import { describe, expect, it } from 'vitest';
import { createTtlCache } from '../../src/cache/ttl-cache.js';

describe('TTL cache', () => {
  it('returns cached values before expiry', () => {
    let now = 1_000;
    const cache = createTtlCache<string>({ ttlMs: 100, now: () => now });

    cache.set('key', 'value');

    expect(cache.get('key')).toBe('value');

    now = 1_050;
    expect(cache.get('key')).toBe('value');
  });

  it('drops cached values after expiry', () => {
    let now = 1_000;
    const cache = createTtlCache<string>({ ttlMs: 100, now: () => now });

    cache.set('key', 'value');
    now = 1_101;

    expect(cache.get('key')).toBeUndefined();
  });
});
