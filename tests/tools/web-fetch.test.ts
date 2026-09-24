import { describe, expect, it, vi } from 'vitest';
import { createWebFetchTool } from '../../src/tools/web-fetch.js';

describe('web_fetch tool', () => {
  it('rejects unsupported URL schemes before fetching', async () => {
    const webFetch = createWebFetchTool({ fetchPage: vi.fn() });

    await expect(webFetch({ url: 'file:///tmp/test.html' })).resolves.toMatchObject({
      status: 'unsupported',
      error: { code: 'UNSUPPORTED_URL' },
      presentation: {
        views: {
          compact: 'Fetch failed: Only http and https URLs are supported.'
        }
      }
    });
  });

  it('passes through honest fetch results', async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      status: 'needs_headless',
      url: 'https://example.com',
      metadata: { method: 'http', cacheHit: false },
      error: { code: 'WEAK_EXTRACTION', message: 'not enough content' }
    });
    const webFetch = createWebFetchTool({
      fetchPage
    });

    await expect(webFetch({ url: 'https://example.com' })).resolves.toMatchObject({
      status: 'needs_headless',
      presentation: {
        views: {
          compact: 'Needs headless rendering: not enough content'
        }
      }
    });
    expect(fetchPage).toHaveBeenCalledWith({ url: 'https://example.com' });
  });

  it('can be constructed without dependency arguments', () => {
    expect(typeof createWebFetchTool()).toBe('function');
  });
});
