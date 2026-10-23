import { randomUUID } from 'node:crypto';
import type { EnvelopeFailure } from '../backends/provider-failure.js';
import type { FailureKind, SearchResult } from '../types.js';
import { createJsonSearchProvider, type Normalized } from './json-provider.js';

export const PARALLEL_SEARCH_URL = 'https://search.parallel.ai/mcp';
export const PARALLEL_USER_AGENT = 'pi-web-agent (+https://github.com/demigodmode/pi-web-agent)';

/** The version whose tool result carries `structuredContent`; see normalize. */
const MCP_PROTOCOL_VERSION = '2025-06-18';
const JSON_RPC_INVALID_PARAMS = -32602;
const MAX_RESULTS = 10;

// Keeps free-tier accounting stable across searches and backend configuration reloads.
const sessionId = randomUUID();

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** Concatenated text blocks of a tool result: the payload on success, the reason on `isError`. */
function toolText(result: Record<string, unknown>): string {
  if (!Array.isArray(result.content)) return '';
  return result.content
    .flatMap((item) => {
      const part = asRecord(item);
      return part?.type === 'text' && typeof part.text === 'string' ? [part.text] : [];
    })
    .join('\n');
}

/**
 * Streamable HTTP lets the endpoint answer a POST with an SSE stream instead of a JSON body.
 * A response to a single request carries one message event, so the first `data:` payload is
 * the JSON-RPC response.
 */
function parseEventStream(text: string): unknown {
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim());
    if (data.length === 0) continue;
    try {
      return JSON.parse(data.join('\n'));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * MCP reports a failed tool call as a 200 with `isError`, and a protocol-level failure as a
 * JSON-RPC `error` member, so neither reaches the HTTP classifier.
 */
function mcpFailure(json: unknown): EnvelopeFailure | undefined {
  const body = asRecord(json);
  if (!body) return undefined;

  const rpcError = asRecord(body.error);
  if (rpcError) {
    const code = typeof rpcError.code === 'number' ? rpcError.code : undefined;
    return {
      failure: {
        kind: code === JSON_RPC_INVALID_PARAMS ? 'bad_request' : 'bad_response',
        httpStatus: 200,
        ...(code === undefined ? {} : { providerCode: String(code) })
      },
      message: typeof rpcError.message === 'string' ? rpcError.message : 'the endpoint returned a JSON-RPC error'
    };
  }

  const result = asRecord(body.result);
  if (!result || result.isError !== true) return undefined;
  const text = toolText(result);
  const kind: FailureKind = /rate.?limit|quota|too many requests/i.test(text) ? 'rate_limited' : 'bad_response';
  return { failure: { kind, httpStatus: 200 }, message: text || 'the web_search tool reported an error' };
}

/** Unwraps the JSON-RPC envelope, then the tool result, then the search payload inside it. */
function normalize(json: unknown): Normalized | undefined {
  const result = asRecord(asRecord(json)?.result);
  if (!result) return undefined;

  // The payload is structured output, with the same JSON in a text block for clients that cannot read it.
  let body = asRecord(result.structuredContent);
  if (!body) {
    const text = toolText(result);
    if (!text) return undefined;
    try {
      body = asRecord(JSON.parse(text));
    } catch {
      return undefined;
    }
    if (!body) return undefined;
  }
  if (!Array.isArray(body.results)) return undefined;

  const results = body.results.flatMap((item: unknown): SearchResult[] => {
    const entry = asRecord(item);
    if (!entry || typeof entry.url !== 'string') return [];
    if (!Array.isArray(entry.excerpts) || !entry.excerpts.every((text) => typeof text === 'string')) return [];
    try {
      if (!['https:', 'http:'].includes(new URL(entry.url).protocol)) return [];
    } catch {
      return [];
    }
    return [{
      url: entry.url,
      title: typeof entry.title === 'string' && entry.title.trim() ? entry.title : entry.url,
      snippet: entry.excerpts.join('\n')
    }];
  });

  return { rawCount: body.results.length, results: results.slice(0, MAX_RESULTS) };
}

/**
 * Parallel's keyless Search MCP endpoint. It answers a `tools/call` POST on its own, so there is
 * no `initialize` handshake and no session to carry: the request is a plain JSON-RPC body sent
 * through the same provider and fetch as every other search backend.
 */
export function createParallelSearchTool({ fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}) {
  return createJsonSearchProvider({
    name: 'parallel',
    label: 'Parallel',
    requiresKey: false,
    fetchImpl,
    request: (query) => ({
      url: PARALLEL_SEARCH_URL,
      init: {
        method: 'POST',
        headers: {
          // Streamable HTTP requires both; the endpoint picks one and decodeBody reads either.
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
          'User-Agent': PARALLEL_USER_AGENT
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'web_search',
            arguments: { objective: query, search_queries: [query], session_id: sessionId }
          }
        })
      }
    }),
    decodeBody: ({ text, headers }) =>
      headers.get('content-type')?.includes('text/event-stream') ? parseEventStream(text) : undefined,
    bodyFailure: mcpFailure,
    normalize
  });
}
