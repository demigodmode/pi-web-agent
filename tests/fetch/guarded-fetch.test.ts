import { describe, expect, it, vi } from 'vitest';
import { createGuardedFetch, MAX_REDIRECTS } from '../../src/fetch/guarded-fetch.js';
import { BlockedAddressError, createNetworkGuard } from '../../src/fetch/network-guard.js';
import { fakeLookup } from './fake-lookup.js';

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
