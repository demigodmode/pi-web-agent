import { describe, expect, it, vi } from 'vitest';
import { createBraveSearchTool } from '../../src/search/brave.js';

function response(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: vi.fn().mockResolvedValue(body)
  } as unknown as Response;
}

describe('brave search', () => {
  it('normalizes Brave web results', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      web: {
        results: [
          {
            title: 'Playwright browsers',
            url: 'https://playwright.dev/docs/browsers',
            description: 'Browsers docs.'
          },
          {
            title: 'Missing URL',
            description: 'Ignored.'
          }
        ]
      }
    }));

    const search = createBraveSearchTool({ apiKey: 'key', fetchImpl });
    const result = await search({ query: 'playwright browsers' });

    expect(result.status).toBe('ok');
    expect(result.metadata.backend).toBe('brave');
    expect(result.results).toEqual([
      {
        title: 'Playwright browsers',
        url: 'https://playwright.dev/docs/browsers',
        snippet: 'Browsers docs.'
      }
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('https://api.search.brave.com/res/v1/web/search?'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json',
          'X-Subscription-Token': 'key'
        })
      })
    );
  });

  it('rejects empty queries with brave metadata', async () => {
    const search = createBraveSearchTool({ apiKey: 'key', fetchImpl: vi.fn() });

    const result = await search({ query: '   ' });

    expect(result.status).toBe('error');
    expect(result.metadata.backend).toBe('brave');
    expect(result.error?.code).toBe('INVALID_QUERY');
  });

  it('returns config error when API key is missing', async () => {
    const search = createBraveSearchTool({ apiKey: undefined, fetchImpl: vi.fn() });

    const result = await search({ query: 'playwright' });

    expect(result.status).toBe('error');
    expect(result.metadata.backend).toBe('brave');
    expect(result.error).toEqual({
      code: 'BACKEND_CONFIG_INVALID',
      message: 'Brave search requires PI_WEB_AGENT_BRAVE_API_KEY.'
    });
  });

  it('returns no results when Brave has no usable web results', async () => {
    const search = createBraveSearchTool({
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({ web: { results: [{ title: 'No URL' }] } }))
    });

    const result = await search({ query: 'empty' });

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('NO_RESULTS');
  });

  it('returns fetch failure for non-ok responses', async () => {
    const search = createBraveSearchTool({
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({}, { ok: false, status: 401 }))
    });

    const result = await search({ query: 'playwright' });

    expect(result.status).toBe('error');
    expect(result.error).toEqual({
      code: 'FETCH_FAILED',
      message: 'Brave search request failed: HTTP 401'
    });
  });

  it('returns fetch failure for thrown errors', async () => {
    const search = createBraveSearchTool({
      apiKey: 'key',
      fetchImpl: vi.fn().mockRejectedValue(new Error('network down'))
    });

    const result = await search({ query: 'playwright' });

    expect(result.status).toBe('error');
    expect(result.error).toEqual({
      code: 'FETCH_FAILED',
      message: 'Brave search request failed: network down'
    });
  });
});
