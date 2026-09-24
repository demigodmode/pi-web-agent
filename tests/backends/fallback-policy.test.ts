import { describe, expect, it, vi } from 'vitest';
import { chainSearch, withFetchPolicy, withSearchPolicy, type PolicyDeps } from '../../src/backends/fallback-policy.js';
import { createProviderHealth } from '../../src/backends/provider-health.js';
import type { FailureInfo, SearchProviderName, WebFetchResponse, WebSearchResponse } from '../../src/types.js';

const ok = (backend: SearchProviderName, count = 1): WebSearchResponse => ({
  status: 'ok',
  results: Array.from({ length: count }, (_, i) => ({ title: `r${i}`, url: `https://${backend}.test/${i}`, snippet: '' })),
  metadata: { backend, cacheHit: false }
});
const fail = (backend: SearchProviderName, failure: FailureInfo, code = 'FETCH_FAILED'): WebSearchResponse => ({
  status: 'error',
  results: [],
  metadata: { backend, cacheHit: false },
  error: { code, message: `${backend} ${failure.kind}`, failure }
});

function deps(now = 1_000_000): PolicyDeps & { sleep: ReturnType<typeof vi.fn> } {
  return { health: createProviderHealth({ now: () => now }), now: () => now, sleep: vi.fn(async () => undefined), random: () => 0 };
}

describe('withSearchPolicy', () => {
  it('retries a transient failure exactly once after 500-750 ms', async () => {
    const d = deps();
    const search = vi.fn().mockResolvedValueOnce(fail('brave', { kind: 'transient' })).mockResolvedValueOnce(ok('brave'));
    const result = await withSearchPolicy('brave', search, d)({ query: 'q' });

    expect(search).toHaveBeenCalledTimes(2);
    expect(d.sleep).toHaveBeenCalledWith(500);
    expect(result.status).toBe('ok');
    expect(result.metadata.attempts?.map((a) => a.outcome)).toEqual(['retried', 'results']);
  });

  it('retries at most once', async () => {
    const d = deps();
    const search = vi.fn(async () => fail('brave', { kind: 'transient' }));
    await withSearchPolicy('brave', search, d)({ query: 'q' });
    expect(search).toHaveBeenCalledTimes(2);
  });

  it.each(['rate_limited', 'quota_exhausted', 'auth_failed', 'not_configured', 'blocked', 'bad_response', 'bad_request', 'config_global', 'guard_refused'] as const)(
    'never retries %s',
    async (kind) => {
      const d = deps();
      const search = vi.fn(async () => fail('brave', { kind }));
      await withSearchPolicy('brave', search, d)({ query: 'q' });
      expect(search).toHaveBeenCalledTimes(1);
      expect(d.sleep).not.toHaveBeenCalled();
    }
  );

  it('skips a cooling-down provider without calling it, keeping the original failure', async () => {
    const d = deps();
    const failure = { kind: 'rate_limited' as const, httpStatus: 429, providerRetryAfterMs: 90_000 };
    d.health.record('brave', failure);
    const search = vi.fn();
    const result = await withSearchPolicy('brave', search, d)({ query: 'q' });

    expect(search).not.toHaveBeenCalled();
    expect(result.status).toBe('error');
    expect(result.error?.failure).toEqual(failure);
    expect(result.metadata.attempts).toEqual([
      { backend: 'brave', outcome: 'skipped', failure, skipReason: 'cooling_down', cooldownUntil: 1_000_000 + 90_000 }
    ]);
  });

  it('records the applied cooldown separately from the provider retry time', async () => {
    const d = deps();
    const failure = { kind: 'rate_limited' as const, httpStatus: 429, providerRetryAfterMs: 999_999_000 };
    const result = await withSearchPolicy('brave', async () => fail('brave', failure), d)({ query: 'q' });
    expect(result.metadata.attempts?.[0]).toEqual({
      backend: 'brave',
      outcome: 'failed',
      failure,
      cooldownUntil: 1_000_000 + 15 * 60_000
    });
  });

  it('uses the health key, not the display name, for state', async () => {
    const d = deps();
    d.health.record('tavily', { kind: 'auth_failed' });
    const search = vi.fn(async () => ok('tavily'));
    await withSearchPolicy('tavily', search, d, 'tavily-keyless')({ query: 'q' });
    expect(search).toHaveBeenCalled();
  });
});

describe('chainSearch', () => {
  const d = () => deps();

  it('falls back on a non-terminal failure and marks partial coverage', async () => {
    const x = d();
    const result = await chainSearch(
      [withSearchPolicy('brave', async () => fail('brave', { kind: 'blocked' }), x), withSearchPolicy('duckduckgo', async () => ok('duckduckgo'), x)],
      x
    )({ query: 'q' });

    expect(result.status).toBe('ok');
    expect(result.metadata.backend).toBe('duckduckgo');
    expect(result.metadata.fallbackFrom).toBe('brave');
    expect(result.metadata.fallbackReason).toBe('brave blocked');
    expect(result.metadata.coverage).toEqual({ partial: true, unavailable: [{ provider: 'brave', kind: 'blocked' }] });
    expect(result.metadata.attempts?.map((a) => [a.backend, a.outcome])).toEqual([['brave', 'failed'], ['duckduckgo', 'results']]);
  });

  it('does not fall back on bad_request or terminal failures', async () => {
    for (const kind of ['bad_request', 'config_global', 'guard_refused'] as const) {
      const x = d();
      const next = vi.fn(async () => ok('duckduckgo'));
      const result = await chainSearch([withSearchPolicy('brave', async () => fail('brave', { kind }), x), withSearchPolicy('duckduckgo', next, x)], x)({ query: 'q' });
      expect(next).not.toHaveBeenCalled();
      expect(result.error?.failure?.kind).toBe(kind);
    }
  });

  it('returns a valid empty response as ok without falling back or claiming partial coverage', async () => {
    const x = d();
    const next = vi.fn(async () => ok('duckduckgo'));
    const result = await chainSearch([withSearchPolicy('brave', async () => ok('brave', 0), x), withSearchPolicy('duckduckgo', next, x)], x)({ query: 'q' });
    expect(next).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'ok', results: [] });
    expect(result.metadata.coverage).toBeUndefined();
  });

  it('reports every provider unavailable without calling any, soonest cooldown first', async () => {
    const x = d();
    x.health.record('brave', { kind: 'rate_limited', providerRetryAfterMs: 120_000 });
    x.health.record('exa', { kind: 'rate_limited', providerRetryAfterMs: 30_000 });
    x.health.record('tavily', { kind: 'quota_exhausted' });
    const calls = [vi.fn(), vi.fn(), vi.fn()];

    const result = await chainSearch(
      [withSearchPolicy('brave', calls[0], x), withSearchPolicy('tavily', calls[2], x), withSearchPolicy('exa', calls[1], x)],
      x
    )({ query: 'q' });

    for (const call of calls) expect(call).not.toHaveBeenCalled();
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('SEARCH_BACKENDS_UNAVAILABLE');
    expect(result.error?.failure?.kind).not.toBe('config_global');
    const message = result.error?.message ?? '';
    expect(message.indexOf('exa')).toBeLessThan(message.indexOf('brave'));
    expect(message).toContain('tavily');
    expect(message).toContain('quota_exhausted');
  });

  it('keeps the provider hint for problems the user has to fix', async () => {
    const x = d();
    const result = await chainSearch(
      [withSearchPolicy('searxng', async () => fail('searxng', { kind: 'not_configured' }), x)],
      x
    )({ query: 'q' });
    expect(result.error?.message).toBe('No search backend is available: searxng not_configured (searxng not_configured).');
  });

  it('uses SEARCH_BACKENDS_UNAVAILABLE when every provider failed as well', async () => {
    const x = d();
    const result = await chainSearch(
      [withSearchPolicy('brave', async () => fail('brave', { kind: 'blocked' }), x), withSearchPolicy('duckduckgo', async () => fail('duckduckgo', { kind: 'blocked' }), x)],
      x
    )({ query: 'q' });
    expect(result.error?.code).toBe('SEARCH_BACKENDS_UNAVAILABLE');
  });
});

describe('withFetchPolicy', () => {
  const page = (status: WebFetchResponse['status'], failure?: FailureInfo): WebFetchResponse => ({
    status,
    url: 'https://page.test/',
    metadata: { method: 'firecrawl', cacheHit: false },
    ...(failure ? { error: { code: 'FETCH_FAILED', message: `firecrawl ${failure.kind}`, failure } } : {})
  });
  const http = (): WebFetchResponse => ({ status: 'ok', url: 'https://page.test/', metadata: { method: 'http', cacheHit: false }, content: { text: 'hi' } });

  it('falls back to http on a non-terminal failure and on needs_headless', async () => {
    for (const first of [page('error', { kind: 'quota_exhausted' }), page('needs_headless')]) {
      const x = deps();
      const fallback = vi.fn(async () => http());
      const result = await withFetchPolicy(async () => first, fallback, x)({ url: 'https://page.test/' });
      expect(fallback).toHaveBeenCalled();
      expect(result.metadata).toMatchObject({ method: 'http', fallbackFrom: 'firecrawl' });
    }
  });

  it('never falls back on bad_request or terminal failures', async () => {
    for (const kind of ['bad_request', 'config_global', 'guard_refused'] as const) {
      const x = deps();
      const fallback = vi.fn(async () => http());
      const result = await withFetchPolicy(async () => page('error', { kind }), fallback, x)({ url: 'https://page.test/' });
      expect(fallback).not.toHaveBeenCalled();
      expect(result.error?.failure?.kind).toBe(kind);
    }
  });

  it('skips a disabled Firecrawl straight to http, and returns the skip when there is no fallback', async () => {
    const x = deps();
    x.health.record('firecrawl', { kind: 'auth_failed' });
    const primary = vi.fn();
    const withFallback = await withFetchPolicy(primary, async () => http(), x)({ url: 'https://page.test/' });
    expect(primary).not.toHaveBeenCalled();
    expect(withFallback.status).toBe('ok');

    const noFallback = await withFetchPolicy(primary, undefined, x)({ url: 'https://page.test/' });
    expect(noFallback).toMatchObject({ status: 'error', error: { failure: { kind: 'auth_failed' } } });
    expect(noFallback.metadata.attempts?.[0]).toMatchObject({ outcome: 'skipped', skipReason: 'disabled' });
  });

  it('retries a transient Firecrawl failure once before falling back', async () => {
    const x = deps();
    const primary = vi.fn(async () => page('error', { kind: 'transient' }));
    const fallback = vi.fn(async () => http());
    const input = { url: 'https://page.test/', query: 'relevant section' };
    await withFetchPolicy(primary, fallback, x)(input);
    expect(primary).toHaveBeenCalledTimes(2);
    expect(primary).toHaveBeenNthCalledWith(1, input);
    expect(primary).toHaveBeenNthCalledWith(2, input);
    expect(fallback).toHaveBeenCalledWith(input);
  });
});
