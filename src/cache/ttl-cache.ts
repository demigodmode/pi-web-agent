export function createCacheKey(parts: Array<string | number | boolean>): string {
  return JSON.stringify(parts);
}

export function createTtlCache<T>({
  ttlMs,
  now = () => Date.now()
}: {
  ttlMs: number;
  now?: () => number;
}) {
  const entries = new Map<string, { value: T; expiresAt: number }>();

  return {
    get(key: string): T | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key: string, value: T): void {
      entries.set(key, { value, expiresAt: now() + ttlMs });
    }
  };
}
