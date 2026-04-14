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

  it('rejects empty queries', async () => {
    const search = createWebSearchTool({ searchHtml: vi.fn() });

    await expect(search({ query: '   ' })).resolves.toMatchObject({
      status: 'error',
      error: { code: 'INVALID_QUERY' }
    });
  });
});
