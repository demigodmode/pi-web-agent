import { describe, expect, it } from 'vitest';
import { allocateResult } from '../../src/results/allocate.js';
import { countResultContent } from '../../src/results/content-length.js';
import { prepareEvidenceSources } from '../../src/tools/evidence-records.js';
import type { PreparedSource, ResultAllocationInput } from '../../src/results/types.js';

function passages(...text: string[]) { return text.map((value, order) => ({ text: value, order, score: 10 - order, codeBlock: false })); }
function ordinary(id: string, text: string, required = false): PreparedSource {
  return { id, required, reader: false, title: id, url: `https://${id}.test`, method: 'http', ranked: passages(text), retrievalCut: false, selectionOmitted: false };
}
function requiredReader(id: string, text: string): PreparedSource {
  return { ...ordinary(id, text, true), reader: true, method: 'pdf', readerDocument: text, ranked: passages(...text.split('\n\n')) };
}
function discoveredReader(id: string, text: string): PreparedSource {
  return { ...ordinary(id, text), reader: true, method: 'pdf', readerDocument: text, ranked: passages(...text.split('\n\n')) };
}
function input(sources: PreparedSource[], setting: ResultAllocationInput['setting'] = 1000): ResultAllocationInput {
  return { sources, findings: [], findingSourceIds: [], context: {}, setting };
}
function actual(result: ReturnType<typeof allocateResult>) {
  return countResultContent(result.modelResult.findings.map(f => f.text), result.evidence.flatMap(s => s.excerpts.map(e => e.text)), result.modelResult.contextLines);
}

describe('allocateResult', () => {
  it('keeps a finite result within 1000 and Auto 8192, with excerpts getting the remaining room', () => {
    const text = 'a'.repeat(850);
    const base = input([ordinary('S1', text), ordinary('S2', text), ordinary('S3', text), ordinary('S4', text)]);
    base.findings = Array.from({ length: 5 }, (_, n) => `Finding ${n} ${'x'.repeat(150)}`);
    base.findingSourceIds = base.findings.map((_, n) => [`S${(n % 4) + 1}`]);
    base.context = { openGaps: ['missing evidence'], suggestedQueries: ['more evidence'], executedQueries: ['test query'] };
    for (const setting of [1000, 'auto'] as const) {
      const result = allocateResult({ ...base, setting, ...(setting === 'auto' ? { model: { contextWindow: 8192 } } : {}) });
      expect(actual(result)).toBeLessThanOrEqual(result.effectiveChars!);
      expect(result.requiredOverflowChars).toBe(0);
      // Fair sharing applies the 300-character discovered-source floor to all
      // eligible sources, so a crowded 1k result may intentionally have none.
      expect(result.evidence.every(source => source.excerpts.length === 0 && source.spaceCut)).toBe(true);
    }
  });

  it('preserves a supplied reader document once at Standard, but caps a discovered reader', () => {
    const document = ['first paragraph', 'second paragraph', 'third paragraph'].join('\n\n');
    const required = allocateResult(input([requiredReader('S1', document)], 'standard'));
    expect(required.evidence[0]!.excerpts.map(e => e.text).join('\n\n')).toBe(document);
    const discovered = allocateResult(input([discoveredReader('S1', document)], 'standard'));
    expect(discovered.evidence[0]!.excerpts).toHaveLength(3);
  });

  it('keeps a real capped 24k supplied reader once while a discovered reader stays at three excerpts', () => {
    const document = Array.from({ length: 30 }, (_, index) => `${index}:${'p'.repeat(797)}`).join('\n\n');
    const supplied = allocateResult(input([requiredReader('S1', document)], 'standard'));
    expect(supplied.evidence[0]!.excerpts.map(excerpt => excerpt.text).join('\n\n')).toBe(document);
    const found = allocateResult(input([discoveredReader('S1', document)], 'standard'));
    expect(found.evidence[0]!.excerpts).toHaveLength(3);
    expect(found.evidence[0]!.excerpts.every(excerpt => Array.from(excerpt.text).length <= 900)).toBe(true);
  });

  it('gives every required source a first bounded excerpt before extras and measures overflow', () => {
    const result = allocateResult(input([
      requiredReader('S1', 'a'.repeat(900)), requiredReader('S2', 'b'.repeat(900)), requiredReader('S3', 'c'.repeat(900))
    ], 'short'));
    expect(result.evidence.every(source => source.excerpts[0] && source.excerpts[0].text.length <= 900)).toBe(true);
    expect(result.requiredOverflowChars).toBeLessThanOrEqual(2700);
  });

  it('shares Standard ordinary capacity across required and discovered sources', () => {
    const sources = Array.from({ length: 8 }, (_, n) => ordinary(`S${n + 1}`, 'x'.repeat(900), true))
      .concat(Array.from({ length: 5 }, (_, n) => ordinary(`D${n + 1}`, 'y'.repeat(900))));
    const result = allocateResult(input(sources, 'standard'));
    expect(result.evidence.flatMap(source => source.excerpts).reduce((sum, excerpt) => sum + Array.from(excerpt.text).length, 0)).toBeLessThanOrEqual(10_000);
  });

  it('shares the Standard ordinary pool fairly across discovered sources in rank order', () => {
    const sources = Array.from({ length: 5 }, (_, source) => ({
      ...ordinary(`S${source + 1}`, `${source}:first ${'a'.repeat(890)}`),
      ranked: passages(
        `${source}:first ${'a'.repeat(890)}`,
        `${source}:second ${'b'.repeat(889)}`,
        `${source}:third ${'c'.repeat(890)}`
      )
    }));
    const result = allocateResult(input(sources, 'standard'));

    expect(result.evidence.map(source => source.excerpts.reduce((sum, excerpt) => sum + excerpt.text.length, 0))).toEqual([2000, 2000, 2000, 2000, 2000]);
    expect(result.evidence.every(source => source.spaceCut)).toBe(true);
    expect(result.cutSourceIds).toEqual(['S1', 'S2', 'S3', 'S4', 'S5']);
  });

  it('refunds Standard pool text removed by a later covering excerpt before sharing later sources', () => {
    const short = `short ${'s'.repeat(594)}`;
    const sources = [
      { ...ordinary('S1', short), ranked: passages(short, `A ${'a'.repeat(898)}`, `B ${'b'.repeat(898)}`) },
      { ...ordinary('S2', `${short} qualified ${'q'.repeat(280)}`), ranked: passages(`${short} qualified ${'q'.repeat(280)}`, `C ${'c'.repeat(898)}`, `D ${'d'.repeat(898)}`) },
      ...Array.from({ length: 3 }, (_, index) => ({ ...ordinary(`S${index + 3}`, `x${index} ${'x'.repeat(897)}`), ranked: passages(`x${index} ${'x'.repeat(897)}`, `y${index} ${'y'.repeat(897)}`, `z${index} ${'z'.repeat(897)}`) }))
    ];
    const result = allocateResult(input(sources, 'standard'));
    expect(result.evidence.slice(2).map(source => source.excerpts.reduce((sum, excerpt) => sum + excerpt.text.length, 0))).toEqual([2200, 2200, 2200]);
    expect(result.evidence.flatMap(source => source.excerpts).reduce((sum, excerpt) => sum + excerpt.text.length, 0)).toBe(10_000);
  });

  it('does not use text removed from another source to exceed a bounded source share', () => {
    const short = `short ${'s'.repeat(594)}`;
    const sources = [
      { ...ordinary('S1', short), ranked: passages(short, `A ${'a'.repeat(898)}`, `B ${'b'.repeat(898)}`) },
      { ...ordinary('S2', `${short} qualified ${'q'.repeat(280)}`), ranked: passages(`${short} qualified ${'q'.repeat(280)}`, `C ${'c'.repeat(898)}`, `D ${'d'.repeat(898)}`) },
      ordinary('S3', `x ${'x'.repeat(898)}`), ordinary('S4', `y ${'y'.repeat(898)}`), ordinary('S5', `z ${'z'.repeat(898)}`)
    ];
    const result = allocateResult(input(sources, 4000));
    const s2 = result.evidence[1]!;
    expect(s2.excerpts.reduce((sum, excerpt) => sum + excerpt.text.length, 0)).toEqual(799);
    for (const source of result.evidence) for (const coverage of source.samePassageAs ?? []) {
      expect(result.evidence.find(target => target.id === coverage.sourceId)?.excerpts[coverage.excerptIndex]).toBeDefined();
    }
  });

  it('marks every discovered source cut when its tight bounded share is below 300 characters', () => {
    const sources = Array.from({ length: 14 }, (_, source) => ({
      ...ordinary(`S${source + 1}`, `${source}:first ${'a'.repeat(890)}`),
      ranked: passages(`${source}:first ${'a'.repeat(890)}`, `${source}:second ${'b'.repeat(889)}`, `${source}:third ${'c'.repeat(890)}`)
    }));
    const result = allocateResult(input(sources, 'short'));

    expect(result.evidence.every(source => source.excerpts.length === 0 && source.spaceCut)).toBe(true);
    expect(result.cutSourceIds).toEqual(sources.map(source => source.id));
  });

  it('gives all five discovered sources a Short fair share and reports their clipped selected text', () => {
    const sources = Array.from({ length: 5 }, (_, source) => ({
      ...ordinary(`S${source + 1}`, `${source}:first ${'a'.repeat(890)}`),
      ranked: passages(`${source}:first ${'a'.repeat(890)}`, `${source}:second ${'b'.repeat(889)}`, `${source}:third ${'c'.repeat(890)}`)
    }));
    const result = allocateResult(input(sources, 'short'));

    expect(result.evidence.map(source => source.excerpts[0]!.text.length)).toEqual([800, 799, 799, 799, 799]);
    expect(result.cutSourceIds).toEqual(sources.map(source => source.id));
  });

  it('only aliases a shorter passage to emitted covering text, and keeps old alias indexes valid', () => {
    const result = allocateResult(input([
      ordinary('S0', 'short qualification'),
      ordinary('S1', 'short qualification'),
      ordinary('S2', `short qualification ${'x'.repeat(890)}`)
    ], 2000));
    for (const source of result.evidence) for (const coverage of source.samePassageAs ?? []) {
      const target = result.evidence.find(candidate => candidate.id === coverage.sourceId)?.excerpts[coverage.excerptIndex];
      expect(target).toBeDefined();
      expect(target!.text).toContain('short qualification');
    }
  });

  it('does not redirect an earlier alias to its own source when a later excerpt replaces its target', () => {
    const original = 'shared evidence with a detail';
    const replacement = 'shared evidence with a detail and a longer qualification';
    const result = allocateResult(input([
      ordinary('S2', original),
      { ...ordinary('S1', 'shared evidence'), ranked: passages('shared evidence', replacement) }
    ], 'standard'));

    expect(result.evidence[0]!.samePassageAs).toEqual([{ sourceId: 'S1', excerptIndex: 0, relation: 'covered' }]);
    expect(result.evidence[1]!.samePassageAs?.some(alias => alias.sourceId === 'S1')).toBe(false);
  });

  it('does not replace a shorter emitted passage with a clipped non-covering candidate', () => {
    const result = allocateResult(input([
      ordinary('S1', 'tail qualification'),
      ordinary('S2', `${'x'.repeat(895)} tail qualification`)
    ], 1000));
    expect(result.evidence[0]!.excerpts[0]!.text).toBe('tail qualification');
  });

  it('marks required Standard passages cut when their selected ordinary pool text cannot fit', () => {
    const sources = Array.from({ length: 8 }, (_, index) => ({
      ...ordinary(`R${index + 1}`, `${index} ${'r'.repeat(898)}`, true),
      ranked: passages(`${index} ${'r'.repeat(898)}`, `${index} extra ${'e'.repeat(892)}`)
    }));
    const result = allocateResult(input(sources, 'standard'));
    expect(result.cutSourceIds.length).toBeGreaterThan(0);
    expect(result.evidence.some(source => source.spaceCut)).toBe(true);
  });

  it('drops all remaining Standard discovered sources when their shared remainder is below 300', () => {
    const required = Array.from({ length: 8 }, (_, index) => ({
      ...ordinary(`R${index + 1}`, `${index} ${'r'.repeat(898)}`, true),
      ranked: passages(`${index} ${'r'.repeat(898)}`, `${index} extra ${'e'.repeat(892)}`)
    }));
    // First passages consume 7200; required extras consume the next 2300.
    required[2]!.ranked[1] = { ...required[2]!.ranked[1]!, text: `2 extra ${'e'.repeat(492)}` };
    const result = allocateResult(input([...required, ordinary('D1', 'd'.repeat(900)), ordinary('D2', 'e'.repeat(900))], 'standard'));
    expect(result.evidence.slice(-2).every(source => source.excerpts.length === 0 && source.spaceCut)).toBe(true);
    expect(result.cutSourceIds).toEqual(expect.arrayContaining(['D1', 'D2']));
  });

  it('counts the first excerpt section separator after a finding', () => {
    const base = input([ordinary('S1', 'x'.repeat(900))], 1000);
    base.findings = ['f'.repeat(180)]; base.findingSourceIds = [['S1']];
    const result = allocateResult(base);
    expect(result.modelResult.contentChars).toBeLessThanOrEqual(1000);
    expect(result.evidence[0]!.excerpts[0]!.text).toHaveLength(818);
  });

  it('keeps longer containment and only emits aliases that point at real excerpts', () => {
    const result = allocateResult(input([
      ordinary('S1', 'recommended mode'), ordinary('S2', 'recommended mode for development only')
    ], 2000));
    expect(result.evidence[1]!.excerpts[0]!.text).toContain('development only');
    for (const source of result.evidence) for (const coverage of source.samePassageAs ?? []) {
      const target = result.evidence.find(candidate => candidate.id === coverage.sourceId);
      expect(target?.excerpts[coverage.excerptIndex]).toBeDefined();
    }
  });

  it('does not mutate input candidate arrays or renumber public IDs', () => {
    const source = ordinary('S9', 'unique source text '.repeat(40));
    const before = JSON.stringify(source);
    const result = allocateResult(input([source], 'short'));
    expect(JSON.stringify(source)).toBe(before);
    expect(result.evidence[0]!.id).toBe('S9');
  });

  it('never dedupes the only excerpt of either required source', () => {
    const result = allocateResult(input([ordinary('S1', 'same required evidence', true), ordinary('S2', 'same required evidence', true)], 1000));
    expect(result.evidence.map(source => source.excerpts).every(excerpts => excerpts.length === 1)).toBe(true);
  });

  it('drops a finding only when its own emitted excerpt contains it', () => {
    const base = input([ordinary('S1', 'recommended mode for development only')], 2000);
    base.findings = ['recommended mode', 'recommended mode for development only with a qualification'];
    base.findingSourceIds = [['S1'], ['S1']];
    const result = allocateResult(base);
    expect(result.modelResult.findings.map(finding => finding.index)).toEqual([1]);
  });

  it('does not treat a finding number as covered by a larger number substring', () => {
    const base = input([ordinary('S1', 'The timeout is 500 milliseconds.')], 2000);
    base.findings = ['50'];
    base.findingSourceIds = [['S1']];
    expect(allocateResult(base).modelResult.findings.map(finding => finding.text)).toEqual(['50']);
  });

  it('uses community context only as a coverage label, including through emitted aliases', () => {
    const base = input([ordinary('S1', 'practical recommendation'), ordinary('S2', 'practical recommendation with details')], 'standard');
    base.findings = ['Community/practical context: practical recommendation', 'Community/practical context: unrelated advice'];
    base.findingSourceIds = [['S1'], ['S1']];
    const result = allocateResult(base);

    expect(result.evidence[0]!.samePassageAs?.[0]).toMatchObject({ sourceId: 'S2', excerptIndex: 0 });
    expect(result.modelResult.findings.map(finding => finding.text)).toEqual(['Community/practical context: unrelated advice']);
  });

  it('keeps Standard context within its one shared 1000-character allowance', () => {
    const base = input([], 'standard');
    base.context = { openGaps: ['g'.repeat(600)], suggestedQueries: ['s'.repeat(600)], executedQueries: ['q'.repeat(600)] };
    const result = allocateResult(base);
    expect(Array.from(result.modelResult.contextLines.join('\n')).length).toBeLessThanOrEqual(1000);
  });

  it('keeps a later longer qualification and aliases the earlier shorter source at Standard', () => {
    const result = allocateResult(input([ordinary('S1', 'recommended mode'), ordinary('S2', 'recommended mode for development only')], 'standard'));
    expect(result.evidence[1]!.excerpts).toHaveLength(1);
    expect(result.evidence[0]!.excerpts).toHaveLength(0);
    expect(result.evidence[0]!.samePassageAs?.[0]).toMatchObject({ sourceId: 'S2', excerptIndex: 0 });
  });

  it('marks actual finite clipping and retains anchors and code provenance across duplicate comparison', () => {
    const source = { ...ordinary('S1', 'x'.repeat(900)), sectionAnchor: 'section' };
    const result = allocateResult(input([source, ordinary('S2', 'y'.repeat(900))], 1000));
    expect(result.evidence[0]!.excerpts[0]?.anchor).toBe('section');
    expect(result.evidence.some(record => record.spaceCut)).toBe(true);
  });

  it('uses required record position, not redirect-equivalent URLs, in the preparation seam', () => {
    const records = prepareEvidenceSources([
      { title: 'one', url: 'https://redirect.test', method: 'http', sourceKind: 'unknown', summary: 'one', supports: ['one'] },
      { title: 'two', url: 'https://redirect.test', method: 'http', sourceKind: 'unknown', summary: 'two', supports: ['two'] }
    ], 'query', 1);
    expect(records.map(record => record.required)).toEqual([true, false]);
  });

  it('accounts for every separator with five unique findings, full context, and many distinct candidates', () => {
    const sources = Array.from({ length: 12 }, (_, index) => ordinary(`S${index + 1}`, `${index}:${String.fromCharCode(65 + index)}${'x'.repeat(895)}`));
    const base = input(sources, 1000);
    base.findings = Array.from({ length: 5 }, (_, index) => `Finding ${index} ${String.fromCharCode(65 + index)}${'q'.repeat(165)}`);
    base.findingSourceIds = base.findings.map((_, index) => [`S${index + 1}`]);
    base.context = { openGaps: Array.from({ length: 4 }, (_, n) => `gap ${n}`), suggestedQueries: ['one', 'two'], executedQueries: Array.from({ length: 6 }, (_, n) => `search ${n}`) };
    for (const setting of [1000, 'auto'] as const) {
      const result = allocateResult({ ...base, setting, ...(setting === 'auto' ? { model: { contextWindow: 8192 } } : {}) });
      expect(actual(result)).toBeLessThanOrEqual(result.effectiveChars!);
      expect(result.evidence.every(source => source.excerpts.length === 0 && source.spaceCut)).toBe(true);
    }
  });

  it('gives all eight required ordinary sources their first excerpt before spending the shared Standard pool', () => {
    const sources = Array.from({ length: 8 }, (_, index) => ({ ...ordinary(`S${index + 1}`, `${index}a${'a'.repeat(898)}`, true), ranked: passages(`${index}a${'a'.repeat(898)}`, `${index}b${'b'.repeat(898)}`, `${index}c${'c'.repeat(898)}`) }))
      .concat(Array.from({ length: 5 }, (_, index) => ({ ...ordinary(`D${index + 1}`, `${index}d${'d'.repeat(898)}`), ranked: passages(`${index}d${'d'.repeat(898)}`, `${index}e${'e'.repeat(898)}`, `${index}f${'f'.repeat(898)}`) })));
    const result = allocateResult(input(sources, 'standard'));
    expect(result.evidence.slice(0, 8).every((source) => source.excerpts.length > 0)).toBe(true);
    expect(result.evidence.flatMap((source) => source.excerpts).reduce((sum, item) => sum + Array.from(item.text).length, 0)).toBeLessThanOrEqual(10_000);
  });

  it('keeps all fourteen required ordinary first excerpts at Standard after their pool share is exhausted', () => {
    const required = Array.from({ length: 14 }, (_, index) => ordinary(`R${index + 1}`, `R${String(index).padStart(2, '0')}:${'x'.repeat(896)}`, true));
    const discovered = Array.from({ length: 2 }, (_, index) => ordinary(`D${index + 1}`, `discovered${index} ${'y'.repeat(888)}`));
    const result = allocateResult(input([...required, ...discovered], 'standard'));

    expect(result.evidence.slice(0, 14).map(source => source.excerpts[0]?.text.length)).toEqual(Array(14).fill(900));
    expect(result.evidence.slice(0, 14).some(source => source.spaceCut)).toBe(false);
    expect(result.evidence.slice(14).map(source => ({ id: source.id, excerpts: source.excerpts.length, spaceCut: source.spaceCut }))).toEqual([
      { id: 'D1', excerpts: 0, spaceCut: true }, { id: 'D2', excerpts: 0, spaceCut: true }
    ]);
  });

  it('follows a nonadjacent covering source and resolves finding coverage through the emitted alias', () => {
    const base = input([ordinary('S1', 'recommended mode'), ordinary('S2', 'unrelated evidence'), ordinary('S9', 'recommended mode for development only')], 2000);
    base.findings = ['recommended mode']; base.findingSourceIds = [['S1']];
    const result = allocateResult(base);
    expect(result.evidence[0]!.samePassageAs?.[0]).toMatchObject({ sourceId: 'S9', excerptIndex: 0 });
    expect(result.modelResult.findings).toEqual([]);
  });

  it('keeps a finding when its only covering candidate is cut for finite space', () => {
    const base = input([ordinary('S2', `other ${'y'.repeat(895)}`), ordinary('S1', `${'z'.repeat(895)} cover`)], 1000);
    base.findings = ['cover']; base.findingSourceIds = [['S1']];
    const result = allocateResult(base);
    expect(result.modelResult.findings.map((finding) => finding.text)).toContain('cover');
  });

  it('preserves reader bytes exactly at Standard, including fenced-code whitespace', () => {
    const document = 'before\\n\\n```ts\\n  a  + b\\n\\n  c()\\n```\\n\\nafter  \\n';
    const result = allocateResult(input([requiredReader('S1', document)], 'standard'));
    expect(result.evidence[0]!.excerpts).toEqual([{ text: document }]);
  });

  it('keeps finite-space clipping, retrieval cuts, and aliases distinct', () => {
    const source = { ...ordinary('S1', 'a'.repeat(900)), retrievalCut: true };
    const result = allocateResult(input([source, ordinary('S2', 'b'.repeat(900))], 1000));
    expect(result.evidence[0]!.retrievalCut).toBe(true);
    expect(result.evidence.some((record) => record.spaceCut)).toBe(true);
  });

  it('resolves every bounded preset and falls back to Standard for an unknown Auto model', () => {
    const source = ordinary('S1', 'short evidence');
    expect(allocateResult(input([source], 'short')).effectiveChars).toBe(4000);
    expect(allocateResult(input([source], 'medium')).effectiveChars).toBe(8000);
    expect(allocateResult(input([source], 4096)).effectiveChars).toBe(4096);
    expect(allocateResult({ ...input([source], 'auto'), model: { contextWindow: 32_000 } }).effectiveChars).toBeGreaterThan(0);
    expect(allocateResult({ ...input([source], 'auto'), model: { contextWindow: 128_000 } }).effectiveChars).toBeGreaterThan(0);
    const unknown = allocateResult(input([source], 'auto'));
    expect(unknown.effectiveChars).toBeUndefined();
    expect(unknown.modelResult).toEqual(allocateResult(input([source], 'standard')).modelResult);
  });
});
