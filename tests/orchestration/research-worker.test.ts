import { describe, expect, it, vi } from 'vitest';
import { createResearchWorker } from '../../src/orchestration/research-worker.js';
import { createPresentationStats } from '../../src/orchestration/presentation-stats.js';
import { createResearchRunBudget } from '../../src/orchestration/run-budget.js';
import type { WebFetchResponse } from '../../src/types.js';
import { createFirecrawlFetcher } from '../../src/fetch/firecrawl-fetch.js';

describe('research worker', () => {
  it('retains several source passages and extraction metadata from an ordinary page', async () => {
    const worker = createResearchWorker({
      search: vi.fn().mockResolvedValue({
        status: 'ok',
        results: [{ title: 'Coverage guide', url: 'https://example.com/coverage', snippet: 'Coverage' }],
        metadata: { backend: 'duckduckgo', cacheHit: false }
      }),
      fetchPage: vi.fn().mockResolvedValue({
        status: 'ok', url: 'https://example.com/coverage',
        content: { title: 'Coverage guide', text: 'First coverage paragraph.\n\nSecond coverage paragraph.\n\nThird coverage paragraph.', sectionAnchor: 'coverage' },
        metadata: { method: 'http', cacheHit: false, contentType: 'text/html', truncated: true }
      })
    });

    const result = await worker.run({ query: 'coverage', maxSearchRounds: 1, maxFetches: 1 });
    expect(result.evidence[0]?.supports).toEqual(['First coverage paragraph.', 'Second coverage paragraph.', 'Third coverage paragraph.']);
    expect(result.evidence[0]?.sectionAnchor).toBe('coverage');
    expect(result.evidence[0]?.truncated).toBe(true);
    expect(result.evidence[0]?.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('does not assign a fresh retrieval time to cached source text', async () => {
    const worker = createResearchWorker({
      search: vi.fn().mockResolvedValue({
        status: 'ok', results: [{ title: 'Cached guide', url: 'https://example.com/cached', snippet: 'Guide' }],
        metadata: { backend: 'duckduckgo', cacheHit: false }
      }),
      fetchPage: vi.fn().mockResolvedValue({
        status: 'ok', url: 'https://example.com/cached',
        content: { title: 'Cached guide', text: 'Cached guide content.' },
        metadata: { method: 'http', cacheHit: true, truncated: false }
      })
    });

    const result = await worker.run({ query: 'cached guide', maxSearchRounds: 1, maxFetches: 1 });
    expect(result.evidence[0]?.retrievedAt).toBeUndefined();
  });

  it('keeps the original retrieval time when later concurrent pages finish', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const urls = ['https://a.example.com/guide', 'https://b.example.com/guide'];
    const waiting = new Map<string, (value: WebFetchResponse) => void>();
    const partials: string[] = [];
    const worker = createResearchWorker({
      search: vi.fn(async () => ({ status: 'ok' as const, results: urls.map((url) => ({ title: 'Guide', url, snippet: 'Guide' })), metadata: { backend: 'duckduckgo' as const, cacheHit: false } })),
      fetchPage: vi.fn(({ url }: { url: string }) => new Promise<WebFetchResponse>((resolve) => waiting.set(url, resolve)))
    });
    const response = (url: string): WebFetchResponse => ({ status: 'ok', url, content: { title: 'Guide', text: `Guide content from ${url}` }, metadata: { method: 'http', cacheHit: false } });

    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const run = worker.run({ query: 'guide', maxSearchRounds: 1, maxFetches: 2, onPartial: (partial) => {
        const retrievedAt = partial.evidence.find((item) => item.url === urls[0])?.retrievedAt;
        if (retrievedAt) partials.push(retrievedAt);
      } });
      await vi.waitFor(() => expect(waiting.size).toBe(2));
      waiting.get(urls[0])!(response(urls[0]));
      await vi.waitFor(() => expect(partials).toHaveLength(1));
      vi.setSystemTime(new Date('2026-01-01T01:00:00.000Z'));
      waiting.get(urls[1])!(response(urls[1]));
      const result = await run;
      expect(result.evidence[0]?.retrievedAt).toBe(partials[0]);
    } finally {
      vi.useRealTimers();
    }
  });
  it('emits started and settled search and fetch events without page content', async () => {
    const url = 'https://example.com/guide';
    const events: Array<{ phase: string; searches: number; fetches: number; headless: number }> = [];
    const worker = createResearchWorker({
      search: vi.fn(async () => ({ status: 'ok' as const, results: [{ title: 'Guide', url, snippet: 'Guide' }], metadata: { backend: 'duckduckgo' as const, cacheHit: false } })),
      fetchPage: vi.fn(async () => ({ status: 'ok' as const, url, content: { title: 'Guide', text: 'Secret page content' }, metadata: { method: 'http' as const, cacheHit: false } }))
    });
    const budget = createResearchRunBudget({ timeoutMs: 120_000 });
    await worker.run({ query: 'guide', maxSearchRounds: 1, maxFetches: 1, budget, onProgress: (event) => events.push(event) });
    expect(events.map((event) => `${event.phase}:${(event as { state?: string }).state}`)).toEqual([
      'search:started', 'search:settled', 'fetch:started', 'fetch:settled'
    ]);
    expect(events.at(-1)).toMatchObject({ searches: 1, fetches: 1, headless: 0 });
    expect(JSON.stringify(events)).not.toContain('Secret page content');
    budget.dispose();
  });
  it('fetches up to three distinct hosts concurrently and keeps candidate order', async () => {
    const waiting = new Map<string, (value: WebFetchResponse) => void>();
    const fetchPage = vi.fn(({ url }: { url: string }) => new Promise<WebFetchResponse>((resolve) => waiting.set(url, resolve)));
    const urls = ['https://a.example.com/one', 'https://b.example.com/two', 'https://c.example.com/three', 'https://a.example.com/four'];
    const worker = createResearchWorker({
      search: vi.fn(async () => ({ status: 'ok' as const, results: urls.map((url) => ({ title: url, url, snippet: 'Details' })), metadata: { backend: 'duckduckgo' as const, cacheHit: false } })),
      fetchPage
    });
    const budget = createResearchRunBudget({ timeoutMs: 120_000 });
    const resultPromise = worker.run({ query: 'distinct hosts', maxSearchRounds: 1, maxFetches: 4, budget });
    await vi.waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(3));
    expect(waiting.has(urls[3])).toBe(false);

    const response = (url: string) => ({ status: 'ok' as const, url, content: { title: url, text: `Useful details from ${url}` }, metadata: { method: 'http' as const, cacheHit: false } });
    waiting.get(urls[2])!(response(urls[2]));
    await Promise.resolve();
    expect(waiting.has(urls[3])).toBe(false);
    waiting.get(urls[0])!(response(urls[0]));
    await vi.waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(4));
    waiting.get(urls[3])!(response(urls[3]));
    waiting.get(urls[1])!(response(urls[1]));
    const result = await resultPromise;
    expect(result.evidence.map((item) => item.url)).toEqual(urls);
    budget.dispose();
  });

  it('records out-of-order concurrent candidates while preserving evidence order', async () => {
    const urls = ['https://a.example/one', 'https://b.example/two', 'https://c.example/three'];
    const waiting = new Map<string, (response: WebFetchResponse) => void>();
    const stats = createPresentationStats();
    const worker = createResearchWorker({
      search: async () => ({ status: 'ok' as const, results: urls.map((url) => ({ title: url, url, snippet: 'details' })), metadata: { backend: 'duckduckgo' as const, cacheHit: false } }),
      fetchPage: ({ url }) => new Promise<WebFetchResponse>((resolve) => waiting.set(url, resolve))
    });
    const run = worker.run({ query: 'details', maxSearchRounds: 1, maxFetches: 3, presentationStats: stats });
    await vi.waitFor(() => expect(waiting.size).toBe(3));
    for (const url of [...urls].reverse()) waiting.get(url)!({ status: 'ok', url, content: { text: `details ${url}` }, metadata: { method: 'http', cacheHit: false } });
    expect((await run).evidence.map((item) => item.url)).toEqual(urls);
    expect(stats.snapshot()).toMatchObject({ searches: 1, pagesRead: 3, failedReads: 0, methods: { http: 3 } });
  });

  it('does not fetch a URL already visited in an earlier worker pass', async () => {
    const url = 'https://example.com/guide';
    const fetchPage = vi.fn(async () => ({ status: 'ok' as const, url, content: { title: 'Guide', text: 'Useful guide details' }, metadata: { method: 'http' as const, cacheHit: false } }));
    const worker = createResearchWorker({
      search: vi.fn(async () => ({ status: 'ok' as const, results: [{ title: 'Guide', url, snippet: 'Guide' }], metadata: { backend: 'duckduckgo' as const, cacheHit: false } })),
      fetchPage
    });
    const budget = createResearchRunBudget({ timeoutMs: 120_000 });
    await worker.run({ query: 'first', maxSearchRounds: 1, maxFetches: 4, budget });
    const second = await worker.run({ query: 'second', maxSearchRounds: 1, maxFetches: 4, budget });
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(second.evidence).toEqual([]);
    budget.dispose();
  });

  it('stops at a shared fetch cap after direct URLs have spent slots', async () => {
    const budget = createResearchRunBudget({ timeoutMs: 120_000, maxFetches: 4 });
    for (const name of ['a', 'b', 'c']) expect(budget.claimFetch(`https://${name}.example/direct`)).toBe(true);
    const urls = Array.from({ length: 4 }, (_, index) => `https://result-${index}.example/page`);
    const fetchPage = vi.fn(async ({ url }) => ({ status: 'ok' as const, url, content: { title: 'Page', text: 'Useful page details' }, metadata: { method: 'http' as const, cacheHit: false } }));
    const worker = createResearchWorker({
      search: vi.fn(async () => ({ status: 'ok' as const, results: urls.map((url) => ({ title: 'Page', url, snippet: 'Details' })), metadata: { backend: 'duckduckgo' as const, cacheHit: false } })),
      fetchPage
    });

    const result = await worker.run({ query: 'pages', maxSearchRounds: 1, maxFetches: 4, budget });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result.evidence).toHaveLength(1);
    expect(result.exhaustedBudget).toBe(true);
    expect(budget.snapshot()).toMatchObject({ fetches: 4, limitReason: 'fetch-limit' });
    budget.dispose();
  });

  it('keeps evidence from another host when one candidate throws', async () => {
    const urls = ['https://a.example.com/failed', 'https://b.example.com/good'];
    const worker = createResearchWorker({
      search: vi.fn(async () => ({ status: 'ok' as const, results: urls.map((url) => ({ title: url, url, snippet: 'Details' })), metadata: { backend: 'duckduckgo' as const, cacheHit: false } })),
      fetchPage: vi.fn(async ({ url }) => {
        if (url === urls[0]) throw new Error('connection reset');
        return { status: 'ok' as const, url, content: { title: 'Good', text: 'Useful details' }, metadata: { method: 'http' as const, cacheHit: false } };
      })
    });
    const budget = createResearchRunBudget({ timeoutMs: 120_000 });
    const result = await worker.run({ query: 'two hosts', maxSearchRounds: 1, maxFetches: 2, budget });
    expect(result.evidence.map((item) => item.url)).toEqual([urls[1]]);
    expect(result.gaps[0]?.message).toContain('connection reset');
    budget.dispose();
  });

  it('stops in-flight fetch work when the caller cancels', async () => {
    const controller = new AbortController();
    const url = 'https://example.com/pending';
    const fetchPage = vi.fn(() => new Promise<WebFetchResponse>(() => undefined));
    const worker = createResearchWorker({
      search: vi.fn(async () => ({ status: 'ok' as const, results: [{ title: 'Pending', url, snippet: 'Pending' }], metadata: { backend: 'duckduckgo' as const, cacheHit: false } })),
      fetchPage
    });
    const budget = createResearchRunBudget({ signal: controller.signal, timeoutMs: 120_000 });
    const run = worker.run({ query: 'pending', maxSearchRounds: 1, maxFetches: 1, signal: controller.signal, budget });
    const rejected = expect(run).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(1));
    controller.abort();
    await rejected;
    budget.dispose();
  });
  it('runs one bounded search/fetch pass and summarizes evidence', async () => {
    const worker = createResearchWorker({
      search: vi.fn().mockResolvedValue({
        status: 'ok',
        results: [
          {
            title: 'Browsers | Playwright',
            url: 'https://playwright.dev/docs/browsers',
            snippet: 'Playwright can operate against branded Chrome and Edge browsers.'
          },
          {
            title: 'Use Playwright to automate and test in Microsoft Edge',
            url: 'https://learn.microsoft.com/en-us/microsoft-edge/playwright/',
            snippet: 'Use channel msedge to run in Edge.'
          }
        ],
        metadata: { backend: 'duckduckgo', cacheHit: false }
      }),
      fetchPage: vi.fn()
        .mockResolvedValueOnce({
          status: 'ok',
          url: 'https://playwright.dev/docs/browsers',
          content: {
            title: 'Browsers | Playwright',
            text: 'Playwright can operate against branded Google Chrome and Microsoft Edge browsers available on the machine.'
          },
          metadata: { method: 'http', cacheHit: false, contentType: 'text/html', truncated: false }
        })
        .mockResolvedValueOnce({
          status: 'ok',
          url: 'https://learn.microsoft.com/en-us/microsoft-edge/playwright/',
          content: {
            title: 'Use Playwright to automate and test in Microsoft Edge',
            text: 'Use channel: msedge to run tests in Microsoft Edge.'
          },
          metadata: { method: 'http', cacheHit: false, contentType: 'text/html', truncated: false }
        })
    });

    const result = await worker.run({
      query: 'playwright installed edge executablePath vs channel',
      maxSearchRounds: 1,
      maxFetches: 2
    });

    expect(result.searchQueries).toEqual(['playwright installed edge executablePath vs channel']);
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence[0].summary.length).toBeGreaterThan(0);
    expect(result.exhaustedBudget).toBe(false);
  });

  it('uses a query-relevant late passage for non-reader evidence', async () => {
    const worker = createResearchWorker({
      search: vi.fn().mockResolvedValue({
        status: 'ok',
        results: [{ title: 'Archive guide', url: 'https://example.com/archive', snippet: 'Archive guide' }],
        metadata: { backend: 'duckduckgo', cacheHit: false }
      }),
      fetchPage: vi.fn().mockResolvedValue({
        status: 'ok',
        url: 'https://example.com/archive',
        content: {
          title: 'Archive guide',
          text: `${'General archive background. '.repeat(12)}\n\nLunar archive transfer requires the signed manifest before upload.`
        },
        metadata: { method: 'http', cacheHit: false, contentType: 'text/html', truncated: false }
      })
    });

    const result = await worker.run({ query: 'lunar archive transfer', maxSearchRounds: 1, maxFetches: 1 });

    expect(result.evidence[0]?.summary).toContain('Lunar archive transfer requires the signed manifest');
    expect(result.evidence[0]?.supports).toContain('Lunar archive transfer requires the signed manifest before upload.');
  });

  it('keeps a Firecrawl bot wall omitted by query selection out of evidence', async () => {
    const query = 'lunar archive transfer manifest';
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: {
        markdown: `# Lunar archive transfer manifest\n\n${'Lunar archive transfer manifest instructions. '.repeat(110)}\n\nPerforming security verification. Please verify you are not a bot.`,
        metadata: { title: 'Archive guide' }
      }
    })));
    const firecrawlFetch = createFirecrawlFetcher({ baseUrl: 'http://firecrawl.test', fetchImpl });
    const worker = createResearchWorker({
      search: vi.fn().mockResolvedValue({
        status: 'ok',
        results: [{ title: 'Archive guide', url: 'https://example.com/archive', snippet: 'Archive transfer details' }],
        metadata: { backend: 'duckduckgo', cacheHit: false }
      }),
      fetchPage: ({ url, query: activeQuery }) => firecrawlFetch(url, activeQuery)
    });

    const result = await worker.run({ query, maxSearchRounds: 1, maxFetches: 1 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.evidence).toHaveLength(0);
    expect(result.lowValueOutcomes).toContainEqual({
      kind: 'bot-check',
      url: 'https://example.com/archive',
      message: 'Fetched page showed a bot-check or security verification page.'
    });
  });

  it('flags a likely headless candidate when http fetch is weak', async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      status: 'needs_headless' as const,
      url: 'https://example.com/app',
      metadata: { method: 'http' as const, cacheHit: false, contentType: 'text/html' },
      error: { code: 'WEAK_EXTRACTION', message: 'HTTP extraction was not reliable enough.' }
    });
    const worker = createResearchWorker({
      search: vi.fn().mockResolvedValue({
        status: 'ok',
        results: [
          {
            title: 'Dynamic docs site',
            url: 'https://example.com/app',
            snippet: 'JS-heavy docs app'
          }
        ],
        metadata: { backend: 'duckduckgo', cacheHit: false }
      }),
      fetchPage
    });

    const result = await worker.run({
      query: 'dynamic docs app',
      maxSearchRounds: 1,
      maxFetches: 1
    });

    expect(result.suggestedHeadlessUrl).toBe('https://example.com/app');
    expect(result.gaps[0]?.kind).toBe('fetch-failed');
    expect(fetchPage).toHaveBeenCalledWith({ url: 'https://example.com/app', query: 'dynamic docs app' });
  });

  it('records empty search results as a low-value outcome', async () => {
    const worker = createResearchWorker({
      search: vi.fn().mockResolvedValue({
        status: 'ok',
        results: [],
        metadata: { backend: 'duckduckgo', cacheHit: false }
      }),
      fetchPage: vi.fn()
    });

    const result = await worker.run({
      query: 'vitest coverage docs',
      maxSearchRounds: 1,
      maxFetches: 2
    });

    expect(result.lowValueOutcomes).toEqual([
      {
        kind: 'empty-search',
        message: 'Search returned no results for this pass.'
      }
    ]);
    expect(result.evidence).toHaveLength(0);
  });

  it('limits headless suggestion to one flagged url even if multiple fetches are weak', async () => {
    const worker = createResearchWorker({
      search: vi.fn().mockResolvedValue({
        status: 'ok',
        results: [
          { title: 'Page A', url: 'https://example.com/a', snippet: 'A' },
          { title: 'Page B', url: 'https://example.com/b', snippet: 'B' }
        ],
        metadata: { backend: 'duckduckgo', cacheHit: false }
      }),
      fetchPage: vi.fn()
        .mockResolvedValueOnce({
          status: 'needs_headless',
          url: 'https://example.com/a',
          metadata: { method: 'http', cacheHit: false, contentType: 'text/html' },
          error: { code: 'WEAK_EXTRACTION', message: 'Weak A' }
        })
        .mockResolvedValueOnce({
          status: 'needs_headless',
          url: 'https://example.com/b',
          metadata: { method: 'http', cacheHit: false, contentType: 'text/html' },
          error: { code: 'WEAK_EXTRACTION', message: 'Weak B' }
        })
    });

    const result = await worker.run({
      query: 'two weak pages',
      maxSearchRounds: 1,
      maxFetches: 2
    });

    expect(result.suggestedHeadlessUrl).toBe('https://example.com/a');
    expect(result.gaps).toHaveLength(2);
  });

  it('does not turn bot-check pages into evidence', async () => {
    const worker = createResearchWorker({
      search: vi.fn().mockResolvedValue({
        status: 'ok',
        results: [
          {
            title: 'Forum thread',
            url: 'https://forum.example.com/thread/123',
            snippet: 'Discussion thread'
          }
        ],
        metadata: { backend: 'duckduckgo', cacheHit: false }
      }),
      fetchPage: vi.fn().mockResolvedValue({
        status: 'ok',
        url: 'https://forum.example.com/thread/123',
        content: {
          title: 'Just a moment...',
          text: 'Checking your browser before accessing this site. Security verification is required.'
        },
        metadata: { method: 'http', cacheHit: false, contentType: 'text/html', truncated: false }
      })
    });

    const result = await worker.run({
      query: 'forum discussion',
      maxSearchRounds: 1,
      maxFetches: 1
    });

    expect(result.evidence).toHaveLength(0);
    expect(result.lowValueOutcomes).toEqual([
      {
        kind: 'bot-check',
        url: 'https://forum.example.com/thread/123',
        message: 'Fetched page showed a bot-check or security verification page.'
      }
    ]);
  });

  it('classifies npm package pages as low-value when they do not add useful evidence', async () => {
    const worker = createResearchWorker({
      search: vi.fn().mockResolvedValue({
        status: 'ok',
        results: [
          {
            title: 'duck-duck-scrape - npm',
            url: 'https://www.npmjs.com/package/duck-duck-scrape',
            snippet: 'Package page'
          }
        ],
        metadata: { backend: 'duckduckgo', cacheHit: false }
      }),
      fetchPage: vi.fn().mockResolvedValue({
        status: 'ok',
        url: 'https://www.npmjs.com/package/duck-duck-scrape',
        content: {
          title: 'duck-duck-scrape - npm',
          text: 'Package page, install instructions, version history.'
        },
        metadata: { method: 'http', cacheHit: false, contentType: 'text/html', truncated: false }
      })
    });

    const result = await worker.run({
      query: 'duckduckgo scraping node',
      maxSearchRounds: 1,
      maxFetches: 1
    });

    expect(result.evidence).toHaveLength(0);
    expect(result.lowValueOutcomes).toEqual([
      {
        kind: 'low-value-page',
        url: 'https://www.npmjs.com/package/duck-duck-scrape',
        message: 'Fetched page did not add strong research evidence.'
      }
    ]);
  });

  it('captures fanout providers from search metadata', async () => {
    const worker = createResearchWorker({
      search: vi.fn().mockResolvedValue({
        status: 'ok',
        results: [
          {
            title: 'Playwright Browsers',
            url: 'https://playwright.dev/docs/browsers',
            snippet: 'Playwright supports Chrome and Edge.'
          }
        ],
        metadata: {
          backend: 'duckduckgo',
          cacheHit: false,
          fanout: { mode: 'on', providers: ['duckduckgo', 'brave', 'exa'] }
        }
      }),
      fetchPage: vi.fn().mockResolvedValue({
        status: 'ok',
        url: 'https://playwright.dev/docs/browsers',
        content: {
          title: 'Playwright Browsers',
          text: 'Playwright can operate against Chrome and Edge browsers available on the machine.'
        },
        metadata: { method: 'http', cacheHit: false, contentType: 'text/html', truncated: false }
      })
    });

    const result = await worker.run({
      query: 'playwright browser support',
      maxSearchRounds: 1,
      maxFetches: 1
    });

    expect(result.fanoutProviders).toEqual(['duckduckgo', 'brave', 'exa']);
    expect(result.evidence).toHaveLength(1);
  });

  it('captures fanout skipped providers from search metadata', async () => {
    const worker = createResearchWorker({
      search: vi.fn().mockResolvedValue({
        status: 'ok',
        results: [
          {
            title: 'Playwright Browsers',
            url: 'https://playwright.dev/docs/browsers',
            snippet: 'Playwright supports Chrome and Edge.'
          }
        ],
        metadata: {
          backend: 'duckduckgo',
          cacheHit: false,
          fanout: { mode: 'on', providers: ['duckduckgo', 'brave'], skipped: ['exa', 'youcom'] }
        }
      }),
      fetchPage: vi.fn().mockResolvedValue({
        status: 'ok',
        url: 'https://playwright.dev/docs/browsers',
        content: {
          title: 'Playwright Browsers',
          text: 'Playwright can operate against Chrome and Edge browsers available on the machine.'
        },
        metadata: { method: 'http', cacheHit: false, contentType: 'text/html', truncated: false }
      })
    });

    const result = await worker.run({
      query: 'playwright browser support',
      maxSearchRounds: 1,
      maxFetches: 1
    });

    expect(result.fanoutProviders).toEqual(['duckduckgo', 'brave']);
    expect(result.fanoutSkipped).toEqual(['exa', 'youcom']);
    expect(result.evidence).toHaveLength(1);
  });

  it('captures fanout skipped providers from error search response with fanout metadata', async () => {
    const worker = createResearchWorker({
      search: vi.fn().mockResolvedValue({
        status: 'error',
        results: [],
        metadata: {
          backend: 'duckduckgo',
          cacheHit: false,
          fanout: { mode: 'on', providers: [], skipped: ['brave', 'exa'] }
        },
        error: { code: 'FANOUT_NO_RESULTS', message: 'No fanout provider returned usable results.' }
      }),
      fetchPage: vi.fn()
    });

    const result = await worker.run({
      query: 'test query',
      maxSearchRounds: 1,
      maxFetches: 2
    });

    expect(result.fanoutSkipped).toEqual(['brave', 'exa']);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].kind).toBe('fetch-failed');
  });

  it('keeps full reader text without treating the reader method as authority', async () => {
    const fullYoutubeText =
      'This is a very long transcript from a YouTube video that contains detailed technical information about the topic. It has more than 180 characters of content that should be preserved in full for primary-content evidence extraction.';

    const worker = createResearchWorker({
      search: vi.fn().mockResolvedValue({
        status: 'ok',
        results: [
          {
            title: 'Technical Discussion Video',
            url: 'https://youtube.com/watch?v=example123',
            snippet: 'Detailed technical discussion'
          }
        ],
        metadata: { backend: 'duckduckgo', cacheHit: false }
      }),
      fetchPage: vi.fn().mockResolvedValue({
        status: 'ok',
        url: 'https://youtube.com/watch?v=example123',
        content: {
          title: 'Technical Discussion Video',
          text: fullYoutubeText
        },
        metadata: { method: 'youtube', cacheHit: false, contentType: 'text/plain', truncated: false }
      })
    });

    const result = await worker.run({
      query: 'technical details from video',
      maxSearchRounds: 1,
      maxFetches: 1
    });

    expect(result.evidence).toHaveLength(1);
    const evidence = result.evidence[0];
    expect(evidence?.sourceKind).toBe('unknown');
    expect(evidence?.method).toBe('youtube');
    expect(evidence?.summary).toBe(fullYoutubeText);
    expect(evidence?.supports[0]).toBe(fullYoutubeText);
  });

  it('does not accept an empty reader response as evidence', async () => {
    const worker = createResearchWorker({
      search: vi.fn().mockResolvedValue({
        status: 'ok',
        results: [
          {
            title: 'Empty PDF Document',
            url: 'https://example.com/empty.pdf',
            snippet: 'PDF file'
          }
        ],
        metadata: { backend: 'duckduckgo', cacheHit: false }
      }),
      fetchPage: vi.fn().mockResolvedValue({
        status: 'ok',
        url: 'https://example.com/empty.pdf',
        content: {
          title: 'Empty PDF Document',
          text: ''
        },
        metadata: { method: 'pdf', cacheHit: false, contentType: 'application/pdf', truncated: false }
      })
    });

    const result = await worker.run({
      query: 'pdf content',
      maxSearchRounds: 1,
      maxFetches: 1
    });

    expect(result.evidence.some((item) => item.method === 'pdf')).toBe(false);
  });

  it('does not accept a whitespace-only reader response as evidence', async () => {
    const worker = createResearchWorker({
      search: vi.fn().mockResolvedValue({
        status: 'ok',
        results: [
          {
            title: 'Whitespace PDF',
            url: 'https://example.com/whitespace.pdf',
            snippet: 'PDF file'
          }
        ],
        metadata: { backend: 'duckduckgo', cacheHit: false }
      }),
      fetchPage: vi.fn().mockResolvedValue({
        status: 'ok',
        url: 'https://example.com/whitespace.pdf',
        content: {
          title: 'Whitespace PDF',
          text: '   \n  \t  '
        },
        metadata: { method: 'pdf', cacheHit: false, contentType: 'application/pdf', truncated: false }
      })
    });

    const result = await worker.run({
      query: 'pdf content',
      maxSearchRounds: 1,
      maxFetches: 1
    });

    expect(result.evidence.some((item) => item.method === 'pdf')).toBe(false);
  });

  it('keeps reader content from a deep package URL without treating it as a package listing', async () => {
    const pdfText = 'This is actual PDF content from a package documentation PDF hosted on npmjs.';

    const worker = createResearchWorker({
      search: vi.fn().mockResolvedValue({
        status: 'ok',
        results: [
          {
            title: 'Package Docs PDF',
            url: 'https://www.npmjs.com/package/example-pkg/docs.pdf',
            snippet: 'Package documentation'
          }
        ],
        metadata: { backend: 'duckduckgo', cacheHit: false }
      }),
      fetchPage: vi.fn().mockResolvedValue({
        status: 'ok',
        url: 'https://www.npmjs.com/package/example-pkg/docs.pdf',
        content: {
          title: 'Package Documentation',
          text: pdfText
        },
        metadata: { method: 'pdf', cacheHit: false, contentType: 'application/pdf', truncated: false }
      })
    });

    const result = await worker.run({
      query: 'package documentation',
      maxSearchRounds: 1,
      maxFetches: 1
    });

    expect(result.evidence).toHaveLength(1);
    const evidence = result.evidence[0];
    expect(evidence?.sourceKind).toBe('unknown');
    expect(evidence?.method).toBe('pdf');
    expect(evidence?.summary).toBe(pdfText);
  });
});

describe('research worker cancellation', () => {
  const results = {
    status: 'ok' as const,
    results: [
      { title: 'A', url: 'https://a.test/', snippet: '' },
      { title: 'B', url: 'https://b.test/', snippet: '' }
    ],
    metadata: { backend: 'duckduckgo' as const, cacheHit: false }
  };

  it('does not fetch candidates once the run is cancelled during the search', async () => {
    const controller = new AbortController();
    const fetchPage = vi.fn();
    const worker = createResearchWorker({
      search: vi.fn(async () => {
        controller.abort();
        return results;
      }),
      fetchPage
    });

    await expect(worker.run({ query: 'q', maxSearchRounds: 1, maxFetches: 2, signal: controller.signal })).rejects.toThrow('Operation aborted');
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('turns a fetch result that arrives after the cancel into the cancel error', async () => {
    const controller = new AbortController();
    const fetchPage = vi.fn(async () => {
      controller.abort();
      return { status: 'error' as const, url: 'https://a.test/', metadata: { method: 'http' as const, cacheHit: false }, error: { code: 'X', message: 'x' } };
    });
    const worker = createResearchWorker({ search: vi.fn(async () => results), fetchPage });

    await expect(worker.run({ query: 'q', maxSearchRounds: 1, maxFetches: 2, signal: controller.signal })).rejects.toThrow('Operation aborted');
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('passes the signal to search and fetch', async () => {
    const controller = new AbortController();
    const search = vi.fn(async () => results);
    const fetchPage = vi.fn(async ({ url }: { url: string }) => ({ status: 'error' as const, url, metadata: { method: 'http' as const, cacheHit: false }, error: { code: 'X', message: 'x' } }));
    await createResearchWorker({ search, fetchPage }).run({ query: 'q', maxSearchRounds: 1, maxFetches: 1, signal: controller.signal });
    expect(search).toHaveBeenCalledWith({ query: 'q', signal: controller.signal });
    expect(fetchPage).toHaveBeenCalledWith({ url: 'https://a.test/', query: 'q', signal: controller.signal });
  });
});
