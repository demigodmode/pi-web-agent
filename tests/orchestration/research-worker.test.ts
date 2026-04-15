import { describe, expect, it, vi } from 'vitest';
import { createResearchWorker } from '../../src/orchestration/research-worker.js';

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

  it('flags a likely headless candidate when http fetch is weak', async () => {
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
      fetchPage: vi.fn().mockResolvedValue({
        status: 'needs_headless',
        url: 'https://example.com/app',
        metadata: { method: 'http', cacheHit: false, contentType: 'text/html' },
        error: { code: 'WEAK_EXTRACTION', message: 'HTTP extraction was not reliable enough.' }
      })
    });

    const result = await worker.run({
      query: 'dynamic docs app',
      maxSearchRounds: 1,
      maxFetches: 1
    });

    expect(result.suggestedHeadlessUrl).toBe('https://example.com/app');
    expect(result.gaps[0]?.kind).toBe('fetch-failed');
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
});
