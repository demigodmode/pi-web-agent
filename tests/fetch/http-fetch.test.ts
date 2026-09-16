import { describe, expect, it } from 'vitest';
import { createHttpFetcher } from '../../src/fetch/http-fetch.js';
import { BlockedAddressError } from '../../src/fetch/network-guard.js';

describe('http fetch blocked redirect', () => {
  it('reports a blocked redirect hop as a private address error', async () => {
    const fetchImpl = (async () => {
      throw new BlockedAddressError('evil.example', '169.254.169.254');
    }) as unknown as typeof fetch;

    const result = await createHttpFetcher({ fetchImpl })('https://example.com/start');

    expect(result).toMatchObject({
      status: 'error',
      url: 'https://example.com/start',
      metadata: { method: 'http', cacheHit: false },
      error: { code: 'BLOCKED_PRIVATE_ADDRESS' }
    });
    expect(result.error?.failure).toEqual({ kind: 'guard_refused' });
  });

  it('still throws unrelated errors', async () => {
    const fetchImpl = (async () => {
      throw new Error('socket hang up');
    }) as unknown as typeof fetch;

    await expect(createHttpFetcher({ fetchImpl })('https://example.com/')).rejects.toThrow('socket hang up');
  });
});
