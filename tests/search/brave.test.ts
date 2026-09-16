import { describe, expect, it, vi } from 'vitest';
import { createBraveSearchTool } from '../../src/search/brave.js';

function response(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers }
  });
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
      message: 'Brave search requires PI_WEB_AGENT_BRAVE_API_KEY.',
      failure: { kind: 'not_configured' }
    });
  });

  it('treats a body whose items all fail normalization as bad_response', async () => {
    const search = createBraveSearchTool({
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({ web: { results: [{ title: 'No URL' }] } }))
    });

    const result = await search({ query: 'empty' });

    expect(result.status).toBe('error');
    expect(result.error).toMatchObject({ code: 'BAD_RESPONSE', failure: { kind: 'bad_response', httpStatus: 200 } });
  });

  it('returns fetch failure for non-ok responses', async () => {
    const search = createBraveSearchTool({
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({}, { status: 401 }))
    });

    const result = await search({ query: 'playwright' });

    expect(result.status).toBe('error');
    expect(result.error).toEqual({
      code: 'FETCH_FAILED',
      message: 'Brave search request failed: HTTP 401',
      failure: { kind: 'auth_failed', httpStatus: 401 }
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
      message: 'Brave search request failed: network down',
      failure: { kind: 'transient' }
    });
  });

  it('returns ok with an empty list for a valid empty response', async () => {
    const search = createBraveSearchTool({ apiKey: 'key', fetchImpl: vi.fn().mockResolvedValue(response({ web: { results: [] } })) });
    const result = await search({ query: 'q' });
    expect(result).toMatchObject({ status: 'ok', results: [] });
    expect(result.error).toBeUndefined();
  });

  it('treats a malformed body as bad_response', async () => {
    for (const body of ['not json', { web: { results: 'nope' } }]) {
      const search = createBraveSearchTool({ apiKey: 'key', fetchImpl: vi.fn().mockResolvedValue(response(body)) });
      const result = await search({ query: 'q' });
      expect(result.error).toMatchObject({ code: 'BAD_RESPONSE', failure: { kind: 'bad_response' } });
    }
  });

  it('treats a 200 without a web block as a valid empty search', async () => {
    const search = createBraveSearchTool({ apiKey: 'key', fetchImpl: vi.fn().mockResolvedValue(response({ query: { original: 'q' } })) });
    const result = await search({ query: 'q' });
    expect(result).toMatchObject({ status: 'ok', results: [] });
  });

  it('classifies a 429 as rate_limited with the retry time, never quota_exhausted', async () => {
    const search = createBraveSearchTool({
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({}, { status: 429, headers: { 'retry-after': '3', 'x-ratelimit-remaining': '0, 0' } }))
    });
    const result = await search({ query: 'q' });
    expect(result.error).toMatchObject({ code: 'FETCH_FAILED', failure: { kind: 'rate_limited', httpStatus: 429, providerRetryAfterMs: 3000 } });
  });
});
