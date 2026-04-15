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

    expect(result.suggestedHeadlessUrls).toEqual(['https://example.com/app']);
    expect(result.gaps[0]?.kind).toBe('fetch-failed');
  });
});
