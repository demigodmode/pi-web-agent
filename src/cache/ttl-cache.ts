export function createCacheKey(parts: Array<string | number | boolean>): string {
  return JSON.stringify(parts);
}

export function createTtlCache<T>({
  ttlMs,
  maxEntries = 256,
  now = () => Date.now()
}: {
  ttlMs: number;
  maxEntries?: number;
  now?: () => number;
}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError('maxEntries must be a positive integer');
  }

  const entries = new Map<string, { value: T; expiresAt: number }>();

  function pruneExpired(timestamp: number): void {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= timestamp) entries.delete(key);
    }
  }

  return {
    get(key: string): T | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key: string, value: T): void {
      const timestamp = now();
      pruneExpired(timestamp);
      entries.delete(key);
      entries.set(key, { value, expiresAt: timestamp + ttlMs });

      while (entries.size > maxEntries) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey === undefined) break;
        entries.delete(oldestKey);
      }
    }
  };
}
