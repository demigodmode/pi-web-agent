import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createDegoogSearchTool, degoogApiUrl } from '../../src/search/degoog.js';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/degoog/${name}`, import.meta.url), 'utf8');
const nativeBody = () => fixture('search.json');
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
const searchWith = (response: Response, baseUrl = 'http://localhost:4444', apiKey?: string) =>
  createDegoogSearchTool({ baseUrl, apiKey, fetchImpl: vi.fn().mockResolvedValue(response) })({ query: 'q' });

describe('degoog search backend', () => {
  it('maps native results from a real instance response in returned order', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(nativeBody(), { headers: { 'content-type': 'application/json' } }));
    const search = createDegoogSearchTool({ baseUrl: 'http://localhost:4444', fetchImpl });

    const result = await search({ query: 'vitest coverage setup' });

    expect(result.status).toBe('ok');
    expect(result.metadata).toMatchObject({ backend: 'degoog', cacheHit: false });
    expect(result.results).toHaveLength(5);
    expect(result.results[0]).toEqual({
      title: 'coverage | Config | Vitest',
      url: 'https://vitest.dev/config/coverage',
      snippet: expect.stringContaining('Vitest calls it for each node')
    });
    expect(result.results.map((r) => r.url)).toEqual(
      JSON.parse(nativeBody()).results.slice(0, 5).map((r: { url: string }) => r.url)
    );
  });

  it('uses snippet and falls back to content, then to an empty snippet', async () => {
    const result = await searchWith(json({
      results: [
        { title: 'A', url: 'https://a.test', snippet: 'from snippet', content: 'from content' },
        { title: 'B', url: 'https://b.test', content: 'only content' },
        { title: 'C', url: 'https://c.test' }
      ]
    }));

    expect(result.results).toEqual([
      { title: 'A', url: 'https://a.test', snippet: 'from snippet' },
      { title: 'B', url: 'https://b.test', snippet: 'only content' },
      { title: 'C', url: 'https://c.test', snippet: '' }
    ]);
  });

  it('skips items without a string title and url', async () => {
    const result = await searchWith(json({
      results: [
        { title: 'Kept', url: 'https://kept.test', snippet: 's' },
        { url: 'https://no-title.test' },
        { title: 42, url: 'https://bad-title.test' },
        { title: 'No url' },
        null
      ]
    }));

    expect(result.results).toEqual([{ title: 'Kept', url: 'https://kept.test', snippet: 's' }]);
    expect(result.status).toBe('ok');
  });

  it('asks for JSON with q only: no format and no paging or option params', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ results: [] }));
    await createDegoogSearchTool({ baseUrl: 'http://localhost:4444', fetchImpl })({ query: 'example docs' });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:4444/api/search?q=example+docs');
    expect(new URL(url).searchParams.has('format')).toBe(false);
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.headers).toEqual({ Accept: 'application/json' });
  });

  it('sends the bearer header only when a key is set', async () => {
    const withKey = vi.fn().mockResolvedValue(json({ results: [] }));
    await createDegoogSearchTool({ baseUrl: 'http://localhost:4444', apiKey: 'a'.repeat(64), fetchImpl: withKey })({ query: 'q' });
    expect((withKey.mock.calls[0] as [string, RequestInit])[1].headers).toEqual({
      Accept: 'application/json',
      Authorization: `Bearer ${'a'.repeat(64)}`
    });

    const blank = vi.fn().mockResolvedValue(json({ results: [] }));
    await createDegoogSearchTool({ baseUrl: 'http://localhost:4444', apiKey: '   ', fetchImpl: blank })({ query: 'q' });
    expect((blank.mock.calls[0] as [string, RequestInit])[1].headers).toEqual({ Accept: 'application/json' });
  });

  it('never puts the key in the URL or in the error message', async () => {
    const key = 'b'.repeat(64);
    const fetchImpl = vi.fn().mockResolvedValue(json('nope', 401));
    const result = await createDegoogSearchTool({ baseUrl: 'http://localhost:4444', apiKey: key, fetchImpl })({ query: 'q' });

    expect(String(fetchImpl.mock.calls[0][0])).not.toContain(key);
    expect(JSON.stringify(result)).not.toContain(key);
  });

  it.each([
    ['a trailing slash', 'http://host:4444/', 'http://host:4444/api/search?q=test'],
    ['a pasted /api/search', 'http://host:4444/api/search', 'http://host:4444/api/search?q=test'],
    ['a pasted /api/search/', 'http://host:4444/api/search/', 'http://host:4444/api/search?q=test'],
    ['a pasted /search', 'http://host:4444/search', 'http://host:4444/api/search?q=test'],
    ['a pasted /search and slash', 'http://host:4444/search/', 'http://host:4444/api/search?q=test'],
    ['a sub-path', 'https://host/degoog', 'https://host/degoog/api/search?q=test'],
    ['a sub-path with slash', 'https://host/degoog/', 'https://host/degoog/api/search?q=test'],
    ['a sub-path with pasted /search', 'https://host/degoog/search', 'https://host/degoog/api/search?q=test']
  ])('builds the API URL for %s', async (_label, baseUrl, expected) => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ results: [] }));
    await createDegoogSearchTool({ baseUrl, fetchImpl })({ query: 'test' });
    expect(fetchImpl.mock.calls[0][0]).toBe(expected);
  });

  it('keeps the sub-path in degoogApiUrl for the engines endpoint too', () => {
    expect(degoogApiUrl('https://host/degoog/search/', 'api/engines')).toBe('https://host/degoog/api/engines');
  });

  it.each([
    ['a query string on the root', 'http://h:4444/?x=1', 'http://h:4444/api/search?q=test'],
    ['a fragment on the root', 'http://h:4444/#frag', 'http://h:4444/api/search?q=test'],
    ['a query on a pasted /api/search', 'http://h:4444/api/search?x=1', 'http://h:4444/api/search?q=test'],
    ['a fragment on a pasted /search', 'http://h:4444/search#top', 'http://h:4444/api/search?q=test'],
    ['an uppercase /API/SEARCH', 'http://h:4444/API/SEARCH', 'http://h:4444/api/search?q=test'],
    ['an uppercase /SEARCH', 'https://host/SEARCH/', 'https://host/api/search?q=test'],
    ['an uppercase sub-path kept', 'https://host/DeGoog/', 'https://host/DeGoog/api/search?q=test'],
    ['an uppercase scheme and host', 'HTTP://HOST:4444/', 'http://host:4444/api/search?q=test'],
    ['an IPv6 host', 'http://[::1]:4444/', 'http://[::1]:4444/api/search?q=test'],
    ['an IPv6 host with a pasted /search', 'http://[::1]:4444/search', 'http://[::1]:4444/api/search?q=test']
  ])('builds the API URL for %s', async (_label, baseUrl, expected) => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ results: [] }));
    await createDegoogSearchTool({ baseUrl, fetchImpl })({ query: 'test' });
    expect(fetchImpl.mock.calls[0][0]).toBe(expected);
  });

  it('keeps the engines URL free of query and fragment too', () => {
    expect(degoogApiUrl('http://h:4444/?x=1#frag', 'api/engines')).toBe('http://h:4444/api/engines');
  });

  it('returns a useful error when degoog is unreachable', async () => {
    const search = createDegoogSearchTool({
      baseUrl: 'http://localhost:4444',
      fetchImpl: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'))
    });

    await expect(search({ query: 'example' })).resolves.toMatchObject({
      status: 'error',
      metadata: { backend: 'degoog', cacheHit: false },
      error: { code: 'FETCH_FAILED', failure: { kind: 'transient' } }
    });
  });

  it('classifies a 400 as bad_request', async () => {
    const result = await searchWith(json({ error: "Missing or invalid query parameter 'q'" }, 400));
    expect(result.error).toMatchObject({ code: 'FETCH_FAILED', failure: { kind: 'bad_request', httpStatus: 400 } });
  });

  it('classifies a 401 as auth_failed and names the env var', async () => {
    const withKey = await searchWith(json({ error: 'You shall not pass!' }, 401), 'http://localhost:4444', 'c'.repeat(64));
    expect(withKey.error).toMatchObject({ code: 'FETCH_FAILED', failure: { kind: 'auth_failed', httpStatus: 401 } });
    expect(withKey.error?.message).toContain('PI_WEB_AGENT_DEGOOG_API_KEY');

    const withoutKey = await searchWith(json({ error: 'You shall not pass!' }, 401));
    expect(withoutKey.error?.failure?.kind).toBe('auth_failed');
    expect(withoutKey.error?.message).toContain('PI_WEB_AGENT_DEGOOG_API_KEY');
  });

  it('classifies a 404 HTML page as bad_response and asks for the base URL', async () => {
    const result = await searchWith(new Response('<!doctype html><title>404</title>', {
      status: 404,
      headers: { 'content-type': 'text/html' }
    }));
    expect(result.error).toMatchObject({ code: 'FETCH_FAILED', failure: { kind: 'bad_response', httpStatus: 404 } });
    expect(result.error?.message).toContain('base URL');
  });

  it('classifies a 429 as rate_limited and keeps Retry-After', async () => {
    const result = await searchWith(json({ error: 'slow down' }, 429, { 'retry-after': '7' }));
    expect(result.error?.failure).toMatchObject({ kind: 'rate_limited', httpStatus: 429 });
    expect(result.error?.failure?.providerRetryAfterMs).toBe(7000);
  });

  it('classifies a 500 as transient', async () => {
    const result = await searchWith(json('boom', 500));
    expect(result.error?.failure).toMatchObject({ kind: 'transient', httpStatus: 500 });
  });

  it('classifies a network error as transient', async () => {
    const search = createDegoogSearchTool({
      baseUrl: 'http://localhost:4444',
      fetchImpl: vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    });
    const result = await search({ query: 'q' });
    expect(result.error?.failure?.kind).toBe('transient');
  });

  it('treats an HTML 200 as bad_response that points at the base URL', async () => {
    const result = await searchWith(new Response('<!doctype html><html></html>', { headers: { 'content-type': 'text/html' } }));
    expect(result.error).toMatchObject({ code: 'BAD_RESPONSE', failure: { kind: 'bad_response', httpStatus: 200 } });
    expect(result.error?.message).toContain('base URL');
  });

  it('treats a JSON body without a results array as bad_response', async () => {
    const result = await searchWith(json({ nope: true }));
    expect(result.error?.failure?.kind).toBe('bad_response');
    expect(result.error?.message).toContain('base URL');
  });

  it('reads a SearXNG-shaped body by its results', async () => {
    const result = await searchWith(new Response(fixture('search-searxng-shape.json'), { headers: { 'content-type': 'application/json' } }));
    expect(result.status).toBe('ok');
    expect(result.results).toHaveLength(3);
  });

  it('reports an empty response whose engines all failed as degraded, naming them', async () => {
    const body = {
      results: [],
      query: 'q',
      engineTimings: [
        { name: 'Brave Search', id: 'b', time: 142, resultCount: 0, status: 'rate_limited', errorReason: 'Brave Search upstream returned HTTP 429', httpStatus: 429 },
        { name: 'DuckDuckGo', id: 'd', time: 900, resultCount: 0, status: 'timeout' }
      ]
    };
    const result = await searchWith(json(body));
    expect(result.error).toMatchObject({ code: 'BAD_RESPONSE', failure: { kind: 'bad_response', httpStatus: 200 } });
    expect(result.error?.message).toContain('Brave Search (Brave Search upstream returned HTTP 429)');
    expect(result.error?.message).toContain('DuckDuckGo (timeout)');
  });

  it('keeps results when some engines failed', async () => {
    const parsed = JSON.parse(nativeBody());
    parsed.engineTimings[0].status = 'blocked';
    const result = await searchWith(json(parsed));
    expect(result.status).toBe('ok');
    expect(result.results.length).toBeGreaterThan(0);
  });

  it('treats an ok engine with an error reason and no results as failed, and names the reason', async () => {
    const result = await searchWith(json({
      results: [],
      engineTimings: [
        { name: 'Wikipedia', id: 'w', status: 'ok', resultCount: 0, errorReason: 'Engine is missing its API token' },
        { name: 'Brave Search', id: 'b', status: 'timeout', resultCount: 0 }
      ]
    }));
    expect(result.error).toMatchObject({ code: 'BAD_RESPONSE', failure: { kind: 'bad_response', httpStatus: 200 } });
    expect(result.error?.message).toContain('Wikipedia (Engine is missing its API token)');
    expect(result.error?.message).toContain('Brave Search (timeout)');
  });

  it('does not count an ok engine with an error reason but results as failed', async () => {
    const parsed = JSON.parse(nativeBody());
    parsed.engineTimings = [{ name: 'Wikipedia', id: 'w', status: 'ok', resultCount: 2, errorReason: 'partial' }];
    const result = await searchWith(json(parsed));
    expect(result.status).toBe('ok');
    expect(result.results.length).toBeGreaterThan(0);
  });

  it('returns ok with no results when there are no engines at all', async () => {
    const result = await searchWith(json({ results: [], query: 'q', type: 'web', engineTimings: [], relatedSearches: [] }));
    expect(result).toMatchObject({ status: 'ok', results: [] });
    expect(result.error).toBeUndefined();
  });

  it('returns ok with no results when every engine answered ok but found nothing', async () => {
    const result = await searchWith(json({ results: [], engineTimings: [{ name: 'Wikipedia', id: 'w', status: 'ok', resultCount: 0 }] }));
    expect(result).toMatchObject({ status: 'ok', results: [] });
  });
});
