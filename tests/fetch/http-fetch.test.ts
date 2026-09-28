import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
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

async function stalledServer() {
  const seen = { requests: 0, closed: 0 };
  const server = createServer((request) => {
    seen.requests += 1;
    request.socket.once('close', () => (seen.closed += 1));
    // Never answers.
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      })
  };
}

describe('http fetch timeouts and cancellation', () => {
  it('gives up on a server that never answers and reports it as transient', async () => {
    const server = await stalledServer();
    try {
      const result = await createHttpFetcher({ timeoutMs: 50 })(server.url);
      expect(result).toMatchObject({
        status: 'error',
        metadata: { method: 'http' },
        error: { code: 'FETCH_TIMEOUT', failure: { kind: 'transient' } }
      });
      await vi.waitFor(() => expect(server.seen.closed).toBe(1));
    } finally {
      await server.close();
    }
  });

  it('throws the abort error when the caller cancels, and drops the connection', async () => {
    const server = await stalledServer();
    try {
      const controller = new AbortController();
      const pending = createHttpFetcher()(server.url, undefined, controller.signal);
      await vi.waitFor(() => expect(server.seen.requests).toBe(1));
      controller.abort();
      await expect(pending).rejects.toThrow('Operation aborted');
      await vi.waitFor(() => expect(server.seen.closed).toBe(1));
    } finally {
      await server.close();
    }
  });

  it('does not start a request that is already cancelled', async () => {
    const fetchImpl = vi.fn(async () => new Response('x'));
    const controller = new AbortController();
    controller.abort();
    await expect(createHttpFetcher({ fetchImpl: fetchImpl as unknown as typeof fetch })('https://example.com/', undefined, controller.signal)).rejects.toThrow('Operation aborted');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
