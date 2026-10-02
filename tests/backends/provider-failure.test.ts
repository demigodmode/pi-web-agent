import { describe, expect, it } from 'vitest';
import { classifyEnvelopeFailure, classifyHttpFailure } from '../../src/backends/provider-failure.js';

const now = Date.parse('2026-09-16T12:00:00Z');
const parts = (status: number, body?: unknown, headers: Record<string, string> = {}) => ({
  status,
  headers: new Headers(headers),
  json: body
});

describe('classifyHttpFailure defaults', () => {
  it.each([
    [429, 'rate_limited'],
    [401, 'auth_failed'],
    [403, 'blocked'],
    [400, 'bad_request'],
    [422, 'bad_request'],
    [408, 'transient'],
    [500, 'transient'],
    [502, 'transient'],
    [503, 'transient'],
    [504, 'transient'],
    [402, 'bad_response'],
    [418, 'bad_response']
  ])('HTTP %s -> %s for a provider without specific rules (brave, tavily)', (status, kind) => {
    expect(classifyHttpFailure('brave', parts(status), now).kind).toBe(kind);
    expect(classifyHttpFailure('tavily', parts(status), now).kind).toBe(kind);
  });

  it('records the provider retry time on a rate limit only', () => {
    expect(classifyHttpFailure('tavily', parts(429, undefined, { 'retry-after': '20' }), now)).toEqual({
      kind: 'rate_limited',
      httpStatus: 429,
      providerRetryAfterMs: 20_000
    });
    expect(classifyHttpFailure('tavily', parts(503, undefined, { 'retry-after': '20' }), now)).toEqual({
      kind: 'transient',
      httpStatus: 503
    });
  });

  it('never classifies a Brave 429 as quota exhausted (UNVERIFIED monthly signal)', () => {
    expect(
      classifyHttpFailure('brave', parts(429, undefined, { 'x-ratelimit-remaining': '0, 0' }), now).kind
    ).toBe('rate_limited');
  });
});

describe('classifyHttpFailure Exa (tag first)', () => {
  it.each([
    [429, 'RATE_LIMIT_EXCEEDED', 'rate_limited'],
    [402, 'NO_MORE_CREDITS', 'quota_exhausted'],
    [402, 'API_KEY_BUDGET_EXCEEDED', 'quota_exhausted'],
    [402, 'TEAM_BUDGET_EXCEEDED', 'quota_exhausted'],
    [401, 'INVALID_API_KEY', 'auth_failed'],
    [403, 'FEATURE_DISABLED', 'auth_failed'],
    [403, 'PROHIBITED_CONTENT', 'bad_request'],
    [403, 'CONTENT_FILTER_ERROR', 'bad_request'],
    [400, 'INVALID_REQUEST_BODY', 'bad_request']
  ])('%s %s -> %s', (status, tag, kind) => {
    expect(classifyHttpFailure('exa', parts(status, { tag, error: 'x' }), now)).toMatchObject({
      kind,
      httpStatus: status,
      providerCode: tag
    });
  });

  it('treats an untagged 402 as quota exhausted and falls back to defaults otherwise', () => {
    expect(classifyHttpFailure('exa', parts(402), now).kind).toBe('quota_exhausted');
    expect(classifyHttpFailure('exa', parts(403), now).kind).toBe('blocked');
    expect(classifyHttpFailure('exa', parts(503, { tag: 'SOMETHING_NEW' }), now).kind).toBe('transient');
  });
});

describe('classifyHttpFailure documented provider rules', () => {
  it('Firecrawl: 402 quota, 401 auth, 429 rate limited', () => {
    expect(classifyHttpFailure('firecrawl', parts(402, { success: false }), now).kind).toBe('quota_exhausted');
    expect(classifyHttpFailure('firecrawl', parts(401), now).kind).toBe('auth_failed');
    expect(classifyHttpFailure('firecrawl', parts(429, undefined, { 'retry-after': '5' }), now)).toMatchObject({
      kind: 'rate_limited',
      providerRetryAfterMs: 5000
    });
  });

  it('You.com: 402 quota, 403 scope is provider-wide auth, 422 bad request', () => {
    expect(classifyHttpFailure('youcom', parts(402), now).kind).toBe('quota_exhausted');
    expect(classifyHttpFailure('youcom', parts(403), now).kind).toBe('auth_failed');
    expect(classifyHttpFailure('youcom', parts(422), now).kind).toBe('bad_request');
  });

  it('SearXNG: 403 (JSON format disabled) is provider-wide', () => {
    expect(classifyHttpFailure('searxng', parts(403), now).kind).toBe('auth_failed');
  });

  it('DuckDuckGo: 403 is a bot wall, not auth', () => {
    expect(classifyHttpFailure('duckduckgo', parts(403), now).kind).toBe('blocked');
  });
});

describe('classifyEnvelopeFailure', () => {
  it('reads a documented code even when the wording says nothing about it', () => {
    // No timeout/upstream phrase in the wording, so the code is what makes this call worth a
    // retry instead of a non-retryable bad_response.
    expect(classifyEnvelopeFailure({ status: 1001, error: 'Unauthorized' })).toEqual({
      failure: { kind: 'auth_failed', httpStatus: 200, providerCode: '1001' },
      message: '"Unauthorized" (provider status 1001)'
    });
    expect(classifyEnvelopeFailure({ status: 1504 })?.failure.kind).toBe('transient');
    expect(classifyEnvelopeFailure({ status: 1020, message: 'nothing' })?.failure.kind).toBe('quota_exhausted');
  });

  it('falls back to the wording, then to bad_response, and reports success as no failure', () => {
    expect(classifyEnvelopeFailure({ status: 2000, message: 'Upstream timeout' })?.failure.kind).toBe('transient');
    // An unrecognized code with unrecognized wording is not retryable.
    expect(classifyEnvelopeFailure({ status: 2000, message: 'something else' })?.failure).toMatchObject({
      kind: 'bad_response',
      providerCode: '2000'
    });
    expect(classifyEnvelopeFailure({ status: 0, error: 'ignored' })).toBeUndefined();
    expect(classifyEnvelopeFailure({ organic: [] })).toBeUndefined();
  });

  it('does not treat a body that only echoes the HTTP status as a failure', () => {
    // Some vendors answer `{"status": 200, "organic": [...]}` instead of SerpBase's `0`. Reading
    // 200 as a provider code dropped every row and, since bad_response is not retried, wrote the
    // vendor off for the rest of the run.
    expect(classifyEnvelopeFailure({ status: 200, organic: [{ title: 'A', link: 'https://a.test/' }] })).toBeUndefined();
    expect(classifyEnvelopeFailure({ status: 200, organic: [] })).toBeUndefined();
    // No wording and no documented code: leave it to normalize() rather than guess a failure.
    expect(classifyEnvelopeFailure({ status: 9999 })).toBeUndefined();
  });

  it('treats a 2xx status in the body as success even with a message field', () => {
    // A 2xx response in the body envelope means success, even if it echoes a message.
    expect(classifyEnvelopeFailure({ status: 200, message: 'OK' })).toBeUndefined();
    expect(classifyEnvelopeFailure({ status: 201, message: 'success' })).toBeUndefined();
    // Do not let wording (e.g., "credit used") turn a 2xx into a quota exhausted failure.
    expect(classifyEnvelopeFailure({ status: 200, message: '1 credit used' })).toBeUndefined();
  });
});
