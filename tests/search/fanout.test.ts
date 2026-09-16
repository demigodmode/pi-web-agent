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
