import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect as netConnect, createServer as createNetServer, isIP, type AddressInfo, type Socket } from 'node:net';
import path from 'node:path';

export const FIXTURE_CERT = readFileSync(path.join(process.cwd(), 'tests/fixtures/guard-proxy/cert.pem'));
export const FIXTURE_KEY = readFileSync(path.join(process.cwd(), 'tests/fixtures/guard-proxy/key.pem'));

export const READABLE_PAGE =
  '<html><body><article><p>Fixture page with plenty of readable text so extraction succeeds here.</p></article></body></html>';

export type SeenRequest = { host?: string; servername?: string; url?: string; headers?: Record<string, unknown> };

export type FixtureServer = {
  port: number;
  readonly connections: number;
  /** Completed WebSocket upgrades (only with `websocket: true`). */
  readonly upgrades: number;
  requests: SeenRequest[];
  close(): Promise<void>;
};

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

/** Counts TCP connections, so "zero connections" really means nothing reached it. */
export async function startFixtureServer(options: {
  address: string;
  port?: number;
  tls?: boolean;
  websocket?: boolean;
  handler?: Handler;
}): Promise<FixtureServer> {
  const requests: SeenRequest[] = [];
  const state = { connections: 0, upgrades: 0 };
  const sockets = new Set<Socket>();

  const handle: Handler = (request, response) => {
    requests.push({
      host: request.headers.host,
      servername: (request.socket as { servername?: string }).servername || undefined,
      url: request.url,
      headers: { ...request.headers }
    });
    if (options.handler) {
      options.handler(request, response);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(READABLE_PAGE);
  };

  const server = options.tls ? createHttpsServer({ cert: FIXTURE_CERT, key: FIXTURE_KEY }, handle) : createHttpServer(handle);
  server.on('connection', (socket: Socket) => {
    state.connections += 1;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  if (options.websocket) {
    // Minimal RFC 6455 handshake; the socket is kept open and never sends frames.
    server.on('upgrade', (request: IncomingMessage, socket: Socket) => {
      state.upgrades += 1;
      const accept = createHash('sha1')
        .update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest('base64');
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
      );
    });
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, options.address, () => resolve());
  });

  return {
    port: (server.address() as AddressInfo).port,
    get connections() {
      return state.connections;
    },
    get upgrades() {
      return state.upgrades;
    },
    requests,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

/**
 * An allowed server on 127.0.0.1 and a blocked one on 127.0.0.2, same port, so
 * the only difference between them is which address a hostname maps to.
 */
export async function startServerPair(
  options: { tls?: boolean; websocket?: boolean; okHandler?: Handler; evilHandler?: Handler } = {}
) {
  const evil = await startFixtureServer({
    address: '127.0.0.2',
    tls: options.tls,
    websocket: options.websocket,
    handler: options.evilHandler
  });
  const ok = await startFixtureServer({
    address: '127.0.0.1',
    port: evil.port,
    tls: options.tls,
    websocket: options.websocket,
    handler: options.okHandler
  });
  return {
    ok,
    evil,
    port: evil.port,
    async close() {
      await ok.close();
      await evil.close();
    }
  };
}

export type RecordingUpstream = { url: string; targets: string[]; heads: string[]; close(): Promise<void> };

/**
 * A stand-in for the user's upstream proxy. Records the CONNECT authority or
 * absolute-form host it was asked for, then connects. Hostnames are resolved
 * only through `resolve`, never real DNS.
 */
export async function startRecordingUpstream(
  options: { rejectIpTargets?: boolean; resolve?: Record<string, string> } = {}
): Promise<RecordingUpstream> {
  const targets: string[] = [];
  const heads: string[] = [];
  const sockets = new Set<Socket>();
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
  };

  const server = createNetServer((client) => {
    track(client);
    let buffered = Buffer.alloc(0);

    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf('\r\n\r\n');
      if (end === -1) return;
      client.off('data', onData);

      const head = buffered.subarray(0, end).toString('latin1');
      const rest = buffered.subarray(end + 4);
      const [method, target] = head.split('\r\n')[0].split(' ');
      heads.push(head);

      if (method === 'CONNECT') {
        targets.push(target);
        const match = /^\[?([^\]]+?)\]?:(\d+)$/.exec(target);
        if (!match) {
          client.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n');
          return;
        }
        const host = match[1];
        if (options.rejectIpTargets && isIP(host)) {
          client.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
          return;
        }
        const address = isIP(host) ? host : options.resolve?.[host];
        if (!address) {
          client.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
          return;
        }
        const outbound = netConnect({ host: address, port: Number(match[2]) }, () => {
          client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (rest.length) outbound.write(rest);
          outbound.pipe(client);
          client.pipe(outbound);
        });
        track(outbound);
        outbound.on('error', () => client.destroy());
        return;
      }

      const url = new URL(target);
      targets.push(url.host);
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      const address = isIP(hostname) ? hostname : options.resolve?.[hostname];
      if (!address) {
        client.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
        return;
      }
      const outbound = netConnect({ host: address, port: Number(url.port) || 80 }, () => {
        outbound.write(`${head.replace(/^(\S+) \S+ /, `$1 ${url.pathname}${url.search} `)}\r\n\r\n`);
        if (rest.length) outbound.write(rest);
        outbound.pipe(client);
        client.pipe(outbound);
      });
      track(outbound);
      outbound.on('error', () => client.destroy());
    };

    client.on('data', onData);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    targets,
    heads,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

/** Sends a raw CONNECT and returns the proxy's status line and headers. */
export async function rawConnect(
  proxyUrl: string,
  authority: string,
  auth?: { username: string; password: string }
): Promise<{ status: number; head: string; socket: Socket }> {
  const url = new URL(proxyUrl);
  const socket = netConnect({ host: url.hostname, port: Number(url.port) });
  socket.on('error', () => undefined);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('error', reject);
  });

  const authLine = auth
    ? `Proxy-Authorization: Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}\r\n`
    : '';
  socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${authLine}\r\n`);

  return new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf('\r\n\r\n');
      if (end === -1) return;
      socket.off('data', onData);
      const head = buffered.subarray(0, end).toString('latin1');
      resolve({ status: Number(/^HTTP\/1\.[01] (\d{3})/.exec(head)?.[1] ?? 0), head, socket });
    };
    socket.on('data', onData);
    socket.once('close', () => reject(new Error('proxy closed before responding')));
  });
}
