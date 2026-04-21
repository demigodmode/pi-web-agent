import { describe, expect, it, vi } from 'vitest';
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

    await expect(search({ query: 'example' })).resolves.toEqual({
      status: 'ok',
      results: [{ title: 'Example', url: 'https://example.com', snippet: 'Snippet' }],
      metadata: { backend: 'duckduckgo', cacheHit: false }
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

  it('returns NO_RESULTS when the backend page is valid but contains no usable results', async () => {
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

    await expect(search({ query: 'missing thing' })).resolves.toMatchObject({
      status: 'error',
      error: {
        code: 'NO_RESULTS',
        message: 'DuckDuckGo returned no usable results for this query.'
      }
    });
  });

  it('returns PARSE_FAILED when the backend page cannot be understood as search results', async () => {
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
        code: 'PARSE_FAILED',
        message: 'DuckDuckGo returned a page, but it did not match the expected results format.'
      }
    });
  });

  it('returns BLOCKED when the backend clearly looks blocked', async () => {
    const search = createWebSearchTool({
      searchHtml: vi.fn().mockRejectedValue(new Error('DuckDuckGo blocked the request with 403'))
    });

    await expect(search({ query: 'blocked query' })).resolves.toMatchObject({
      status: 'error',
      error: {
        code: 'BLOCKED',
        message: 'DuckDuckGo search appears to be blocked or rate limited.'
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
        message: 'DuckDuckGo search request failed: socket hang up'
      }
    });
  });
});
