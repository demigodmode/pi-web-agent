import { describe, expect, it, vi } from 'vitest';
import { createExaSearchTool } from '../../src/search/exa.js';

function response(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: vi.fn().mockResolvedValue(body)
  } as unknown as Response;
}

describe('exa search', () => {
  it('normalizes Exa search results', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      results: [
        {
          title: 'Playwright browsers',
          url: 'https://playwright.dev/docs/browsers',
          text: 'Browsers docs.'
        },
        {
          title: 'Missing URL',
          text: 'Ignored.'
        }
      ]
    }));

    const search = createExaSearchTool({ apiKey: 'key', fetchImpl });
    const result = await search({ query: 'playwright browsers' });

    expect(result.status).toBe('ok');
    expect(result.metadata.backend).toBe('exa');
    expect(result.results).toEqual([
      {
        title: 'Playwright browsers',
        url: 'https://playwright.dev/docs/browsers',
        snippet: 'Browsers docs.'
      }
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.exa.ai/search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-api-key': 'key'
        })
      })
    );
    expect(JSON.parse((fetchImpl.mock.calls[0][1] as { body: string }).body)).toEqual({
      query: 'playwright browsers',
      numResults: 10
    });
  });

  it('rejects empty queries with exa metadata', async () => {
    const search = createExaSearchTool({ apiKey: 'key', fetchImpl: vi.fn() });

    const result = await search({ query: '   ' });

    expect(result.status).toBe('error');
    expect(result.metadata.backend).toBe('exa');
    expect(result.error?.code).toBe('INVALID_QUERY');
  });

  it('returns config error when API key is missing', async () => {
    const search = createExaSearchTool({ apiKey: undefined, fetchImpl: vi.fn() });

    const result = await search({ query: 'playwright' });

    expect(result.status).toBe('error');
    expect(result.metadata.backend).toBe('exa');
    expect(result.error).toEqual({
      code: 'BACKEND_CONFIG_INVALID',
      message: 'Exa search requires EXA_API_KEY.'
    });
  });

  it('returns no results when Exa has no usable results', async () => {
    const search = createExaSearchTool({
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({ results: [{ title: 'No URL' }] }))
    });

    const result = await search({ query: 'empty' });

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('NO_RESULTS');
  });

  it('returns fetch failure for non-ok responses', async () => {
    const search = createExaSearchTool({
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({}, { ok: false, status: 401 }))
    });

    const result = await search({ query: 'playwright' });

    expect(result.status).toBe('error');
    expect(result.error).toEqual({
      code: 'FETCH_FAILED',
      message: 'Exa search request failed: HTTP 401'
    });
  });

  it('returns fetch failure for thrown errors', async () => {
    const search = createExaSearchTool({
      apiKey: 'key',
      fetchImpl: vi.fn().mockRejectedValue(new Error('network down'))
    });

    const result = await search({ query: 'playwright' });

    expect(result.status).toBe('error');
    expect(result.error).toEqual({
      code: 'FETCH_FAILED',
      message: 'Exa search request failed: network down'
    });
  });

  it('treats a missing text as an empty string', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      results: [{ title: 'No text', url: 'https://example.com' }]
    }));

    const search = createExaSearchTool({ apiKey: 'key', fetchImpl });
    const result = await search({ query: 'textless' });

    expect(result.status).toBe('ok');
    expect(result.results[0].snippet).toBe('');
  });
});
