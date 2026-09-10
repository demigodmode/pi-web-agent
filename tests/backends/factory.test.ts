import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackendSet } from '../../src/backends/factory.js';
import { DEFAULT_BACKEND_CONFIG } from '../../src/backends/config.js';
import type { SearchProviderName } from '../../src/types.js';

describe('backend factory', () => {
  beforeEach(() => {
    delete process.env.PI_WEB_AGENT_DISABLE_KEYLESS_FALLBACK;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('creates the existing search/fetch/headless tools by default', () => {
    const backends = createBackendSet();

    expect(backends.search).toEqual(expect.any(Function));
    expect(backends.fetchPage).toEqual(expect.any(Function));
    expect(backends.headlessFetch).toEqual(expect.any(Function));
  });

  it('creates self-hosted search and fetch backends', () => {
    const backends = createBackendSet({
      search: { provider: 'searxng', baseUrl: 'http://localhost:8080' },
      fetch: { provider: 'firecrawl', baseUrl: 'http://localhost:3002' },
      headless: { provider: 'local-browser' }
    });

    expect(backends.search).toEqual(expect.any(Function));
    expect(backends.fetchPage).toEqual(expect.any(Function));
  });

  it('returns clear backend config errors instead of silently falling back', async () => {
    const backends = createBackendSet({
      search: { provider: 'searxng' },
      fetch: { provider: 'firecrawl' },
      headless: { provider: 'local-browser' }
    });

    await expect(backends.search({ query: 'docs' })).resolves.toMatchObject({
      status: 'error',
      metadata: { backend: 'searxng', cacheHit: false },
      error: { code: 'BACKEND_CONFIG_INVALID' }
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
      { createSearxngSearch: () => searxng, createDuckDuckGoSearch: () => duckduckgo }
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
      { createSearxngSearch: () => searxng }
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
        { createBraveSearch }
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
        { createYouComSearch }
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
      { createFirecrawlFetch: () => firecrawl, createHttpFetch: createHttpFetch as never }
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
        { createExaSearch }
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
        { createTavilySearch }
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
      { createDuckDuckGoSearch: vi.fn().mockReturnValue(failingDdg), createTavilySearch }
    );

    const result = await backends.search({ query: 'anything' });

    expect(createTavilySearch).toHaveBeenCalledWith(expect.objectContaining({ keyless: true }));
    expect(result.status).toBe('ok');
    expect(result.metadata.fallbackFrom).toBe('duckduckgo');
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
        { createDuckDuckGoSearch: vi.fn().mockReturnValue(failingDdg), createTavilySearch }
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

    const backends = createBackendSet();
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
      { createDuckDuckGoSearch: () => duck }
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
      { createDuckDuckGoSearch: () => failingDuck, createTavilySearch }
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
      { createDuckDuckGoSearch: () => failingDuck, createTavilySearch }
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
      { createDuckDuckGoSearch: () => duck, createBraveSearch: () => brave }
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
  it('routes search and fetch traffic through the configured proxy fetch', async () => {
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
    const createProxyFetch = vi.fn(() => proxyFetchMock as typeof fetch);

    let capturedSearchHtml: ((query: string) => Promise<string>) | undefined;

    const backends = createBackendSet(
      {
        search: { provider: 'duckduckgo' },
        fetch: { provider: 'http' },
        headless: { provider: 'local-browser' },
        proxy: { url: 'http://127.0.0.1:7890', username: 'user', password: 'secret' }
      },
      {
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

    expect(capturedSearchHtml).toEqual(expect.any(Function));
    await capturedSearchHtml!('docs');
    expect(proxiedUrls).toContain('https://html.duckduckgo.com/html/?q=docs');
  });

  it('does not build a proxy fetch when no proxy is configured', () => {
    const createProxyFetch = vi.fn();

    createBackendSet(DEFAULT_BACKEND_CONFIG, { createProxyFetch });

    expect(createProxyFetch).not.toHaveBeenCalled();
  });

  it('routes YouTube reader traffic through the configured proxy fetch', async () => {
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
    const createProxyFetch = vi.fn(() => proxyFetchMock as typeof fetch);

    const backends = createBackendSet(
      {
        search: { provider: 'duckduckgo' },
        fetch: { provider: 'http' },
        headless: { provider: 'local-browser' },
        proxy: { url: 'http://127.0.0.1:7890', username: 'user', password: 'secret' }
      },
      { createProxyFetch }
    );

    const page = await backends.fetchPage({ url: 'https://youtu.be/abc123' });
    expect(page.status).toBe('ok');
    expect(page.metadata.method).toBe('youtube');
    expect(page.content?.title).toBe('My Talk');
    expect(page.content?.text).toContain('hello world');

    // Both the InnerTube player call and the caption track call went through the proxy.
    expect(proxiedUrls).toContain(INNERTUBE);
    expect(proxiedUrls.some((u) => u.startsWith('https://www.youtube.com/api/timedtext'))).toBe(true);
  });
});
