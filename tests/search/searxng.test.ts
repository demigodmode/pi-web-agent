import { describe, expect, it, vi } from 'vitest';
import { createSearxngSearchTool } from '../../src/search/searxng.js';

describe('searxng search backend', () => {
  it('maps SearXNG JSON results into web search results', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            title: 'Example Docs',
            url: 'https://example.com/docs',
            content: 'Useful docs snippet'
          }
        ]
      })
    } as Response);

    const search = createSearxngSearchTool({ baseUrl: 'http://localhost:8080', fetchImpl });
    const result = await search({ query: 'example docs' });

    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:8080/search?q=example+docs&format=json');
    expect(result).toMatchObject({
      status: 'ok',
      results: [{ title: 'Example Docs', url: 'https://example.com/docs', snippet: 'Useful docs snippet' }],
      metadata: { backend: 'searxng', cacheHit: false }
    });
  });

  it('returns a useful error when SearXNG is unreachable', async () => {
    const search = createSearxngSearchTool({
      baseUrl: 'http://localhost:8080',
      fetchImpl: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'))
    });

    await expect(search({ query: 'example' })).resolves.toMatchObject({
      status: 'error',
      metadata: { backend: 'searxng', cacheHit: false },
      error: { code: 'FETCH_FAILED' }
    });
  });
});
