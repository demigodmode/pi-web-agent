import { describe, expect, it } from 'vitest';
import { createWebFetchHeadlessTool } from '../../src/tools/web-fetch-headless.js';

describe('web_fetch_headless tool', () => {
  it('passes through headless fetch results', async () => {
    const tool = createWebFetchHeadlessTool({
      fetchPage: async () => ({
        status: 'ok',
        url: 'https://example.com',
        metadata: { method: 'headless', cacheHit: false, browser: 'chrome', navigationMs: 1200 },
        content: { text: 'Rendered text' }
      })
    });
    const result = await tool({ url: 'https://example.com' });

    expect(result).toMatchObject({
      status: 'ok',
      metadata: { method: 'headless', cacheHit: false, browser: 'chrome', navigationMs: 1200 },
      content: { text: 'Rendered text' },
      presentation: {
        views: {
          compact: 'Fetched page · article extracted · 2 words'
        }
      }
    });
  });

  it('can be constructed without dependency arguments', () => {
    expect(typeof createWebFetchHeadlessTool()).toBe('function');
  });

  it('rejects unsupported URL schemes before headless execution', async () => {
    const tool = createWebFetchHeadlessTool();
    const result = await tool({ url: 'file:///tmp/test.html' });

    expect(result).toMatchObject({
      status: 'unsupported',
      error: { code: 'UNSUPPORTED_URL' },
      presentation: {
        views: {
          compact: 'Fetch failed: Only http and https URLs are supported.'
        }
      }
    });
  });
});
