import { describe, expect, it } from 'vitest';
import { allocateResult } from '../../src/results/allocate.js';
import { countResultContent } from '../../src/results/content-length.js';
import type { PreparedSource, ResultAllocationInput } from '../../src/results/types.js';

function source(id: string, texts: string[], required = false): PreparedSource {
  return {
    id, title: id, url: `https://example.test/${id}`, method: 'http', required, reader: false,
    ranked: texts.map((text, order) => ({ text, order, score: 100 - order, codeBlock: false })),
    retrievalCut: false, selectionOmitted: false
  };
}
function input(sources: PreparedSource[], setting: ResultAllocationInput['setting'] = 1000): ResultAllocationInput {
  return { sources, setting, findings: [], findingSourceIds: [], context: {} };
}
const paragraph = (label: string, length = 900) => `${label} ${'content '.repeat(length)}`.slice(0, length);

describe('allocation contract boundaries', () => {
  it('lets required readers use more than three relevant passages under Short', () => {
    const item = source('S1', Array.from({ length: 8 }, (_, n) => paragraph(`passage${n}`)), true);
    item.reader = true;
    item.method = 'pdf';
    item.readerDocument = item.ranked.map(candidate => candidate.text).join('\n\n');
    const result = allocateResult(input([item], 'short'));
    expect(result.evidence[0]!.excerpts.length).toBeGreaterThan(3);
    expect(result.modelResult.contentChars).toBe(4000);
    expect(result.evidence[0]!.spaceCut).toBe(true);
  });

  it('marks a unique short finding omitted by the finding allowance as cut for space', () => {
    const data = input([source('S1', ['first evidence']), source('S2', ['second evidence'])]);
    data.findings = ['A'.repeat(180), 'a unique second finding'];
    data.findingSourceIds = [['S1'], ['S2']];
    const result = allocateResult(data);
    expect(result.modelResult.findings.map(finding => finding.index)).toEqual([0]);
    expect(result.evidence[1]!.spaceCut).toBe(true);
    expect(result.cutSourceIds).toContain('S2');
  });

  it('does not report an omitted finding as cut when a final alias actually covers it', () => {
    const data = input([source('S1', ['actual shared evidence']), source('S2', ['actual shared evidence'])]);
    data.findings = ['A'.repeat(180), 'actual shared evidence'];
    data.findingSourceIds = [['S1'], ['S2']];
    const result = allocateResult(data);
    expect(result.evidence[1]!.samePassageAs).toEqual([{ sourceId: 'S1', excerptIndex: 0, relation: 'same' }]);
    expect(result.evidence[1]!.spaceCut).toBe(false);
  });

  it('applies the 300-character floor to discovered sources, not required-source extras', () => {
    const data = input([source('S1', [paragraph('first'), paragraph('second', 400)], true)], 1200);
    const result = allocateResult(data);
    expect(result.evidence[0]!.excerpts.map(excerpt => excerpt.text.length)).toEqual([900, 299]);
    expect(result.modelResult.contentChars).toBe(1200);
  });

  it('does not allocate a discovered excerpt when exactly 299 characters remain', () => {
    const required = source('S1', [paragraph('first', 700)], true);
    const result = allocateResult(input([required, source('S2', [paragraph('second', 400)])]));
    expect(result.evidence[1]!.excerpts).toEqual([]);
    expect(result.evidence[1]!.spaceCut).toBe(true);
    expect(result.evidence[1]!.samePassageAs).toBeUndefined();
  });

  it('uses both sides of interior fenced-code provenance during dedupe', () => {
    const code = source('S1', ['value  =  result']);
    code.ranked[0]!.codeBlock = true;
    const result = allocateResult(input([code, source('S2', ['value = result'])], 'standard'));
    expect(result.evidence.map(item => item.excerpts.length)).toEqual([1, 1]);
    expect(result.evidence[1]!.samePassageAs).toBeUndefined();
  });

  it('dedupes a finding when the final excerpt adds another number', () => {
    const data = input([source('S1', ['Supported in 1.4 since 2020.'])]);
    data.findings = ['Supported in 1.4'];
    data.findingSourceIds = [['S1']];
    expect(allocateResult(data).modelResult.findings).toEqual([]);
  });

  it('keeps a full required document outside the ordinary Standard pool', () => {
    const reader = source('R', [paragraph('reader')], true);
    reader.reader = true;
    reader.method = 'pdf';
    reader.readerDocument = 'document '.repeat(3000).slice(0, 24_000);
    const ordinary = Array.from({ length: 10 }, (_, n) => source(`S${n}`, Array.from({ length: 3 }, (_, p) => paragraph(`source${n}passage${p}`))));
    const result = allocateResult(input([reader, ...ordinary], 'standard'));
    expect(result.evidence[0]!.excerpts.map(excerpt => excerpt.text).join('')).toBe(reader.readerDocument);
    expect(result.evidence.slice(1).flatMap(item => item.excerpts).reduce((sum, excerpt) => sum + excerpt.text.length, 0)).toBe(10_000);
  });

  it('preserves a naturally short required excerpt without padding', () => {
    const result = allocateResult(input([source('S1', ['short but relevant'], true)]));
    expect(result.evidence[0]!.excerpts).toEqual([{ text: 'short but relevant' }]);
    expect(result.requiredOverflowChars).toBe(0);
  });

  it('keeps exact counts, bounded overflow, valid aliases and determinism across small budgets', () => {
    for (const budget of [1000, 1001, 1031, 1310, 4000]) {
      for (const required of [0, 1, 3, 8]) {
        const sources = Array.from({ length: 12 }, (_, n) => source(`S${n}`, [paragraph(`unique${n}`), paragraph(`extra${n}`, 700)], n < required));
        const data = input(sources, budget);
        data.findings = Array.from({ length: 5 }, (_, n) => `unique finding ${n} ${'z'.repeat(160)}`);
        data.findingSourceIds = data.findings.map((_, n) => [`S${n}`]);
        data.context = { suggestedQueries: ['first follow-up', 'second follow-up'], openGaps: ['missing detail'], executedQueries: ['query with "quotes"', 'other query'] };
        const before = JSON.stringify(data);
        const result = allocateResult(data);
        const actual = countResultContent(result.modelResult.findings.map(item => item.text), result.evidence.flatMap(item => item.excerpts.map(excerpt => excerpt.text)), result.modelResult.contextLines);
        expect(result.modelResult.contentChars).toBe(actual);
        expect(actual).toBeLessThanOrEqual(budget + 900 * required);
        expect(result.requiredOverflowChars).toBe(Math.max(0, actual - budget));
        expect(result.evidence.slice(0, required).every(item => item.excerpts.length > 0)).toBe(true);
        expect(JSON.stringify(data)).toBe(before);
        expect(allocateResult(data)).toEqual(result);
      }
    }
  });
});
