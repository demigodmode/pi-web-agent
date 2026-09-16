import { request as httpRequest } from 'node:http';
import { Socket, connect as netConnect, createServer as createNetServer, type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BLOCKED_HEADER, startGuardProxy, type GuardProxy } from '../../src/fetch/guard-proxy.js';
import {
  BlockedAddressError,
  UnverifiedDestinationError,
  UpstreamProxyRefusedError,
  createNetworkGuard
} from '../../src/fetch/network-guard.js';
import { fakeLookup } from './fake-lookup.js';
import { rawConnect, startRecordingUpstream, startServerPair } from './guard-proxy-fixtures.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const MALFORMED_AUTHORITIES = ['evil.test@127.0.0.1:443', '127.0.0.1%25eth0:443', '%31%32%37.0.0.1:443', 'a/b:443'];

function guardFor(table: Record<string, string[]>, allowRanges = ['127.0.0.1/32']) {
  return createNetworkGuard({ allowRanges }, { lookup: fakeLookup(table) });
}

async function proxyWith(options: Parameters<typeof startGuardProxy>[0]): Promise<GuardProxy> {
  const proxy = await startGuardProxy(options);
  cleanups.push(() => proxy.close());
  return proxy;
}

function forward(
  proxy: GuardProxy,
  target: string,
  auth: { username: string; password: string },
  extraHeaders: Record<string, string> = {}
) {
  const url = new URL(proxy.url);
  const parsed = new URL(target);
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
    const request = httpRequest(
      {
        host: url.hostname,
        port: Number(url.port),
        method: 'GET',
        path: target,
        headers: {
          ...extraHeaders,
          host: parsed.host,
          'proxy-authorization': `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`
        }
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
      }
    );
    request.on('error', reject);
    request.end();
  });
}

describe.skipIf(process.platform !== 'linux')('guard proxy', () => {
  it('requires the proxy credentials', async () => {
    const proxy = await proxyWith({ guard: guardFor({}) });
    const { status, head, socket } = await rawConnect(proxy.url, 'ok.test:443');
    socket.destroy();

    expect(status).toBe(407);
    expect(head.toLowerCase()).toContain('proxy-authenticate: basic');
  });

  it('tunnels an allowed CONNECT to the address it resolved', async () => {
    const pair = await startServerPair();
    cleanups.push(() => pair.close());
    const proxy = await proxyWith({ guard: guardFor({ 'ok.test': ['127.0.0.1'] }) });

    const { status, socket } = await rawConnect(proxy.url, `ok.test:${pair.port}`, proxy.client('t'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    socket.destroy();

    expect(status).toBe(200);
    expect(pair.ok.connections).toBe(1);
    expect(pair.evil.connections).toBe(0);
  });

  it('refuses a blocked CONNECT and records it', async () => {
    const pair = await startServerPair();
    cleanups.push(() => pair.close());
    const proxy = await proxyWith({ guard: guardFor({ 'evil.test': ['127.0.0.2'] }) });
    const client = proxy.client('t');
    const since = proxy.sequence();

    const { status, head, socket } = await rawConnect(proxy.url, `evil.test:${pair.port}`, client);
    socket.destroy();

    expect(status).toBe(403);
    expect(head.toLowerCase()).toContain(`${BLOCKED_HEADER}: blocked_private_address`);
    expect(pair.evil.connections).toBe(0);
    const refusals = proxy.refusalsSince(client.username, since);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({ host: 'evil.test' });
    expect(refusals[0].error).toBeInstanceOf(BlockedAddressError);
  });

  it('refuses a destination it cannot resolve', async () => {
    const proxy = await proxyWith({ guard: guardFor({}) });
    const client = proxy.client('t');

    const { status, socket } = await rawConnect(proxy.url, 'nope.test:443', client);
    socket.destroy();

    expect(status).toBe(403);
    expect(proxy.refusalsSince(client.username, 0)[0].error).toBeInstanceOf(UnverifiedDestinationError);
  });

  it('forwards plain HTTP to the resolved address and keeps the original Host', async () => {
    const pair = await startServerPair();
    cleanups.push(() => pair.close());
    const proxy = await proxyWith({ guard: guardFor({ 'ok.test': ['127.0.0.1'] }) });

    const response = await forward(proxy, `http://ok.test:${pair.port}/page`, proxy.client('t'));

    expect(response.status).toBe(200);
    expect(pair.ok.requests[0]).toMatchObject({ host: `ok.test:${pair.port}`, url: '/page' });
  });

  it('refuses blocked plain HTTP with the blocked header', async () => {
    const pair = await startServerPair();
    cleanups.push(() => pair.close());
    const proxy = await proxyWith({ guard: guardFor({ 'evil.test': ['127.0.0.2'] }) });

    const response = await forward(proxy, `http://evil.test:${pair.port}/`, proxy.client('t'));

    expect(response.status).toBe(403);
    expect(String(response.headers[BLOCKED_HEADER])).toContain('BLOCKED_PRIVATE_ADDRESS');
    expect(pair.evil.connections).toBe(0);
  });

  it('connects only to the address from its own single lookup when DNS changes', async () => {
    const pair = await startServerPair();
    cleanups.push(() => pair.close());
    const lookup = vi
      .fn()
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
      .mockResolvedValue([{ address: '127.0.0.2', family: 4 }]);
    const proxy = await proxyWith({
      guard: createNetworkGuard({ allowRanges: ['127.0.0.1/32'] }, { lookup })
    });
    const client = proxy.client('t');

    const first = await rawConnect(proxy.url, `flip.test:${pair.port}`, client);
    const second = await rawConnect(proxy.url, `flip.test:${pair.port}`, client);
    await new Promise((resolve) => setTimeout(resolve, 50));
    first.socket.destroy();
    second.socket.destroy();

    expect(first.status).toBe(200);
    expect(second.status).toBe(403);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(pair.ok.connections).toBe(1);
    expect(pair.evil.connections).toBe(0);
  });

  it('rejects malformed CONNECT authorities with 400', async () => {
    const proxy = await proxyWith({ guard: guardFor({}) });
    const client = proxy.client('t');
    for (const authority of MALFORMED_AUTHORITIES) {
      const { status, socket } = await rawConnect(proxy.url, authority, client);
      socket.destroy();
      expect(status, authority).toBe(400);
    }
  });

  it('refuses a destination whose lookup never finishes', async () => {
    const proxy = await proxyWith({
      guard: createNetworkGuard({}, { lookup: () => new Promise(() => undefined), lookupTimeoutMs: 50 }),
      // Shorter than the lookup timeout: only the guard's own deadline should bound resolution.
      connectTimeoutMs: 30
    });
    const client = proxy.client('t');

    const startedAt = Date.now();
    const { status, socket } = await rawConnect(proxy.url, 'slow.test:443', client);
    socket.destroy();

    expect(status).toBe(403);
    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(proxy.refusalsSince(client.username, 0)[0].error).toBeInstanceOf(UnverifiedDestinationError);
  });

  it('strips hop-by-hop headers in both directions when forwarding', async () => {
    const pair = await startServerPair({
      okHandler: (request, response) => {
        response.writeHead(200, { connection: 'X-Reply', 'x-reply': '1', 'keep-alive': 'timeout=77', trailer: 'x-t', 'x-kept': 'yes' });
        response.end('ok');
      }
    });
    cleanups.push(() => pair.close());
    const proxy = await proxyWith({ guard: guardFor({ 'ok.test': ['127.0.0.1'] }) });

    const response = await forward(proxy, `http://ok.test:${pair.port}/h`, proxy.client('t'), {
      connection: 'X-Secret',
      'x-secret': '1',
      upgrade: 'websocket',
      'keep-alive': 'timeout=5',
      te: 'trailers',
      'x-kept': 'yes'
    });

    expect(response.status).toBe(200);
    const seen = pair.ok.requests[0].headers ?? {};
    for (const name of ['x-secret', 'upgrade', 'keep-alive', 'te', 'proxy-authorization', 'proxy-connection']) {
      expect(seen, name).not.toHaveProperty(name);
    }
    expect(String(seen.connection ?? '')).not.toMatch(/x-secret/i);
    expect(seen['x-kept']).toBe('yes');
    expect(response.headers).not.toHaveProperty('x-reply');
    expect(response.headers).not.toHaveProperty('trailer');
    expect(String(response.headers['keep-alive'] ?? '')).not.toBe('timeout=77');
    expect(response.headers['x-kept']).toBe('yes');
  });

  it('puts the refusal sequence number in the blocked header', async () => {
    const proxy = await proxyWith({ guard: guardFor({ 'evil.test': ['127.0.0.2'] }) });
    const client = proxy.client('t');
    const { head, socket } = await rawConnect(proxy.url, 'evil.test:443', client);
    socket.destroy();
    const seq = proxy.refusalsSince(client.username, 0)[0].seq;
    expect(head.toLowerCase()).toContain(`${BLOCKED_HEADER}: blocked_private_address ${seq} `);
  });

  describe('with an upstream proxy', () => {
    it('sends the approved IP upstream, never the hostname', async () => {
      const pair = await startServerPair();
      const upstream = await startRecordingUpstream();
      cleanups.push(() => pair.close(), () => upstream.close());
      const proxy = await proxyWith({ guard: guardFor({ 'ok.test': ['127.0.0.1'] }), upstream: { url: upstream.url } });

      const { status, socket } = await rawConnect(proxy.url, `ok.test:${pair.port}`, proxy.client('t'));
      socket.destroy();

      expect(status).toBe(200);
      expect(upstream.targets).toEqual([`127.0.0.1:${pair.port}`]);
    });

    it('forwards plain HTTP upstream by IP with the original Host', async () => {
      const pair = await startServerPair();
      const upstream = await startRecordingUpstream();
      cleanups.push(() => pair.close(), () => upstream.close());
      const proxy = await proxyWith({ guard: guardFor({ 'ok.test': ['127.0.0.1'] }), upstream: { url: upstream.url } });

      const response = await forward(proxy, `http://ok.test:${pair.port}/x`, proxy.client('t'));

      expect(response.status).toBe(200);
      expect(upstream.targets).toEqual([`127.0.0.1:${pair.port}`]);
      expect(pair.ok.requests[0]).toMatchObject({ host: `ok.test:${pair.port}`, url: '/x' });
    });

    it('fails with an actionable error when the upstream rejects IP destinations, without retrying by hostname', async () => {
      const upstream = await startRecordingUpstream({ rejectIpTargets: true });
      cleanups.push(() => upstream.close());
      const proxy = await proxyWith({ guard: guardFor({ 'ok.test': ['127.0.0.1'] }), upstream: { url: upstream.url } });
      const client = proxy.client('t');

      const { status, head, socket } = await rawConnect(proxy.url, 'ok.test:443', client);
      socket.destroy();

      expect(status).toBe(502);
      expect(head.toLowerCase()).toContain(`${BLOCKED_HEADER}: upstream_proxy_refused`);
      expect(upstream.targets).toEqual(['127.0.0.1:443']);
      const error = proxy.refusalsSince(client.username, 0)[0].error;
      expect(error).toBeInstanceOf(UpstreamProxyRefusedError);
      expect(error.message).toContain('backends.network.trustProxyDns');
    });

    it('sends the upstream proxy credentials', async () => {
      const upstream = await startRecordingUpstream();
      cleanups.push(() => upstream.close());
      const proxy = await proxyWith({
        guard: guardFor({ 'ok.test': ['127.0.0.1'] }),
        upstream: { url: upstream.url, username: 'user', password: 'secret' }
      });

      const { socket } = await rawConnect(proxy.url, 'ok.test:1', proxy.client('t'));
      socket.destroy();

      expect(upstream.targets).toEqual(['127.0.0.1:1']);
      expect(upstream.heads[0]).toContain('Proxy-Authorization: Basic dXNlcjpzZWNyZXQ=');
    });

    it('delegates the hostname when the upstream is trusted, but still refuses private literals and localhost', async () => {
      const pair = await startServerPair();
      const upstream = await startRecordingUpstream({ resolve: { 'ok.test': '127.0.0.1' } });
      cleanups.push(() => pair.close(), () => upstream.close());
      const proxy = await proxyWith({
        // No allow list here: 127.0.0.1/32 would make localhost legitimately allowed. The guard
        // sees ok.test as public; only the trusted upstream maps it to the fixture.
        guard: guardFor({ 'ok.test': ['93.184.216.34'] }, []),
        upstream: { url: upstream.url },
        trustProxyDns: true
      });
      const client = proxy.client('t');

      const delegated = await rawConnect(proxy.url, `ok.test:${pair.port}`, client);
      const unresolved = await rawConnect(proxy.url, `inside-only.test:${pair.port}`, client);
      const literal = await rawConnect(proxy.url, `127.0.0.2:${pair.port}`, client);
      const local = await rawConnect(proxy.url, `localhost:${pair.port}`, client);
      for (const attempt of [delegated, unresolved, literal, local]) attempt.socket.destroy();

      expect(delegated.status).toBe(200);
      expect(literal.status).toBe(403);
      expect(local.status).toBe(403);
      expect(upstream.targets).toEqual([`ok.test:${pair.port}`, `inside-only.test:${pair.port}`]);
      expect(pair.evil.connections).toBe(0);
    });

    it('delegates a hostname whose lookup timed out to a trusted upstream', async () => {
      const upstream = await startRecordingUpstream();
      cleanups.push(() => upstream.close());
      const proxy = await proxyWith({
        guard: createNetworkGuard({}, { lookup: () => new Promise(() => undefined), lookupTimeoutMs: 50 }),
        upstream: { url: upstream.url },
        trustProxyDns: true,
        // Lower than the lookup timeout, so an outer race on resolution would refuse first.
        connectTimeoutMs: 30
      });
      const client = proxy.client('t');

      const startedAt = Date.now();
      const { socket } = await rawConnect(proxy.url, 'slow.test:4443', client);
      socket.destroy();

      // The recording upstream can't resolve slow.test and answers 502; what matters is it was asked.
      expect(upstream.targets).toEqual(['slow.test:4443']);
      expect(Date.now() - startedAt).toBeLessThan(2000);
      expect(proxy.refusalsSince(client.username, 0).some((r) => r.error instanceof UnverifiedDestinationError)).toBe(false);
    });

    it('never delegates a malformed authority to a trusted upstream', async () => {
      const upstream = await startRecordingUpstream();
      cleanups.push(() => upstream.close());
      const proxy = await proxyWith({ guard: guardFor({}), upstream: { url: upstream.url }, trustProxyDns: true });
      const client = proxy.client('t');

      for (const authority of MALFORMED_AUTHORITIES) {
        const { status, socket } = await rawConnect(proxy.url, authority, client);
        socket.destroy();
        expect(status, authority).toBe(400);
      }
      expect(upstream.targets).toEqual([]);
    });
  });

  describe('lifecycle', () => {
    it('stops accepting connections after close, and close is idempotent', async () => {
      const proxy = await startGuardProxy({ guard: guardFor({}) });
      await proxy.close();
      await proxy.close();
      await expect(rawConnect(proxy.url, 'ok.test:443')).rejects.toThrow();
    });

    it('answers 502 and destroys the socket when an outbound connection does not open in time', async () => {
      const pending = new Socket();
      const proxy = await proxyWith({
        guard: guardFor({ 'ok.test': ['127.0.0.1'] }),
        connectTimeoutMs: 100,
        openSocket: () => pending
      });

      const { status, socket } = await rawConnect(proxy.url, 'ok.test:443', proxy.client('t'));
      socket.destroy();

      expect(status).toBe(502);
      expect(pending.destroyed).toBe(true);
    });

    it('records an upstream refusal when the upstream never answers the CONNECT', async () => {
      // resume() so the socket sees EOF and close() can finish; it still never answers.
      const silent = createNetServer((socket) => socket.on('error', () => undefined).resume());
      await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', () => resolve()));
      cleanups.push(() => new Promise<void>((resolve) => silent.close(() => resolve())));
      const proxy = await proxyWith({
        guard: guardFor({ 'ok.test': ['127.0.0.1'] }),
        upstream: { url: `http://127.0.0.1:${(silent.address() as AddressInfo).port}` },
        handshakeTimeoutMs: 100
      });
      const client = proxy.client('t');

      const { status, socket } = await rawConnect(proxy.url, 'ok.test:443', client);
      socket.destroy();

      expect(status).toBe(502);
      expect(proxy.refusalsSince(client.username, 0)[0].error).toBeInstanceOf(UpstreamProxyRefusedError);
    });

    it('drops a client that never finishes sending its request headers', async () => {
      const proxy = await proxyWith({ guard: guardFor({}), handshakeTimeoutMs: 100 });
      const url = new URL(proxy.url);
      const socket = netConnect({ host: url.hostname, port: Number(url.port) });
      socket.on('error', () => undefined);
      // Read what the proxy sends (a 408), otherwise the paused socket never sees EOF and never emits close.
      socket.resume();
      socket.write('CONNECT ok.test:443 HTTP/1.1\r\n');

      await new Promise<void>((resolve) => socket.once('close', () => resolve()));
      expect(socket.destroyed).toBe(true);
    }, 5000);

    it('destroys outbound sockets that are still opening when it closes', async () => {
      const pending = new Socket();
      const proxy = await startGuardProxy({ guard: guardFor({ 'ok.test': ['127.0.0.1'] }), openSocket: () => pending });

      const attempt = rawConnect(proxy.url, 'ok.test:443', proxy.client('t')).catch((error) => error);
      await vi.waitFor(() => expect(pending.listenerCount('close')).toBeGreaterThan(0));
      await proxy.close();

      expect(pending.destroyed).toBe(true);
      await attempt;
    });
  });
});
