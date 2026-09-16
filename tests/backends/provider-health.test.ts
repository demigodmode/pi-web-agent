import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COOLDOWN_MS,
  MAX_COOLDOWN_MS,
  MIN_COOLDOWN_MS,
  cooldownFor,
  createProviderHealth
} from '../../src/backends/provider-health.js';

describe('cooldownFor', () => {
  it('uses the provider retry time, clamped to 1 s - 15 min, or 60 s by default', () => {
    expect(cooldownFor({ kind: 'rate_limited' })).toBe(DEFAULT_COOLDOWN_MS);
    expect(DEFAULT_COOLDOWN_MS).toBe(60_000);
    expect(cooldownFor({ kind: 'rate_limited', providerRetryAfterMs: 30_000 })).toBe(30_000);
    expect(cooldownFor({ kind: 'rate_limited', providerRetryAfterMs: 10 })).toBe(MIN_COOLDOWN_MS);
    expect(cooldownFor({ kind: 'rate_limited', providerRetryAfterMs: 999_999_000 })).toBe(MAX_COOLDOWN_MS);
    expect(cooldownFor({ kind: 'rate_limited', providerRetryAfterMs: Number.MAX_SAFE_INTEGER })).toBe(MAX_COOLDOWN_MS);
    expect(cooldownFor({ kind: 'rate_limited', providerRetryAfterMs: Number.POSITIVE_INFINITY })).toBe(MAX_COOLDOWN_MS);
    expect(MIN_COOLDOWN_MS).toBe(1000);
    expect(MAX_COOLDOWN_MS).toBe(15 * 60_000);
  });
});

describe('provider health', () => {
  function clock(start = 1_000_000) {
    let t = start;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  }

  it('cools a rate-limited provider down, keeping the original failure, then recovers', () => {
    const c = clock();
    const health = createProviderHealth({ now: c.now });
    const failure = { kind: 'rate_limited' as const, httpStatus: 429, providerRetryAfterMs: 5000 };

    expect(health.record('brave', failure)).toEqual({ state: 'cooling_down', until: c.now() + 5000, failure });
    expect(health.get('brave').state).toBe('cooling_down');
    c.advance(4999);
    expect(health.get('brave').state).toBe('cooling_down');
    c.advance(1);
    expect(health.get('brave')).toEqual({ state: 'available' });
  });

  it.each(['quota_exhausted', 'auth_failed', 'not_configured'] as const)('disables on %s for the set lifetime', (kind) => {
    const c = clock();
    const health = createProviderHealth({ now: c.now });
    health.record('exa', { kind });
    c.advance(24 * 60 * 60_000);
    expect(health.get('exa')).toEqual({ state: 'disabled', failure: { kind } });
  });

  it.each(['transient', 'blocked', 'bad_response', 'bad_request', 'config_global', 'guard_refused'] as const)(
    'leaves state unchanged on %s',
    (kind) => {
      const health = createProviderHealth();
      expect(health.record('tavily', { kind })).toEqual({ state: 'available' });
    }
  );

  it('never downgrades a disabled provider to a cooldown', () => {
    const health = createProviderHealth();
    health.record('youcom', { kind: 'quota_exhausted' });
    health.record('youcom', { kind: 'rate_limited' });
    expect(health.get('youcom').state).toBe('disabled');
  });

  it('keeps separate state per key and starts fresh for a new instance', () => {
    const health = createProviderHealth();
    health.record('tavily', { kind: 'auth_failed' });
    expect(health.get('tavily-keyless')).toEqual({ state: 'available' });
    expect(createProviderHealth().get('tavily')).toEqual({ state: 'available' });
  });
});
