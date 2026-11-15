import { describe, expect, it, vi } from 'vitest';
import { createKeenableSearchTool } from '../../src/search/keenable.js';
import { usableSearchProviders } from '../../src/backends/config.js';

function response(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers }
  });
}

// Shape of a documented 200 from POST /v1/search (https://docs.keenable.ai/api-reference/search#response):
// `description` is deprecated and always empty; `snippet` carries the text.
const documented200 = {
  query: 'agents',
  mode: 'pro',
  results: [
    {
      title: 'Building effective agents',
      url: 'https://a.example/agents',
      snippet: 'Agents are systems where models direct their own processes.',
      published_at: '2026-10-30T00:00:00Z',
      indexed_at: '2026-11-03T08:57:22Z',
      description: ''
    },
    { title: 'No URL', snippet: 'dropped', description: '' }
  ],
  usage: { sku: 'search.pro', units: 1, credits: 1, paid: false }
};

describe('keenable search', () => {
  it('posts the query to the keyed endpoint with X-API-Key and reads snippet', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(documented200));

    const result = await createKeenableSearchTool({ apiKey: 'kn-key', fetchImpl })({ query: 'agents' });

    expect(result.status).toBe('ok');
    expect(result.metadata.backend).toBe('keenable');
    expect(result.results).toEqual([
      { title: 'Building effective agents', url: 'https://a.example/agents', snippet: 'Agents are systems where models direct their own processes.' }
    ]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.keenable.ai/v1/search');
    expect(init.method).toBe('POST');
    expect(init.headers['X-API-Key']).toBe('kn-key');
    expect(init.headers['X-Keenable-Title']).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ query: 'agents', max_results: 10, snippet_max_length: 500 });
  });

  it('treats a missing snippet as an empty string', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ results: [{ title: 'T', url: 'https://t.example/', description: '' }] }));
    const result = await createKeenableSearchTool({ apiKey: 'kn-key', fetchImpl })({ query: 'q' });
    expect(result.status).toBe('ok');
    expect(result.results[0].snippet).toBe('');
  });

  it('reports a missing key without calling the API', async () => {
    const fetchImpl = vi.fn();
    const result = await createKeenableSearchTool({ fetchImpl })({ query: 'agents' });
    expect(result.error).toEqual({
      code: 'BACKEND_CONFIG_INVALID',
      message: 'Keenable search requires KEENABLE_API_KEY.',
      failure: { kind: 'not_configured' }
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects empty queries', async () => {
    const result = await createKeenableSearchTool({ apiKey: 'kn-key', fetchImpl: vi.fn() })({ query: '  ' });
    expect(result.error?.code).toBe('INVALID_QUERY');
  });

  it('returns ok with an empty list for a valid empty response', async () => {
    const result = await createKeenableSearchTool({ apiKey: 'kn-key', fetchImpl: vi.fn().mockResolvedValue(response({ query: 'q', mode: 'pro', results: [] })) })({ query: 'q' });
    expect(result).toMatchObject({ status: 'ok', results: [] });
    expect(result.error).toBeUndefined();
  });

  it('treats malformed JSON, a non-array results and all-invalid items as bad_response', async () => {
    for (const body of ['not json', { results: 'nope' }, { query: 'q' }, { results: [{ title: 'No URL' }] }]) {
      const result = await createKeenableSearchTool({ apiKey: 'kn-key', fetchImpl: vi.fn().mockResolvedValue(response(body)) })({ query: 'q' });
      expect(result.error).toMatchObject({ code: 'BAD_RESPONSE', failure: { kind: 'bad_response' } });
    }
  });

  it.each([
    [401, { error: 'Invalid API key', code: 'invalid_api_key' }, 'auth_failed'],
    [402, { error: 'Out of credits', code: 'out_of_credits' }, 'quota_exhausted'],
    [403, { error: 'Key rejected', code: 'api_key_revoked' }, 'auth_failed'],
    [500, { error: 'Internal error' }, 'transient'],
    [503, { error: 'Service unavailable' }, 'transient']
  ])('classifies HTTP %i as %s', async (status, body, kind) => {
    const result = await createKeenableSearchTool({ apiKey: 'kn-key', fetchImpl: vi.fn().mockResolvedValue(response(body, { status })) })({ query: 'q' });
    expect(result.status).toBe('error');
    expect(result.error).toMatchObject({ code: 'FETCH_FAILED', message: `Keenable search request failed: HTTP ${status}`, failure: { kind, httpStatus: status } });
  });

  it('classifies 429 as rate_limited with Retry-After', async () => {
    const result = await createKeenableSearchTool({
      apiKey: 'kn-key',
      fetchImpl: vi.fn().mockResolvedValue(response({ error: 'Rate limit exceeded', code: 'rate_limit_per_second' }, { status: 429, headers: { 'retry-after': '1' } }))
    })({ query: 'q' });
    expect(result.error).toMatchObject({ code: 'FETCH_FAILED', failure: { kind: 'rate_limited', httpStatus: 429, providerRetryAfterMs: 1_000 } });
  });

  it('returns a transient failure when fetch throws', async () => {
    const result = await createKeenableSearchTool({ apiKey: 'kn-key', fetchImpl: vi.fn().mockRejectedValue(new Error('network down')) })({ query: 'q' });
    expect(result.error).toEqual({ code: 'FETCH_FAILED', message: 'Keenable search request failed: network down', failure: { kind: 'transient' } });
  });
});

describe('keenable opt-in', () => {
  it('is not added to the usable set by the key alone', () => {
    const env = { KEENABLE_API_KEY: 'kn-key' } as NodeJS.ProcessEnv;
    expect(usableSearchProviders({ provider: 'duckduckgo' } as any, env)).not.toContain('keenable');
    expect(usableSearchProviders({ provider: 'keenable' } as any, env)).toContain('keenable');
  });
});
