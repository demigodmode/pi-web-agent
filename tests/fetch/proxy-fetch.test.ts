import { readFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createProxyFetch, resolveProxyCredentials } from '../../src/fetch/proxy-fetch.js';

type ProxyRequest = { url: string; method: string; proxyAuthorization?: string };

type StartedServer = { port: number; close: () => Promise<void> };

type ProxyServer = StartedServer & { requests: ProxyRequest[]; connects: string[] };

type RequestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

async function startHttpServer(handler: RequestHandler): Promise<StartedServer> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return { port, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

async function startHttpsServer(handler: RequestHandler): Promise<StartedServer> {
  const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'proxy');
  const key = await readFile(path.join(fixtureDir, 'self-signed.key'), 'utf8');
  const cert = await readFile(path.join(fixtureDir, 'self-signed.crt'), 'utf8');
  const server = https.createServer({ key, cert }, handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return { port, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

async function startProxyServer(): Promise<ProxyServer> {
  const requests: ProxyRequest[] = [];
  const connects: string[] = [];
  const server = http.createServer((req, res) => {
    const targetUrl = req.url ?? '';
    requests.push({ url: targetUrl, method: req.method ?? 'GET', proxyAuthorization: req.headers['proxy-authorization'] });
    const target = new URL(targetUrl);
    // Test fixture: only ever forward to the local test servers.
    if (target.hostname !== '127.0.0.1') {
      res.writeHead(403).end();
      return;
    }
    const upstream = http.request(
      target,
      { method: req.method, headers: { ...req.headers, host: target.host } },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 500, upstreamRes.headers);
        upstreamRes.pipe(res);
      }
    );
    upstream.on('error', () => res.destroy());
    req.pipe(upstream);
  });
  server.on('connect', (req, socket, head) => {
    const target = req.url ?? '';
    connects.push(target);
    const [host, port] = target.split(':');
    if (host !== '127.0.0.1') {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const upstream = net.connect(Number(port) || 443, host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    requests,
    connects,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

describe('proxy fetch', () => {
  let cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.map((cleanup) => cleanup()));
    cleanups = [];
  });

  it('routes requests through the local proxy', async () => {
    const target = await startHttpServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`hello from target: ${req.url}`);
    });
    const proxy = await startProxyServer();
    cleanups.push(target.close, proxy.close);

    const fetchViaProxy = createProxyFetch({ url: `http://127.0.0.1:${proxy.port}` });
    const response = await fetchViaProxy(`http://127.0.0.1:${target.port}/hello`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('hello from target: /hello');
    expect(proxy.requests).toHaveLength(1);
    expect(proxy.requests[0].url).toBe(`http://127.0.0.1:${target.port}/hello`);
  });

  it('tunnels https requests through the proxy using CONNECT', async () => {
    const target = await startHttpsServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`secure hello: ${req.url}`);
    });
    const proxy = await startProxyServer();
    cleanups.push(target.close, proxy.close);

    const fetchViaProxy = createProxyFetch({ url: `http://127.0.0.1:${proxy.port}` }, {
      tls: { rejectUnauthorized: false }
    });
    const response = await fetchViaProxy(`https://127.0.0.1:${target.port}/secure`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('secure hello: /secure');
    expect(proxy.connects).toEqual([`127.0.0.1:${target.port}`]);
    expect(proxy.requests).toHaveLength(0);
  });

  it('sends proxy credentials as a Basic authorization header to the proxy', async () => {
    const target = await startHttpServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    const proxy = await startProxyServer();
    cleanups.push(target.close, proxy.close);

    const fetchViaProxy = createProxyFetch({
      url: `http://127.0.0.1:${proxy.port}`,
      username: 'user',
      password: 'secret'
    });
    const response = await fetchViaProxy(`http://127.0.0.1:${target.port}/auth`);

    expect(response.status).toBe(200);
    expect(proxy.requests[0].proxyAuthorization).toBe(`Basic ${Buffer.from('user:secret').toString('base64')}`);
  });

  it('ignores credentials embedded in the proxy url', async () => {
    const target = await startHttpServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    const proxy = await startProxyServer();
    cleanups.push(target.close, proxy.close);

    // Credentials in the URL must be stripped, never sent to the proxy.
    const fetchViaProxy = createProxyFetch({ url: `http://urluser:urlpass@127.0.0.1:${proxy.port}` });
    const response = await fetchViaProxy(`http://127.0.0.1:${target.port}/noauth`);

    expect(response.status).toBe(200);
    expect(proxy.requests).toHaveLength(1);
    expect(proxy.requests[0].proxyAuthorization).toBeUndefined();
  });

  it('resolves credentials from the config first, then environment variables', () => {
    const env = {
      PI_WEB_AGENT_PROXY_USERNAME: 'env-user',
      PI_WEB_AGENT_PROXY_PASSWORD: 'env-pass'
    };

    expect(resolveProxyCredentials({ url: 'http://127.0.0.1:7890' }, env)).toEqual({
      username: 'env-user',
      password: 'env-pass'
    });

    expect(
      resolveProxyCredentials({ url: 'http://127.0.0.1:7890', username: 'cfg', password: 'cfg-pass' }, env)
    ).toEqual({ username: 'cfg', password: 'cfg-pass' });

    expect(resolveProxyCredentials({ url: 'http://127.0.0.1:7890' }, {})).toEqual({});
  });
});
