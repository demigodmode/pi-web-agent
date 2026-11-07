import { describe, expect, it } from 'vitest';
import { buildCallerContext } from '../../src/orchestration/caller-context.js';
import { classifyResearchIntent } from '../../src/orchestration/research-intent.js';
import type { ResearchEvidence } from '../../src/orchestration/research-types.js';

const page = (summary: string): ResearchEvidence => ({
  title: 'Widget', url: 'https://widget.test/docs', method: 'http',
  sourceKind: 'official-docs', summary, supports: [summary]
});

function input(query = 'Widget versions') {
  return {
    query, intent: classifyResearchIntent(query), evidence: [] as ResearchEvidence[],
    opinionQuestion: false, hasPossibleConflict: false,
    requiredFailureUrls: [] as string[], executedQueries: [query], nextPassIndex: 1,
    partial: true, allowSuggestions: true
  };
}

describe('buildCallerContext', () => {
  it('reports version evidence still missing and suggests unexecuted searches', () => {
    const result = buildCallerContext(input());
    expect(result.openGaps).toContain('Need supported version details.');
    expect(result.suggestedQueries.length).toBeGreaterThan(0);
    expect(result.suggestedQueries.length).toBeLessThanOrEqual(2);
    expect(result.suggestedQueries).not.toContain('Widget versions');
  });

  it('removes a version gap once returned evidence supplies a version', () => {
    expect(buildCallerContext({ ...input(), evidence: [page('Supported since 1.2.3')] }).openGaps)
      .not.toContain('Need supported version details.');
  });

  it('never suggests another query for a confident result', () => {
    expect(buildCallerContext({ ...input(), partial: false }).suggestedQueries).toEqual([]);
  });

  it('suppresses heuristic task gaps and suggestions for a confident result', () => {
    const result = buildCallerContext({ ...input('Widget versions'), partial: false });
    expect(result.openGaps).toEqual([]);
    expect(result.suggestedQueries).toEqual([]);
  });

  it('does not repeat an unread required source as a comparison gap', () => {
    const query = 'Compare https://a.test/docs https://b.test/docs';
    const result = buildCallerContext({ ...input(query), requiredFailureUrls: ['https://b.test/docs'],
      evidence: [{ ...page('A'), url: 'https://a.test/docs', requestedUrl: 'https://a.test/docs' }] });
    expect(result.openGaps.some((gap) => gap.includes('https://b.test/docs'))).toBe(false);
  });

  it('preserves the complete user site scope in suggestions', () => {
    const result = buildCallerContext(input('Widget versions (site:a.test OR site:b.test) -site:github.com'));
    for (const query of result.suggestedQueries) {
      expect(query).toContain('(site:a.test OR site:b.test)');
      expect(query).toContain('-site:github.com');
      expect(query).not.toMatch(/(^|\s)site:github\.com/);
    }
  });

  it('allows an empty suggestion list when both later variants already ran', () => {
    const result = buildCallerContext({ ...input(), nextPassIndex: 3, executedQueries: [
      'Widget versions', 'Widget versions version compatibility changelog',
      'Widget versions release notes', 'Widget versions discussion'
    ] });
    expect(result.suggestedQueries).toEqual([]);
  });

  it('reports an API gap only when the existing heuristic has no evidence', () => {
    expect(buildCallerContext(input('Widget API')).openGaps).toContain('Need exact API behavior.');
    expect(buildCallerContext({ ...input('Widget API'), evidence: [page('API reference')] }).openGaps)
      .not.toContain('Need exact API behavior.');
  });

  it('clears the user-experience gap after discussion evidence arrives', () => {
    const request = { ...input('Widget user opinions'), opinionQuestion: true };
    expect(buildCallerContext(request).openGaps).toContain('Need user experience.');
    expect(buildCallerContext({ ...request, evidence: [{ ...page('User experience'), sourceKind: 'community' }] }).openGaps)
      .not.toContain('Need user experience.');
  });

  it('retains the missing named comparison target', () => {
    const result = buildCallerContext({ ...input('Compare React and Vue'),
      evidence: [{ ...page('React documentation'), title: 'React', url: 'https://react.dev/' }] });
    expect(result.openGaps).toContain('Need comparison evidence for target: Vue');
  });

  it('suppresses proposals when the caller marks the path ineligible', () => {
    const result = buildCallerContext({ ...input(), allowSuggestions: false });
    expect(result.openGaps).toContain('Need supported version details.');
    expect(result.suggestedQueries).toEqual([]);
  });
});
