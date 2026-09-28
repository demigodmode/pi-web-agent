import { describe, expect, it, vi } from 'vitest';
import { createWebFetchHeadlessTool } from '../../src/tools/web-fetch-headless.js';
import * as headlessFetchModule from '../../src/fetch/headless-fetch.js';

describe('web_fetch_headless tool', () => {
  it('passes through headless fetch results', async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      status: 'ok',
      url: 'https://example.com',
      metadata: { method: 'headless', cacheHit: false, browser: 'chrome', navigationMs: 1200 },
      content: { text: 'Rendered text' }
    });
    const tool = createWebFetchHeadlessTool({
      fetchPage
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
    expect(fetchPage).toHaveBeenCalledWith({ url: 'https://example.com' });
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

  it('passes the caller signal to fetchPage', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ status: 'ok', url: 'https://example.com', content: { text: 'x' }, metadata: { method: 'headless', cacheHit: false } });
    const controller = new AbortController();
    await createWebFetchHeadlessTool({ fetchPage })({ url: 'https://example.com', signal: controller.signal });
    expect(fetchPage).toHaveBeenCalledWith({ url: 'https://example.com', signal: controller.signal });
  });

  it('the default fetchPage forwards the signal to headlessFetch', async () => {
    const spy = vi.spyOn(headlessFetchModule, 'headlessFetch').mockResolvedValue({
      status: 'ok',
      url: 'https://example.com',
      metadata: { method: 'headless', cacheHit: false },
      content: { text: 'x' }
    });
    const controller = new AbortController();

    await createWebFetchHeadlessTool()({ url: 'https://example.com', query: 'q', signal: controller.signal });

    expect(spy).toHaveBeenCalledWith('https://example.com', { query: 'q', signal: controller.signal });
    spy.mockRestore();
  });
});
