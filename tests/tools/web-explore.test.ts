import { describe, expect, it, vi } from 'vitest';
import { createWebExploreTool } from '../../src/tools/web-explore.js';
import type { ResearchProgress } from '../../src/orchestration/progress.js';

describe('web_explore tool', () => {
  it('records an injected elapsed duration without changing synthesized output', async () => {
    let time = 100;
    const webExplore = createWebExploreTool({
      now: () => time,
      explore: vi.fn().mockImplementation(async () => {
        time = 650;
        return { decision: { action: 'answer' }, evidence: [], workerPass: {} };
      })
    });
    const result = await webExplore({ query: 'example', startedAt: 100 });
    expect(result.durationMs).toBe(550);
    expect(result.findings).toEqual([]);
  });

  it('uses a local start time when callers do not supply one', async () => {
    let time = 10;
    const webExplore = createWebExploreTool({
      now: () => time,
      explore: vi.fn().mockImplementation(async () => {
        time = 20;
        return { decision: { action: 'answer' }, evidence: [], workerPass: {} };
      })
    });
    await expect(webExplore({ query: 'example' })).resolves.toMatchObject({ durationMs: 10 });
  });

  it('keeps all successful required sources public while findings use the first five', async () => {
    const required = Array.from({ length: 8 }, (_, index) => ({
      title: `Required ${index + 1}`, url: `https://required.example/${index + 1}`, requestedUrl: `https://query.example/${index + 1}`,
      sourceKind: 'official-docs' as const, method: 'http' as const, summary: `Required finding ${index + 1}`, supports: [`Required finding ${index + 1}`]
    }));
    const webExplore = createWebExploreTool({ explore: vi.fn().mockResolvedValue({ decision: { action: 'answer' }, evidence: [...required, { title: 'Extra', url: 'https://extra.example', sourceKind: 'community', method: 'http', summary: 'Extra finding', supports: ['Extra finding'] }], requiredSourceEvidence: required, requiredSourceFailures: [], workerPass: {} }) });
    const result = await webExplore({ query: 'Read required links' });
    expect(result.sources).toHaveLength(9);
    expect(result.evidence).toHaveLength(9);
    expect(result.findings).toEqual(required.slice(0, 5).map((item) => item.summary));
    expect(result.findingSourceIds).toEqual([['S1'], ['S2'], ['S3'], ['S4'], ['S5']]);
  });
  it('forces a model-facing caveat for incomplete GitHub thread comments even when answering', async () => {
    const webExplore = createWebExploreTool({
      explore: vi.fn().mockResolvedValue({
        decision: { action: 'answer' },
        evidence: [{ title: 'Issue', url: 'https://github.com/o/r/issues/1', sourceKind: 'issue-thread', method: 'github', summary: 'detail', supports: ['detail'], partialComments: true }],
        workerPass: {},
        metadata: { searchPasses: 1, fetchedPages: 1, headlessAttempts: 0, exhaustedBudget: false, caveatReasons: ['partial-thread-comments'] }
      })
    });
    const result = await webExplore({ query: 'issue' });
    expect(result.caveat).toContain('the GitHub thread comments were incomplete');
  });
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

  it('passes progress events from the workflow to its caller', async () => {
    const onProgress = vi.fn();
    const explore = vi.fn(async ({ onProgress: emit }: { onProgress?: (event: ResearchProgress) => void }) => {
      emit?.({ phase: 'search', searches: 1, fetches: 0, headless: 0 });
      return { decision: { action: 'answer' as const }, evidence: [], workerPass: {} };
    });
    const webExplore = createWebExploreTool({ explore });

    await webExplore({ query: 'example', onProgress });

    expect(onProgress).toHaveBeenCalledWith({ phase: 'search', searches: 1, fetches: 0, headless: 0 });
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'complete' }));
  });
  it('retains presentation stats on a terminal workflow error', async () => {
    const presentationStats = { searches: 1, executedQueries: ['q'], pagesRead: 0, failedReads: 1, methods: {} };
    const webExplore = createWebExploreTool({
      explore: vi.fn().mockResolvedValue({ decision: { action: 'research-again' }, evidence: [], workerPass: {}, terminalFailure: { code: 'SEARCH_FAILED', message: 'failed' }, metadata: { searchPasses: 1, fetchedPages: 0, headlessAttempts: 0, exhaustedBudget: false, presentationStats } })
    });
    const onProgress = vi.fn();
    const result = await webExplore({ query: 'q', onProgress });
    expect(result.status).toBe('error');
    expect(result.metadata?.presentationStats).toBe(presentationStats);
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'complete', state: 'settled' }));
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

describe('web_explore terminal source preservation', () => {
  it('keeps earlier required evidence and reports required failures when later work terminates', async () => {
    const direct = { title: 'Direct', url: 'https://example.test/final', requestedUrl: 'https://example.test/requested', sourceKind: 'official-docs' as const, method: 'http' as const, summary: 'Direct finding', supports: ['Direct finding'] };
    const result = await createWebExploreTool({ explore: vi.fn().mockResolvedValue({
      decision: { action: 'research-again' }, evidence: [direct], requiredSourceEvidence: [direct],
      requiredSourceFailures: [{ url: 'https://example.test/bad', reason: 'read-failed', code: 'DIRECT_SOURCE_READ_FAILED', message: 'unreadable' }],
      workerPass: {}, terminalFailure: { code: 'UPSTREAM', message: 'worker stopped' }
    }) })({ query: 'read links' });
    expect(result.status).toBe('error');
    expect(result.sources).toEqual([expect.objectContaining({ requestedUrl: 'https://example.test/requested' })]);
    expect(result.evidence?.[0]).toMatchObject({ url: 'https://example.test/final' });
    expect(result.presentation?.views.compact).toContain('Required source not read');
  });

  it('retains requested URL identity for a redirected required source', async () => {
    const source = { title: 'Final', url: 'https://example.test/final', requestedUrl: 'https://example.test/requested', sourceKind: 'official-docs' as const, method: 'http' as const, summary: 'Final evidence', supports: ['Final evidence'] };
    const result = await createWebExploreTool({ explore: vi.fn().mockResolvedValue({ decision: { action: 'answer' }, evidence: [source], requiredSourceEvidence: [source], workerPass: {} }) })({ query: 'read source' });
    expect(result.sources).toEqual([expect.objectContaining({ url: source.url, requestedUrl: source.requestedUrl })]);
    expect(result.evidence?.[0]?.url).toBe(source.url);
  });

  it('includes two required sources before ranked discretionary findings and keeps source IDs aligned', async () => {
    const required = [1, 2].map((n) => ({ title: `Required ${n}`, url: `https://required.test/${n}`, requestedUrl: `https://input.test/${n}`, sourceKind: 'official-docs' as const, method: 'http' as const, summary: `Required ${n}`, supports: [`Required ${n}`] }));
    const discretionary = { title: 'Ranked', url: 'https://ranked.test', sourceKind: 'community' as const, method: 'http' as const, summary: 'Ranked finding', supports: ['Ranked finding'] };
    const result = await createWebExploreTool({ explore: vi.fn().mockResolvedValue({ decision: { action: 'answer' }, evidence: [...required, discretionary], requiredSourceEvidence: required, workerPass: {} }) })({ query: 'compare' });
    expect(result.sources.map((item) => item.url)).toEqual([...required.map((item) => item.url), discretionary.url]);
    expect(result.findingSourceIds).toEqual([['S1'], ['S2'], ['S3']]);
  });

  it('keeps search evidence when a required item has no requested URL', async () => {
    const required = { title: 'Direct', url: 'https://direct.test', sourceKind: 'official-docs' as const, method: 'http' as const, summary: 'Direct finding', supports: ['Direct finding'] };
    const searched = { title: 'Searched', url: 'https://search.test', sourceKind: 'official-docs' as const, method: 'http' as const, summary: 'Search finding', supports: ['Search finding'] };
    const result = await createWebExploreTool({ explore: vi.fn().mockResolvedValue({ decision: { action: 'answer' }, evidence: [required, searched], requiredSourceEvidence: [required], workerPass: {} }) })({ query: 'research' });
    expect(result.sources.map((item) => item.url)).toEqual([required.url, searched.url]);
    expect(result.findings).toEqual(['Direct finding', 'Search finding']);
    expect(result.findingSourceIds).toEqual([['S1'], ['S2']]);
  });

  it('reports a terminal required failure before its error when there are no findings', async () => {
    const result = await createWebExploreTool({ explore: vi.fn().mockResolvedValue({ decision: { action: 'research-again' }, evidence: [], requiredSourceFailures: [{ url: 'https://bad.test', reason: 'read-failed', code: 'DIRECT_SOURCE_READ_FAILED', message: 'cannot read' }], workerPass: {}, terminalFailure: { code: 'UPSTREAM', message: 'stopped' } }) })({ query: 'read' });
    expect(result.findings).toEqual([]);
    const compact = result.presentation?.views.compact ?? '';
    expect(compact.indexOf('Required source not read')).toBeLessThan(compact.indexOf('Research failed'));
  });
});
