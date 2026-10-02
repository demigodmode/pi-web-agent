import { describe, expect, it, vi } from 'vitest';
import { createGoogleSerpSearchTool } from '../../src/search/google-serp.js';

function response(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers }
  });
}

const ENDPOINT = 'https://serp.example/search';

describe('google-serp search', () => {
  it('normalizes an organic result list', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      status: 0,
      organic: [
        { title: 'Playwright browsers', link: 'https://playwright.dev/docs/browsers', snippet: 'Browsers docs.' },
        { title: 'Missing link', snippet: 'Ignored.' }
      ]
    }));

    const search = createGoogleSerpSearchTool({ baseUrl: ENDPOINT, apiKey: 'key', fetchImpl });
    const result = await search({ query: 'playwright browsers' });

    expect(result.status).toBe('ok');
    expect(result.metadata.backend).toBe('google-serp');
    expect(result.results).toEqual([
      { title: 'Playwright browsers', url: 'https://playwright.dev/docs/browsers', snippet: 'Browsers docs.' }
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      ENDPOINT,
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
      q: 'playwright browsers',
      num: 10
    });
  });

  it('uses the configured key header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ organic: [] }));

    const search = createGoogleSerpSearchTool({
      baseUrl: ENDPOINT,
      apiKey: 'key',
      keyHeader: 'Authorization',
      fetchImpl
    });
    await search({ query: 'q' });

    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({ Authorization: 'key' });
  });

  it('returns config error when the API key is missing', async () => {
    const search = createGoogleSerpSearchTool({ baseUrl: ENDPOINT, apiKey: undefined, fetchImpl: vi.fn() });

    const result = await search({ query: 'playwright' });

    expect(result.status).toBe('error');
    expect(result.metadata.backend).toBe('google-serp');
    expect(result.error).toEqual({
      code: 'BACKEND_CONFIG_INVALID',
      message: 'Google SERP search requires PI_WEB_AGENT_GOOGLE_SERP_API_KEY.',
      failure: { kind: 'not_configured' }
    });
  });

  it('rejects empty queries with google-serp metadata', async () => {
    const search = createGoogleSerpSearchTool({ baseUrl: ENDPOINT, apiKey: 'key', fetchImpl: vi.fn() });

    const result = await search({ query: '   ' });

    expect(result.error?.code).toBe('INVALID_QUERY');
    expect(result.metadata.backend).toBe('google-serp');
  });

  it('treats a 200 body with a non-zero status as a provider failure', async () => {
    const unauthorized = await createGoogleSerpSearchTool({
      baseUrl: ENDPOINT,
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({ status: 1001, error: 'Unauthorized' }))
    })({ query: 'q' });

    expect(unauthorized.status).toBe('error');
    expect(unauthorized.error).toMatchObject({
      code: 'FETCH_FAILED',
      message: 'Google SERP search request failed: "Unauthorized" (provider status 1001).',
      failure: { kind: 'auth_failed', httpStatus: 200, providerCode: '1001' }
    });

    const broke = await createGoogleSerpSearchTool({
      baseUrl: ENDPOINT,
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({ status: 4001, message: 'Insufficient credits' }))
    })({ query: 'q' });

    expect(broke.error?.failure).toMatchObject({ kind: 'quota_exhausted', providerCode: '4001' });

    // An unrecognized status with no error message is not read as an envelope failure; the body
    // has no usable `organic` array, so it fails at normalize as a bad_response instead.
    const unrecognized = await createGoogleSerpSearchTool({
      baseUrl: ENDPOINT,
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({ status: 9999 }))
    })({ query: 'q' });

    expect(unrecognized.error).toMatchObject({
      code: 'BAD_RESPONSE',
      failure: { kind: 'bad_response', httpStatus: 200 }
    });
  });

  it('accepts a success body that only echoes the HTTP status', async () => {
    // Some vendors echo the HTTP status (`{"status": 200, "organic": [...]}`) instead of
    // SerpBase's `0`. Reading 200 as a provider code dropped these rows and, since bad_response
    // is not retried, wrote the vendor off for the rest of the run.
    const search = createGoogleSerpSearchTool({
      baseUrl: ENDPOINT,
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({
        status: 200,
        organic: [{ title: 'Playwright', link: 'https://playwright.dev/', snippet: 'Browsers.' }]
      }))
    });

    const result = await search({ query: 'q' });

    expect(result.status).toBe('ok');
    expect(result.results).toEqual([
      { title: 'Playwright', url: 'https://playwright.dev/', snippet: 'Browsers.' }
    ]);
    expect(result.error).toBeUndefined();
  });

  it('returns ok with an empty list for a successful empty response', async () => {
    const search = createGoogleSerpSearchTool({
      baseUrl: ENDPOINT,
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({ status: 0, organic: [] }))
    });

    const result = await search({ query: 'q' });

    expect(result).toMatchObject({ status: 'ok', results: [] });
    expect(result.error).toBeUndefined();
  });

  it('reports an auth failure for an error envelope that also carries an organic array', async () => {
    // The envelope wins over the payload: an empty array is not a valid empty search, and a row
    // next to the error is not a result.
    for (const body of [
      { status: 1001, error: 'Unauthorized', organic: [] },
      { status: 1001, error: 'Unauthorized', organic: [{ title: 'T', link: 'https://x.test/', snippet: 's' }] }
    ]) {
      const result = await createGoogleSerpSearchTool({
        baseUrl: ENDPOINT,
        apiKey: 'key',
        fetchImpl: vi.fn().mockResolvedValue(response(body))
      })({ query: 'q' });

      expect(result.status).toBe('error');
      expect(result.results).toEqual([]);
      expect(result.error).toMatchObject({
        code: 'FETCH_FAILED',
        message: 'Google SERP search request failed: "Unauthorized" (provider status 1001).',
        failure: { kind: 'auth_failed', httpStatus: 200, providerCode: '1001' }
      });
    }
  });

  it('treats the documented 1504 timeout as retryable', async () => {
    const result = await createGoogleSerpSearchTool({
      baseUrl: ENDPOINT,
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({ status: 1504, error: 'Failed to fetch search results' }))
    })({ query: 'q' });

    expect(result.error).toMatchObject({
      code: 'FETCH_FAILED',
      failure: { kind: 'transient', httpStatus: 200, providerCode: '1504' }
    });
  });

  it('classifies HTTP failures for the endpoint', async () => {
    const cases: Array<[number, string]> = [
      [401, 'auth_failed'],
      [403, 'auth_failed'],
      [402, 'quota_exhausted'],
      [429, 'rate_limited'],
      [500, 'transient']
    ];

    for (const [status, kind] of cases) {
      const result = await createGoogleSerpSearchTool({
        baseUrl: ENDPOINT,
        apiKey: 'key',
        fetchImpl: vi.fn().mockResolvedValue(response({}, { status }))
      })({ query: 'q' });

      expect(result.error).toMatchObject({ code: 'FETCH_FAILED', failure: { kind, httpStatus: status } });
    }
  });

  it('treats a body whose items all fail normalization as bad_response', async () => {
    const search = createGoogleSerpSearchTool({
      baseUrl: ENDPOINT,
      apiKey: 'key',
      fetchImpl: vi.fn().mockResolvedValue(response({ organic: [{ title: 'No link' }] }))
    });

    const result = await search({ query: 'q' });

    expect(result.error).toMatchObject({ code: 'BAD_RESPONSE', failure: { kind: 'bad_response', httpStatus: 200 } });
  });

  it('treats a malformed body as bad_response', async () => {
    for (const body of ['not json', { organic: 'nope' }]) {
      const search = createGoogleSerpSearchTool({
        baseUrl: ENDPOINT,
        apiKey: 'key',
        fetchImpl: vi.fn().mockResolvedValue(response(body))
      });
      const result = await search({ query: 'q' });
      expect(result.error).toMatchObject({ code: 'BAD_RESPONSE', failure: { kind: 'bad_response' } });
    }
  });

  it('returns fetch failure for thrown errors', async () => {
    const search = createGoogleSerpSearchTool({
      baseUrl: ENDPOINT,
      apiKey: 'key',
      fetchImpl: vi.fn().mockRejectedValue(new Error('network down'))
    });

    const result = await search({ query: 'q' });

    expect(result.error).toEqual({
      code: 'FETCH_FAILED',
      message: 'Google SERP search request failed: network down',
      failure: { kind: 'transient' }
    });
  });
});
