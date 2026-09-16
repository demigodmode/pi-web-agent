import { describe, expect, it } from 'vitest';
import { classifyHttpFailure } from '../../src/backends/provider-failure.js';

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
