import { describe, expect, it, vi } from 'vitest';
import { createExaSearchTool } from '../../src/search/exa.js';

function response(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers }
  });
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
      message: 'Exa search requires EXA_API_KEY.',
      failure: { kind: 'not_configured' }
    });
  });

  it('treats a body whose items all fail normalization as bad_response', async () => {
    const search = createExaSearchTool({
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({ results: [{ title: 'No URL' }] }))
    });

    const result = await search({ query: 'empty' });

    expect(result.status).toBe('error');
    expect(result.error).toMatchObject({ code: 'BAD_RESPONSE', failure: { kind: 'bad_response', httpStatus: 200 } });
  });

  it('returns fetch failure for non-ok responses', async () => {
    const search = createExaSearchTool({
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({}, { status: 401 }))
    });

    const result = await search({ query: 'playwright' });

    expect(result.status).toBe('error');
    expect(result.error).toEqual({
      code: 'FETCH_FAILED',
      message: 'Exa search request failed: HTTP 401',
      failure: { kind: 'auth_failed', httpStatus: 401 }
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
      message: 'Exa search request failed: network down',
      failure: { kind: 'transient' }
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

  it('returns ok with an empty list for a valid empty response', async () => {
    const search = createExaSearchTool({ apiKey: 'key', fetchImpl: vi.fn().mockResolvedValue(response({ results: [] })) });
    const result = await search({ query: 'q' });
    expect(result).toMatchObject({ status: 'ok', results: [] });
    expect(result.error).toBeUndefined();
  });

  it('treats a malformed body as bad_response', async () => {
    for (const body of ['not json', { results: 'nope' }]) {
      const search = createExaSearchTool({ apiKey: 'key', fetchImpl: vi.fn().mockResolvedValue(response(body)) });
      const result = await search({ query: 'q' });
      expect(result.error).toMatchObject({ code: 'BAD_RESPONSE', failure: { kind: 'bad_response' } });
    }
  });

  it('classifies documented Exa tags ahead of the status', async () => {
    const search = createExaSearchTool({
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({ tag: 'API_KEY_BUDGET_EXCEEDED', error: 'budget' }, { status: 402 }))
    });
    const result = await search({ query: 'q' });
    expect(result.error).toMatchObject({ failure: { kind: 'quota_exhausted', httpStatus: 402, providerCode: 'API_KEY_BUDGET_EXCEEDED' } });

    const filtered = await createExaSearchTool({
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({ tag: 'PROHIBITED_CONTENT' }, { status: 403 }))
    })({ query: 'q' });
    expect(filtered.error?.failure).toMatchObject({ kind: 'bad_request', providerCode: 'PROHIBITED_CONTENT' });
  });
});
