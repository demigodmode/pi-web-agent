import { afterEach, describe, expect, it, vi } from 'vitest';
import { createParallelSearchTool, PARALLEL_SEARCH_URL, PARALLEL_USER_AGENT } from '../../src/search/parallel.js';
import { createBackendSet } from '../../src/backends/factory.js';
import { DEFAULT_BACKEND_CONFIG, extractBackendConfigOverride, mergeBackendConfigLayers, usableSearchProviders, validateBackendConfig } from '../../src/backends/config.js';
import { checkBackendHealth } from '../../src/backends/doctor.js';
import { createResearchWorkflow } from '../../src/orchestration/index.js';
import { createWebExploreTool } from '../../src/tools/web-explore.js';

const page = { url: 'https://vitest.dev/guide/coverage', title: 'Coverage', excerpts: ['Use the v8 provider.', 'Install @vitest/coverage-v8.'] };

/** The JSON-RPC response the endpoint returns, in whichever framing Streamable HTTP picked. */
function envelope(result: unknown, sse: boolean) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, result });
  return new Response(sse ? `event: message\ndata: ${body}\n\n` : body, {
    headers: { 'Content-Type': sse ? 'text/event-stream' : 'application/json' }
  });
}

/** A Search MCP endpoint that answers tools/call directly, with no handshake. */
function server({ body = { results: [page] }, sse = false, toolError, respond }: {
  body?: unknown;
  sse?: boolean;
  /** Reason text of an MCP tool error (`isError`) returned instead of a payload. */
  toolError?: string;
  /** Replaces the whole HTTP response, for transport-level cases. */
  respond?: (init: RequestInit) => Promise<Response>;
} = {}) {
  return vi.fn(async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    expect(String(url)).toBe(PARALLEL_SEARCH_URL);
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('User-Agent')).toBe(PARALLEL_USER_AGENT);
    expect(headers.get('Accept')).toBe('application/json, text/event-stream');
    expect(headers.has('Authorization')).toBe(false);
    if (respond) return respond(init!);
    return envelope(toolError === undefined
      ? { content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body, isError: false }
      : { content: [{ type: 'text', text: toolError }], isError: true }, sse);
  });
}

function searchRequests(fetchImpl: ReturnType<typeof server>) {
  return fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Parallel Search MCP', () => {
  it.each([false, true])('loads saved config through the factory and consumes MCP results (SSE=%s)', async (sse) => {
    const fetchImpl = server({ sse });
    vi.stubGlobal('fetch', fetchImpl);
    const config = mergeBackendConfigLayers(DEFAULT_BACKEND_CONFIG, extractBackendConfigOverride({
      backends: { search: { provider: 'parallel' } }
    }));
    expect(validateBackendConfig(config)).toEqual([]);
    const backend = createBackendSet(config);
    try {
      const result = await backend.search({ query: '  Vitest v8 coverage configuration  ' });
      expect(result).toMatchObject({ status: 'ok', metadata: { backend: 'parallel' }, results: [{
        title: page.title, url: page.url, snippet: page.excerpts.join('\n')
      }] });
      expect(result.presentation).toBeDefined();
      await backend.search({ query: 'second query' });
      // One POST per search: the endpoint needs no initialize handshake and no session to carry.
      const requests = searchRequests(fetchImpl);
      expect(requests).toHaveLength(2);
      expect(requests[0]).toMatchObject({ jsonrpc: '2.0', id: 1, method: 'tools/call' });
      expect(requests[0].params).toEqual({ name: 'web_search', arguments: {
        objective: 'Vitest v8 coverage configuration', search_queries: ['Vitest v8 coverage configuration'], session_id: expect.any(String)
      } });
      expect(requests[0].params.arguments.session_id).toBe(requests[1].params.arguments.session_id);
    } finally { await backend.close(); }
  });

  it('reads the payload from the mirrored text block when structured output is missing', async () => {
    const fetchImpl = server({ respond: async () => envelope({ content: [{ type: 'text', text: JSON.stringify({ results: [page] }) }] }, false) });
    const result = await createParallelSearchTool({ fetchImpl })({ query: 'query' });
    expect(result).toMatchObject({ status: 'ok', results: [{ url: page.url, title: page.title }] });
  });

  it('preserves default providers and requires explicit fanout inclusion', () => {
    expect(DEFAULT_BACKEND_CONFIG.search).toEqual({ provider: 'duckduckgo' });
    expect(usableSearchProviders({ provider: 'duckduckgo', fanout: { mode: 'on' } }, {})).toEqual(['duckduckgo']);
    expect(usableSearchProviders({ provider: 'parallel' }, {})).toEqual(['duckduckgo', 'parallel']);
    expect(usableSearchProviders({ provider: 'duckduckgo', fanout: { mode: 'on', providers: ['parallel'] } }, {}))
      .toEqual(['duckduckgo', 'parallel']);
  });

  it('passes discovered sources into the public bounded research workflow', async () => {
    vi.stubGlobal('fetch', server());
    const backend = createBackendSet({ ...DEFAULT_BACKEND_CONFIG, search: { provider: 'parallel' } });
    const fetchPage = vi.fn(async ({ url }: { url: string }) => ({
      status: 'ok' as const, url,
      content: { title: page.title, text: 'Vitest uses v8 coverage by default. Install @vitest/coverage-v8 and enable test.coverage.enabled in vitest.config.ts. '.repeat(20) },
      metadata: { method: 'http' as const, cacheHit: false }
    }));
    const workflow = createResearchWorkflow({ search: backend.search, fetchPage,
      headlessFetch: async ({ url }) => ({ status: 'error', url, metadata: { method: 'headless', cacheHit: false } }) });
    try {
      const result = await createWebExploreTool({ explore: workflow })({ query: 'Vitest v8 coverage configuration' });
      expect(fetchPage).toHaveBeenCalledWith(expect.objectContaining({ url: page.url }));
      expect(JSON.stringify(result.sources)).toContain(page.url);
      expect(JSON.stringify(result.findings)).toContain('coverage');
    } finally { await backend.close(); }
  });

  it('routes the MCP request through the configured proxy fetch', async () => {
    const fetchImpl = server();
    const proxy = { url: 'http://127.0.0.1:7890' };
    const createProxyFetch = vi.fn(() => fetchImpl);
    const backend = createBackendSet({ ...DEFAULT_BACKEND_CONFIG, search: { provider: 'parallel' }, proxy }, { createProxyFetch });
    try {
      expect((await backend.search({ query: 'Vitest coverage' })).status).toBe('ok');
      expect(createProxyFetch).toHaveBeenCalledWith(proxy);
      expect(searchRequests(fetchImpl)).toHaveLength(1);
    } finally { await backend.close(); }
  });

  it('checks the selected provider in doctor using the same MCP caller', async () => {
    const fetchImpl = server();
    const lines = await checkBackendHealth({ ...DEFAULT_BACKEND_CONFIG, search: { provider: 'parallel' } }, { fetchImpl });
    expect(lines).toContain('search backend: parallel ok');
    expect(searchRequests(fetchImpl)).toHaveLength(1);
    expect(fetchImpl.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('accepts empty results and nullable titles, rejects malformed results', async () => {
    for (const body of [{ results: [] }, { results: [{ ...page, title: null }] }]) {
      const result = await createParallelSearchTool({ fetchImpl: server({ body }) })({ query: 'query' });
      expect(result.status).toBe('ok');
      if (result.results.length) expect(result.results[0].title).toBe(page.url);
    }
    for (const body of [{}, { results: 'bad' }, { results: [{ ...page, url: 'file:///etc/passwd' }] },
      { results: [{ ...page, url: 'not a url' }] }, { results: [{ ...page, excerpts: [1] }] }]) {
      const result = await createParallelSearchTool({ fetchImpl: server({ body }) })({ query: 'query' });
      expect(result.error?.failure?.kind).toBe('bad_response');
    }
  });

  it('does not make a request for an empty query', async () => {
    const fetchImpl = server();
    expect((await createParallelSearchTool({ fetchImpl })({ query: '   ' })).error?.failure?.kind).toBe('bad_request');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('classifies HTTP limits with Retry-After and prevents immediate reuse', async () => {
    const fetchImpl = server({ respond: async () => new Response('Rate limited', { status: 429, headers: { 'Retry-After': '120' } }) });
    vi.stubGlobal('fetch', fetchImpl);
    const backend = createBackendSet({ ...DEFAULT_BACKEND_CONFIG, search: { provider: 'parallel' } });
    try {
      const result = await backend.search({ query: 'query' });
      expect(result.error?.failure).toMatchObject({ kind: 'rate_limited', httpStatus: 429, providerRetryAfterMs: 120_000 });
      await backend.search({ query: 'another query' });
      expect(searchRequests(fetchImpl)).toHaveLength(1);
    } finally { await backend.close(); }
  });

  it('reports MCP tool errors instead of successful empty results', async () => {
    const quota = await createParallelSearchTool({ fetchImpl: server({ toolError: 'Free quota rate limit exceeded' }) })({ query: 'query' });
    expect(quota).toMatchObject({ status: 'error', error: { code: 'FETCH_FAILED', failure: { kind: 'rate_limited', httpStatus: 200 } } });
    expect(quota.error?.message).toContain('Free quota rate limit exceeded');
    const unknown = await createParallelSearchTool({ fetchImpl: server({ toolError: 'Unknown tool: web_search' }) })({ query: 'query' });
    expect(unknown.error?.failure?.kind).toBe('bad_response');
  });

  it('classifies JSON-RPC protocol errors by code', async () => {
    const cases = [[-32602, 'bad_request'], [-32601, 'bad_response']] as const;
    for (const [code, kind] of cases) {
      const fetchImpl = server({ respond: async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code, message: 'rejected' } }), {
        headers: { 'Content-Type': 'application/json' }
      }) });
      const result = await createParallelSearchTool({ fetchImpl })({ query: 'query' });
      expect(result.error?.failure).toMatchObject({ kind, httpStatus: 200, providerCode: String(code) });
    }
  });

  it.each([[401, 'auth_failed'], [503, 'transient']] as const)('classifies HTTP %s', async (status, kind) => {
    const result = await createParallelSearchTool({ fetchImpl: server({ respond: async () => new Response('failure', { status }) }) })({ query: 'query' });
    expect(result.error?.failure).toMatchObject({ kind, httpStatus: status });
  });

  it.each([false, true])('rejects malformed MCP responses without retrying (SSE=%s)', async (sse) => {
    const bodies = [
      'not json',
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: 'invalid' } }),
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'not json' }] } })
    ];
    for (const body of bodies) {
      const fetchImpl = server({ respond: async () => new Response(sse ? `event: message\ndata: ${body}\n\n` : body, {
        headers: { 'Content-Type': sse ? 'text/event-stream' : 'application/json' }
      }) });
      const result = await createParallelSearchTool({ fetchImpl })({ query: 'query' });
      expect(result.error).toMatchObject({ code: 'BAD_RESPONSE', failure: { kind: 'bad_response' } });
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
    const html = await createParallelSearchTool({ fetchImpl: server({ respond: async () => new Response('<html>unexpected</html>', {
      headers: { 'Content-Type': 'text/html' }
    }) }) })({ query: 'query' });
    expect(html.error).toMatchObject({ code: 'BAD_RESPONSE', failure: { kind: 'bad_response' } });
    // An SSE stream that never carried a message event, e.g. keep-alive comments only.
    const silent = await createParallelSearchTool({ fetchImpl: server({ respond: async () => new Response(': keep-alive\n\n', {
      headers: { 'Content-Type': 'text/event-stream' }
    }) }) })({ query: 'query' });
    expect(silent.error).toMatchObject({ code: 'BAD_RESPONSE', failure: { kind: 'bad_response' } });
  });

  it('honors the explicit DuckDuckGo fallback after a provider failure', async () => {
    vi.stubGlobal('fetch', server({ toolError: 'Unknown tool: web_search' }));
    const fallback = vi.fn(async () => ({ status: 'ok' as const, results: [{ title: 'Fallback', url: page.url, snippet: '' }], metadata: { backend: 'duckduckgo' as const, cacheHit: false } }));
    const backend = createBackendSet({ ...DEFAULT_BACKEND_CONFIG, search: { provider: 'parallel', fallback: 'duckduckgo' } }, { createDuckDuckGoSearch: () => fallback });
    try {
      const result = await backend.search({ query: 'query' });
      expect(result.metadata).toMatchObject({ backend: 'duckduckgo', fallbackFrom: 'parallel' });
      expect(fallback).toHaveBeenCalledOnce();
    } finally { await backend.close(); }
  });

  it('reports a timed-out request as transient and propagates caller cancellation', async () => {
    const stalled = () => server({ respond: (init) => new Promise<Response>((_, reject) => {
      const fail = () => reject(init.signal?.reason ?? new Error('aborted'));
      if (init.signal?.aborted) fail();
      else init.signal?.addEventListener('abort', fail, { once: true });
    }) });
    const fetchImpl = stalled();
    const timedOut = await createParallelSearchTool({ fetchImpl })({ query: 'query', signal: AbortSignal.timeout(25) });
    expect(timedOut.error).toMatchObject({ code: 'FETCH_FAILED', failure: { kind: 'transient' } });
    expect(fetchImpl.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);

    vi.stubGlobal('fetch', stalled());
    const backend = createBackendSet({ ...DEFAULT_BACKEND_CONFIG, search: { provider: 'parallel' } });
    try {
      const controller = new AbortController();
      const work = backend.search({ query: 'query', signal: controller.signal });
      setTimeout(() => controller.abort(), 10);
      await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    } finally { await backend.close(); }
  });
});
