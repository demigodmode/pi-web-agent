import { describe, it, expect, vi } from 'vitest';
import { createFanoutSearch } from '../../src/search/fanout.js';
import type { SearchProviderName, WebSearchResponse } from '../../src/types.js';

function ok(backend: SearchProviderName, urls: string[]): WebSearchResponse {
  return {
    status: 'ok',
    results: urls.map((url, i) => ({ title: `${backend}-${i}`, url, snippet: `${backend} snippet ${i}` })),
    metadata: { backend, cacheHit: false }
  };
}
function err(backend: SearchProviderName): WebSearchResponse {
  return { status: 'error', results: [], metadata: { backend, cacheHit: false }, error: { code: 'X', message: 'nope' } };
}

describe('createFanoutSearch', () => {
  it('on: queries all providers and dedupes by canonical url', async () => {
    const providers = [
      { name: 'duckduckgo' as const, search: vi.fn().mockResolvedValue(ok('duckduckgo', ['https://a.com/x', 'https://b.com/y'])) },
      { name: 'brave' as const, search: vi.fn().mockResolvedValue(ok('brave', ['https://a.com/x/', 'https://c.com/z'])) }
    ];
    const search = createFanoutSearch({ providers, mode: 'on' });
    const res = await search({ query: 'q' });
    expect(providers[0].search).toHaveBeenCalled();
    expect(providers[1].search).toHaveBeenCalled();
    const urls = res.results.map((r) => r.url);
    expect(urls.filter((u) => new URL(u).hostname === 'a.com').length).toBe(1);
    expect(res.results.length).toBe(3);
    expect(res.metadata.fanout?.mode).toBe('on');
  });

  it('on: ranks a url two providers agree on above single-provider urls', async () => {
    const providers = [
      { name: 'duckduckgo' as const, search: vi.fn().mockResolvedValue(ok('duckduckgo', ['https://solo.com/1', 'https://shared.com/2'])) },
      { name: 'brave' as const, search: vi.fn().mockResolvedValue(ok('brave', ['https://shared.com/2'])) }
    ];
    const search = createFanoutSearch({ providers, mode: 'on' });
    const res = await search({ query: 'q' });
    expect(res.results[0].url).toContain('shared.com');
  });

  it('on: a provider that errors is skipped, others still merge', async () => {
    const providers = [
      { name: 'duckduckgo' as const, search: vi.fn().mockResolvedValue(ok('duckduckgo', ['https://a.com/x'])) },
      { name: 'exa' as const, search: vi.fn().mockResolvedValue(err('exa')) }
    ];
    const search = createFanoutSearch({ providers, mode: 'on' });
    const res = await search({ query: 'q' });
    expect(res.status).toBe('ok');
    expect(res.results.length).toBe(1);
    expect(res.metadata.fanout?.providers).toEqual(['duckduckgo']);
  });

  it('on: all providers failing returns an error response', async () => {
    const providers = [
      { name: 'brave' as const, search: vi.fn().mockResolvedValue(err('brave')) },
      { name: 'exa' as const, search: vi.fn().mockResolvedValue(err('exa')) }
    ];
    const search = createFanoutSearch({ providers, mode: 'on' });
    const res = await search({ query: 'q' });
    expect(res.status).toBe('error');
  });

  it('auto: a strong primary does not fan out', async () => {
    const others = vi.fn().mockResolvedValue(ok('brave', ['https://x.com/1']));
    const providers = [
      { name: 'duckduckgo' as const, search: vi.fn().mockResolvedValue(ok('duckduckgo', ['https://a.com/1', 'https://b.com/2', 'https://c.com/3'])) },
      { name: 'brave' as const, search: others }
    ];
    const search = createFanoutSearch({ providers, mode: 'auto' });
    const res = await search({ query: 'q' });
    expect(others).not.toHaveBeenCalled();
    expect(res.metadata.fanout).toBeUndefined();
  });

  it('auto: a weak primary (too few results) fans out', async () => {
    const others = vi.fn().mockResolvedValue(ok('brave', ['https://x.com/1', 'https://y.com/2']));
    const providers = [
      { name: 'duckduckgo' as const, search: vi.fn().mockResolvedValue(ok('duckduckgo', ['https://a.com/1'])) },
      { name: 'brave' as const, search: others }
    ];
    const search = createFanoutSearch({ providers, mode: 'auto' });
    const res = await search({ query: 'q' });
    expect(others).toHaveBeenCalled();
    expect(res.metadata.fanout?.mode).toBe('auto');
    expect(res.results.length).toBeGreaterThan(1);
  });

  it('auto: a single-host primary fans out even with enough results', async () => {
    const others = vi.fn().mockResolvedValue(ok('brave', ['https://other.com/1']));
    const providers = [
      { name: 'duckduckgo' as const, search: vi.fn().mockResolvedValue(ok('duckduckgo', ['https://one.com/1', 'https://one.com/2', 'https://one.com/3'])) },
      { name: 'brave' as const, search: others }
    ];
    const search = createFanoutSearch({ providers, mode: 'auto' });
    await search({ query: 'q' });
    expect(others).toHaveBeenCalled();
  });

  it('on: does not treat a single-provider duplicate as cross-provider agreement', async () => {
    const providers = [
      { name: 'duckduckgo' as const, search: vi.fn().mockResolvedValue(ok('duckduckgo', ['https://u.com/1', 'https://u.com/1'])) },
      { name: 'brave' as const, search: vi.fn().mockResolvedValue(ok('brave', ['https://w.com/2'])) },
      { name: 'exa' as const, search: vi.fn().mockResolvedValue(ok('exa', ['https://w.com/2'])) }
    ];
    const search = createFanoutSearch({ providers, mode: 'on' });
    const res = await search({ query: 'q' });
    // w.com is agreed by TWO distinct providers; u.com only appeared twice from ONE provider.
    expect(res.results[0].url).toContain('w.com');
    // u.com deduped to a single result
    expect(res.results.filter((r) => new URL(r.url).hostname === 'u.com').length).toBe(1);
  });

  it('on: skips a provider that does not respond within the timeout', async () => {
    const providers = [
      { name: 'duckduckgo' as const, search: vi.fn().mockResolvedValue(ok('duckduckgo', ['https://a.com/x'])) },
      { name: 'searxng' as const, search: vi.fn().mockReturnValue(new Promise(() => {})) } // never resolves
    ];
    const search = createFanoutSearch({ providers, mode: 'on', timeoutMs: 20 });
    const res = await search({ query: 'q' });
    expect(res.status).toBe('ok');
    expect(res.metadata.fanout?.providers).toEqual(['duckduckgo']);
    expect(res.metadata.fanout?.skipped).toEqual(['searxng']);
  });

  it('on: records skipped providers that errored or returned nothing', async () => {
    const providers = [
      { name: 'duckduckgo' as const, search: vi.fn().mockResolvedValue(ok('duckduckgo', ['https://a.com/1'])) },
      { name: 'brave' as const, search: vi.fn().mockResolvedValue(err('brave')) }
    ];
    const search = createFanoutSearch({ providers, mode: 'on' });
    const res = await search({ query: 'q' });
    expect(res.metadata.fanout?.providers).toEqual(['duckduckgo']);
    expect(res.metadata.fanout?.skipped).toEqual(['brave']);
  });

  it('on: all providers failing still reports skipped providers in metadata', async () => {
    const providers = [
      { name: 'brave' as const, search: vi.fn().mockResolvedValue(err('brave')) },
      { name: 'exa' as const, search: vi.fn().mockResolvedValue(err('exa')) }
    ];
    const search = createFanoutSearch({ providers, mode: 'on' });
    const res = await search({ query: 'q' });
    expect(res.status).toBe('error');
    expect(res.metadata.fanout?.skipped).toEqual(['brave', 'exa']);
    expect(res.metadata.fanout?.providers).toEqual([]);
  });
});

describe('fanout outcomes and precedence (#55)', () => {
  const okP = (name: any, n = 2) => ({ name, search: async () => ({ status: 'ok' as const, results: Array.from({ length: n }, (_, i) => ({ title: `${name}${i}`, url: `https://${name}${i}.test/`, snippet: '' })), metadata: { backend: name, cacheHit: false } }) });
  const emptyP = (name: any) => ({ name, search: async () => ({ status: 'ok' as const, results: [], metadata: { backend: name, cacheHit: false } }) });
  const failP = (name: any, kind: any, attempts?: any) => ({
    name,
    search: async () => ({ status: 'error' as const, results: [], metadata: { backend: name, cacheHit: false, ...(attempts ? { attempts } : {}) }, error: { code: 'X', message: `${name} ${kind}`, failure: { kind } } })
  });

  it('a terminal outcome wins over results and empty responses', async () => {
    for (const terminal of ['config_global', 'guard_refused']) {
      const result = await createFanoutSearch({ providers: [okP('brave', 5), emptyP('exa'), failP('tavily', terminal)], mode: 'on' })({ query: 'q' });
      expect(result.status).toBe('error');
      expect(result.error?.failure?.kind).toBe(terminal);
      expect(result.error?.code).not.toBe('FANOUT_ALL_FAILED');
    }
  });

  it('results win over empty and failed, with partial coverage when something failed', async () => {
    const result = await createFanoutSearch({ providers: [okP('brave'), emptyP('exa'), failP('tavily', 'rate_limited')], mode: 'on' })({ query: 'q' });
    expect(result.status).toBe('ok');
    expect(result.metadata.coverage).toEqual({ partial: true, unavailable: [{ provider: 'tavily', kind: 'rate_limited' }] });
    expect(result.metadata.fanout?.outcomes).toEqual([
      { provider: 'brave', outcome: 'results', count: 2 },
      { provider: 'exa', outcome: 'empty' },
      { provider: 'tavily', outcome: 'failed', failure: { kind: 'rate_limited' } }
    ]);
  });

  it('a valid empty response with other failures is ok, empty, and partial', async () => {
    const result = await createFanoutSearch({ providers: [emptyP('brave'), failP('exa', 'blocked')], mode: 'on' })({ query: 'q' });
    expect(result).toMatchObject({ status: 'ok', results: [] });
    expect(result.metadata.coverage?.partial).toBe(true);
  });

  it('all empty is ok and not partial', async () => {
    const result = await createFanoutSearch({ providers: [emptyP('brave'), emptyP('exa')], mode: 'on' })({ query: 'q' });
    expect(result).toMatchObject({ status: 'ok', results: [] });
    expect(result.metadata.coverage).toBeUndefined();
  });

  it('all failed or skipped is FANOUT_ALL_FAILED, non-terminal, with each outcome kept', async () => {
    const skippedAttempts = [{ backend: 'exa', outcome: 'skipped', failure: { kind: 'quota_exhausted' }, skipReason: 'disabled' }];
    const result = await createFanoutSearch({ providers: [failP('brave', 'blocked'), failP('exa', 'quota_exhausted', skippedAttempts)], mode: 'on' })({ query: 'q' });
    expect(result.error?.code).toBe('FANOUT_ALL_FAILED');
    expect(['config_global', 'guard_refused']).not.toContain(result.error?.failure?.kind);
    expect(result.metadata.fanout?.outcomes).toEqual([
      { provider: 'brave', outcome: 'failed', failure: { kind: 'blocked' } },
      { provider: 'exa', outcome: 'skipped', failure: { kind: 'quota_exhausted' }, skipReason: 'disabled' }
    ]);
  });

  it('reports bad_request for an all-failed fanout regardless of provider order', async () => {
    for (const providers of [
      [failP('duckduckgo', 'bad_request'), failP('tavily', 'transient')],
      [failP('tavily', 'transient'), failP('duckduckgo', 'bad_request')]
    ]) {
      const result = await createFanoutSearch({ providers, mode: 'on' })({ query: 'q' });
      expect(result.error).toMatchObject({ code: 'FANOUT_ALL_FAILED', failure: { kind: 'bad_request' } });
    }
  });

  it('a provider timeout is a transient failure outcome', async () => {
    const slow = { name: 'exa' as const, search: () => new Promise<any>(() => undefined) };
    const result = await createFanoutSearch({ providers: [okP('brave'), slow], mode: 'on', timeoutMs: 20 })({ query: 'q' });
    expect(result.metadata.fanout?.outcomes?.[1]).toEqual({ provider: 'exa', outcome: 'failed', failure: { kind: 'transient' } });
  });

  it('auto mode stops on a terminal primary without fanning out', async () => {
    const other = vi.fn(async () => okP('exa').search());
    const result = await createFanoutSearch({ providers: [failP('brave', 'config_global'), { name: 'exa', search: other }], mode: 'auto' })({ query: 'q' });
    expect(other).not.toHaveBeenCalled();
    expect(result.error?.failure?.kind).toBe('config_global');
  });
});
