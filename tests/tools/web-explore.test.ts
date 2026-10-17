import { describe, expect, it, vi } from 'vitest';
import { createWebExploreTool } from '../../src/tools/web-explore.js';

describe('web_explore tool', () => {
  it('pairs all five findings with their sources', async () => {
    const evidence = Array.from({ length: 6 }, (_, index) => ({
      title: `Source ${index + 1}`,
      url: `https://example.com/${index + 1}`,
      sourceKind: 'official-docs' as const,
      method: index === 4 ? 'headless' as const : 'http' as const,
      summary: `Finding ${index + 1}`,
      supports: [`Finding ${index + 1}`]
    }));
    const webExplore = createWebExploreTool({
      explore: vi.fn().mockResolvedValue({
        decision: { action: 'answer' },
        evidence,
        workerPass: {}
      })
    });

    const result = await webExplore({ query: 'Compare the six sources' });

    expect(result.findings).toEqual(['Finding 1', 'Finding 2', 'Finding 3', 'Finding 4', 'Finding 5']);
    expect(result.sources).toEqual(evidence.slice(0, 5).map(({ title, url, method }) => ({ title, url, method })));
    expect(result.findingSourceIds).toEqual([['S1'], ['S2'], ['S3'], ['S4'], ['S5']]);
    expect(result.evidence?.map((item) => item.id)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5']);
    expect(result.presentation?.views.preview).toContain('[web_fetch_headless] Finding 5');
    expect(result.presentation?.views.verbose).toContain('Source 5: https://example.com/5');
    expect(result.presentation?.views.verbose).not.toContain('Source 6: https://example.com/6');
  });

  it('returns bounded excerpts with available source metadata', async () => {
    const supports = Array.from({ length: 3 }, (_, index) => `passage ${index}: ${'x'.repeat(1000)}`);
    const webExplore = createWebExploreTool({
      explore: vi.fn().mockResolvedValue({
        decision: { action: 'answer' },
        evidence: Array.from({ length: 5 }, (_, index) => ({
          title: `Source ${index}`, url: `https://example.com/${index}`, sourceKind: 'official-docs', method: 'http',
          summary: `Finding ${index}`, supports, sectionAnchor: 'relevant', retrievedAt: '2026-10-17T00:00:00.000Z', truncated: false
        })),
        workerPass: {}
      })
    });

    const result = await webExplore({ query: 'question' });

    expect(result.evidence).toHaveLength(5);
    expect(result.evidence?.[0]?.excerpts[0]).toEqual({ text: supports[0].slice(0, 900), anchor: 'relevant' });
    expect(result.evidence?.[0]?.retrievedAt).toBe('2026-10-17T00:00:00.000Z');
    expect(result.evidence?.[0]?.truncated).toBe(true);
    expect(result.evidence?.flatMap((item) => item.excerpts).reduce((sum, item) => sum + item.text.length, 0)).toBeLessThanOrEqual(10000);
    expect(result.evidence?.[4]?.excerpts.length).toBeGreaterThan(0);
    expect(result.findingSourceIds?.every((ids, index) => ids[0] === result.evidence?.[index]?.id)).toBe(true);
  });

  it('returns clean findings, sources, and no caveat when evidence is sufficient', async () => {
    const webExplore = createWebExploreTool({
      explore: vi.fn().mockResolvedValue({
        decision: {
          action: 'answer',
          rationale: 'Enough evidence.',
          approvedEvidence: [
            {
              title: 'Browsers | Playwright',
              url: 'https://playwright.dev/docs/browsers',
              sourceKind: 'official-docs',
              method: 'http',
              summary: 'Use channel for branded browsers.',
              supports: ['Use channel']
            },
            {
              title: 'BrowserType | Playwright',
              url: 'https://playwright.dev/docs/api/class-browsertype',
              sourceKind: 'official-api',
              method: 'http',
              summary: 'executablePath is supported but use at your own risk.',
              supports: ['executablePath is risky']
            }
          ]
        },
        evidence: [
          {
            title: 'Browsers | Playwright',
            url: 'https://playwright.dev/docs/browsers',
            sourceKind: 'official-docs',
            method: 'http',
            summary: 'Use channel for branded browsers.',
            supports: ['Use channel']
          },
          {
            title: 'BrowserType | Playwright',
            url: 'https://playwright.dev/docs/api/class-browsertype',
            sourceKind: 'official-api',
            method: 'http',
            summary: 'executablePath is supported but use at your own risk.',
            supports: ['executablePath is risky']
          }
        ],
        workerPass: {
          searchQueries: ['playwright installed edge executablePath vs channel'],
          evidence: [],
          gaps: [],
          lowValueOutcomes: [],
          suggestedHeadlessUrl: undefined,
          exhaustedBudget: false
        }
      })
    });

    const result = await webExplore({
      query: 'Find current docs or discussions about Playwright launching an installed Chrome or Edge executable instead of a bundled browser, then summarize the recommended approach.'
    });

    expect(result.status).toBe('ok');
    expect(result.findings).toEqual([
      'Use channel for branded browsers.',
      'executablePath is supported but use at your own risk.'
    ]);
    expect(result.sources).toEqual([
      {
        title: 'Browsers | Playwright',
        url: 'https://playwright.dev/docs/browsers',
        method: 'http'
      },
      {
        title: 'BrowserType | Playwright',
        url: 'https://playwright.dev/docs/api/class-browsertype',
        method: 'http'
      }
    ]);
    expect(result.caveat).toBeUndefined();
    expect(result.presentation?.views.compact).toBe(
      'Reviewed 2 sources · synthesized answer with 2 findings'
    );
    expect(result.presentation?.views.preview).toContain('Use channel for branded browsers.');
    expect(result).not.toHaveProperty('text');
  });

  it('returns a caveat when only partial evidence is available', async () => {
    const webExplore = createWebExploreTool({
      explore: vi.fn().mockResolvedValue({
        decision: {
          action: 'research-again',
          rationale: 'Evidence is partial.',
          followupQuery: 'same query'
        },
        evidence: [
          {
            title: 'Coverage | Guide | Vitest',
            url: 'https://vitest.dev/guide/coverage.html',
            sourceKind: 'official-docs',
            method: 'headless',
            summary: 'Set coverage.provider to v8 and install @vitest/coverage-v8.',
            supports: ['provider: v8', 'install @vitest/coverage-v8']
          }
        ],
        workerPass: {
          searchQueries: ['vitest coverage docs'],
          evidence: [],
          gaps: [{ kind: 'needs-more-evidence', message: 'Only one strong source was gathered.' }],
          lowValueOutcomes: [],
          suggestedHeadlessUrl: undefined,
          exhaustedBudget: false
        }
      })
    });

    const result = await webExplore({
      query: 'Find the current Vitest coverage docs and tell me how to enable coverage with the V8 provider in a TypeScript project.'
    });

    expect(result.status).toBe('ok');
    expect(result.findings).toEqual([
      'Set coverage.provider to v8 and install @vitest/coverage-v8.'
    ]);
    expect(result.sources).toEqual([
      {
        title: 'Coverage | Guide | Vitest',
        url: 'https://vitest.dev/guide/coverage.html',
        method: 'headless'
      }
    ]);
    expect(result.caveat).toBe('Evidence is partial, so this answer is based on the strongest source found within the bounded research budget.');
    expect(result.presentation?.views.compact).toBe(
      'Reviewed 1 sources · synthesized answer with 1 findings'
    );
  });

  it('uses specific caveat reasons from research metadata', async () => {
    const webExplore = createWebExploreTool({
      explore: vi.fn().mockResolvedValue({
        decision: {
          action: 'research-again',
          rationale: 'Evidence is partial.',
          followupQuery: 'same query'
        },
        evidence: [
          {
            title: 'Source A',
            url: 'https://example.com/a',
            sourceKind: 'community',
            method: 'http',
            summary: 'A practical source.',
            supports: ['practical source']
          }
        ],
        workerPass: {
          searchQueries: ['q1'],
          evidence: [],
          gaps: [],
          lowValueOutcomes: [],
          exhaustedBudget: true
        },
        metadata: {
          searchPasses: 1,
          fetchedPages: 1,
          headlessAttempts: 0,
          exhaustedBudget: true,
          caveatReasons: ['community-only', 'low-diversity']
        }
      })
    });

    const result = await webExplore({ query: 'example query' });

    expect(result.caveat).toBe(
      'Evidence is partial: the strongest readable sources were mostly community/practical context, and the source set was narrow.'
    );
  });

  it('rejects empty exploration queries', async () => {
    const explore = vi.fn(async (): Promise<never> => {
      throw new Error('explore should not run for an empty query');
    });
    const webExplore = createWebExploreTool({ explore });

    await expect(webExplore({ query: '   ' })).resolves.toMatchObject({
      status: 'error',
      error: { code: 'INVALID_QUERY' }
    });
    expect(explore).not.toHaveBeenCalled();
  });

  it('does not leak raw internal worker bookkeeping into visible output', async () => {
    const webExplore = createWebExploreTool({
      explore: vi.fn().mockResolvedValue({
        decision: {
          action: 'research-again',
          rationale: 'Not enough evidence.',
          followupQuery: 'same query'
        },
        evidence: [
          {
            title: 'Source A',
            url: 'https://example.com/a',
            sourceKind: 'community',
            method: 'http',
            summary: 'A concise summary.',
            supports: ['detail a']
          }
        ],
        workerPass: {
          searchQueries: ['q1'],
          evidence: [],
          gaps: [{ kind: 'needs-more-evidence', message: 'Need more.' }],
          lowValueOutcomes: [{ kind: 'empty-search', message: 'No more results.' }],
          suggestedHeadlessUrl: 'https://example.com/b',
          exhaustedBudget: false
        }
      })
    });

    const result = await webExplore({ query: 'example query' });

    expect(JSON.stringify(result)).not.toContain('searchQueries');
    expect(JSON.stringify(result)).not.toContain('lowValueOutcomes');
    expect(JSON.stringify(result)).not.toContain('suggestedHeadlessUrl');
    expect(result.findings).toEqual(['Community/practical context: A concise summary.']);
    expect(result.presentation?.views.preview).toContain('- [web_fetch] Community/practical context: A concise summary.');
  });
});

describe('web_explore cancellation (#59)', () => {
  it('rejects as soon as the run is cancelled, even if the workflow ignores the signal', async () => {
    const explore = vi.fn(() => new Promise<never>(() => undefined));
    const controller = new AbortController();
    const pending = createWebExploreTool({ explore })({ query: 'q', signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow('Operation aborted');
  });

  it('does not start a run that is already cancelled', async () => {
    const explore = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(createWebExploreTool({ explore })({ query: 'q', signal: controller.signal })).rejects.toThrow('Operation aborted');
    expect(explore).not.toHaveBeenCalled();
  });

  it('passes the signal to the workflow', async () => {
    const explore = vi.fn().mockResolvedValue({
      decision: { action: 'answer' },
      evidence: [],
      workerPass: {},
      metadata: { searchPasses: 0, fetchedPages: 0, headlessAttempts: 0, exhaustedBudget: false }
    });
    const controller = new AbortController();
    await createWebExploreTool({ explore })({ query: 'q', signal: controller.signal });
    expect(explore).toHaveBeenCalledWith({ query: 'q', signal: controller.signal });
  });
});
