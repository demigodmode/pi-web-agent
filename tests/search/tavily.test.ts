import { describe, expect, it, vi } from 'vitest';
import { createTavilySearchTool } from '../../src/search/tavily.js';

function response(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers }
  });
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
      message: 'Tavily search requires TAVILY_API_KEY.',
      failure: { kind: 'not_configured' }
    });
  });

  it('treats a body whose items all fail normalization as bad_response', async () => {
    const search = createTavilySearchTool({
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({ results: [{ title: 'No URL' }] }))
    });

    const result = await search({ query: 'empty' });

    expect(result.status).toBe('error');
    expect(result.error).toMatchObject({ code: 'BAD_RESPONSE', failure: { kind: 'bad_response', httpStatus: 200 } });
  });

  it('returns fetch failure for non-ok responses', async () => {
    const search = createTavilySearchTool({
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({}, { status: 401 }))
    });

    const result = await search({ query: 'playwright' });

    expect(result.status).toBe('error');
    expect(result.error).toEqual({
      code: 'FETCH_FAILED',
      message: 'Tavily search request failed: HTTP 401',
      failure: { kind: 'auth_failed', httpStatus: 401 }
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
      message: 'Tavily search request failed: network down',
      failure: { kind: 'transient' }
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

  it('runs keyless: sends the keyless header and no Authorization', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      results: [{ title: 'Doc', url: 'https://example.com', content: 'snip' }]
    }));

    const search = createTavilySearchTool({ keyless: true, fetchImpl });
    const result = await search({ query: 'playwright' });

    expect(result.status).toBe('ok');
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers['X-Tavily-Access-Mode']).toBe('keyless');
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('still errors when neither a key nor keyless is provided', async () => {
    const search = createTavilySearchTool({ fetchImpl: vi.fn() });
    const result = await search({ query: 'playwright' });
    expect(result.error?.code).toBe('BACKEND_CONFIG_INVALID');
  });

  it('returns ok with an empty list for a valid empty response', async () => {
    const search = createTavilySearchTool({ apiKey: 'key', fetchImpl: vi.fn().mockResolvedValue(response({ results: [] })) });
    const result = await search({ query: 'q' });
    expect(result).toMatchObject({ status: 'ok', results: [] });
    expect(result.error).toBeUndefined();
  });

  it('treats a malformed body as bad_response', async () => {
    for (const body of ['not json', { results: 'nope' }]) {
      const search = createTavilySearchTool({ apiKey: 'key', fetchImpl: vi.fn().mockResolvedValue(response(body)) });
      const result = await search({ query: 'q' });
      expect(result.error).toMatchObject({ code: 'BAD_RESPONSE', failure: { kind: 'bad_response' } });
    }
  });

  it('classifies a keyless 429 as rate_limited with Retry-After', async () => {
    const search = createTavilySearchTool({
      keyless: true,
      fetchImpl: vi.fn().mockResolvedValue(response({ detail: { error: 'limit' } }, { status: 429, headers: { 'retry-after': '12' } }))
    });
    const result = await search({ query: 'q' });
    expect(result.error).toMatchObject({ code: 'FETCH_FAILED', failure: { kind: 'rate_limited', httpStatus: 429, providerRetryAfterMs: 12_000 } });
  });

  it('keeps undocumented Tavily statuses on the defaults (UNVERIFIED)', async () => {
    const result = await createTavilySearchTool({
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({}, { status: 403 }))
    })({ query: 'q' });
    expect(result.error?.failure?.kind).toBe('blocked');
  });
});
