import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGuardedFetch, createPinnedFetch, MAX_REDIRECTS } from '../../src/fetch/guarded-fetch.js';
import { BlockedAddressError, createNetworkGuard, findBlockedAddressError } from '../../src/fetch/network-guard.js';
import { callbackLookup, fakeLookup } from './fake-lookup.js';

const lookup = fakeLookup({
  'example.com': ['93.184.216.34'],
  'cdn.example.com': ['93.184.216.35'],
  'evil.example': ['169.254.169.254']
});

function redirect(location: string, status = 302) {
  return new Response(null, { status, headers: { location } });
}

describe('createGuardedFetch', () => {
  it('blocks a private url before issuing any request', async () => {
    const base = vi.fn();
    const guarded = createGuardedFetch(base as unknown as typeof fetch, createNetworkGuard({}, { lookup }));

    await expect(guarded('http://169.254.169.254/latest/meta-data/')).rejects.toBeInstanceOf(BlockedAddressError);
    expect(base).not.toHaveBeenCalled();
  });

  it('follows a redirect to a public host and returns the final response', async () => {
    const base = vi
      .fn()
      .mockResolvedValueOnce(redirect('https://cdn.example.com/page'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const guarded = createGuardedFetch(base as unknown as typeof fetch, createNetworkGuard({}, { lookup }));

    const response = await guarded('https://example.com/start');

    expect(await response.text()).toBe('ok');
    expect(base.mock.calls[1][0]).toBe('https://cdn.example.com/page');
    for (const call of base.mock.calls) {
      expect(call[1]).toMatchObject({ redirect: 'manual' });
    }
  });

  it('blocks a redirect hop that points at a private address', async () => {
    const base = vi.fn().mockResolvedValueOnce(redirect('http://evil.example/steal'));
    const guarded = createGuardedFetch(base as unknown as typeof fetch, createNetworkGuard({}, { lookup }));

    await expect(guarded('https://example.com/start')).rejects.toBeInstanceOf(BlockedAddressError);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('resolves relative redirect locations against the current url', async () => {
    const base = vi
      .fn()
      .mockResolvedValueOnce(redirect('/next'))
      .mockResolvedValueOnce(new Response('done', { status: 200 }));
    const guarded = createGuardedFetch(base as unknown as typeof fetch, createNetworkGuard({}, { lookup }));

    await guarded('https://example.com/start');
    expect(base.mock.calls[1][0]).toBe('https://example.com/next');
  });

  it('gives up after too many redirects', async () => {
    const base = vi.fn(async () => redirect('https://example.com/loop'));
    const guarded = createGuardedFetch(base as unknown as typeof fetch, createNetworkGuard({}, { lookup }));

    await expect(guarded('https://example.com/loop')).rejects.toThrow(/Too many redirects/);
    expect(base).toHaveBeenCalledTimes(MAX_REDIRECTS + 1);
  });

  it('switches to GET without a body after a 303', async () => {
    const base = vi
      .fn()
      .mockResolvedValueOnce(redirect('https://example.com/result', 303))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const guarded = createGuardedFetch(base as unknown as typeof fetch, createNetworkGuard({}, { lookup }));

    await guarded('https://example.com/submit', { method: 'POST', body: 'x' });

    expect(base.mock.calls[1][1]).toMatchObject({ method: 'GET', body: undefined });
  });

  it('drops authorization, cookie and proxy-authorization on a cross-origin redirect', async () => {
    const base = vi
      .fn()
      .mockResolvedValueOnce(redirect('https://cdn.example.com/page'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const guarded = createGuardedFetch(base as unknown as typeof fetch, createNetworkGuard({}, { lookup }));

    await guarded('https://example.com/start', {
      headers: { authorization: 'secret', cookie: 'a=b', 'proxy-authorization': 'p', 'x-keep': 'yes' }
    });

    const secondHeaders = new Headers(base.mock.calls[1][1].headers);
    expect(secondHeaders.get('authorization')).toBeNull();
    expect(secondHeaders.get('cookie')).toBeNull();
    expect(secondHeaders.get('proxy-authorization')).toBeNull();
    expect(secondHeaders.get('x-keep')).toBe('yes');
  });

  it('keeps authorization on a same-origin redirect', async () => {
    const base = vi
      .fn()
      .mockResolvedValueOnce(redirect('/next'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const guarded = createGuardedFetch(base as unknown as typeof fetch, createNetworkGuard({}, { lookup }));

    await guarded('https://example.com/start', { headers: { authorization: 'secret' } });

    const secondHeaders = new Headers(base.mock.calls[1][1].headers);
    expect(secondHeaders.get('authorization')).toBe('secret');
  });

  it('drops content-type and content-length when a 303 switches to GET', async () => {
    const base = vi
      .fn()
      .mockResolvedValueOnce(redirect('https://example.com/result', 303))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const guarded = createGuardedFetch(base as unknown as typeof fetch, createNetworkGuard({}, { lookup }));

    await guarded('https://example.com/submit', {
      method: 'POST',
      body: 'x',
      headers: { 'content-type': 'text/plain', 'content-length': '1' }
    });

    const secondHeaders = new Headers(base.mock.calls[1][1].headers);
    expect(secondHeaders.get('content-type')).toBeNull();
    expect(secondHeaders.get('content-length')).toBeNull();
  });

  it('seeds method, headers and body from a Request input', async () => {
    const base = vi.fn().mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const guarded = createGuardedFetch(base as unknown as typeof fetch, createNetworkGuard({}, { lookup }));

    const request = new Request('https://example.com/start', {
      method: 'POST',
      headers: { authorization: 'x' },
      body: 'b'
    });
    await guarded(request);

    expect(base.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    const headers = new Headers(base.mock.calls[0][1].headers);
    expect(headers.get('authorization')).toBe('x');
  });

  it('follows a 307 redirect for a Request input without losing the body', async () => {
    const base = vi
      .fn()
      .mockResolvedValueOnce(redirect('https://example.com/next', 307))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const guarded = createGuardedFetch(base as unknown as typeof fetch, createNetworkGuard({}, { lookup }));

    const request = new Request('https://example.com/start', { method: 'POST', body: 'hello' });
    await guarded(request);

    expect(base.mock.calls[1][1]).toMatchObject({ method: 'POST' });
    const secondCallInit = base.mock.calls[1][1] as RequestInit;
    const bodyText = await new Response(secondCallInit.body as BodyInit).text();
    expect(bodyText).toBe('hello');
  });

  it('rejects a redirect to a non-http(s) protocol before issuing another request', async () => {
    const base = vi.fn().mockResolvedValueOnce(redirect('file:///etc/passwd'));
    const guarded = createGuardedFetch(base as unknown as typeof fetch, createNetworkGuard({}, { lookup }));

    await expect(guarded('https://example.com/start')).rejects.toThrow(/Unsupported protocol/);
    expect(base).toHaveBeenCalledTimes(1);
  });
});

describe('createPinnedFetch against a real local server', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === '/redirect') {
        response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('hello');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('refuses to connect when the hostname resolves to a blocked address at connect time', async () => {
    const pinned = createPinnedFetch(createNetworkGuard(), { lookup: callbackLookup({ 'rebind.test': '127.0.0.1' }) });

    const error = await pinned(`http://rebind.test:${port}/`).catch((e) => e);

    expect(findBlockedAddressError(error)).toBeInstanceOf(BlockedAddressError);
  });

  it('connects when the resolved address is on the allow list', async () => {
    const pinned = createPinnedFetch(createNetworkGuard({ allowRanges: ['127.0.0.0/8'] }), {
      lookup: callbackLookup({ 'rebind.test': '127.0.0.1' })
    });

    const response = await pinned(`http://rebind.test:${port}/`);

    expect(await response.text()).toBe('hello');
  });

  it('stops a real redirect to cloud metadata', async () => {
    // Proves undici hands back the real 3xx in manual mode, so the hop check actually runs.
    const guard = createNetworkGuard(
      { allowRanges: ['127.0.0.0/8'] },
      { lookup: fakeLookup({ 'rebind.test': ['127.0.0.1'] }) }
    );
    const pinned = createPinnedFetch(guard, { lookup: callbackLookup({ 'rebind.test': '127.0.0.1' }) });
    const guarded = createGuardedFetch(pinned, guard);

    await expect(guarded(`http://rebind.test:${port}/redirect`)).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it('treats an empty lookup result as a resolution failure instead of throwing uncaught', async () => {
    const emptyLookup = (_hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
      if (options?.all) callback(null, []);
      else callback(Object.assign(new Error('getaddrinfo ENOTFOUND empty.test'), { code: 'ENOTFOUND' }));
    };
    const pinned = createPinnedFetch(createNetworkGuard(), { lookup: emptyLookup });

    await expect(pinned(`http://empty.test:${port}/`)).rejects.toBeTruthy();
  });
});
