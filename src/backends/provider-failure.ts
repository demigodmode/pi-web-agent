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

/** A failure a provider reported inside a 2xx body, with the wording to show the user. */
export type EnvelopeFailure = { failure: FailureInfo; message: string };

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
  } else if (provider === 'google-serp') {
    // Vendor-neutral Google SERP endpoint. Vendors in this space reject a bad or
    // revoked key with 401/403 rather than a bot wall, and bill an empty balance
    // as 402. UNVERIFIED across every vendor, so anything else keeps the defaults.
    if (status === 401 || status === 403) kind = 'auth_failed';
    else if (status === 402) kind = 'quota_exhausted';
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

const ENVELOPE_KINDS: Array<[RegExp, FailureKind]> = [
  [/quota|credit|billing|insufficient|payment|exhaust/i, 'quota_exhausted'],
  [/rate.?limit|too many/i, 'rate_limited'],
  [/unauthor|forbidden|denied|api.?key|token/i, 'auth_failed'],
  [/invalid|required|missing/i, 'bad_request']
];

/**
 * Some vendors answer HTTP 200 with the failure in the body instead of a 4xx, e.g.
 * `{"status": 1001, "error": "unauthorized"}`. Returns undefined when the body
 * reports success (`status: 0`) or does not carry a status envelope at all, so
 * this is only consulted after the response failed to normalize.
 *
 * The numeric codes are vendor-specific and not documented consistently, so the
 * kind comes from the vendor's own wording and the code is only kept for the
 * message. Anything unrecognized stays `bad_response`, which the fallback policy
 * already treats as non-retryable against that provider.
 */
export function classifyEnvelopeFailure(json: unknown): EnvelopeFailure | undefined {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return undefined;
  const body = json as Record<string, unknown>;
  const status = body.status;
  if (typeof status !== 'number' || status === 0) return undefined;
  const wording = [body.error, body.message].find((value): value is string => typeof value === 'string');
  const kind = ENVELOPE_KINDS.find(([pattern]) => pattern.test(wording ?? ''))?.[1] ?? 'bad_response';
  const message = wording ? `"${wording}" (provider status ${status})` : `provider status ${status}`;
  return { failure: { kind, httpStatus: 200, providerCode: String(status) }, message };
}

