import { describe, expect, it, vi } from 'vitest';
import * as researchTypes from '../../src/orchestration/research-types.js';
import type { ResearchProgress } from '../../src/orchestration/progress.js';
import { createResearchOrchestrator } from '../../src/orchestration/research-orchestrator.js';
import type {
  ResearchWorkerResult,
  ResearchEvidence,
  ResearchGap,
  ResearchOrchestratorDecision
} from '../../src/orchestration/research-types.js';

describe('research orchestrator types', () => {
  it('reports direct fetch and headless progress with shared counts', async () => {
    const phases: string[] = [];
    const orchestrator = createResearchOrchestrator({
      worker: { run: vi.fn(async () => ({ searchQueries: [], evidence: [], gaps: [], lowValueOutcomes: [], exhaustedBudget: false })) },
      fetchDirect: vi.fn(async ({ url }) => ({ status: 'needs_headless' as const, url, metadata: { method: 'http' as const, cacheHit: false } })),
      headlessFetch: vi.fn(async ({ url }) => ({ status: 'ok' as const, url, content: { title: 'PDF', text: 'Readable PDF content' }, metadata: { method: 'headless' as const, cacheHit: false } }))
    });

    const result = await orchestrator.run({ query: 'Read https://example.com/file.pdf', onProgress: (event) => phases.push(`${event.phase}:${event.fetches}:${event.headless}`) });

    expect(phases).toEqual(['fetch:1:0', 'headless:1:1']);
    expect(result.metadata.budget).toMatchObject({ searches: 0, fetches: 1, headless: 1 });
  });

  it('forwards worker progress to callers', async () => {
    const phases: string[] = [];
    const worker = { run: vi.fn(async ({ onProgress }: { onProgress?: (event: ResearchProgress) => void }) => {
      onProgress?.({ phase: 'search', searches: 1, fetches: 0, headless: 0 });
      return { searchQueries: [], evidence: [], gaps: [], lowValueOutcomes: [], exhaustedBudget: false };
    }) };
    await createResearchOrchestrator({ worker, headlessFetch: vi.fn() }).run({ query: 'plain research', onProgress: (event) => phases.push(event.phase) });
    expect(phases).toContain('search');
  });
  it('reads a supplied PDF directly but researches alternatives for a comparison', async () => {
    const worker = { run: vi.fn(async () => ({ searchQueries: [], evidence: [], gaps: [], lowValueOutcomes: [], exhaustedBudget: false })) };
    const orchestrator = createResearchOrchestrator({
      worker,
      fetchDirect: vi.fn(async ({ url }) => ({
        status: 'ok' as const, url, content: { title: 'Source PDF', text: 'Long readable PDF source content.' },
        metadata: { method: 'pdf' as const, cacheHit: false }
      })),
      headlessFetch: vi.fn()
    });

    await orchestrator.run({ query: 'Read https://example.com/file.pdf' });
    expect(worker.run).not.toHaveBeenCalled();

    await orchestrator.run({ query: 'Please summarize https://example.com/file.pdf' });
    expect(worker.run).not.toHaveBeenCalled();

    await orchestrator.run({ query: 'Compare https://example.com/file.pdf with alternatives' });
    expect(worker.run).toHaveBeenCalled();
  });

  it('keeps searching a named comparison until both targets have evidence', async () => {
    const react = (url: string) => ({ title: 'React guide', url, sourceKind: 'unknown' as const, method: 'http' as const, summary: 'React details', supports: ['React details'] });
    const vue = { title: 'Vue guide', url: 'https://vuejs.org/guide', sourceKind: 'unknown' as const, method: 'http' as const, summary: 'Vue details', supports: ['Vue details'] };
    const worker = { run: vi.fn()
      .mockResolvedValueOnce({ searchQueries: [], evidence: [react('https://react.dev/a'), react('https://react.dev/b')], gaps: [], lowValueOutcomes: [], exhaustedBudget: false })
      .mockResolvedValue({ searchQueries: [], evidence: [vue], gaps: [], lowValueOutcomes: [], exhaustedBudget: false }) };
    const orchestrator = createResearchOrchestrator({ worker, headlessFetch: vi.fn() });

    const result = await orchestrator.run({ query: 'Compare React and Vue' });

    expect(worker.run).toHaveBeenCalledTimes(2);
    expect(worker.run.mock.calls[1]?.[0].query).toContain('Vue comparison evidence');
    expect(result.evidence.some((item) => item.title === 'Vue guide')).toBe(true);
  });

  it('reports the uncovered comparison target when the search budget ends', async () => {
    const react = (url: string) => ({ title: 'React guide', url, sourceKind: 'unknown' as const, method: 'http' as const, summary: 'React details', supports: ['React details'] });
    const worker = { run: vi.fn(async () => ({ searchQueries: [], evidence: [react('https://react.dev/a'), react('https://react.dev/b')], gaps: [], lowValueOutcomes: [], exhaustedBudget: false })) };
    const result = await createResearchOrchestrator({ worker, headlessFetch: vi.fn() }).run({ query: 'Compare React and Vue' });

    expect(result.metadata?.caveatReasons).toContain('missing-comparison-target');
    expect(result.metadata?.missingComparisonTargets).toEqual(['Vue']);
    expect(result.metadata?.exhaustedBudget).toBe(true);
    expect(result.decision.action).toBe('research-again');
  });

  it('plans a version-specific follow-up when the first evidence has no version', async () => {
    const worker = { run: vi.fn()
      .mockResolvedValueOnce({ searchQueries: [], evidence: [
        { title: 'Feature overview', url: 'https://example.com/overview', sourceKind: 'unknown', method: 'http', summary: 'Feature details without compatibility information', supports: [] }
      ], gaps: [], lowValueOutcomes: [], exhaustedBudget: false })
      .mockResolvedValue({ searchQueries: [], evidence: [
        { title: 'Release notes', url: 'https://example.org/releases', sourceKind: 'unknown', method: 'http', summary: 'Feature is supported since 2.0', supports: [] }
      ], gaps: [], lowValueOutcomes: [], exhaustedBudget: false }) };
    await createResearchOrchestrator({ worker, headlessFetch: vi.fn() }).run({ query: 'Which versions support the feature?' });
    expect(worker.run.mock.calls[1]?.[0].query).toContain('supported version release notes');
  });

  it('continues searching after a useful headless result leaves the comparison incomplete', async () => {
    const worker = { run: vi.fn()
      .mockResolvedValueOnce({ searchQueries: [], evidence: [], gaps: [], lowValueOutcomes: [], suggestedHeadlessUrl: 'https://react.dev/guide', exhaustedBudget: false })
      .mockResolvedValue({ searchQueries: [], evidence: [
        { title: 'Vue guide', url: 'https://vuejs.org/guide', sourceKind: 'unknown', method: 'http', summary: 'Vue details', supports: ['Vue details'] }
      ], gaps: [], lowValueOutcomes: [], exhaustedBudget: false }) };
    const headlessFetch = vi.fn(async ({ url }) => ({
      status: 'ok' as const, url, content: { title: 'React guide', text: 'React details available from rendered page.' },
      metadata: { method: 'headless' as const, cacheHit: false }
    }));

    const result = await createResearchOrchestrator({ worker, headlessFetch }).run({ query: 'Compare React and Vue' });

    expect(headlessFetch).toHaveBeenCalledTimes(1);
    expect(worker.run.mock.calls.length).toBeGreaterThan(1);
    expect(result.evidence.some((item) => item.title === 'Vue guide')).toBe(true);
  });
  it('exports a runtime module for orchestration types', () => {
    expect(researchTypes).toBeTypeOf('object');
  });

  it('supports evidence, gaps, and decisions for one bounded pass', () => {
    const evidence: ResearchEvidence = {
      title: 'BrowserType | Playwright',
      url: 'https://playwright.dev/docs/api/class-browsertype',
      sourceKind: 'official-docs',
      method: 'http',
      summary: 'The API docs describe channel and executablePath.',
      supports: ['Use channel for branded browsers', 'executablePath exists but is risky']
    };

    const gap: ResearchGap = {
      kind: 'needs-more-evidence',
      message: 'Need one source showing the recommended Edge usage pattern.'
    };

    const result: ResearchWorkerResult = {
      searchQueries: ['playwright installed edge channel executablePath'],
      evidence: [evidence],
      gaps: [gap],
      lowValueOutcomes: [],
      suggestedHeadlessUrl: undefined,
      exhaustedBudget: false
    };

    const decision: ResearchOrchestratorDecision = {
      action: 'answer',
      rationale: 'One official source is enough for this smoke test.',
      approvedEvidence: result.evidence
    };

    expect(result.evidence[0].sourceKind).toBe('official-docs');
    expect(decision.action).toBe('answer');
  });

  it('supports explicit low-value outcomes in worker results', () => {
    const result: ResearchWorkerResult = {
      searchQueries: ['duckduckgo scraping node'],
      evidence: [],
      gaps: [{ kind: 'fetch-failed', message: 'Primary fetch failed.' }],
      lowValueOutcomes: [
        {
          kind: 'bot-check',
          url: 'https://www.npmjs.com/package/duck-duck-scrape',
          message: 'Headless hit a security verification page.'
        }
      ],
      suggestedHeadlessUrl: undefined,
      exhaustedBudget: false
    };

    expect(result.lowValueOutcomes[0]?.kind).toBe('bot-check');
    expect(result.suggestedHeadlessUrl).toBeUndefined();
  });

  it('fetches direct urls before running search queries', async () => {
    const calls: string[] = [];
    const worker = {
      run: vi.fn(async ({ query }) => {
        calls.push(`search:${query}`);
        return {
          searchQueries: [query],
          evidence: [],
          gaps: [],
          lowValueOutcomes: [],
          exhaustedBudget: false
        };
      })
    };
    const fetchDirect = vi.fn(async ({ url }) => {
      calls.push(`direct:${url}`);
      return {
        status: 'ok' as const,
        url,
        content: { title: 'Linked page', text: 'Linked page has enough useful readable evidence for the result.' },
        metadata: { method: 'http' as const, cacheHit: false }
      };
    });

    const orchestrator = createResearchOrchestrator({
      worker,
      fetchDirect,
      headlessFetch: vi.fn()
    });

    const result = await orchestrator.run({ query: 'Read https://example.com/thread?utm_source=x' });

    expect(calls[0]).toBe('direct:https://example.com/thread');
    expect(fetchDirect).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://example.com/thread',
      query: 'Read https://example.com/thread?utm_source=x'
    }));
    expect(result.evidence[0]?.url).toBe('https://example.com/thread');
  });

  it('uses a late query-relevant passage for direct and direct-headless evidence', async () => {
    const lateAnswer = 'Lunar archive transfer requires the signed manifest before upload.';
    const worker = {
      run: vi.fn(async () => ({ searchQueries: [], evidence: [], gaps: [], lowValueOutcomes: [], exhaustedBudget: false }))
    };
    const fetchDirect = vi.fn(async ({ url }) => ({
      status: 'ok' as const,
      url,
      content: { title: 'Archive guide', text: `${'General archive background. '.repeat(12)}\n\n${lateAnswer}`, sectionAnchor: 'transfer' },
      metadata: { method: 'http' as const, cacheHit: false }
    }));
    const direct = createResearchOrchestrator({ worker, fetchDirect, headlessFetch: vi.fn() });
    const directResult = await direct.run({ query: 'Read https://example.com/archive lunar archive transfer' });

    expect(directResult.evidence[0]?.summary).toContain(lateAnswer);
    expect(directResult.evidence[0]?.supports).toContain(lateAnswer);
    expect(directResult.evidence[0]?.supports.length).toBeGreaterThan(1);
    expect(directResult.evidence[0]?.sectionAnchor).toBe('transfer');
    expect(directResult.evidence[0]?.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const headlessFetch = vi.fn(async ({ url }) => ({
      status: 'ok' as const,
      url,
      content: { title: 'Rendered archive', text: `${'General archive background. '.repeat(12)}\n\n${lateAnswer}` },
      metadata: { method: 'headless' as const, cacheHit: false, browser: 'chromium' as const, navigationMs: 10 }
    }));
    const headless = createResearchOrchestrator({
      worker,
      fetchDirect: vi.fn(async ({ url }) => ({
        status: 'needs_headless' as const,
        url,
        metadata: { method: 'http' as const, cacheHit: false },
        error: { code: 'WEAK_EXTRACTION', message: 'Weak extraction.' }
      })),
      headlessFetch
    });
    const headlessResult = await headless.run({ query: 'Read https://example.com/archive lunar archive transfer' });

    expect(headlessResult.evidence[0]?.summary).toContain(lateAnswer);
    expect(headlessResult.evidence[0]?.supports).toContain(lateAnswer);
    expect(headlessResult.evidence[0]?.supports.length).toBeGreaterThan(1);

    const searchHeadless = createResearchOrchestrator({
      worker: {
        run: vi.fn(async () => ({
          searchQueries: ['lunar archive transfer'], evidence: [], gaps: [], lowValueOutcomes: [],
          suggestedHeadlessUrl: 'https://example.com/archive', exhaustedBudget: false
        }))
      },
      headlessFetch
    });
    const searchHeadlessResult = await searchHeadless.run({ query: 'lunar archive transfer' });

    expect(searchHeadlessResult.evidence[0]?.summary).toContain(lateAnswer);
    expect(searchHeadlessResult.evidence[0]?.supports).toContain(lateAnswer);
  });

  it('uses headless fallback when a direct url has weak http extraction', async () => {
    const fetchDirect = vi.fn(async ({ url }) => ({
      status: 'needs_headless' as const,
      url,
      metadata: { method: 'http' as const, cacheHit: false },
      error: { code: 'WEAK_EXTRACTION', message: 'HTTP extraction was not reliable enough.' }
    }));
    const headlessFetch = vi.fn(async ({ url }) => ({
      status: 'ok' as const,
      url,
      content: { title: 'Rendered thread', text: 'Rendered direct link content is now readable enough to use.' },
      metadata: { method: 'headless' as const, cacheHit: false, browser: 'chromium' as const, navigationMs: 10 }
    }));

    const orchestrator = createResearchOrchestrator({
      worker: {
        run: vi.fn(async () => ({ searchQueries: [], evidence: [], gaps: [], lowValueOutcomes: [], exhaustedBudget: false }))
      },
      fetchDirect,
      headlessFetch
    });

    const result = await orchestrator.run({ query: 'Read https://example.com/comment' });

    expect(headlessFetch).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://example.com/comment',
      query: 'Read https://example.com/comment'
    }));
    expect(result.evidence[0]?.method).toBe('headless');
  });

  it('uses headless when a direct thread url returns bot-check text over http', async () => {
    const fetchDirect = vi.fn(async ({ url }) => ({
      status: 'ok' as const,
      url,
      content: { title: 'Just a moment...', text: 'Checking your browser before accessing the site.' },
      metadata: { method: 'http' as const, cacheHit: false }
    }));
    const headlessFetch = vi.fn(async ({ url }) => ({
      status: 'blocked' as const,
      url,
      metadata: { method: 'headless' as const, cacheHit: false, browser: 'chromium' as const, navigationMs: 10 },
      error: { code: 'HEADLESS_EXTRACTION_WEAK', message: 'Rendered page did not produce enough readable content.' }
    }));

    const orchestrator = createResearchOrchestrator({
      worker: {
        run: vi.fn(async () => ({ searchQueries: [], evidence: [], gaps: [], lowValueOutcomes: [], exhaustedBudget: false }))
      },
      fetchDirect,
      headlessFetch
    });

    const result = await orchestrator.run({ query: 'Read https://www.reddit.com/r/selfhosted/comments/abc/example/' });

    expect(headlessFetch).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://www.reddit.com/r/selfhosted/comments/abc/example',
      query: 'Read https://www.reddit.com/r/selfhosted/comments/abc/example/'
    }));
    expect(result.workerPass.gaps).toContainEqual({
      kind: 'fetch-failed',
      message: 'Thread source could not be read reliably: https://www.reddit.com/r/selfhosted/comments/abc/example'
    });
  });

  it('records a clear gap when a direct thread url cannot be read reliably', async () => {
    const fetchDirect = vi.fn(async ({ url }) => ({
      status: 'needs_headless' as const,
      url,
      metadata: { method: 'http' as const, cacheHit: false },
      error: { code: 'WEAK_EXTRACTION', message: 'HTTP extraction was not reliable enough.' }
    }));
    const headlessFetch = vi.fn(async ({ url }) => ({
      status: 'blocked' as const,
      url,
      metadata: { method: 'headless' as const, cacheHit: false, browser: 'chromium' as const, navigationMs: 10 },
      error: { code: 'HEADLESS_EXTRACTION_WEAK', message: 'Rendered page did not produce enough readable content.' }
    }));

    const orchestrator = createResearchOrchestrator({
      worker: {
        run: vi.fn(async () => ({ searchQueries: [], evidence: [], gaps: [], lowValueOutcomes: [], exhaustedBudget: false }))
      },
      fetchDirect,
      headlessFetch
    });

    const result = await orchestrator.run({ query: 'Read https://www.reddit.com/r/selfhosted/comments/abc/example/' });

    expect(result.workerPass.gaps).toContainEqual({
      kind: 'fetch-failed',
      message: 'Thread source could not be read reliably: https://www.reddit.com/r/selfhosted/comments/abc/example'
    });
  });

  it('answers when one bounded pass returns enough official evidence', async () => {
    const orchestrator = createResearchOrchestrator({
      worker: {
        run: vi.fn().mockResolvedValue({
          searchQueries: ['playwright edge channel'],
          evidence: [
            {
              title: 'Browsers | Playwright',
              url: 'https://playwright.dev/docs/browsers',
              sourceKind: 'official-docs',
              method: 'http',
              summary: 'Use branded browsers with channel values like msedge.',
              supports: ['Use msedge for Edge']
            },
            {
              title: 'BrowserType | Playwright',
              url: 'https://playwright.dev/docs/api/class-browsertype',
              sourceKind: 'official-api',
              method: 'http',
              summary: 'executablePath exists but is use-at-your-own-risk.',
              supports: ['executablePath is risky']
            }
          ],
          gaps: [],
          lowValueOutcomes: [],
          suggestedHeadlessUrl: undefined,
          exhaustedBudget: false
        })
      },
      headlessFetch: vi.fn()
    });

    const result = await orchestrator.run({ query: 'playwright installed edge executablePath vs channel' });

    expect(result.decision.action).toBe('answer');
    expect(result.evidence).toHaveLength(2);
  });

  it('answers with caveat when strong readable evidence includes cautionary conflict markers', async () => {
    const orchestrator = createResearchOrchestrator({
      worker: {
        run: vi.fn(async () => ({
          searchQueries: ['playwright edge executablePath'],
          evidence: [
            {
              title: 'Browsers | Playwright',
              url: 'https://playwright.dev/docs/browsers',
              sourceKind: 'official-docs' as const,
              method: 'http' as const,
              summary: 'Use channel for branded browsers like msedge. This is recommended.',
              supports: ['Use channel for branded browsers']
            },
            {
              title: 'BrowserType | Playwright',
              url: 'https://playwright.dev/docs/api/class-browsertype',
              sourceKind: 'official-api' as const,
              method: 'http' as const,
              summary: 'executablePath is supported but use at your own risk and is not recommended for normal use.',
              supports: ['executablePath is use at your own risk']
            }
          ],
          gaps: [],
          lowValueOutcomes: [],
          exhaustedBudget: false
        }))
      },
      headlessFetch: vi.fn()
    });

    const result = await orchestrator.run({ query: 'playwright installed edge executablePath vs channel' });

    expect(result.decision.action).toBe('research-again');
    expect(result.decision.rationale).toBe('Evidence has quality caveats; answer with caveat.');
    expect(result.metadata?.exhaustedBudget).toBe(false);
  });

  it('requests another pass when evidence is too thin', async () => {
    const orchestrator = createResearchOrchestrator({
      worker: {
        run: vi.fn().mockResolvedValue({
          searchQueries: ['ambiguous query'],
          evidence: [
            {
              title: 'Some blog',
              url: 'https://example.com/post',
              sourceKind: 'community',
              method: 'http',
              summary: 'A single community source only.',
              supports: ['One weak source']
            }
          ],
          gaps: [{ kind: 'needs-more-evidence', message: 'Need at least one official source.' }],
          lowValueOutcomes: [],
          suggestedHeadlessUrl: undefined,
          exhaustedBudget: false
        })
      },
      headlessFetch: vi.fn()
    });

    const result = await orchestrator.run({ query: 'ambiguous query' });

    expect(result.decision.action).toBe('research-again');
  });

  it('answers when successful headless content completes the evidence set', async () => {
    const headlessFetch = vi.fn().mockResolvedValue({
      status: 'ok',
      url: 'https://vitest.dev/guide/coverage.html',
      content: {
        title: 'Coverage | Guide | Vitest',
        text: 'Set coverage.provider to v8. Install @vitest/coverage-v8. Run vitest with --coverage.'
      },
      metadata: {
        method: 'headless',
        cacheHit: false,
        browser: 'edge',
        navigationMs: 900,
        truncated: false
      }
    });

    const orchestrator = createResearchOrchestrator({
      worker: {
        run: vi.fn().mockResolvedValue({
          searchQueries: ['vitest coverage'],
          evidence: [
            {
              title: 'vitest/docs/guide/coverage.md',
              url: 'https://github.com/vitest-dev/vitest/blob/main/docs/guide/coverage.md',
              sourceKind: 'official-docs',
              method: 'http',
              summary: 'Vitest supports native V8 coverage.',
              supports: ['V8 coverage']
            }
          ],
          gaps: [{ kind: 'fetch-failed', message: 'HTTP fetch was weak for https://vitest.dev/guide/coverage.html' }],
          lowValueOutcomes: [],
          suggestedHeadlessUrl: 'https://vitest.dev/guide/coverage.html',
          exhaustedBudget: false
        })
      },
      headlessFetch
    });

    const result = await orchestrator.run({ query: 'vitest coverage v8 provider' });

    expect(result.evidence).toEqual([
      expect.objectContaining({
        title: 'vitest/docs/guide/coverage.md',
        method: 'http'
      }),
      expect.objectContaining({
        title: 'Coverage | Guide | Vitest',
        url: 'https://vitest.dev/guide/coverage.html',
        sourceKind: 'official-docs',
        method: 'headless'
      })
    ]);
    expect(result.decision.action).toBe('answer');
  });

  it('does not turn headless bot-check pages into evidence', async () => {
    const headlessFetch = vi.fn().mockResolvedValue({
      status: 'ok',
      url: 'https://medium.com/example',
      content: {
        title: 'Performing security verification',
        text: 'This website uses a security service to protect itself from online attacks. Please verify you are not a bot.'
      },
      metadata: {
        method: 'headless',
        cacheHit: false,
        browser: 'edge',
        navigationMs: 900,
        truncated: false
      }
    });

    const orchestrator = createResearchOrchestrator({
      worker: {
        run: vi.fn().mockResolvedValue({
          searchQueries: ['medium ddg scraping'],
          evidence: [],
          gaps: [{ kind: 'fetch-failed', message: 'HTTP fetch was weak for https://medium.com/example' }],
          lowValueOutcomes: [],
          suggestedHeadlessUrl: 'https://medium.com/example',
          exhaustedBudget: false
        })
      },
      headlessFetch
    });

    const result = await orchestrator.run({ query: 'duckduckgo scraping medium source' });

    expect(result.evidence).toEqual([]);
    expect(result.decision.action).toBe('escalate-headless');
  });

  it('fetches one specific page with headless only when approved by the orchestrator', async () => {
    const headlessFetch = vi.fn().mockResolvedValue({
      status: 'ok',
      url: 'https://example.com/app',
      content: { title: 'Dynamic App', text: 'Rendered content with enough detail.' },
      metadata: {
        method: 'headless',
        cacheHit: false,
        browser: 'edge',
        navigationMs: 1200,
        truncated: false
      }
    });

    const orchestrator = createResearchOrchestrator({
      worker: {
        run: vi.fn().mockResolvedValue({
          searchQueries: ['dynamic app'],
          evidence: [],
          gaps: [{ kind: 'fetch-failed', message: 'HTTP was weak.' }],
          lowValueOutcomes: [],
          suggestedHeadlessUrl: 'https://example.com/app',
          exhaustedBudget: false
        })
      },
      headlessFetch
    });

    const result = await orchestrator.run({ query: 'dynamic app' });

    expect(result.decision.action).toBe('research-again');
    expect(result.evidence).toHaveLength(1);
    expect(headlessFetch).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com/app', query: 'dynamic app' }));
  });

  it('answers once two strong sources exist and one is official', async () => {
    const orchestrator = createResearchOrchestrator({
      worker: {
        run: vi.fn().mockResolvedValue({
          searchQueries: ['playwright edge channel'],
          evidence: [
            {
              title: 'Browsers | Playwright',
              url: 'https://playwright.dev/docs/browsers',
              sourceKind: 'official-docs',
              method: 'http',
              summary: 'Official docs',
              supports: ['Use channel']
            },
            {
              title: 'Edge docs',
              url: 'https://learn.microsoft.com/en-us/microsoft-edge/playwright/',
              sourceKind: 'official-discussion',
              method: 'http',
              summary: 'Vendor guidance',
              supports: ['Use msedge']
            }
          ],
          gaps: [],
          lowValueOutcomes: [],
          suggestedHeadlessUrl: undefined,
          exhaustedBudget: false
        })
      },
      headlessFetch: vi.fn()
    });

    const result = await orchestrator.run({ query: 'playwright edge channel' });
    expect(result.decision.action).toBe('answer');
  });

  it('does not escalate to headless when strong http evidence already answers the question', async () => {
    const headlessFetch = vi.fn();
    const orchestrator = createResearchOrchestrator({
      worker: {
        run: vi.fn().mockResolvedValue({
          searchQueries: ['vitest coverage docs'],
          evidence: [
            {
              title: 'Coverage | Guide | Vitest',
              url: 'https://vitest.dev/guide/coverage.html',
              sourceKind: 'official-docs',
              method: 'http',
              summary: 'Coverage docs',
              supports: ['provider v8']
            },
            {
              title: 'Coverage package',
              url: 'https://vitest.dev/guide/coverage.html#provider',
              sourceKind: 'official-api',
              method: 'http',
              summary: 'Install @vitest/coverage-v8',
              supports: ['install package']
            }
          ],
          gaps: [{ kind: 'fetch-failed', message: 'One page was weak over HTTP.' }],
          lowValueOutcomes: [],
          suggestedHeadlessUrl: 'https://vitest.dev/guide/coverage.html',
          exhaustedBudget: false
        })
      },
      headlessFetch
    });

    const result = await orchestrator.run({ query: 'vitest coverage docs' });
    expect(result.decision.action).toBe('answer');
    expect(headlessFetch).not.toHaveBeenCalled();
  });

  it('prefers stronger sources over package pages in approved evidence', async () => {
    const orchestrator = createResearchOrchestrator({
      worker: {
        run: vi.fn().mockResolvedValue({
          searchQueries: ['duckduckgo scraping node'],
          evidence: [
            {
              title: 'npm package',
              url: 'https://www.npmjs.com/package/duck-duck-scrape',
              sourceKind: 'package-page',
              method: 'http',
              summary: 'Package page',
              supports: ['Install command']
            },
            {
              title: 'SearXNG docs',
              url: 'https://docs.searxng.org/dev/engines/online/duckduckgo.html',
              sourceKind: 'community',
              method: 'http',
              summary: 'vqd and pagination details',
              supports: ['vqd matters']
            },
            {
              title: 'ddg-search',
              url: 'https://github.com/camohiddendj/ddg-search',
              sourceKind: 'community',
              method: 'http',
              summary: 'Node implementation',
              supports: ['bot detection note']
            }
          ],
          gaps: [],
          lowValueOutcomes: [],
          suggestedHeadlessUrl: undefined,
          exhaustedBudget: false
        })
      },
      headlessFetch: vi.fn()
    });

    const result = await orchestrator.run({ query: 'duckduckgo scraping node' });

    expect(result.decision.action).toBe('research-again');
    expect(result.evidence[0]?.sourceKind).not.toBe('package-page');
  });

  it('runs another search pass when first pass evidence is too thin', async () => {
    const worker = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          searchQueries: ['vitest coverage'],
          evidence: [
            {
              title: 'Blog',
              url: 'https://example.com/blog',
              sourceKind: 'community',
              method: 'http',
              summary: 'community summary',
              supports: ['community support']
            }
          ],
          gaps: [{ kind: 'needs-more-evidence', message: 'Need official docs.' }],
          lowValueOutcomes: [],
          suggestedHeadlessUrl: undefined,
          exhaustedBudget: false
        })
        .mockResolvedValueOnce({
          searchQueries: ['site:vitest.dev Vitest coverage docs V8 provider'],
          evidence: [
            {
              title: 'Coverage | Guide | Vitest',
              url: 'https://vitest.dev/guide/coverage.html',
              sourceKind: 'official-docs',
              method: 'http',
              summary: 'Official coverage docs',
              supports: ['provider v8']
            },
            {
              title: 'Config | Vitest',
              url: 'https://vitest.dev/config/',
              sourceKind: 'official-api',
              method: 'http',
              summary: 'Official config docs',
              supports: ['coverage config']
            }
          ],
          gaps: [],
          lowValueOutcomes: [],
          suggestedHeadlessUrl: undefined,
          exhaustedBudget: false
        })
    };

    const orchestrator = createResearchOrchestrator({ worker, headlessFetch: vi.fn() });
    const result = await orchestrator.run({ query: 'Find Vitest coverage V8 docs' });

    expect(worker.run).toHaveBeenCalledTimes(2);
    expect(result.decision.action).toBe('answer');
    expect(result.evidence.map((item) => item.sourceKind)).toEqual(['official-docs', 'official-api', 'community']);
  });

  it('records low-value bot-check outcomes as a reason not to escalate again', async () => {
    const headlessFetch = vi.fn().mockResolvedValue({
      status: 'ok',
      url: 'https://www.npmjs.com/package/duck-duck-scrape',
      content: {
        title: 'Just a moment...',
        text: 'Performing security verification'
      },
      metadata: {
        method: 'headless',
        cacheHit: false,
        browser: 'edge',
        navigationMs: 5000,
        truncated: false
      }
    });

    const orchestrator = createResearchOrchestrator({
      worker: {
        run: vi.fn().mockResolvedValue({
          searchQueries: ['duckduckgo scraping node'],
          evidence: [],
          gaps: [{ kind: 'needs-more-evidence', message: 'Need one more technical source.' }],
          lowValueOutcomes: [
            {
              kind: 'bot-check',
              url: 'https://www.npmjs.com/package/duck-duck-scrape',
              message: 'Security verification wall.'
            }
          ],
          suggestedHeadlessUrl: 'https://www.npmjs.com/package/duck-duck-scrape',
          exhaustedBudget: false
        })
      },
      headlessFetch
    });

    const result = await orchestrator.run({ query: 'duckduckgo scraping node' });
    expect(result.decision.action).toBe('research-again');
    expect(headlessFetch).not.toHaveBeenCalled();
  });

  it('accumulates fanout providers across multiple search passes', async () => {
    const worker = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          searchQueries: ['vitest coverage'],
          evidence: [
            {
              title: 'Blog',
              url: 'https://example.com/blog',
              sourceKind: 'community' as const,
              method: 'http' as const,
              summary: 'community summary',
              supports: ['community support']
            }
          ],
          gaps: [{ kind: 'needs-more-evidence' as const, message: 'Need official docs.' }],
          lowValueOutcomes: [],
          suggestedHeadlessUrl: undefined,
          exhaustedBudget: false,
          fanoutProviders: ['duckduckgo', 'brave'],
          fanoutSkipped: ['exa']
        })
        .mockResolvedValueOnce({
          searchQueries: ['site:vitest.dev vitest coverage docs'],
          evidence: [
            {
              title: 'Coverage | Guide | Vitest',
              url: 'https://vitest.dev/guide/coverage.html',
              sourceKind: 'official-docs' as const,
              method: 'http' as const,
              summary: 'Official coverage docs',
              supports: ['provider v8']
            },
            {
              title: 'Config | Vitest',
              url: 'https://vitest.dev/config/',
              sourceKind: 'official-api' as const,
              method: 'http' as const,
              summary: 'Official config docs',
              supports: ['coverage config']
            }
          ],
          gaps: [],
          lowValueOutcomes: [],
          suggestedHeadlessUrl: undefined,
          exhaustedBudget: false,
          fanoutProviders: ['duckduckgo', 'exa'],
          fanoutSkipped: ['youcom']
        })
    };

    const orchestrator = createResearchOrchestrator({ worker, headlessFetch: vi.fn() });
    const result = await orchestrator.run({ query: 'Find Vitest coverage V8 docs' });

    expect(worker.run).toHaveBeenCalledTimes(2);
    expect(result.decision.action).toBe('answer');
    expect(result.metadata?.fanoutProviders).toEqual(expect.arrayContaining(['duckduckgo', 'brave', 'exa']));
    expect(result.metadata?.fanoutProviders?.length).toBe(3);
    expect(result.metadata?.fanoutSkipped).toEqual(expect.arrayContaining(['youcom']));
    expect(result.metadata?.fanoutSkipped?.length).toBe(1);
    expect(result.metadata?.fanoutSkipped).not.toContain('exa');
  });
});

describe('orchestrator cancellation', () => {
  const weakPass = {
    searchQueries: ['q'],
    evidence: [],
    gaps: [],
    lowValueOutcomes: [],
    suggestedHeadlessUrl: 'https://spa.test/',
    exhaustedBudget: false
  };

  it('starts no further pass and no headless escalation after a cancel', async () => {
    const controller = new AbortController();
    const worker = {
      run: vi.fn(async () => {
        controller.abort();
        return weakPass;
      })
    };
    const headlessFetch = vi.fn();
    const orchestrator = createResearchOrchestrator({ worker, headlessFetch });

    await expect(orchestrator.run({ query: 'q', signal: controller.signal })).rejects.toThrow('Operation aborted');
    expect(worker.run).toHaveBeenCalledTimes(1);
    expect(headlessFetch).not.toHaveBeenCalled();
  });

  it('does not fetch a direct url when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchDirect = vi.fn();
    const orchestrator = createResearchOrchestrator({ worker: { run: vi.fn() }, fetchDirect, headlessFetch: vi.fn() });
    await expect(orchestrator.run({ query: 'read https://example.com/page', signal: controller.signal })).rejects.toThrow('Operation aborted');
    expect(fetchDirect).not.toHaveBeenCalled();
  });

  it('passes the signal to the worker', async () => {
    const controller = new AbortController();
    const worker = { run: vi.fn(async () => ({ ...weakPass, suggestedHeadlessUrl: undefined })) };
    await createResearchOrchestrator({ worker, headlessFetch: vi.fn() }).run({ query: 'q', signal: controller.signal });
    expect(worker.run).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
  });
});

describe('orchestrator run budget', () => {
  it('returns accumulated evidence at the deadline while an uncooperative worker remains pending', async () => {
    vi.useFakeTimers();
    let resolveWorker!: (value: ResearchWorkerResult) => void;
    const firstEvidence = { title: 'Initial guide', url: 'https://example.com/guide', sourceKind: 'unknown' as const, method: 'http' as const, summary: 'Useful initial evidence', supports: ['Useful initial evidence'] };
    const worker = { run: vi.fn()
      .mockResolvedValueOnce({ searchQueries: ['initial'], evidence: [firstEvidence], gaps: [], lowValueOutcomes: [], exhaustedBudget: false })
      .mockImplementationOnce(() => new Promise<ResearchWorkerResult>((resolve) => { resolveWorker = resolve; })) };
    const orchestrator = createResearchOrchestrator({
      worker,
      headlessFetch: vi.fn()
    });

    try {
      const run = orchestrator.run({ query: 'pending search' });
      await vi.advanceTimersByTimeAsync(120_000);
      const result = await run;

      expect(worker.run).toHaveBeenCalledTimes(2);
      expect(result.metadata.exhaustedBudget).toBe(true);
      expect(result.metadata.budgetReason).toBe('deadline');
      expect(result.evidence).toContainEqual(firstEvidence);

      resolveWorker({ searchQueries: [], evidence: [], gaps: [], lowValueOutcomes: [], exhaustedBudget: false });
      await orchestrator.drain();
    } finally {
      vi.useRealTimers();
    }
  });
});
