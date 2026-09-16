import { describe, expect, it } from 'vitest';
import { failureOf, isTerminalFailure, parseRetryAfter, shouldFallBack } from '../../src/backends/failure.js';

describe('failure helpers', () => {
  const now = Date.parse('2026-09-16T12:00:00Z');

  it('parses Retry-After seconds and HTTP dates', () => {
    expect(parseRetryAfter('30', now)).toBe(30_000);
    expect(parseRetryAfter('Wed, 16 Sep 2026 12:02:00 GMT', now)).toBe(120_000);
  });

  it('rejects invalid and negative Retry-After values', () => {
    for (const value of [undefined, null, '', 'soon', '-5', '1.5', 'Wed, 16 Sep 2026 11:00:00 GMT']) {
      expect(parseRetryAfter(value, now)).toBeUndefined();
    }
  });

  it('keeps a huge Retry-After as reported', () => {
    expect(parseRetryAfter('999999', now)).toBe(999_999_000);
  });

  it('marks only config_global and guard_refused terminal', () => {
    expect(isTerminalFailure({ kind: 'config_global' })).toBe(true);
    expect(isTerminalFailure({ kind: 'guard_refused' })).toBe(true);
    for (const kind of ['rate_limited', 'quota_exhausted', 'auth_failed', 'not_configured', 'transient', 'blocked', 'bad_response', 'bad_request'] as const) {
      expect(isTerminalFailure({ kind })).toBe(false);
    }
    expect(isTerminalFailure(undefined)).toBe(false);
  });

  it('falls back for everything except bad_request and terminal kinds', () => {
    expect(shouldFallBack('bad_request')).toBe(false);
    expect(shouldFallBack('config_global')).toBe(false);
    expect(shouldFallBack('guard_refused')).toBe(false);
    for (const kind of ['rate_limited', 'quota_exhausted', 'auth_failed', 'not_configured', 'transient', 'blocked', 'bad_response'] as const) {
      expect(shouldFallBack(kind)).toBe(true);
    }
  });

  it('reads the failure of an error result, defaulting unclassified errors to bad_response', () => {
    expect(failureOf({ status: 'ok' })).toBeUndefined();
    expect(failureOf({ status: 'error', error: { code: 'X', message: 'x', failure: { kind: 'blocked' } } })).toEqual({ kind: 'blocked' });
    expect(failureOf({ status: 'error', error: { code: 'X', message: 'x' } })).toEqual({ kind: 'bad_response' });
    expect(failureOf({ status: 'error' })).toEqual({ kind: 'bad_response' });
  });
});
