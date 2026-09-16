import { describe, expect, it, vi } from 'vitest';
import { DuckDuckGoHttpError } from '../../src/search/duckduckgo.js';
import { createWebSearchTool } from '../../src/tools/web-search.js';

describe('web_search tool', () => {
  it('returns discovery-only results from the search backend', async () => {
    const search = createWebSearchTool({
      searchHtml: vi.fn().mockResolvedValue(`
        <div class="result">
          <a class="result__a" href="https://example.com">Example</a>
          <a class="result__snippet">Snippet</a>
        </div>
      `)
    });

    await expect(search({ query: 'example' })).resolves.toMatchObject({
      status: 'ok',
      results: [{ title: 'Example', url: 'https://example.com', snippet: 'Snippet' }],
      metadata: { backend: 'duckduckgo', cacheHit: false },
      presentation: {
        views: {
          compact: 'Found 1 result',
          preview: '1. Example'
        }
      }
    });
  });

  it('serves repeated identical queries from cache', async () => {
    const searchHtml = vi.fn().mockResolvedValue(`
      <div class="result">
        <a class="result__a" href="https://example.com">Example</a>
        <a class="result__snippet">Snippet</a>
      </div>
    `);

    const search = createWebSearchTool({ searchHtml });

    const first = await search({ query: 'example' });
    const second = await search({ query: 'example' });

    expect(searchHtml).toHaveBeenCalledTimes(1);
    expect(first.metadata.cacheHit).toBe(false);
    expect(second.metadata.cacheHit).toBe(true);
  });

  it('rejects empty queries', async () => {
    const search = createWebSearchTool({ searchHtml: vi.fn() });

    await expect(search({ query: '   ' })).resolves.toMatchObject({
      status: 'error',
      error: { code: 'INVALID_QUERY' }
    });
  });

  it('returns ok with no results when the backend page says there are no results', async () => {
    const search = createWebSearchTool({
      searchHtml: vi.fn().mockResolvedValue(`
        <html>
          <body>
            <div class="results">
              <div class="no-results">No results found for your search.</div>
            </div>
          </body>
        </html>
      `)
    });

    const result = await search({ query: 'missing thing' });
    expect(result).toMatchObject({ status: 'ok', results: [] });
    expect(result.error).toBeUndefined();
  });

  it('returns BLOCKED when the page has no result containers and no no-results text', async () => {
    const search = createWebSearchTool({
      searchHtml: vi.fn().mockResolvedValue(`
        <html>
          <body>
            <main>
              <h1>Unexpected page</h1>
            </main>
          </body>
        </html>
      `)
    });

    await expect(search({ query: 'odd page' })).resolves.toMatchObject({
      status: 'error',
      error: {
        code: 'BLOCKED',
        message: 'DuckDuckGo search appears to be blocked or rate limited.',
        failure: { kind: 'blocked' }
      }
    });
  });

  it('returns BLOCKED when the backend answers 403', async () => {
    const search = createWebSearchTool({
      searchHtml: vi.fn().mockRejectedValue(new DuckDuckGoHttpError(403, new Headers()))
    });

    await expect(search({ query: 'blocked query' })).resolves.toMatchObject({
      status: 'error',
      error: {
        code: 'BLOCKED',
        message: 'DuckDuckGo search appears to be blocked or rate limited.',
        failure: { kind: 'blocked', httpStatus: 403 }
      }
    });
  });

  it('returns BLOCKED when a 200 response is really a challenge page', async () => {
    const search = createWebSearchTool({
      searchHtml: vi.fn().mockResolvedValue(`
        <html>
          <body>
            <main>
              <h1>Are you a robot?</h1>
              <p>Please verify you are human to continue.</p>
            </main>
          </body>
        </html>
      `)
    });

    await expect(search({ query: 'challenge page' })).resolves.toMatchObject({
      status: 'error',
      error: {
        code: 'BLOCKED',
        message: 'DuckDuckGo search appears to be blocked or rate limited.'
      }
    });
  });

  it('returns FETCH_FAILED for generic backend failures', async () => {
    const search = createWebSearchTool({
      searchHtml: vi.fn().mockRejectedValue(new Error('socket hang up'))
    });

    await expect(search({ query: 'network issue' })).resolves.toMatchObject({
      status: 'error',
      error: {
        code: 'FETCH_FAILED',
        message: 'DuckDuckGo search request failed: socket hang up',
        failure: { kind: 'transient' }
      }
    });
  });

  it('classifies a keyword-light bot-wall page as BLOCKED, not PARSE_FAILED', async () => {
    const search = createWebSearchTool({
      searchHtml: vi.fn().mockResolvedValue('<html><body>Our systems have detected automated requests.</body></html>')
    });

    await expect(search({ query: 'anything' })).resolves.toMatchObject({
      status: 'error',
      error: { code: 'BLOCKED' }
    });
  });

  it('does not retry a 200-OK bot-wall; it is blocked and falls back (#55)', async () => {
    const searchHtml = vi.fn()
      .mockResolvedValueOnce(`
        <html>
          <body>
            <div>Unusual traffic from your computer network.</div>
            <p>Please verify you are human.</p>
          </body>
        </html>
      `)
      .mockResolvedValueOnce(`
        <div class="result">
          <a class="result__a" href="https://example.com">Example Result</a>
          <a class="result__snippet">This is a valid search result</a>
        </div>
      `);

    const search = createWebSearchTool({ searchHtml });

    const result = await search({ query: 'retry test' });

    expect(result).toMatchObject({ status: 'error', error: { code: 'BLOCKED', failure: { kind: 'blocked' } } });
    expect(searchHtml).toHaveBeenCalledTimes(1);
  });

  it('classifies a page with both no-results text and a bot-wall marker as BLOCKED', async () => {
    const searchHtml = vi.fn().mockResolvedValue(`
      <html>
        <body>
          <div>No results found for your query.</div>
          <p>Our systems have detected automated queries.</p>
        </body>
      </html>
    `);

    const search = createWebSearchTool({ searchHtml });

    const result = await search({ query: 'mixed signals' });

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('BLOCKED');
    expect(result.error?.failure?.kind).toBe('blocked');
    // One request only: retries belong to the fallback policy (#55)
    expect(searchHtml).toHaveBeenCalledTimes(1);
  });
});

describe('duckduckgo classification (#55)', () => {
  const page = (body: string) => `<html><body>${body}</body></html>`;
  const withResult = page('<div class="result"><a class="result__a" href="https://x.test/">X</a><a class="result__snippet">s</a></div>');

  it('requests exactly once per call, with no internal retry', async () => {
    const searchHtml = vi.fn(async () => page('<p>captcha: verify you are human</p>'));
    await createWebSearchTool({ searchHtml })({ query: 'q' });
    expect(searchHtml).toHaveBeenCalledTimes(1);
  });

  it('classifies a bot-wall page as blocked', async () => {
    const result = await createWebSearchTool({ searchHtml: async () => page('<p>unusual traffic</p>') })({ query: 'q' });
    expect(result).toMatchObject({ status: 'error', error: { code: 'BLOCKED', failure: { kind: 'blocked' } } });
  });

  it('classifies a page with no result containers and no no-results text as blocked', async () => {
    const result = await createWebSearchTool({ searchHtml: async () => page('<p>hello</p>') })({ query: 'q' });
    expect(result.error?.failure?.kind).toBe('blocked');
  });

  it('returns ok with an empty list when the page says there are no results', async () => {
    const result = await createWebSearchTool({ searchHtml: async () => page('<p>No results found.</p>') })({ query: 'q' });
    expect(result).toMatchObject({ status: 'ok', results: [] });
  });

  it('returns ok with an empty list when containers exist but every item was filtered', async () => {
    const result = await createWebSearchTool({ searchHtml: async () => page('<div class="result"></div>') })({ query: 'q' });
    expect(result).toMatchObject({ status: 'ok', results: [] });
  });

  it('classifies HTTP failures by status and network failures as transient', async () => {
    const limited = await createWebSearchTool({
      searchHtml: async () => {
        throw new DuckDuckGoHttpError(429, new Headers({ 'retry-after': '7' }));
      }
    })({ query: 'q' });
    expect(limited.error).toMatchObject({ code: 'BLOCKED', failure: { kind: 'rate_limited', httpStatus: 429, providerRetryAfterMs: 7000 } });

    const walled = await createWebSearchTool({
      searchHtml: async () => {
        throw new DuckDuckGoHttpError(403, new Headers());
      }
    })({ query: 'q' });
    expect(walled.error?.failure?.kind).toBe('blocked');

    const network = await createWebSearchTool({
      searchHtml: async () => {
        throw new TypeError('fetch failed');
      }
    })({ query: 'q' });
    expect(network.error).toMatchObject({ code: 'FETCH_FAILED', failure: { kind: 'transient' } });
  });

  it('still returns results', async () => {
    const result = await createWebSearchTool({ searchHtml: async () => withResult })({ query: 'q' });
    expect(result.status).toBe('ok');
    expect(result.results).toHaveLength(1);
  });
});
