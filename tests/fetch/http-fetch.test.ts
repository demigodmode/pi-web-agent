import { describe, expect, it, vi } from 'vitest';
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

describe('http fetch query selection', () => {
  it('selects a late relevant section without treating the short selection as weak', async () => {
    const earlyText = 'General documentation background. '.repeat(220);
    const html = `<html><body><article><h1>Guide</h1><p>${earlyText}</p><h2 id="cancellation">Cancellation deadline</h2><p>The cancellation deadline is 48 hours before departure.</p></article></body></html>`;
    const fetchImpl = vi.fn().mockResolvedValue(new Response(html, { headers: { 'content-type': 'text/html' } }));

    const result = await createHttpFetcher({ fetchImpl })('https://example.com/guide', 'cancellation deadline');

    expect(result).toMatchObject({ status: 'ok', content: { sectionAnchor: 'cancellation' } });
    expect(result.content?.text).toContain('48 hours before departure');
    expect(result.content?.text.length).toBeLessThanOrEqual(4000);
    expect(result.metadata.truncated).toBe(true);
  });

  it('finds a relevant answer in a later sibling article', async () => {
    const html = `<html><body>
      <article><h2>Cancellation deadline</h2><p>Cancellation deadline is mentioned here only.</p></article>
      <article><h2 id="actual-deadline">Cancellation deadline</h2><p>The actual cancellation deadline is 14 days before departure.</p></article>
    </body></html>`;
    const fetchImpl = vi.fn().mockResolvedValue(new Response(html, { headers: { 'content-type': 'text/html' } }));

    const result = await createHttpFetcher({ fetchImpl })('https://example.com/guide', 'cancellation deadline');

    expect(result).toMatchObject({ status: 'ok' });
    expect(result.content?.text).toContain('The actual cancellation deadline is 14 days before departure.');
  });

  it('keeps the leading extraction behavior when no query is supplied', async () => {
    const html = `<html><body><article><p>${'Early material. '.repeat(400)}</p><h2>Cancellation deadline</h2><p>Late answer.</p></article></body></html>`;
    const fetchImpl = vi.fn().mockResolvedValue(new Response(html, { headers: { 'content-type': 'text/html' } }));

    const result = await createHttpFetcher({ fetchImpl })('https://example.com/guide');

    expect(result).toMatchObject({ status: 'ok', metadata: { truncated: true } });
    expect(result.content?.text).toContain('Early material');
    expect(result.content?.text).not.toContain('Late answer');
  });
});
