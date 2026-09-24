import { describe, expect, it, vi } from 'vitest';
import { createResearchWorker } from '../../src/orchestration/research-worker.js';
import { createFirecrawlFetcher } from '../../src/fetch/firecrawl-fetch.js';

describe('research worker', () => {
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
    expect(result.evidence[0]?.supports[0]).toContain('Lunar archive transfer requires the signed manifest');
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

  it('returns reader method content as primary-content with full text, not summarized', async () => {
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
    expect(evidence?.sourceKind).toBe('primary-content');
    expect(evidence?.method).toBe('youtube');
    expect(evidence?.summary).toBe(fullYoutubeText);
    expect(evidence?.supports[0]).toBe(fullYoutubeText);
  });

  it('does not turn reader method response with empty text into primary-content', async () => {
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

    const primaryContent = result.evidence.find((e) => e.sourceKind === 'primary-content');
    expect(primaryContent).toBeUndefined();
  });

  it('does not turn reader method response with only whitespace into primary-content', async () => {
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

    const primaryContent = result.evidence.find((e) => e.sourceKind === 'primary-content');
    expect(primaryContent).toBeUndefined();
  });

  it('makes reader method content primary-content even if url classifies as package-page', async () => {
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
    expect(evidence?.sourceKind).toBe('primary-content');
    expect(evidence?.method).toBe('pdf');
    expect(evidence?.summary).toBe(pdfText);
  });
});
