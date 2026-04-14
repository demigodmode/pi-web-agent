import { describe, expect, it } from 'vitest';
import { createWebFetchHeadlessTool } from '../../src/tools/web-fetch-headless.js';

describe('web_fetch_headless tool', () => {
  it('keeps the explicit headless contract visible', async () => {
    const tool = createWebFetchHeadlessTool();
    const result = await tool({ url: 'https://example.com' });

    expect(result).toMatchObject({
      status: 'error',
      metadata: { method: 'headless', cacheHit: false },
      error: { code: 'NOT_IMPLEMENTED' }
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
      error: { code: 'UNSUPPORTED_URL' }
    });
  });
});
