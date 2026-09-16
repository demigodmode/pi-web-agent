import { describe, expect, it, vi } from 'vitest';
import { createJsonSearchProvider } from '../../src/search/json-provider.js';

function provider(fetchImpl: typeof fetch, extra: Partial<Parameters<typeof createJsonSearchProvider>[0]> = {}) {
  return createJsonSearchProvider({
    name: 'exa',
    label: 'Exa',
    apiKey: 'key',
    missingKeyMessage: 'Exa search requires EXA_API_KEY.',
    fetchImpl,
    request: (query) => ({ url: 'https://api.test/search', init: { method: 'POST', body: JSON.stringify({ query }) } }),
    normalize: (json) => {
      const raw = (json as { results?: unknown }).results;
      if (!Array.isArray(raw)) return undefined;
      return {
        rawCount: raw.length,
        results: raw.flatMap((item: any) =>
          typeof item?.title === 'string' && typeof item?.url === 'string'
            ? [{ title: item.title, url: item.url, snippet: '' }]
            : []
        )
      };
    },
    ...extra
  });
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });

describe('createJsonSearchProvider', () => {
  it('rejects an empty query as bad_request without a request', async () => {
    const fetchImpl = vi.fn();
    const result = await provider(fetchImpl as any)({ query: '   ' });
    expect(result).toMatchObject({ status: 'error', error: { code: 'INVALID_QUERY', failure: { kind: 'bad_request' } } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports a missing key as not_configured without a request', async () => {
    const fetchImpl = vi.fn();
    const result = await provider(fetchImpl as any, { apiKey: ' ' })({ query: 'q' });
    expect(result).toMatchObject({
      status: 'error',
      error: { code: 'BACKEND_CONFIG_INVALID', message: 'Exa search requires EXA_API_KEY.', failure: { kind: 'not_configured' } }
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns ok with an empty list for a valid empty response', async () => {
    const result = await provider(vi.fn(async () => json({ results: [] })) as any)({ query: 'q' });
    expect(result).toMatchObject({ status: 'ok', results: [] });
    expect(result.error).toBeUndefined();
  });

  it('treats malformed JSON, a missing documented field, and a failed normalization as bad_response', async () => {
    for (const response of [json('not json'), json({ nope: true }), json({ results: [{ title: 1 }] })]) {
      const result = await provider(vi.fn(async () => response) as any)({ query: 'q' });
      expect(result).toMatchObject({ status: 'error', error: { code: 'BAD_RESPONSE', failure: { kind: 'bad_response' } } });
    }
  });

  it('treats a degraded empty response as bad_response', async () => {
    const result = await provider(vi.fn(async () => json({ results: [], degraded: true })) as any, {
      isDegradedEmpty: (body) => (body as { degraded?: boolean }).degraded === true
    })({ query: 'q' });
    expect(result.error?.failure?.kind).toBe('bad_response');
  });

  it('classifies HTTP failures with the provider rules', async () => {
    const result = await provider(vi.fn(async () => json({ tag: 'NO_MORE_CREDITS' }, 402)) as any)({ query: 'q' });
    expect(result).toMatchObject({
      status: 'error',
      error: {
        code: 'FETCH_FAILED',
        message: 'Exa search request failed: HTTP 402',
        failure: { kind: 'quota_exhausted', httpStatus: 402, providerCode: 'NO_MORE_CREDITS' }
      }
    });
  });

  it('classifies a network error as transient', async () => {
    const result = await provider(vi.fn(async () => { throw new TypeError('fetch failed'); }) as any)({ query: 'q' });
    expect(result).toMatchObject({ status: 'error', error: { code: 'FETCH_FAILED', failure: { kind: 'transient' } } });
  });

  it('returns results with presentation', async () => {
    const result = await provider(vi.fn(async () => json({ results: [{ title: 'T', url: 'https://x.test/' }] })) as any)({ query: 'q' });
    expect(result).toMatchObject({ status: 'ok', results: [{ title: 'T', url: 'https://x.test/' }], metadata: { backend: 'exa', cacheHit: false } });
    expect(result.presentation).toBeDefined();
  });
});
