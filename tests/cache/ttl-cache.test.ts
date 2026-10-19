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

  it('prunes expired entries when inserting a new value', () => {
    let now = 1_000;
    const cache = createTtlCache<string>({ ttlMs: 100, maxEntries: 2, now: () => now });

    cache.set('fresh', 'new');
    now = 800;
    cache.set('expired', 'old');
    now = 1_000;
    cache.set('newest', 'newer');

    expect(cache.get('fresh')).toBe('new');
    expect(cache.get('expired')).toBeUndefined();
    expect(cache.get('newest')).toBe('newer');
  });

  it('refreshes an entry recency when it is read', () => {
    let now = 1_000;
    const cache = createTtlCache<string>({ ttlMs: 100, maxEntries: 2, now: () => now });

    cache.set('first', 'one');
    now += 1;
    cache.set('second', 'two');
    expect(cache.get('first')).toBe('one');
    cache.set('third', 'three');

    expect(cache.get('first')).toBe('one');
    expect(cache.get('second')).toBeUndefined();
    expect(cache.get('third')).toBe('three');
  });

  it('evicts the least recently used entry at capacity', () => {
    let now = 1_000;
    const cache = createTtlCache<string>({ ttlMs: 100, maxEntries: 2, now: () => now });

    cache.set('first', 'one');
    now += 1;
    cache.set('second', 'two');
    now += 1;
    cache.set('third', 'three');

    expect(cache.get('first')).toBeUndefined();
    expect(cache.get('second')).toBe('two');
    expect(cache.get('third')).toBe('three');
  });

  it('replaces an existing key without growing the cache', () => {
    let now = 1_000;
    const cache = createTtlCache<string>({ ttlMs: 100, maxEntries: 2, now: () => now });

    cache.set('first', 'one');
    now += 1;
    cache.set('second', 'two');
    now += 1;
    cache.set('first', 'updated');
    cache.set('third', 'three');

    expect(cache.get('first')).toBe('updated');
    expect(cache.get('second')).toBeUndefined();
    expect(cache.get('third')).toBe('three');
  });
});
