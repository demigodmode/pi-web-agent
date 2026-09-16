import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackendSet } from '../../src/backends/factory.js';
import { DEFAULT_BACKEND_CONFIG } from '../../src/backends/config.js';
import { createNetworkGuard } from '../../src/fetch/network-guard.js';
import { createResearchWorkflow } from '../../src/orchestration/index.js';
import { createWebExploreTool } from '../../src/tools/web-explore.js';
import type { SearchProviderName } from '../../src/types.js';

/**
 * Keeps factory tests offline now that model-chosen fetches go through the
 * network guard (#53): no real DNS, no real guard proxy, and the model fetch defers to whatever
 * global fetch the test stubbed.
 */
function offlineNetworkDeps() {
  return {
    networkGuard: createNetworkGuard({}, { lookup: async () => [{ address: '93.184.216.34', family: 4 }] }),
    createModelFetch: () =>
      ((input: Parameters<typeof fetch>[0], init?: RequestInit) => globalThis.fetch(input, init)) as typeof fetch,
    createGuardProxy: vi.fn(async () => {
      throw new Error('tests must not start a real guard proxy');
    }),
    policy: { sleep: async () => undefined, random: () => 0 }
  };
}

describe('backend factory', () => {
  beforeEach(() => {
    delete process.env.PI_WEB_AGENT_DISABLE_KEYLESS_FALLBACK;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('creates the existing search/fetch/headless tools by default', () => {
    const backends = createBackendSet(DEFAULT_BACKEND_CONFIG, offlineNetworkDeps());

    expect(backends.search).toEqual(expect.any(Function));
    expect(backends.fetchPage).toEqual(expect.any(Function));
    expect(backends.headlessFetch).toEqual(expect.any(Function));
  });

  it('creates self-hosted search and fetch backends', () => {
    const backends = createBackendSet(
      {
        search: { provider: 'searxng', baseUrl: 'http://localhost:8080' },
        fetch: { provider: 'firecrawl', baseUrl: 'http://localhost:3002' },
        headless: { provider: 'local-browser' }
      },
      offlineNetworkDeps()
    );

    expect(backends.search).toEqual(expect.any(Function));
    expect(backends.fetchPage).toEqual(expect.any(Function));
  });

  it('returns clear backend config errors instead of silently falling back', async () => {
    const backends = createBackendSet(
      {
        search: { provider: 'searxng' },
        fetch: { provider: 'firecrawl' },
        headless: { provider: 'local-browser' }
      },
      offlineNetworkDeps()
    );

    // #55: a plain chain where every provider failed reports SEARCH_BACKENDS_UNAVAILABLE,
    // with the missing base URL classified as not_configured (no silent DuckDuckGo fallback).
    await expect(backends.search({ query: 'docs' })).resolves.toMatchObject({
      status: 'error',
      metadata: { backend: 'searxng', cacheHit: false },
      error: { code: 'SEARCH_BACKENDS_UNAVAILABLE', failure: { kind: 'not_configured' } }
    });

    await expect(backends.fetchPage({ url: 'https://example.com' })).resolves.toMatchObject({
      status: 'error',
      metadata: { method: 'firecrawl', cacheHit: false },
      error: { code: 'BACKEND_CONFIG_INVALID' }
    });
  });

  it('falls back from SearXNG to DuckDuckGo when configured', async () => {
    const searxng = async () => ({
      status: 'error' as const,
      results: [],
      metadata: { backend: 'searxng' as const, cacheHit: false },
      error: { code: 'FETCH_FAILED', message: 'SearXNG down' }
    });
    const duckduckgo = async () => ({
      status: 'ok' as const,
      results: [{ title: 'Fallback result', url: 'https://example.com', snippet: 'ok' }],
      metadata: { backend: 'duckduckgo' as const, cacheHit: false }
    });

    const backends = createBackendSet(
      { search: { provider: 'searxng', baseUrl: 'http://localhost:8080', fallback: 'duckduckgo' }, fetch: { provider: 'http' }, headless: { provider: 'local-browser' } },
      { ...offlineNetworkDeps(), createSearxngSearch: () => searxng, createDuckDuckGoSearch: () => duckduckgo }
    );

    await expect(backends.search({ query: 'docs' })).resolves.toMatchObject({
      status: 'ok',
      metadata: {
        backend: 'duckduckgo',
        fallbackFrom: 'searxng',
        fallbackReason: 'SearXNG down'
      }
    });
  });

  it('does not fall back from SearXNG when fallback is absent', async () => {
    const searxng = async () => ({
      status: 'error' as const,
      results: [],
      metadata: { backend: 'searxng' as const, cacheHit: false },
      error: { code: 'FETCH_FAILED', message: 'SearXNG down' }
    });

    const backends = createBackendSet(
      { search: { provider: 'searxng', baseUrl: 'http://localhost:8080' }, fetch: { provider: 'http' }, headless: { provider: 'local-browser' } },
      { ...offlineNetworkDeps(), createSearxngSearch: () => searxng }
    );

    await expect(backends.search({ query: 'docs' })).resolves.toMatchObject({
      status: 'error',
      metadata: { backend: 'searxng' }
    });
  });

  it('creates brave search with the environment API key', () => {
    const original = process.env.PI_WEB_AGENT_BRAVE_API_KEY;
    process.env.PI_WEB_AGENT_BRAVE_API_KEY = 'brave-key';
    const createBraveSearch = vi.fn().mockReturnValue(vi.fn());

    try {
      createBackendSet(
        { ...DEFAULT_BACKEND_CONFIG, search: { provider: 'brave' } },
        { ...offlineNetworkDeps(), createBraveSearch }
      );

      expect(createBraveSearch).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'brave-key' }));
    } finally {
      if (original === undefined) delete process.env.PI_WEB_AGENT_BRAVE_API_KEY;
      else process.env.PI_WEB_AGENT_BRAVE_API_KEY = original;
    }
  });

  it('records brave as the search fallback source', async () => {
    const primary = vi.fn().mockResolvedValue({
      status: 'error',
      results: [],
      metadata: { backend: 'brave', cacheHit: false },
      error: { code: 'FETCH_FAILED', message: 'Brave failed' }
    });
    const fallback = vi.fn().mockResolvedValue({
      status: 'ok',
      results: [{ title: 'Fallback', url: 'https://example.com', snippet: 'ok' }],
      metadata: { backend: 'duckduckgo', cacheHit: false }
    });

    const backends = createBackendSet(
      { ...DEFAULT_BACKEND_CONFIG, search: { provider: 'brave', fallback: 'duckduckgo' } },
      {
        ...offlineNetworkDeps(),
        createBraveSearch: vi.fn().mockReturnValue(primary),
        createDuckDuckGoSearch: vi.fn().mockReturnValue(fallback)
      }
    );

    const result = await backends.search({ query: 'test' });

    expect(result.status).toBe('ok');
    expect(result.metadata.fallbackFrom).toBe('brave');
    expect(result.metadata.fallbackReason).toBe('Brave failed');
  });

  it('creates youcom search with the environment API key', () => {
    const original = process.env.YDC_API_KEY;
    process.env.YDC_API_KEY = 'ydc-key';
    const createYouComSearch = vi.fn().mockReturnValue(vi.fn());

    try {
      createBackendSet(
        { ...DEFAULT_BACKEND_CONFIG, search: { provider: 'youcom' } },
        { ...offlineNetworkDeps(), createYouComSearch }
      );

      expect(createYouComSearch).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'ydc-key' }));
    } finally {
      if (original === undefined) delete process.env.YDC_API_KEY;
      else process.env.YDC_API_KEY = original;
    }
  });

  it('records youcom as the search fallback source', async () => {
    const primary = vi.fn().mockResolvedValue({
      status: 'error',
      results: [],
      metadata: { backend: 'youcom', cacheHit: false },
      error: { code: 'FETCH_FAILED', message: 'You.com failed' }
    });
    const fallback = vi.fn().mockResolvedValue({
      status: 'ok',
      results: [{ title: 'Fallback', url: 'https://example.com', snippet: 'ok' }],
      metadata: { backend: 'duckduckgo', cacheHit: false }
    });

    const backends = createBackendSet(
      { ...DEFAULT_BACKEND_CONFIG, search: { provider: 'youcom', fallback: 'duckduckgo' } },
      {
        ...offlineNetworkDeps(),
        createYouComSearch: vi.fn().mockReturnValue(primary),
        createDuckDuckGoSearch: vi.fn().mockReturnValue(fallback)
      }
    );

    const result = await backends.search({ query: 'test' });

    expect(result.status).toBe('ok');
    expect(result.metadata.fallbackFrom).toBe('youcom');
    expect(result.metadata.fallbackReason).toBe('You.com failed');
  });

  it('falls back from Firecrawl weak extraction to HTTP when configured', async () => {
    const firecrawl = async () => ({
      status: 'needs_headless' as const,
      url: 'https://example.com',
      metadata: { method: 'firecrawl' as const, cacheHit: false },
      error: { code: 'WEAK_EXTRACTION', message: 'weak' }
    });
    const httpFetch = async ({ url }: { url: string }) => ({
      status: 'ok' as const,
      url,
      content: { text: 'HTTP content' },
      metadata: { method: 'http' as const, cacheHit: false }
    });
    const createHttpFetch = (options?: { fetchPage?: (url: string) => Promise<any> }) => async ({ url }: { url: string }) => {
      if (options?.fetchPage) return options.fetchPage(url);
      return httpFetch({ url });
    };

    const backends = createBackendSet(
      { search: { provider: 'duckduckgo' }, fetch: { provider: 'firecrawl', baseUrl: 'http://localhost:3002', fallback: 'http' }, headless: { provider: 'local-browser' } },
      { ...offlineNetworkDeps(), createFirecrawlFetch: () => firecrawl, createHttpFetch: createHttpFetch as never }
    );

    await expect(backends.fetchPage({ url: 'https://example.com' })).resolves.toMatchObject({
      status: 'ok',
      metadata: { method: 'http', fallbackFrom: 'firecrawl', fallbackReason: 'weak' }
    });
  });

  it('creates exa search with the environment API key', () => {
    const original = process.env.EXA_API_KEY;
    process.env.EXA_API_KEY = 'exa-key';
    const createExaSearch = vi.fn().mockReturnValue(vi.fn());

    try {
      createBackendSet(
        { ...DEFAULT_BACKEND_CONFIG, search: { provider: 'exa' } },
        { ...offlineNetworkDeps(), createExaSearch }
      );

      expect(createExaSearch).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'exa-key' }));
    } finally {
      if (original === undefined) delete process.env.EXA_API_KEY;
      else process.env.EXA_API_KEY = original;
    }
  });

  it('records exa as the search fallback source', async () => {
    const primary = vi.fn().mockResolvedValue({
      status: 'error',
      results: [],
      metadata: { backend: 'exa', cacheHit: false },
      error: { code: 'FETCH_FAILED', message: 'Exa failed' }
    });
    const fallback = vi.fn().mockResolvedValue({
      status: 'ok',
      results: [{ title: 'Fallback', url: 'https://example.com', snippet: 'ok' }],
      metadata: { backend: 'duckduckgo', cacheHit: false }
    });

    const backends = createBackendSet(
      { ...DEFAULT_BACKEND_CONFIG, search: { provider: 'exa', fallback: 'duckduckgo' } },
      {
        ...offlineNetworkDeps(),
        createExaSearch: vi.fn().mockReturnValue(primary),
        createDuckDuckGoSearch: vi.fn().mockReturnValue(fallback)
      }
    );

    const result = await backends.search({ query: 'test' });

    expect(result.status).toBe('ok');
    expect(result.metadata.fallbackFrom).toBe('exa');
    expect(result.metadata.fallbackReason).toBe('Exa failed');
  });

  it('creates tavily search with the environment API key', () => {
    const original = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = 'tavily-key';
    const createTavilySearch = vi.fn().mockReturnValue(vi.fn());

    try {
      createBackendSet(
        { ...DEFAULT_BACKEND_CONFIG, search: { provider: 'tavily' } },
        { ...offlineNetworkDeps(), createTavilySearch }
      );

      expect(createTavilySearch).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'tavily-key' }));
    } finally {
      if (original === undefined) delete process.env.TAVILY_API_KEY;
      else process.env.TAVILY_API_KEY = original;
    }
  });

  it('records tavily as the search fallback source', async () => {
    const primary = vi.fn().mockResolvedValue({
      status: 'error',
      results: [],
      metadata: { backend: 'tavily', cacheHit: false },
      error: { code: 'FETCH_FAILED', message: 'Tavily failed' }
    });
    const fallback = vi.fn().mockResolvedValue({
      status: 'ok',
      results: [{ title: 'Fallback', url: 'https://example.com', snippet: 'ok' }],
      metadata: { backend: 'duckduckgo', cacheHit: false }
    });

    const backends = createBackendSet(
      { ...DEFAULT_BACKEND_CONFIG, search: { provider: 'tavily', fallback: 'duckduckgo' } },
      {
        ...offlineNetworkDeps(),
        createTavilySearch: vi.fn().mockReturnValue(primary),
        createDuckDuckGoSearch: vi.fn().mockReturnValue(fallback)
      }
    );

    const result = await backends.search({ query: 'test' });

    expect(result.status).toBe('ok');
    expect(result.metadata.fallbackFrom).toBe('tavily');
    expect(result.metadata.fallbackReason).toBe('Tavily failed');
  });

  it('falls back to keyless Tavily when the DuckDuckGo default errors', async () => {
    const failingDdg = vi.fn().mockResolvedValue({
      status: 'error',
      results: [],
      metadata: { backend: 'duckduckgo', cacheHit: false },
      error: { code: 'BLOCKED', message: 'blocked' }
    });
    const tavilyOk = vi.fn().mockResolvedValue({
      status: 'ok',
      results: [{ title: 'T', url: 'https://example.com', snippet: '' }],
      metadata: { backend: 'tavily', cacheHit: false }
    });

    const createTavilySearch = vi.fn().mockReturnValue(tavilyOk);
    const backends = createBackendSet(
      { ...DEFAULT_BACKEND_CONFIG, search: { provider: 'duckduckgo' } },
      { ...offlineNetworkDeps(), createDuckDuckGoSearch: vi.fn().mockReturnValue(failingDdg), createTavilySearch }
    );

    const result = await backends.search({ query: 'anything' });

    expect(createTavilySearch).toHaveBeenCalledWith(expect.objectContaining({ keyless: true }));
    expect(result.status).toBe('ok');
    expect(result.metadata.fallbackFrom).toBe('duckduckgo');
  });

  it('never reaches keyless Tavily after a bad_request inside an all-failed fanout (#55)', async () => {
    const badRequestDdg = vi.fn().mockResolvedValue({
      status: 'error',
      results: [],
      metadata: { backend: 'duckduckgo', cacheHit: false },
      error: { code: 'INVALID_QUERY', message: 'bad', failure: { kind: 'bad_request' } }
    });
    const transientTavily = vi.fn().mockResolvedValue({
      status: 'error',
      results: [],
      metadata: { backend: 'tavily', cacheHit: false },
      error: { code: 'FETCH_FAILED', message: 'down', failure: { kind: 'transient' } }
    });
    const keylessTavily = vi.fn();
    const createTavilySearch = vi.fn((options: { keyless?: boolean }) => (options.keyless ? keylessTavily : transientTavily));

    const backends = createBackendSet(
      { ...DEFAULT_BACKEND_CONFIG, search: { provider: 'duckduckgo', fanout: { mode: 'on', providers: ['duckduckgo', 'tavily'] } } },
      { ...offlineNetworkDeps(), createDuckDuckGoSearch: vi.fn().mockReturnValue(badRequestDdg), createTavilySearch: createTavilySearch as any }
    );

    const result = await backends.search({ query: 'anything' });

    expect(keylessTavily).not.toHaveBeenCalled();
    expect(result.error?.failure?.kind).toBe('bad_request');
  });

  it('does not fall back to keyless Tavily when the opt-out env var is set', async () => {
    const original = process.env.PI_WEB_AGENT_DISABLE_KEYLESS_FALLBACK;
    process.env.PI_WEB_AGENT_DISABLE_KEYLESS_FALLBACK = '1';

    try {
      const failingDdg = vi.fn().mockResolvedValue({
        status: 'error',
        results: [],
        metadata: { backend: 'duckduckgo', cacheHit: false },
        error: { code: 'BLOCKED', message: 'blocked' }
      });
      const createTavilySearch = vi.fn().mockReturnValue(vi.fn());

      const backends = createBackendSet(
        { ...DEFAULT_BACKEND_CONFIG, search: { provider: 'duckduckgo' } },
        { ...offlineNetworkDeps(), createDuckDuckGoSearch: vi.fn().mockReturnValue(failingDdg), createTavilySearch }
      );

      const result = await backends.search({ query: 'anything' });

      expect(createTavilySearch).not.toHaveBeenCalledWith({ keyless: true });
      expect(result.status).toBe('error');
      expect(result.metadata.backend).toBe('duckduckgo');
      expect(result.metadata.fallbackFrom).toBeUndefined();
    } finally {
      if (original === undefined) delete process.env.PI_WEB_AGENT_DISABLE_KEYLESS_FALLBACK;
      else process.env.PI_WEB_AGENT_DISABLE_KEYLESS_FALLBACK = original;
    }
  });

  it('routes github urls through the github reader, not http', async () => {
    // Stub global fetch so the github reader resolves offline. A 404 makes the reader
    // return a caveated response whose method is still 'github' — proving the resolver wired it.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
      json: async () => ({}),
      headers: new Headers()
    }));

    const backends = createBackendSet(DEFAULT_BACKEND_CONFIG, offlineNetworkDeps());
    const res = await backends.fetchPage({ url: 'https://github.com/owner/repo/blob/main/does-not-exist-xyz.ts' });
    expect(res.metadata.method).toBe('github');
  });

  it('builds a fanout search when mode is on (offline, injected providers)', async () => {
    const duck = async () => ({
      status: 'ok' as const,
      results: [{ title: 't', url: 'https://a.com/x', snippet: 's' }],
      metadata: { backend: 'duckduckgo' as const, cacheHit: false }
    });
    const backends = createBackendSet(
      { search: { provider: 'duckduckgo', fanout: { mode: 'on', providers: ['duckduckgo'] } }, fetch: { provider: 'http' }, headless: { provider: 'local-browser' } },
      { ...offlineNetworkDeps(), createDuckDuckGoSearch: () => duck }
    );
    const res = await backends.search({ query: 'q' });
    expect(res.status).toBe('ok');
    expect(res.metadata.fanout?.mode).toBe('on');
  });

  it('still falls back to keyless Tavily when a duckduckgo-default fanout comes up empty', async () => {
    const failingDuck = async () => ({
      status: 'error' as const,
      results: [],
      metadata: { backend: 'duckduckgo' as const, cacheHit: false },
      error: { code: 'BLOCKED', message: 'blocked' }
    });
    const tavilyOk = vi.fn().mockResolvedValue({
      status: 'ok',
      results: [{ title: 'T', url: 'https://example.com', snippet: '' }],
      metadata: { backend: 'tavily', cacheHit: false }
    });
    const createTavilySearch = vi.fn().mockReturnValue(tavilyOk);

    const backends = createBackendSet(
      { search: { provider: 'duckduckgo', fanout: { mode: 'on', providers: ['duckduckgo'] } }, fetch: { provider: 'http' }, headless: { provider: 'local-browser' } },
      { ...offlineNetworkDeps(), createDuckDuckGoSearch: () => failingDuck, createTavilySearch }
    );

    const res = await backends.search({ query: 'q' });

    expect(createTavilySearch).toHaveBeenCalledWith(expect.objectContaining({ keyless: true }));
    expect(res.status).toBe('ok');
    expect(res.metadata.fallbackFrom).toBe('duckduckgo');
  });

  it('preserves fanout metadata when falling back from duckduckgo-default fanout to keyless Tavily', async () => {
    const failingDuck = async () => ({
      status: 'error' as const,
      results: [],
      metadata: {
        backend: 'duckduckgo' as const,
        cacheHit: false,
        fanout: { mode: 'on' as const, providers: [] }
      },
      error: { code: 'FANOUT_NO_RESULTS', message: 'no fanout results' }
    });
    const tavilyOk = vi.fn().mockResolvedValue({
      status: 'ok',
      results: [{ title: 'Fallback', url: 'https://example.com', snippet: 'ok' }],
      metadata: { backend: 'tavily', cacheHit: false }
    });
    const createTavilySearch = vi.fn().mockReturnValue(tavilyOk);

    const backends = createBackendSet(
      { search: { provider: 'duckduckgo', fanout: { mode: 'on', providers: ['duckduckgo'] } }, fetch: { provider: 'http' }, headless: { provider: 'local-browser' } },
      { ...offlineNetworkDeps(), createDuckDuckGoSearch: () => failingDuck, createTavilySearch }
    );

    const res = await backends.search({ query: 'q' });

    expect(res.status).toBe('ok');
    expect(res.metadata.fallbackFrom).toBe('duckduckgo');
    expect(res.metadata.fanout?.mode).toBe('on');
  });

  it('keeps duckduckgo in the fanout set when it is the configured fallback', async () => {
    const duck = vi.fn(async () => ({ status: 'ok' as const, results: [{ title: 'd', url: 'https://d.com/1', snippet: 's' }], metadata: { backend: 'duckduckgo' as const, cacheHit: false } }));
    const brave = async () => ({ status: 'ok' as const, results: [{ title: 'b', url: 'https://b.com/1', snippet: 's' }], metadata: { backend: 'brave' as const, cacheHit: false } });
    const backends = createBackendSet(
      { search: { provider: 'brave', fallback: 'duckduckgo', fanout: { mode: 'on', providers: ['brave'] } }, fetch: { provider: 'http' }, headless: { provider: 'local-browser' } },
      { ...offlineNetworkDeps(), createDuckDuckGoSearch: () => duck, createBraveSearch: () => brave }
    );
    await backends.search({ query: 'q' });
    expect(duck).toHaveBeenCalled();
  });

  it('defaults fanout to only usable providers (duckduckgo only when no keys/baseUrl)', async () => {
    const duckMock = vi.fn(async () => ({
      status: 'ok' as const,
      results: [{ title: 'duck result', url: 'https://duck.com/1', snippet: 's' }],
      metadata: { backend: 'duckduckgo' as const, cacheHit: false }
    }));
    const braveMock = vi.fn().mockRejectedValue(new Error('should not be called'));

    const backends = createBackendSet(
      {
        search: {
          provider: 'duckduckgo',
          fanout: { mode: 'on' } // providers: undefined, should default to usable only
        },
        fetch: { provider: 'http' },
        headless: { provider: 'local-browser' }
      },
      {
        ...offlineNetworkDeps(),
        createDuckDuckGoSearch: () => duckMock,
        createBraveSearch: () => braveMock
      }
    );

    const result = await backends.search({ query: 'test' });

    expect(result.status).toBe('ok');
    expect(result.metadata.fanout?.mode).toBe('on');
    // Only duckduckgo should have been called
    expect(duckMock).toHaveBeenCalled();
    expect(braveMock).not.toHaveBeenCalled();
  });

  it('defaults fanout to include searxng when baseUrl is configured', async () => {
    const duckMock = vi.fn(async () => ({
      status: 'ok' as const,
      results: [{ title: 'duck', url: 'https://d.com/1', snippet: 's' }],
      metadata: { backend: 'duckduckgo' as const, cacheHit: false }
    }));
    const searxngMock = vi.fn(async () => ({
      status: 'ok' as const,
      results: [{ title: 'sxng', url: 'https://s.com/1', snippet: 's' }],
      metadata: { backend: 'searxng' as const, cacheHit: false }
    }));

    const backends = createBackendSet(
      {
        search: {
          provider: 'duckduckgo',
          baseUrl: 'http://localhost:8080',
          fanout: { mode: 'on' }
        },
        fetch: { provider: 'http' },
        headless: { provider: 'local-browser' }
      },
      {
        ...offlineNetworkDeps(),
        createDuckDuckGoSearch: () => duckMock,
        createSearxngSearch: () => searxngMock
      }
    );

    const result = await backends.search({ query: 'test' });

    expect(result.status).toBe('ok');
    expect(result.metadata.fanout?.mode).toBe('on');
    expect(duckMock).toHaveBeenCalled();
    expect(searxngMock).toHaveBeenCalled();
  });
});

describe('backend factory proxy support', () => {
  it('routes search through the configured proxy fetch and model-chosen pages through the model fetch', async () => {
    const proxiedUrls: string[] = [];
    const proxyFetchMock = vi.fn((input: string | URL | Request) => {
      proxiedUrls.push(String(input));
      return Promise.resolve(
        new Response(
          '<html><head><title>Proxied</title></head><body><article>' +
            '<h1>Proxied page</h1>' +
            '<p>This proxied page carries enough readable content for the http fetcher to extract it cleanly.</p>' +
            '</article></body></html>',
          { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }
        )
      );
    });
    const searchUrls: string[] = [];
    const searchFetchMock = vi.fn(async (input: string | URL | Request) => {
      searchUrls.push(String(input));
      return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    });

    const createProxyFetch = vi.fn(() => searchFetchMock as typeof fetch);

    let capturedSearchHtml: ((query: string) => Promise<string>) | undefined;

    const backends = createBackendSet(
      {
        search: { provider: 'duckduckgo' },
        fetch: { provider: 'http' },
        headless: { provider: 'local-browser' },
        proxy: { url: 'http://127.0.0.1:7890', username: 'user', password: 'secret' }
      },
      {
        ...offlineNetworkDeps(),
        // Model-chosen urls go through the guard proxy, which chains to the upstream itself.
        createModelFetch: () => proxyFetchMock as typeof fetch,
        createProxyFetch,
        createDuckDuckGoSearch: (options) => {
          capturedSearchHtml = options?.searchHtml;
          return vi.fn();
        }
      }
    );

    expect(createProxyFetch).toHaveBeenCalledWith({ url: 'http://127.0.0.1:7890', username: 'user', password: 'secret' });

    const page = await backends.fetchPage({ url: 'https://example.com/page' });
    expect(page.status).toBe('ok');
    expect(proxiedUrls).toContain('https://example.com/page');
    expect(searchUrls).not.toContain('https://example.com/page');

    expect(capturedSearchHtml).toEqual(expect.any(Function));
    await capturedSearchHtml!('docs');
    expect(searchUrls).toContain('https://html.duckduckgo.com/html/?q=docs');
    expect(proxiedUrls).not.toContain('https://html.duckduckgo.com/html/?q=docs');
  });

  it('does not build a proxy fetch when no proxy is configured', () => {
    const createProxyFetch = vi.fn();

    createBackendSet(DEFAULT_BACKEND_CONFIG, { ...offlineNetworkDeps(), createProxyFetch });

    expect(createProxyFetch).not.toHaveBeenCalled();
  });

  it('routes YouTube reader traffic through the model fetch, not the direct proxy fetch', async () => {
    const proxiedUrls: string[] = [];
    const INNERTUBE = 'https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false';
    const proxyFetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      proxiedUrls.push(url);
      if (url === INNERTUBE) {
        return new Response(
          JSON.stringify({
            playabilityStatus: { status: 'OK' },
            videoDetails: { title: 'My Talk', shortDescription: 'desc' },
            captions: {
              playerCaptionsTracklistRenderer: {
                captionTracks: [
                  { baseUrl: 'https://www.youtube.com/api/timedtext?v=abc123&lang=en', vssId: '.en', languageCode: 'en' }
                ]
              }
            }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      // Caption track (json3).
      return new Response(
        JSON.stringify({
          events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'hello ' }, { utf8: 'world' }] }]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });
    const directProxyFetch = vi.fn();
    const createProxyFetch = vi.fn(() => directProxyFetch as unknown as typeof fetch);

    const backends = createBackendSet(
      {
        search: { provider: 'duckduckgo' },
        fetch: { provider: 'http' },
        headless: { provider: 'local-browser' },
        proxy: { url: 'http://127.0.0.1:7890', username: 'user', password: 'secret' }
      },
      { ...offlineNetworkDeps(), createProxyFetch, createModelFetch: () => proxyFetchMock as typeof fetch }
    );

    const page = await backends.fetchPage({ url: 'https://youtu.be/abc123' });
    expect(page.status).toBe('ok');
    expect(page.metadata.method).toBe('youtube');
    expect(page.content?.title).toBe('My Talk');
    expect(page.content?.text).toContain('hello world');

    // Both the InnerTube player call and the caption track call went through the model fetch (guard proxy).
    expect(directProxyFetch).not.toHaveBeenCalled();
    expect(proxiedUrls).toContain(INNERTUBE);
    expect(proxiedUrls.some((u) => u.startsWith('https://www.youtube.com/api/timedtext'))).toBe(true);
  });

  it('blocks all web requests with a config error when the proxy url is invalid', async () => {
    const createProxyFetch = vi.fn();
    const directFetch = vi.fn(async () => new Response('direct', { status: 200 }));
    vi.stubGlobal('fetch', directFetch);

    const backends = createBackendSet(
      {
        search: { provider: 'duckduckgo' },
        fetch: { provider: 'http' },
        headless: { provider: 'local-browser' },
        proxy: { url: 'htttp://proxy:8080' }
      },
      { ...offlineNetworkDeps(), createProxyFetch }
    );

    const search = await backends.search({ query: 'docs' });
    expect(search.status).toBe('error');
    expect(search.error?.code).toBe('BACKEND_CONFIG_INVALID');
    expect(search.error?.message).toContain('htttp://proxy:8080');

    const page = await backends.fetchPage({ url: 'https://example.com/page' });
    expect(page.status).toBe('error');
    expect(page.error?.code).toBe('BACKEND_CONFIG_INVALID');

    const headless = await backends.headlessFetch({ url: 'https://example.com/page' });
    expect(headless.status).toBe('error');
    expect(headless.error?.code).toBe('BACKEND_CONFIG_INVALID');

    // Neither a proxy agent nor a direct fetch was ever built or used.
    expect(createProxyFetch).not.toHaveBeenCalled();
    expect(directFetch).not.toHaveBeenCalled();
  });

  it('treats a blank proxy url as no proxy (disable marker)', async () => {
    const createProxyFetch = vi.fn(() => vi.fn() as typeof fetch);
    const directFetch = vi.fn(async () =>
      new Response(
        '<html><head><title>Direct</title></head><body><article>' +
          '<h1>Direct page</h1>' +
          '<p>This direct page carries enough readable content for the http fetcher to extract it cleanly.</p>' +
          '</article></body></html>',
        { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }
      )
    );
    vi.stubGlobal('fetch', directFetch);

    const backends = createBackendSet(
      {
        search: { provider: 'duckduckgo' },
        fetch: { provider: 'http' },
        headless: { provider: 'local-browser' },
        proxy: { url: '' }
      },
      { ...offlineNetworkDeps(), createProxyFetch }
    );

    expect(createProxyFetch).not.toHaveBeenCalled();
    const page = await backends.fetchPage({ url: 'https://example.com/page' });
    expect(page.status).toBe('ok');
    expect(directFetch).toHaveBeenCalled();
  });
});

describe('backend factory private address guard', () => {
  it('blocks a private page url before any fetch happens', async () => {
    const directFetch = vi.fn();
    vi.stubGlobal('fetch', directFetch);

    const backends = createBackendSet(DEFAULT_BACKEND_CONFIG, offlineNetworkDeps());
    const result = await backends.fetchPage({ url: 'http://169.254.169.254/latest/meta-data/' });

    expect(result).toMatchObject({ status: 'error', error: { code: 'BLOCKED_PRIVATE_ADDRESS' } });
    expect(result.presentation).toBeDefined();
    expect(directFetch).not.toHaveBeenCalled();
  });

  it('never hands a private url to Firecrawl or its http fallback', async () => {
    const firecrawlFetch = vi.fn();
    const backends = createBackendSet(
      {
        ...DEFAULT_BACKEND_CONFIG,
        fetch: { provider: 'firecrawl', baseUrl: 'http://127.0.0.1:3002', fallback: 'http' }
      },
      { ...offlineNetworkDeps(), createFirecrawlFetch: vi.fn(() => firecrawlFetch) }
    );

    const result = await backends.fetchPage({ url: 'http://10.0.0.8/admin' });

    expect(result.error?.code).toBe('BLOCKED_PRIVATE_ADDRESS');
    expect(result.metadata.method).toBe('firecrawl');
    expect(firecrawlFetch).not.toHaveBeenCalled();
  });

  it('still reaches a SearXNG instance configured on localhost', async () => {
    const searxngFetch = vi.fn(async (_input: Parameters<typeof fetch>[0]) =>
      new Response(JSON.stringify({ results: [{ title: 'Docs', url: 'https://example.com/docs', content: 'hi' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', searxngFetch);

    const backends = createBackendSet(
      { ...DEFAULT_BACKEND_CONFIG, search: { provider: 'searxng', baseUrl: 'http://127.0.0.1:8080' } },
      offlineNetworkDeps()
    );
    const result = await backends.search({ query: 'docs' });

    expect(result.status).toBe('ok');
    expect(String(searxngFetch.mock.calls[0][0])).toContain('127.0.0.1:8080');
  });

  it('builds the guard from the configured allow list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('<html><body><article><p>' + 'Internal docs page with enough readable text. '.repeat(5) + '</p></article></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' }
        })
      )
    );

    const backends = createBackendSet(
      { ...DEFAULT_BACKEND_CONFIG, network: { allowRanges: ['10.0.0.0/8'] } },
      { createModelFetch: offlineNetworkDeps().createModelFetch }
    );
    const result = await backends.fetchPage({ url: 'http://10.0.0.8/docs' });

    expect(result.error?.code).not.toBe('BLOCKED_PRIVATE_ADDRESS');
  });
});

describe('backend factory guard proxy wiring', () => {
  it('does not start the guard proxy until a model-chosen connection needs it', () => {
    const deps = offlineNetworkDeps();
    createBackendSet(DEFAULT_BACKEND_CONFIG, deps);
    expect(deps.createGuardProxy).not.toHaveBeenCalled();
  });

  it('starts one guard proxy, once, with the upstream proxy and trust setting', async () => {
    const proxy = {
      url: 'http://127.0.0.1:9',
      client: vi.fn(() => ({ server: 'http://127.0.0.1:9', username: 'u', password: 'p' })),
      sequence: () => 0,
      refusalsSince: () => [],
      close: async () => undefined
    };
    const createGuardProxy = vi.fn(async () => proxy);

    const backends = createBackendSet(
      {
        ...DEFAULT_BACKEND_CONFIG,
        proxy: { url: 'http://upstream.example:3128', username: 'user', password: 'secret' },
        network: { trustProxyDns: true }
      },
      { networkGuard: offlineNetworkDeps().networkGuard, createGuardProxy }
    );

    // The fake proxy url refuses connections, so these fetches fail; only the proxy start matters here.
    // Headless use of the same proxy is covered by the headless and real-browser tests.
    await backends.fetchPage({ url: 'https://example.com/a' }).catch(() => undefined);
    await backends.fetchPage({ url: 'https://example.com/b' }).catch(() => undefined);

    expect(createGuardProxy).toHaveBeenCalledTimes(1);
    expect(createGuardProxy).toHaveBeenCalledWith(
      expect.objectContaining({
        upstream: { url: 'http://upstream.example:3128', username: 'user', password: 'secret' },
        trustProxyDns: true
      })
    );
  });

  it('does not hang page fetch on a DNS pre-check that never settles', async () => {
    const createGuardProxy = vi.fn(async () => {
      throw new Error('fake guard proxy: not started');
    });
    const backends = createBackendSet(DEFAULT_BACKEND_CONFIG, {
      networkGuard: createNetworkGuard({}, { lookup: () => new Promise(() => undefined), lookupTimeoutMs: 50 }),
      createGuardProxy
    });

    const outcome = await Promise.race([
      backends.fetchPage({ url: 'https://slow-dns.example/' }).then(
        () => 'settled',
        () => 'settled'
      ),
      new Promise((resolve) => setTimeout(() => resolve('still pending'), 2000))
    ]);

    expect(outcome).toBe('settled');
    expect(createGuardProxy).toHaveBeenCalled();
  });

  it('closing a set that never used the guard proxy does not start it', async () => {
    const deps = offlineNetworkDeps();
    const backends = createBackendSet(DEFAULT_BACKEND_CONFIG, deps);

    await backends.close();

    expect(deps.createGuardProxy).not.toHaveBeenCalled();
  });

  it('closes the guard proxy it started exactly once, even if it was still starting', async () => {
    const close = vi.fn(async () => undefined);
    const proxy = {
      url: 'http://127.0.0.1:9',
      client: () => ({ server: 'http://127.0.0.1:9', username: 'u', password: 'p' }),
      sequence: () => 0,
      refusalsSince: () => [],
      close
    };
    let finishStart!: (value: typeof proxy) => void;
    const createGuardProxy = vi.fn(() => new Promise<typeof proxy>((resolve) => (finishStart = resolve)));
    const backends = createBackendSet(DEFAULT_BACKEND_CONFIG, {
      networkGuard: offlineNetworkDeps().networkGuard,
      createGuardProxy
    });

    const pendingFetch = backends.fetchPage({ url: 'https://example.com/' }).catch(() => undefined);
    await vi.waitFor(() => expect(createGuardProxy).toHaveBeenCalledTimes(1));
    const closing = backends.close();
    finishStart(proxy);
    await closing;
    await backends.close();
    await pendingFetch;

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('retries starting the guard proxy after a failed attempt instead of caching the rejection', async () => {
    const proxy = {
      url: 'http://127.0.0.1:9',
      client: vi.fn(() => ({ server: 'http://127.0.0.1:9', username: 'u', password: 'p' })),
      sequence: () => 0,
      refusalsSince: () => [],
      close: vi.fn(async () => undefined)
    };
    const createGuardProxy = vi
      .fn()
      .mockRejectedValueOnce(new Error('listen EADDRINUSE'))
      .mockResolvedValueOnce(proxy);

    const backends = createBackendSet(DEFAULT_BACKEND_CONFIG, {
      networkGuard: offlineNetworkDeps().networkGuard,
      createGuardProxy
    });

    await expect(backends.fetchPage({ url: 'https://example.com/a' })).rejects.toThrow('listen EADDRINUSE');
    expect(createGuardProxy).toHaveBeenCalledTimes(1);

    await backends.fetchPage({ url: 'https://example.com/b' }).catch(() => undefined);
    expect(createGuardProxy).toHaveBeenCalledTimes(2);

    await backends.close();
    expect(createGuardProxy).toHaveBeenCalledTimes(2);
  });

  it('refuses to start a guard proxy after close', async () => {
    const createGuardProxy = vi.fn();
    const backends = createBackendSet(DEFAULT_BACKEND_CONFIG, {
      networkGuard: offlineNetworkDeps().networkGuard,
      createGuardProxy
    });

    await backends.close();
    await backends.fetchPage({ url: 'https://example.com/' }).catch(() => undefined);

    expect(createGuardProxy).not.toHaveBeenCalled();
  });
});

describe('backend factory failure-aware fallback (#55)', () => {
  const ok = (backend: string) => async () => ({ status: 'ok' as const, results: [{ title: 't', url: 'https://r.test/', snippet: '' }], metadata: { backend, cacheHit: false } });
  const failing = (backend: string, kind: string) =>
    vi.fn(async () => ({ status: 'error' as const, results: [], metadata: { backend, cacheHit: false }, error: { code: 'X', message: `${backend} ${kind}`, failure: { kind } } }));

  it('cools a rate-limited primary down across calls and uses the fallback meanwhile', async () => {
    const brave = failing('brave', 'rate_limited');
    const backends = createBackendSet(
      { ...DEFAULT_BACKEND_CONFIG, search: { provider: 'brave', fallback: 'duckduckgo' } },
      { ...offlineNetworkDeps(), createBraveSearch: () => brave as any, createDuckDuckGoSearch: () => ok('duckduckgo') as any }
    );

    await backends.search({ query: 'a' });
    const second = await backends.search({ query: 'b' });

    expect(brave).toHaveBeenCalledTimes(1);
    expect(second.status).toBe('ok');
    expect(second.metadata.attempts?.[0]).toMatchObject({ backend: 'brave', outcome: 'skipped', skipReason: 'cooling_down', failure: { kind: 'rate_limited' } });
  });

  it('a new backend set starts with fresh provider health', async () => {
    const make = () =>
      createBackendSet(
        { ...DEFAULT_BACKEND_CONFIG, search: { provider: 'brave', fallback: 'duckduckgo' } },
        { ...offlineNetworkDeps(), createBraveSearch: () => failing('brave', 'auth_failed') as any, createDuckDuckGoSearch: () => ok('duckduckgo') as any }
      );
    await make().search({ query: 'a' });
    const fresh = await make().search({ query: 'a' });
    expect(fresh.metadata.attempts?.[0]).toMatchObject({ backend: 'brave', outcome: 'failed' });
  });

  it('gives keyless Tavily its own health key', async () => {
    const tavilyCalls: string[] = [];
    const backends = createBackendSet(DEFAULT_BACKEND_CONFIG, {
      ...offlineNetworkDeps(),
      createDuckDuckGoSearch: () => failing('duckduckgo', 'blocked') as any,
      createTavilySearch: (options: any) => {
        tavilyCalls.push(options.keyless ? 'keyless' : 'keyed');
        return ok('tavily') as any;
      }
    });
    const result = await backends.search({ query: 'q' });
    expect(tavilyCalls).toEqual(['keyless']);
    expect(result.metadata.coverage?.partial).toBe(true);
  });

  it('never falls back or retries when the shared proxy config is invalid (config_global)', async () => {
    const backends = createBackendSet({ ...DEFAULT_BACKEND_CONFIG, proxy: { url: 'htttp://bad' } }, offlineNetworkDeps());
    const search = await backends.search({ query: 'q' });
    const page = await backends.fetchPage({ url: 'https://example.com/' });
    const headless = await backends.headlessFetch({ url: 'https://example.com/' });
    for (const result of [search, page, headless]) {
      expect(result.error?.failure?.kind).toBe('config_global');
    }
  });

  it('marks a missing SearXNG base URL and Firecrawl base URL as not_configured', async () => {
    const backends = createBackendSet(
      { ...DEFAULT_BACKEND_CONFIG, search: { provider: 'searxng' }, fetch: { provider: 'firecrawl' } },
      offlineNetworkDeps()
    );
    const search = await backends.search({ query: 'q' });
    expect(search.metadata.attempts?.[0]?.failure?.kind).toBe('not_configured');
  });

  it('never hands a guard-refused page to Firecrawl or the http fallback', async () => {
    const firecrawl = vi.fn();
    const httpPage = vi.fn();
    const backends = createBackendSet(
      { ...DEFAULT_BACKEND_CONFIG, fetch: { provider: 'firecrawl', baseUrl: 'http://127.0.0.1:3002', fallback: 'http' } },
      {
        ...offlineNetworkDeps(),
        createFirecrawlFetch: vi.fn(() => firecrawl) as any,
        createHttpFetch: vi.fn(() => httpPage) as any
      }
    );
    const result = await backends.fetchPage({ url: 'http://169.254.169.254/' });
    expect(result.error?.failure?.kind).toBe('guard_refused');
    expect(firecrawl).not.toHaveBeenCalled();
    expect(httpPage).not.toHaveBeenCalled();
  });
  it('retries a 200 whose body connection drops mid-read exactly once (Brave)', async () => {
    const original = process.env.PI_WEB_AGENT_BRAVE_API_KEY;
    process.env.PI_WEB_AGENT_BRAVE_API_KEY = 'brave-key';
    try {
      const fetchImpl = vi.fn(async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"type":"search","web":{"res'));
              controller.error(new Error('ECONNRESET'));
            }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
      vi.stubGlobal('fetch', fetchImpl);
      const backends = createBackendSet({ ...DEFAULT_BACKEND_CONFIG, search: { provider: 'brave' } }, offlineNetworkDeps());
      const result = await backends.search({ query: 'q' });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(result.metadata.attempts?.map((a) => a.outcome)).toEqual(['retried', 'failed']);
      expect(result.metadata.attempts?.[0]?.failure?.kind).toBe('transient');
    } finally {
      if (original === undefined) delete process.env.PI_WEB_AGENT_BRAVE_API_KEY;
      else process.env.PI_WEB_AGENT_BRAVE_API_KEY = original;
    }
  });

  it('retries a stalled fanout provider once through the policy', async () => {
    const stalled = vi.fn(() => new Promise<any>(() => undefined));
    const backends = createBackendSet(
      { ...DEFAULT_BACKEND_CONFIG, search: { provider: 'brave', fanout: { mode: 'on', providers: ['brave', 'exa'] } } },
      {
        ...offlineNetworkDeps(),
        fanoutTimeoutMs: 20,
        createBraveSearch: () => ok('brave') as any,
        createExaSearch: () => stalled as any
      }
    );
    const result = await backends.search({ query: 'q' });
    expect(stalled).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('ok');
    expect(result.results).toHaveLength(1);
    expect(result.metadata.fanout?.outcomes?.[1]).toMatchObject({ provider: 'exa', outcome: 'failed', failure: { kind: 'transient' } });
  });

  it('carries search attempts into web_explore metadata and the verbose view only', async () => {
    const brave = failing('brave', 'rate_limited');
    const backends = createBackendSet(
      { ...DEFAULT_BACKEND_CONFIG, search: { provider: 'brave', fallback: 'duckduckgo' } },
      { ...offlineNetworkDeps(), createBraveSearch: () => brave as any, createDuckDuckGoSearch: () => ok('duckduckgo') as any }
    );
    await backends.search({ query: 'warm up the cooldown' });

    const workflow = createResearchWorkflow({
      search: backends.search,
      fetchPage: async ({ url }) => ({
        status: 'ok',
        url,
        content: { title: 'Docs', text: 'Useful documentation text about the topic. '.repeat(20) },
        metadata: { method: 'http', cacheHit: false }
      }),
      headlessFetch: async ({ url }) => ({ status: 'error', url, metadata: { method: 'headless', cacheHit: false } })
    });
    const result = await createWebExploreTool({ explore: workflow })({ query: 'topic docs' });

    expect(result.metadata?.attempts).toEqual(
      expect.arrayContaining([expect.objectContaining({ backend: 'brave', outcome: 'skipped', skipReason: 'cooling_down' })])
    );
    expect(result.presentation.views.verbose).toContain('brave: skipped [cooling_down] (rate_limited)');
    expect(result.presentation.views.compact).not.toContain('cooling_down');
    expect(result.presentation.views.preview ?? '').not.toContain('cooling_down');
    const modelFacing = JSON.stringify({ findings: result.findings, sources: result.sources, caveat: result.caveat, error: result.error });
    expect(modelFacing).not.toContain('cooling_down');
    expect(modelFacing).not.toContain('skipped');
  });

  it('credits each failed fanout provider with its own kind when keyless Tavily answers', async () => {
    const backends = createBackendSet(
      { ...DEFAULT_BACKEND_CONFIG, search: { provider: 'duckduckgo', fanout: { mode: 'on', providers: ['duckduckgo', 'brave', 'exa'] } } },
      {
        ...offlineNetworkDeps(),
        createDuckDuckGoSearch: () => failing('duckduckgo', 'blocked') as any,
        createBraveSearch: () => failing('brave', 'rate_limited') as any,
        createExaSearch: () => failing('exa', 'auth_failed') as any,
        createTavilySearch: () => ok('tavily') as any
      }
    );
    const result = await backends.search({ query: 'q' });
    expect(result.status).toBe('ok');
    expect(result.metadata.backend).toBe('tavily');
    expect(result.metadata.coverage?.unavailable).toEqual(
      expect.arrayContaining([
        { provider: 'duckduckgo', kind: 'blocked' },
        { provider: 'brave', kind: 'rate_limited' },
        { provider: 'exa', kind: 'auth_failed' }
      ])
    );
    expect(result.metadata.coverage?.unavailable).toHaveLength(3);
  });

  it('keeps the SearXNG base URL hint on a later, skipped call', async () => {
    const backends = createBackendSet({ ...DEFAULT_BACKEND_CONFIG, search: { provider: 'searxng' } }, offlineNetworkDeps());
    const first = await backends.search({ query: 'a' });
    const second = await backends.search({ query: 'b' });
    expect(first.error?.message).toContain('requires backends.search.baseUrl');
    expect(second.metadata.attempts?.[0]).toMatchObject({ outcome: 'skipped', detail: 'SearXNG search requires backends.search.baseUrl.' });
    expect(second.error?.message).toContain('requires backends.search.baseUrl');
  });
});
