import type { FailureInfo, FailureKind, SearchProviderName } from '../types.js';
import { parseRetryAfter } from './failure.js';

export type ClassifiedProvider = SearchProviderName | 'firecrawl';

export type ResponseParts = {
  status: number;
  headers: Headers;
  /** Parsed JSON body, or undefined when the body was empty or not JSON. */
  json?: unknown;
};

export class BodyReadError extends Error {
  constructor(readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'BodyReadError';
  }
}

/**
 * Reads a response body once, keeping status and headers alongside the parsed JSON.
 * A body that can't be read (connection dropped mid-stream) throws BodyReadError: that's
 * a transport failure, not a malformed response.
 */
export async function readResponseParts(response: Response): Promise<ResponseParts & { text: string }> {
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw new BodyReadError(error);
  }
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: response.status, headers: response.headers, json, text };
}

// Source: https://exa.ai/docs/reference/error-codes
const EXA_TAGS: Record<string, FailureKind> = {
  RATE_LIMIT_EXCEEDED: 'rate_limited',
  NO_MORE_CREDITS: 'quota_exhausted',
  API_KEY_BUDGET_EXCEEDED: 'quota_exhausted',
  TEAM_BUDGET_EXCEEDED: 'quota_exhausted',
  INVALID_API_KEY: 'auth_failed',
  FEATURE_DISABLED: 'auth_failed',
  PROHIBITED_CONTENT: 'bad_request',
  CONTENT_FILTER_ERROR: 'bad_request',
  INVALID_REQUEST_BODY: 'bad_request',
  INVALID_REQUEST: 'bad_request',
  INVALID_NUM_RESULTS: 'bad_request'
};

/**
 * Conservative defaults for undocumented responses. A 401 disables the provider
 * (low risk: resets on config change); an undocumented 403 is treated as a bot
 * wall; an undocumented 402 is not assumed to mean quota.
 */
function defaultKind(status: number): FailureKind {
  if (status === 429) return 'rate_limited';
  if (status === 401) return 'auth_failed';
  if (status === 403) return 'blocked';
  if (status === 400 || status === 422) return 'bad_request';
  if (status === 408 || status >= 500) return 'transient';
  return 'bad_response';
}

function stringField(json: unknown, field: string): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const value = (json as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}

export function classifyHttpFailure(provider: ClassifiedProvider, parts: ResponseParts, now = Date.now()): FailureInfo {
  const { status } = parts;
  let kind: FailureKind | undefined;
  let providerCode: string | undefined;

  if (provider === 'exa') {
    const tag = stringField(parts.json, 'tag');
    if (tag && EXA_TAGS[tag]) {
      kind = EXA_TAGS[tag];
      providerCode = tag;
    } else if (status === 402) {
      kind = 'quota_exhausted'; // documented 402 meaning for Exa
    }
  } else if (provider === 'firecrawl') {
    // Source: https://docs.firecrawl.dev/api-reference/errors
    if (status === 402) kind = 'quota_exhausted';
  } else if (provider === 'youcom') {
    // Source: https://you.com/docs/api-reference/search/v1-search (429 UNVERIFIED -> default)
    // Documented for /v1/search; the client currently calls /v1/agents/search (#60).
    if (status === 402) kind = 'quota_exhausted';
    else if (status === 403) kind = 'auth_failed';
  } else if (provider === 'searxng') {
    // Source: https://docs.searxng.org/dev/search_api.html (403 = format=json disabled in settings)
    if (status === 403) kind = 'auth_failed';
  }
  // brave, tavily, duckduckgo: defaults only (UNVERIFIED beyond 429; see research gate).

  const resolved = kind ?? defaultKind(status);
  const info: FailureInfo = { kind: resolved, httpStatus: status, ...(providerCode ? { providerCode } : {}) };
  if (resolved === 'rate_limited') {
    const retryAfter = parseRetryAfter(parts.headers.get('retry-after'), now);
    if (retryAfter !== undefined) info.providerRetryAfterMs = retryAfter;
  }
  return info;
}
