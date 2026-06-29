import { describe, expect, it, vi } from 'vitest';
import { createBackendSet } from '../../src/backends/factory.js';
import { DEFAULT_BACKEND_CONFIG } from '../../src/backends/config.js';

describe('backend factory', () => {
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

      expect(createBraveSearch).toHaveBeenCalledWith({ apiKey: 'brave-key' });
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

      expect(createYouComSearch).toHaveBeenCalledWith({ apiKey: 'ydc-key' });
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
});
