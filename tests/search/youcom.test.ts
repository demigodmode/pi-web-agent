import { describe, expect, it, vi } from 'vitest';
import { createYouComSearchTool, normalizeYouComResults, YOUCOM_SEARCH_URL } from '../../src/search/youcom.js';

function response(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers }
  });
}

describe('youcom search', () => {
  it('posts the documented search request and concatenates web before news', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      results: {
        web: [{ title: 'Playwright browsers', url: 'https://playwright.dev/docs/browsers', description: 'Browsers docs.' }],
        news: [{ title: 'Playwright news', url: 'https://example.com/news', description: 'News docs.' }]
      }
    }));

    const search = createYouComSearchTool({ apiKey: 'key', fetchImpl });
    const result = await search({ query: 'playwright browsers' });

    expect(result.status).toBe('ok');
    expect(result.metadata.backend).toBe('youcom');
    expect(result.results).toEqual([
      {
        title: 'Playwright browsers',
        url: 'https://playwright.dev/docs/browsers',
        snippet: 'Browsers docs.'
      },
      {
        title: 'Playwright news',
        url: 'https://example.com/news',
        snippet: 'News docs.'
      }
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      YOUCOM_SEARCH_URL,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-API-Key': 'key'
        })
      })
    );
    expect(JSON.parse((fetchImpl.mock.calls[0][1] as { body: string }).body)).toEqual({
      query: 'playwright browsers',
      count: 10
    });
  });

  it('uses the first web snippet when description is absent', () => {
    expect(normalizeYouComResults({
      results: {
        web: [{ title: 'Snippet fallback', url: 'https://example.com', snippets: [42, 'First text', 'Second text'] }]
      }
    })).toEqual({
      rawCount: 1,
      results: [{ title: 'Snippet fallback', url: 'https://example.com', snippet: 'First text' }]
    });
  });

  it('accepts web-only, news-only, and valid empty sections', () => {
    expect(normalizeYouComResults({ results: { web: [{ title: 'Web', url: 'https://web.example' }] } })).toEqual({
      rawCount: 1,
      results: [{ title: 'Web', url: 'https://web.example', snippet: '' }]
    });
    expect(normalizeYouComResults({ results: { news: [{ title: 'News', url: 'https://news.example' }] } })).toEqual({
      rawCount: 1,
      results: [{ title: 'News', url: 'https://news.example', snippet: '' }]
    });
    expect(normalizeYouComResults({ results: { web: [], news: [] } })).toEqual({ rawCount: 0, results: [] });
  });

  it('rejects empty queries with youcom metadata', async () => {
    const search = createYouComSearchTool({ apiKey: 'key', fetchImpl: vi.fn() });

    const result = await search({ query: '   ' });

    expect(result.status).toBe('error');
    expect(result.metadata.backend).toBe('youcom');
    expect(result.error?.code).toBe('INVALID_QUERY');
  });

  it('returns config error when API key is missing', async () => {
    const search = createYouComSearchTool({ apiKey: undefined, fetchImpl: vi.fn() });

    const result = await search({ query: 'playwright' });

    expect(result.status).toBe('error');
    expect(result.metadata.backend).toBe('youcom');
    expect(result.error).toEqual({
      code: 'BACKEND_CONFIG_INVALID',
      message: 'You.com search requires YDC_API_KEY.',
      failure: { kind: 'not_configured' }
    });
  });

  it('treats a body whose items all fail normalization as bad_response', async () => {
    const search = createYouComSearchTool({
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({ results: { web: [{ title: 'No URL' }] } }))
    });

    const result = await search({ query: 'empty' });

    expect(result.status).toBe('error');
    expect(result.error).toMatchObject({ code: 'BAD_RESPONSE', failure: { kind: 'bad_response', httpStatus: 200 } });
  });

  it('returns fetch failure for non-ok responses', async () => {
    const search = createYouComSearchTool({
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({}, { status: 401 }))
    });

    const result = await search({ query: 'playwright' });

    expect(result.status).toBe('error');
    expect(result.error).toEqual({
      code: 'FETCH_FAILED',
      message: 'You.com search request failed: HTTP 401',
      failure: { kind: 'auth_failed', httpStatus: 401 }
    });
  });

  it('returns fetch failure for thrown errors', async () => {
    const search = createYouComSearchTool({
      apiKey: 'key',
      fetchImpl: vi.fn().mockRejectedValue(new Error('network down'))
    });

    const result = await search({ query: 'playwright' });

    expect(result.status).toBe('error');
    expect(result.error).toEqual({
      code: 'FETCH_FAILED',
      message: 'You.com search request failed: network down',
      failure: { kind: 'transient' }
    });
  });

  it('treats a missing description and snippets as an empty string', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      results: { web: [{ title: 'No snippet', url: 'https://example.com' }] }
    }));

    const search = createYouComSearchTool({ apiKey: 'key', fetchImpl });
    const result = await search({ query: 'snippetless' });

    expect(result.status).toBe('ok');
    expect(result.results[0].snippet).toBe('');
  });

  it('returns ok with an empty list for a valid empty response', async () => {
    const search = createYouComSearchTool({ apiKey: 'key', fetchImpl: vi.fn().mockResolvedValue(response({ results: { web: [], news: [] } })) });
    const result = await search({ query: 'q' });
    expect(result).toMatchObject({ status: 'ok', results: [] });
    expect(result.error).toBeUndefined();
  });

  it('treats missing, absent, and non-array result sections as bad_response', async () => {
    for (const body of ['not json', {}, { results: {} }, { results: 'nope' }, { results: { web: 'nope' } }, { results: { news: 'nope' } }]) {
      const search = createYouComSearchTool({ apiKey: 'key', fetchImpl: vi.fn().mockResolvedValue(response(body)) });
      const result = await search({ query: 'q' });
      expect(result.error).toMatchObject({ code: 'BAD_RESPONSE', failure: { kind: 'bad_response' } });
    }
  });

  it('classifies documented You.com 402 and 403 as provider-wide', async () => {
    const quota = await createYouComSearchTool({
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({ error: 'quota', upgrade_url: 'https://you.com' }, { status: 402 }))
    })({ query: 'q' });
    expect(quota.error?.failure).toEqual({ kind: 'quota_exhausted', httpStatus: 402 });

    const scope = await createYouComSearchTool({
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({}, { status: 403 }))
    })({ query: 'q' });
    expect(scope.error?.failure).toEqual({ kind: 'auth_failed', httpStatus: 403 });
  });

  it('treats a You.com 429 as rate_limited (UNVERIFIED, default rule)', async () => {
    const result = await createYouComSearchTool({
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({}, { status: 429 }))
    })({ query: 'q' });
    expect(result.error?.failure?.kind).toBe('rate_limited');
  });
});
