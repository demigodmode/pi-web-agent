import { describe, expect, it } from 'vitest';
import { serializeExploreResult } from '../../src/tools/serialize-explore-result.js';

describe('serializeExploreResult', () => {
  it('uses allocated findings, explicit read cuts, coverage, and the single space-cut notice', () => {
    expect(serializeExploreResult({
      status: 'ok', findings: ['Presentation finding'], sources: [{ title: 'One', url: 'https://one.test' }, { title: 'Two', url: 'https://two.test' }],
      modelResult: { findings: [{ index: 1, text: 'Allocated finding', sourceIds: ['S2'] }], contextLines: ['Still open: "one thing"'], contentChars: 42 },
      evidence: [
        { id: 'S1', title: 'One', url: 'https://one.test', excerpts: [{ text: 'actual excerpt' }], retrievalCut: true, selectionOmitted: false, spaceCut: false },
        { id: 'S2', title: 'Two', url: 'https://two.test', excerpts: [], retrievalCut: false, selectionOmitted: false, spaceCut: true, samePassageAs: [{ sourceId: 'S1', excerptIndex: 0, relation: 'covered' }] }
      ],
      metadata: { searchPasses: 0, fetchedPages: 0, headlessAttempts: 0, exhaustedBudget: false, resultLength: { setting: 'short', effectiveChars: 4000, contentChars: 42, requiredOverflowChars: 0, cutSourceIds: ['S2'] } }
    })).toContain('[S2] Allocated finding');
    const text = serializeExploreResult({
      status: 'ok', findings: [], sources: [{ title: 'One', url: 'https://one.test' }, { title: 'Two', url: 'https://two.test' }],
      modelResult: { findings: [], contextLines: [], contentChars: 0 },
      evidence: [
        { id: 'S1', title: 'One', url: 'https://one.test', excerpts: [{ text: 'actual excerpt' }], retrievalCut: true, selectionOmitted: false, spaceCut: false },
        { id: 'S2', title: 'Two', url: 'https://two.test', excerpts: [], retrievalCut: false, selectionOmitted: false, spaceCut: true, samePassageAs: [{ sourceId: 'S1', excerptIndex: 0, relation: 'covered' }] }
      ],
      metadata: { searchPasses: 0, fetchedPages: 0, headlessAttempts: 0, exhaustedBudget: false, resultLength: { setting: 'short', effectiveChars: 4000, contentChars: 0, requiredOverflowChars: 0, cutSourceIds: ['S2'] } }
    });
    expect(text).toContain('(document longer than what was read)');
    expect(text).toContain('covered by a passage from S1');
    expect(text).toContain("S2 had more relevant text that didn't fit. Re-read a link with a narrower question if you need it.");
    expect(text).not.toContain('source excerpt truncated');
  });
});
