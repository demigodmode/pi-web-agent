import { describe, expect, it } from 'vitest';
import { createResearchWorkflow } from '../../src/orchestration/index.js';

describe('research workflow composition', () => {
  it('can compose the orchestrator from existing search and fetch capabilities', async () => {
    const workflow = createResearchWorkflow({
      search: async () => ({
        status: 'ok',
        results: [],
        metadata: { backend: 'duckduckgo', cacheHit: false }
      }),
      fetchPage: async () => ({
        status: 'unsupported',
        url: 'https://example.com',
        metadata: { method: 'http', cacheHit: false, contentType: 'text/html' }
      }),
      headlessFetch: async () => ({
        status: 'error',
        url: 'https://example.com',
        metadata: { method: 'headless', cacheHit: false },
        error: { code: 'BROWSER_NOT_FOUND', message: 'No browser found.' }
      })
    });

    const result = await workflow.run({ query: 'example query' });
    expect(result.decision.action).toBeDefined();
  });

  it('does not spend headless on a low-value npm package page when other technical sources exist', async () => {
    const workflow = createResearchWorkflow({
      search: async () => ({
        status: 'ok',
        results: [
          {
            title: 'ddg-search',
            url: 'https://github.com/camohiddendj/ddg-search',
            snippet: 'Node scraper'
          },
          {
            title: 'duck-duck-scrape - npm',
            url: 'https://www.npmjs.com/package/duck-duck-scrape',
            snippet: 'Package page'
          }
        ],
        metadata: { backend: 'duckduckgo', cacheHit: false }
      }),
      fetchPage: async ({ url }) => {
        if (url.includes('github.com/camohiddendj/ddg-search')) {
          return {
            status: 'ok',
            url,
            content: {
              title: 'ddg-search',
              text: 'DuckDuckGo HTML search scraper with bot-detection and pagination notes.'
            },
            metadata: { method: 'http', cacheHit: false, contentType: 'text/html', truncated: false }
          };
        }

        return {
          status: 'needs_headless',
          url,
          metadata: { method: 'http', cacheHit: false, contentType: 'text/html' },
          error: { code: 'WEAK_EXTRACTION', message: 'Weak extraction.' }
        };
      },
      headlessFetch: async () => ({
        status: 'ok',
        url: 'https://www.npmjs.com/package/duck-duck-scrape',
        content: { title: 'Just a moment...', text: 'Security verification' },
        metadata: {
          method: 'headless',
          cacheHit: false,
          browser: 'edge',
          navigationMs: 4000,
          truncated: false
        }
      })
    });

    const result = await workflow.run({ query: 'duckduckgo scraping node pitfalls' });
    expect(result.decision.action).toBe('research-again');
  });
});
