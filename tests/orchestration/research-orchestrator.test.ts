import { describe, expect, it, vi } from 'vitest';
import * as researchTypes from '../../src/orchestration/research-types.js';
import { createResearchOrchestrator } from '../../src/orchestration/research-orchestrator.js';
import type {
  ResearchWorkerResult,
  ResearchEvidence,
  ResearchGap,
  ResearchOrchestratorDecision
} from '../../src/orchestration/research-types.js';

describe('research orchestrator types', () => {
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
    expect(headlessFetch).toHaveBeenCalledWith({ url: 'https://example.com/app' });
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
});
