import { describe, expect, it, vi } from 'vitest';
import { createTavilySearchTool } from '../../src/search/tavily.js';

function response(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: vi.fn().mockResolvedValue(body)
  } as unknown as Response;
}

describe('tavily search', () => {
  it('normalizes Tavily search results', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      results: [
        {
          title: 'Playwright browsers',
          url: 'https://playwright.dev/docs/browsers',
          content: 'Browsers docs.'
        },
        {
          title: 'Missing URL',
          content: 'Ignored.'
        }
      ]
    }));

    const search = createTavilySearchTool({ apiKey: 'key', fetchImpl });
    const result = await search({ query: 'playwright browsers' });

    expect(result.status).toBe('ok');
    expect(result.metadata.backend).toBe('tavily');
    expect(result.results).toEqual([
      {
        title: 'Playwright browsers',
        url: 'https://playwright.dev/docs/browsers',
        snippet: 'Browsers docs.'
      }
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.tavily.com/search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: expect.stringMatching(/^Bearer /)
        })
      })
    );
    expect(JSON.parse((fetchImpl.mock.calls[0][1] as { body: string }).body)).toEqual({
      query: 'playwright browsers',
      max_results: 10
    });
  });

  it('rejects empty queries with tavily metadata', async () => {
    const search = createTavilySearchTool({ apiKey: 'key', fetchImpl: vi.fn() });

    const result = await search({ query: '   ' });

    expect(result.status).toBe('error');
    expect(result.metadata.backend).toBe('tavily');
    expect(result.error?.code).toBe('INVALID_QUERY');
  });

  it('returns config error when API key is missing', async () => {
    const search = createTavilySearchTool({ apiKey: undefined, fetchImpl: vi.fn() });

    const result = await search({ query: 'playwright' });

    expect(result.status).toBe('error');
    expect(result.metadata.backend).toBe('tavily');
    expect(result.error).toEqual({
      code: 'BACKEND_CONFIG_INVALID',
      message: 'Tavily search requires TAVILY_API_KEY.'
    });
  });

  it('returns no results when Tavily has no usable results', async () => {
    const search = createTavilySearchTool({
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({ results: [{ title: 'No URL' }] }))
    });

    const result = await search({ query: 'empty' });

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('NO_RESULTS');
  });

  it('returns fetch failure for non-ok responses', async () => {
    const search = createTavilySearchTool({
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({}, { ok: false, status: 401 }))
    });

    const result = await search({ query: 'playwright' });

    expect(result.status).toBe('error');
    expect(result.error).toEqual({
      code: 'FETCH_FAILED',
      message: 'Tavily search request failed: HTTP 401'
    });
  });

  it('returns fetch failure for thrown errors', async () => {
    const search = createTavilySearchTool({
      apiKey: 'key',
      fetchImpl: vi.fn().mockRejectedValue(new Error('network down'))
    });

    const result = await search({ query: 'playwright' });

    expect(result.status).toBe('error');
    expect(result.error).toEqual({
      code: 'FETCH_FAILED',
      message: 'Tavily search request failed: network down'
    });
  });

  it('treats a missing content as an empty string', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      results: [{ title: 'No content', url: 'https://example.com' }]
    }));

    const search = createTavilySearchTool({ apiKey: 'key', fetchImpl });
    const result = await search({ query: 'contentless' });

    expect(result.status).toBe('ok');
    expect(result.results[0].snippet).toBe('');
  });
});
