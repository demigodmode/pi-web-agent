import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGuardedFetch } from '../../src/fetch/guarded-fetch.js';
import { startGuardProxy, type GuardProxyOptions } from '../../src/fetch/guard-proxy.js';
import { createGuardProxyFetch } from '../../src/fetch/guard-proxy-fetch.js';
import {
  BlockedAddressError,
  UnverifiedDestinationError,
  UpstreamProxyRefusedError,
  createNetworkGuard,
  findGuardError
} from '../../src/fetch/network-guard.js';
import { fakeLookup } from './fake-lookup.js';
import { FIXTURE_CERT, startRecordingUpstream, startServerPair } from './guard-proxy-fixtures.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const table = {
  'ok.test': ['127.0.0.1'],
  'wrong.test': ['127.0.0.1'],
  'evil.test': ['127.0.0.2']
};

async function setup(extra: Partial<GuardProxyOptions> = {}) {
  const guard = createNetworkGuard({ allowRanges: ['127.0.0.1/32'] }, { lookup: fakeLookup(table) });
  const proxy = await startGuardProxy({ guard, ...extra });
  cleanups.push(() => proxy.close());
  const proxyFetch = createGuardProxyFetch(async () => proxy, { tls: { ca: FIXTURE_CERT } });
  return { guard, proxy, proxyFetch };
}

describe.skipIf(process.platform !== 'linux')('guard proxy fetch', () => {
  it('reaches an allowed HTTPS destination with the original Host and SNI', async () => {
    const pair = await startServerPair({ tls: true });
    cleanups.push(() => pair.close());
    const { proxyFetch } = await setup();

    const response = await proxyFetch(`https://ok.test:${pair.port}/page`);

    expect(response.status).toBe(200);
    expect(pair.ok.requests[0]).toMatchObject({ host: `ok.test:${pair.port}`, servername: 'ok.test' });
  });

  it('keeps certificate validation on', async () => {
    const pair = await startServerPair({ tls: true });
    cleanups.push(() => pair.close());
    const { proxyFetch } = await setup();

    const error = await proxyFetch(`https://wrong.test:${pair.port}/`).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(findGuardError(error)).toBeUndefined();
    expect(pair.ok.requests).toHaveLength(0);
  });

  it('throws a blocked address error for a blocked destination', async () => {
    const pair = await startServerPair();
    cleanups.push(() => pair.close());
    const { proxyFetch } = await setup();

    const error = await proxyFetch(`http://evil.test:${pair.port}/`).catch((e) => e);

    expect(findGuardError(error)).toBeInstanceOf(BlockedAddressError);
    expect(pair.evil.connections).toBe(0);
  });

  it('throws an unverified destination error when the host does not resolve', async () => {
    const { proxyFetch } = await setup();
    const error = await proxyFetch('https://nope.test/').catch((e) => e);
    expect(findGuardError(error)).toBeInstanceOf(UnverifiedDestinationError);
  });

  it('stops a real redirect chain at the blocked hop', async () => {
    const pair = await startServerPair({
      okHandler: (request, response) => {
        response.writeHead(302, { location: `http://evil.test:${pair.port}/steal` });
        response.end();
      }
    });
    cleanups.push(() => pair.close());
    const { guard, proxyFetch } = await setup();
    const guarded = createGuardedFetch(proxyFetch, guard);

    const error = await guarded(`http://ok.test:${pair.port}/start`).catch((e) => e);

    expect(findGuardError(error)).toBeInstanceOf(BlockedAddressError);
    expect(pair.evil.connections).toBe(0);
  });

  it('does not blame a later unrelated failure on an earlier refusal', async () => {
    const pair = await startServerPair({
      okHandler: (request) => {
        request.socket.destroy();
      }
    });
    cleanups.push(() => pair.close());
    const { proxyFetch } = await setup();

    await proxyFetch(`http://evil.test:${pair.port}/`).catch(() => undefined);
    const error = await proxyFetch(`http://ok.test:${pair.port}/`).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(findGuardError(error)).toBeUndefined();
  });

  it('trusts only the refusal whose sequence number the blocked header names', async () => {
    let flipToBlocked = false;
    const lookup = vi.fn(async (host: string) => {
      if (host !== 'ok.test') throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
      return [{ address: flipToBlocked ? '127.0.0.2' : '127.0.0.1', family: 4 }];
    });
    const guard = createNetworkGuard({ allowRanges: ['127.0.0.1/32'] }, { lookup });
    const proxy = await startGuardProxy({ guard });
    cleanups.push(() => proxy.close());
    const proxyFetch = createGuardProxyFetch(async () => proxy);
    let port = 0;

    const pair = await startServerPair({
      okHandler: async (request, response) => {
        if (request.url === '/spoof') {
          // A refusal for the same host lands while this call is in flight.
          flipToBlocked = true;
          await proxyFetch(`http://ok.test:${port}/other`).catch(() => undefined);
          flipToBlocked = false;
          response.writeHead(200, { 'x-pi-web-agent-blocked': 'BLOCKED_PRIVATE_ADDRESS 99999 x' });
          response.end('fine');
          return;
        }
        response.end('ok');
      }
    });
    cleanups.push(() => pair.close());
    port = pair.port;

    const response = await proxyFetch(`http://ok.test:${port}/spoof`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('fine');
  });

  it('closes its agent and refuses later calls', async () => {
    const pair = await startServerPair();
    cleanups.push(() => pair.close());
    const { proxyFetch } = await setup();

    await proxyFetch(`http://ok.test:${pair.port}/`);
    await proxyFetch.close();
    await proxyFetch.close();

    await expect(proxyFetch(`http://ok.test:${pair.port}/`)).rejects.toThrow('closed');
  });

  it('does not start the proxy when closed before first use', async () => {
    const getProxy = vi.fn();
    const proxyFetch = createGuardProxyFetch(getProxy);

    await proxyFetch.close();

    expect(getProxy).not.toHaveBeenCalled();
  });

  it('retries getProxy after a failed attempt instead of caching the rejection', async () => {
    const pair = await startServerPair();
    cleanups.push(() => pair.close());
    const guard = createNetworkGuard({ allowRanges: ['127.0.0.1/32'] }, { lookup: fakeLookup(table) });
    const proxy = await startGuardProxy({ guard });
    cleanups.push(() => proxy.close());

    const getProxy = vi.fn().mockRejectedValueOnce(new Error('listen EADDRINUSE')).mockResolvedValueOnce(proxy);
    const proxyFetch = createGuardProxyFetch(getProxy, { tls: { ca: FIXTURE_CERT } });

    await expect(proxyFetch(`http://ok.test:${pair.port}/`)).rejects.toThrow('listen EADDRINUSE');
    expect(getProxy).toHaveBeenCalledTimes(1);

    const response = await proxyFetch(`http://ok.test:${pair.port}/`);

    expect(response.status).toBe(200);
    expect(getProxy).toHaveBeenCalledTimes(2);
  });

  describe('through an upstream proxy', () => {
    it('sends the approved IP upstream while the destination sees the original Host and SNI', async () => {
      const pair = await startServerPair({ tls: true });
      const upstream = await startRecordingUpstream();
      cleanups.push(() => pair.close(), () => upstream.close());
      const { proxyFetch } = await setup({ upstream: { url: upstream.url } });

      const response = await proxyFetch(`https://ok.test:${pair.port}/`);

      expect(response.status).toBe(200);
      expect(upstream.targets).toEqual([`127.0.0.1:${pair.port}`]);
      expect(pair.ok.requests[0]).toMatchObject({ host: `ok.test:${pair.port}`, servername: 'ok.test' });
    });

    it('reports an upstream that rejects IP destinations and never retries by hostname', async () => {
      const upstream = await startRecordingUpstream({ rejectIpTargets: true, resolve: { 'ok.test': '127.0.0.1' } });
      cleanups.push(() => upstream.close());
      const { proxyFetch } = await setup({ upstream: { url: upstream.url } });

      // Not :9, which fetch refuses locally as a bad port before any proxy is involved.
      const error = await proxyFetch('https://ok.test:8443/').catch((e) => e);

      expect(findGuardError(error)).toBeInstanceOf(UpstreamProxyRefusedError);
      expect(upstream.targets).toEqual(['127.0.0.1:8443']);
    });
  });
});
