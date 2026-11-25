import { describe, expect, it, vi } from 'vitest';
import { createFirecrawlSearchTool } from '../../src/search/firecrawl.js';
import { usableSearchProviders } from '../../src/backends/config.js';

function response(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers }
  });
}

// Shape of a documented 200 from POST /v2/search (https://docs.firecrawl.dev/api-reference/endpoint/search).
const documented200 = {
  success: true,
  data: {
    web: [
      {
        url: 'https://a.example/agents',
        title: 'Building effective agents',
        description: 'Agents are systems where models direct their own processes.',
        position: 1
      },
      { title: 'No URL', description: 'dropped', position: 2 }
    ]
  },
  creditsUsed: 2,
  id: '01a21278-af0c-72a6-ae9e-933650093ab5'
};

describe('firecrawl search', () => {
  it('posts the query to /v2/search with a bearer key and reads description', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(documented200));

    const result = await createFirecrawlSearchTool({ apiKey: 'fc-key', fetchImpl })({ query: 'agents' });

    expect(result.status).toBe('ok');
    expect(result.metadata.backend).toBe('firecrawl');
    expect(result.results).toEqual([
      { title: 'Building effective agents', url: 'https://a.example/agents', snippet: 'Agents are systems where models direct their own processes.' }
    ]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.firecrawl.dev/v2/search');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer fc-key');
    expect(JSON.parse(init.body)).toEqual({ query: 'agents', limit: 10, origin: 'pi-web-agent' });
  });

  it('caps long descriptions at 500 characters', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ success: true, data: { web: [{ title: 'T', url: 'https://t.example/', description: 'x'.repeat(2_000) }] } }));
    const result = await createFirecrawlSearchTool({ apiKey: 'fc-key', fetchImpl })({ query: 'q' });
    expect(result.results[0].snippet).toHaveLength(500);
  });

  it('treats a missing description as an empty string', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ success: true, data: { web: [{ title: 'T', url: 'https://t.example/' }] } }));
    const result = await createFirecrawlSearchTool({ apiKey: 'fc-key', fetchImpl })({ query: 'q' });
    expect(result.status).toBe('ok');
    expect(result.results[0].snippet).toBe('');
  });

  it('reports a missing key without calling the API', async () => {
    const fetchImpl = vi.fn();
    const result = await createFirecrawlSearchTool({ fetchImpl })({ query: 'agents' });
    expect(result.error).toEqual({
      code: 'BACKEND_CONFIG_INVALID',
      message: 'Firecrawl search requires PI_WEB_AGENT_FIRECRAWL_API_KEY.',
      failure: { kind: 'not_configured' }
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects empty queries', async () => {
    const result = await createFirecrawlSearchTool({ apiKey: 'fc-key', fetchImpl: vi.fn() })({ query: '  ' });
    expect(result.error?.code).toBe('INVALID_QUERY');
  });

  it('returns ok with an empty list for a valid empty response', async () => {
    const result = await createFirecrawlSearchTool({ apiKey: 'fc-key', fetchImpl: vi.fn().mockResolvedValue(response({ success: true, data: { web: [] } })) })({ query: 'q' });
    expect(result).toMatchObject({ status: 'ok', results: [] });
    expect(result.error).toBeUndefined();
  });

  it('treats malformed JSON, a non-array web list and all-invalid items as bad_response', async () => {
    for (const body of ['not json', { success: true, data: { web: 'nope' } }, { success: true, data: {} }, { success: true }, { success: true, data: { web: [{ title: 'No URL' }] } }]) {
      const result = await createFirecrawlSearchTool({ apiKey: 'fc-key', fetchImpl: vi.fn().mockResolvedValue(response(body)) })({ query: 'q' });
      expect(result.error).toMatchObject({ code: 'BAD_RESPONSE', failure: { kind: 'bad_response' } });
    }
  });

  it.each([
    [400, { success: false, error: 'Bad Request' }, 'bad_request'],
    [401, { success: false, error: 'Unauthorized: Invalid token' }, 'auth_failed'],
    [402, { success: false, error: 'Payment required' }, 'quota_exhausted'],
    [403, { success: false, error: 'Forbidden' }, 'auth_failed'],
    [500, { success: false, error: 'Internal server error' }, 'transient']
  ])('classifies HTTP %i as %s', async (status, body, kind) => {
    const result = await createFirecrawlSearchTool({ apiKey: 'fc-key', fetchImpl: vi.fn().mockResolvedValue(response(body, { status })) })({ query: 'q' });
    expect(result.status).toBe('error');
    expect(result.error).toMatchObject({ code: 'FETCH_FAILED', message: `Firecrawl search request failed: HTTP ${status}`, failure: { kind, httpStatus: status } });
  });

  it('classifies 429 as rate_limited with Retry-After', async () => {
    const result = await createFirecrawlSearchTool({
      apiKey: 'fc-key',
      fetchImpl: vi.fn().mockResolvedValue(response({ success: false, error: 'Rate limit exceeded' }, { status: 429, headers: { 'retry-after': '1' } }))
    })({ query: 'q' });
    expect(result.error).toMatchObject({ code: 'FETCH_FAILED', failure: { kind: 'rate_limited', httpStatus: 429, providerRetryAfterMs: 1_000 } });
  });

  it('returns a transient failure when fetch throws', async () => {
    const result = await createFirecrawlSearchTool({ apiKey: 'fc-key', fetchImpl: vi.fn().mockRejectedValue(new Error('network down')) })({ query: 'q' });
    expect(result.error).toEqual({ code: 'FETCH_FAILED', message: 'Firecrawl search request failed: network down', failure: { kind: 'transient' } });
  });
});

describe('firecrawl search opt-in', () => {
  it('is not added to the usable set by the key alone', () => {
    const env = { PI_WEB_AGENT_FIRECRAWL_API_KEY: 'fc-key' } as NodeJS.ProcessEnv;
    expect(usableSearchProviders({ provider: 'duckduckgo' } as any, env)).not.toContain('firecrawl');
    expect(usableSearchProviders({ provider: 'firecrawl' } as any, env)).toContain('firecrawl');
    expect(usableSearchProviders({ provider: 'duckduckgo', fanout: { mode: 'on', providers: ['duckduckgo', 'firecrawl'] } } as any, env)).toContain('firecrawl');
    expect(usableSearchProviders({ provider: 'firecrawl' } as any, {} as NodeJS.ProcessEnv)).not.toContain('firecrawl');
  });
});
