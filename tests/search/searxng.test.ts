import { describe, expect, it, vi } from 'vitest';
import { createSearxngSearchTool } from '../../src/search/searxng.js';

describe('searxng search backend', () => {
  it('maps SearXNG JSON results into web search results', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        results: [
          {
            title: 'Example Docs',
            url: 'https://example.com/docs',
            content: 'Useful docs snippet'
          }
        ]
      })));

    const search = createSearxngSearchTool({ baseUrl: 'http://localhost:8080', fetchImpl });
    const result = await search({ query: 'example docs' });

    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:8080/search?q=example+docs&format=json');
    expect(result).toMatchObject({
      status: 'ok',
      results: [{ title: 'Example Docs', url: 'https://example.com/docs', snippet: 'Useful docs snippet' }],
      metadata: { backend: 'searxng', cacheHit: false }
    });
  });

  it('passes supported SearXNG options as query params', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [{ title: 'Docs', url: 'https://example.com', content: 'Snippet' }] })));

    const search = createSearxngSearchTool({
      baseUrl: 'http://localhost:8080',
      options: { categories: ['general', 'it'], language: 'en', safesearch: 1 },
      fetchImpl
    });

    await search({ query: 'example docs' });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:8080/search?q=example+docs&format=json&categories=general%2Cit&language=en&safesearch=1'
    );
  });

  it('returns a useful error when SearXNG is unreachable', async () => {
    const search = createSearxngSearchTool({
      baseUrl: 'http://localhost:8080',
      fetchImpl: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'))
    });

    await expect(search({ query: 'example' })).resolves.toMatchObject({
      status: 'error',
      metadata: { backend: 'searxng', cacheHit: false },
      error: { code: 'FETCH_FAILED' }
    });
  });

  const json = (body: unknown, status = 200) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const searchWith = (response: Response) =>
    createSearxngSearchTool({ baseUrl: 'http://localhost:8080', fetchImpl: vi.fn().mockResolvedValue(response) })({ query: 'q' });

  it('classifies a 403 (JSON format disabled) as provider-wide auth_failed', async () => {
    const result = await searchWith(json('Forbidden', 403));
    expect(result.error).toMatchObject({ code: 'FETCH_FAILED', failure: { kind: 'auth_failed', httpStatus: 403 } });
  });

  it('returns ok with an empty list when there are no results and no unresponsive engines', async () => {
    const result = await searchWith(json({ results: [], unresponsive_engines: [] }));
    expect(result).toMatchObject({ status: 'ok', results: [] });
    expect(result.error).toBeUndefined();
  });

  it('treats an empty response with unresponsive engines as bad_response', async () => {
    const result = await searchWith(json({ results: [], unresponsive_engines: [['google', 'Suspended: too many requests']] }));
    expect(result.error).toMatchObject({ code: 'BAD_RESPONSE', failure: { kind: 'bad_response', httpStatus: 200 } });
  });

  it('treats an object-shaped unresponsive_engines as degraded too', async () => {
    const result = await searchWith(json({ results: [], unresponsive_engines: { google: 'Suspended: too many requests' } }));
    expect(result.error?.failure?.kind).toBe('bad_response');
  });

  it('keeps results even when some engines were unresponsive', async () => {
    const result = await searchWith(
      json({ results: [{ title: 'T', url: 'https://x.test/', content: 's' }], unresponsive_engines: [['google', 'timeout']] })
    );
    expect(result.status).toBe('ok');
    expect(result.results).toHaveLength(1);
  });

  it('treats a malformed body as bad_response', async () => {
    for (const body of ['<html>not json</html>', { nope: true }]) {
      const result = await searchWith(json(body));
      expect(result.error?.failure?.kind).toBe('bad_response');
    }
  });
});
