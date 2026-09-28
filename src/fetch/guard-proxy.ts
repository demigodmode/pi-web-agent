import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse
} from 'node:http';
import { connect as netConnect, isIP, type AddressInfo, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { decideDestination, type Destination } from './destination-policy.js';
import {
  UnverifiedDestinationError,
  UpstreamProxyRefusedError,
  type GuardError,
  type NetworkGuard
} from './network-guard.js';

/**
 * Enforces the private-address policy where connections are opened (#53, spec
 * revision 2). Every model-chosen connection, from Node or from Chromium, goes
 * through here: the destination is resolved once, every answer is checked, and
 * the socket is opened to an approved IP. Nothing downstream resolves the
 * hostname again, so a redirect or a DNS change cannot move the connection.
 *
 * Listens on loopback only and requires per-start credentials, so it is not an
 * open egress proxy for other local processes. It is an owned resource: call
 * close() to stop it. unref() only keeps an idle listener from holding the
 * process open.
 */

export const BLOCKED_HEADER = 'x-pi-web-agent-blocked';

const MAX_REFUSALS = 500;
const DEFAULT_TIMEOUT_MS = 10_000;

export type UpstreamProxy = { url: string; username?: string; password?: string };

export type OpenSocket = (host: string, port: number, useTls: boolean, servername?: string) => Socket;

export type GuardProxyOptions = {
  guard: NetworkGuard;
  upstream?: UpstreamProxy;
  trustProxyDns?: boolean;
  /** TLS options for an https:// upstream proxy connection. */
  upstreamTls?: { ca?: string | Buffer; rejectUnauthorized?: boolean };
  /** Outbound sockets (direct or to the upstream) must connect within this. */
  connectTimeoutMs?: number;
  /** Client request/CONNECT headers and the upstream CONNECT response must arrive within this. */
  handshakeTimeoutMs?: number;
  /** Test seam for creating outbound sockets. */
  openSocket?: OpenSocket;
};

export type GuardProxyClient = { server: string; username: string; password: string };

/** Thrown when the client left while a connect or handshake was still pending. Never surfaced to the client. */
class ClientGoneError extends Error {
  constructor() {
    super('Client disconnected while connecting.');
    this.name = 'ClientGoneError';
  }
}

export type Refusal = { seq: number; client: string; host: string; error: GuardError };

export type GuardProxy = {
  url: string;
  /** Credentials for one client. Refusals are recorded against its username. */
  client(name?: string): GuardProxyClient;
  sequence(): number;
  refusalsSince(username: string, seq: number): Refusal[];
  /** Idempotent. Stops the listener and destroys every socket, including ones still connecting. */
  close(): Promise<void>;
};

const HOSTNAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.?$/;

/**
 * Strict on purpose: in trust mode an unresolvable name is delegated upstream
 * verbatim, so anything that is not a plain IP or DNS name (userinfo, zone ids,
 * percent-encoding, paths) must never get that far.
 */
function parseAuthority(authority: string): { host: string; port: number } | undefined {
  const match = /^\[([^\]]+)\]:(\d{1,5})$/.exec(authority) ?? /^([^:[\]]+):(\d{1,5})$/.exec(authority);
  if (!match) return undefined;
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  const host = match[1];
  const bracketed = authority.startsWith('[');
  if (bracketed) {
    if (isIP(host) !== 6) return undefined;
  } else if (isIP(host) !== 4 && (host.length > 253 || !HOSTNAME.test(host))) {
    return undefined;
  }
  return { host, port };
}

const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-connection', 'proxy-authorization', 'te', 'trailer', 'upgrade'];

/** Removes hop-by-hop headers, including any named in Connection. Returns a copy. */
function stripHopByHop<T extends Record<string, unknown>>(headers: T, keep: string[] = []): T {
  const copy: Record<string, unknown> = { ...headers };
  const named = String(headers.connection ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  for (const name of [...HOP_BY_HOP, ...named]) {
    if (!keep.includes(name)) delete copy[name];
  }
  return copy as T;
}

function formatAuthority(host: string, port: number): string {
  return isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`;
}

function headerValue(error: GuardError, seq: number): string {
  // `<code> <seq> <message>`; the seq lets the Node fetch match this exact refusal.
  // Encoded so a hostile hostname cannot inject headers.
  return `${error.code} ${seq} ${encodeURIComponent(error.message)}`;
}

function upstreamAuthorization(upstream: UpstreamProxy): string | undefined {
  if (!upstream.username) return undefined;
  return `Basic ${Buffer.from(`${upstream.username}:${upstream.password ?? ''}`).toString('base64')}`;
}

export async function startGuardProxy(options: GuardProxyOptions): Promise<GuardProxy> {
  const {
    guard,
    upstream,
    trustProxyDns = false,
    upstreamTls,
    connectTimeoutMs = DEFAULT_TIMEOUT_MS,
    handshakeTimeoutMs = DEFAULT_TIMEOUT_MS
  } = options;
  const password = randomBytes(24).toString('hex');
  const passwordBuffer = Buffer.from(password);
  const sockets = new Set<Socket>();
  const refusals: Refusal[] = [];
  let seq = 0;
  let clientCounter = 0;
  let closed = false;
  let closing: Promise<void> | undefined;

  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    if (closed) socket.destroy();
  };

  const defaultOpenSocket: OpenSocket = (host, port, useTls, servername) =>
    useTls
      ? tlsConnect({ host, port, ...(servername ? { servername } : {}), ...upstreamTls })
      : netConnect({ host, port });

  function authenticate(header: string | undefined): string | undefined {
    if (!header?.startsWith('Basic ')) return undefined;
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator <= 0) return undefined;
    const candidate = Buffer.from(decoded.slice(separator + 1));
    if (candidate.length !== passwordBuffer.length || !timingSafeEqual(candidate, passwordBuffer)) return undefined;
    return decoded.slice(0, separator);
  }

  /** Records the refusal and returns the header value that names it. */
  function refuse(client: string, host: string, error: GuardError): string {
    seq += 1;
    refusals.push({ seq, client, host, error });
    if (refusals.length > MAX_REFUSALS) refusals.splice(0, refusals.length - MAX_REFUSALS);
    return headerValue(error, seq);
  }

  async function decide(host: string): Promise<Destination> {
    // Resolution is bounded by the guard's own lookup timeout, and an unresolved
    // result still goes through the policy (a trusted upstream may take it).
    try {
      return await decideDestination(host, guard, { upstream: Boolean(upstream), trustProxyDns });
    } catch {
      return { action: 'refuse', error: new UnverifiedDestinationError(host) };
    }
  }

  function upstreamEndpoint() {
    const url = new URL((upstream as UpstreamProxy).url);
    return {
      url,
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80)
    };
  }

  /** Tracked from creation, so close() also destroys sockets that are still connecting. */
  function openSocket(host: string, port: number, useTls: boolean, servername?: string, signal?: AbortSignal): Promise<Socket> {
    if (closed) return Promise.reject(new Error('Guard proxy is closed.'));
    if (signal?.aborted) return Promise.reject(new ClientGoneError());
    const socket = (options.openSocket ?? defaultOpenSocket)(host, port, useTls, servername);
    track(socket);
    const connectEvent = useTls ? 'secureConnect' : 'connect';

    return new Promise((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        socket.off(connectEvent, onConnect);
        socket.off('error', onError);
        socket.off('close', onClose);
        signal?.removeEventListener('abort', onAbort);
      };
      const onConnect = () => {
        finish();
        resolve(socket);
      };
      const onError = (error: Error) => {
        finish();
        socket.destroy();
        reject(error);
      };
      const onClose = () => {
        finish();
        reject(new Error(`Connection to ${host}:${port} closed before it opened.`));
      };
      const onAbort = () => {
        finish();
        socket.destroy();
        reject(new ClientGoneError());
      };
      const timer = setTimeout(() => {
        finish();
        socket.destroy();
        reject(new Error(`Timed out connecting to ${host}:${port}.`));
      }, connectTimeoutMs);
      socket.once(connectEvent, onConnect);
      socket.once('error', onError);
      socket.once('close', onClose);
      signal?.addEventListener('abort', onAbort);
    });
  }

  function readConnectResponse(socket: Socket, signal?: AbortSignal): Promise<{ status: number; rest: Buffer }> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new ClientGoneError());
        return;
      }
      let buffered = Buffer.alloc(0);
      const finish = () => {
        clearTimeout(timer);
        socket.off('data', onData);
        socket.off('error', onError);
        socket.off('close', onClose);
        signal?.removeEventListener('abort', onAbort);
      };
      const onData = (chunk: Buffer) => {
        buffered = Buffer.concat([buffered, chunk]);
        const end = buffered.indexOf('\r\n\r\n');
        if (end === -1) {
          if (buffered.length > 16 * 1024) {
            finish();
            reject(new Error('Upstream proxy sent an oversized CONNECT response.'));
          }
          return;
        }
        finish();
        const statusLine = buffered.subarray(0, buffered.indexOf('\r\n')).toString('latin1');
        resolve({
          status: Number(/^HTTP\/1\.[01] (\d{3})/.exec(statusLine)?.[1] ?? 0),
          rest: buffered.subarray(end + 4)
        });
      };
      const onError = (error: Error) => {
        finish();
        reject(error);
      };
      const onClose = () => {
        finish();
        reject(new Error('Upstream proxy closed the connection before responding.'));
      };
      const onAbort = () => {
        finish();
        reject(new ClientGoneError());
      };
      const timer = setTimeout(() => {
        finish();
        reject(new Error('Upstream proxy did not answer the CONNECT in time.'));
      }, handshakeTimeoutMs);
      socket.on('data', onData);
      socket.once('error', onError);
      socket.once('close', onClose);
      signal?.addEventListener('abort', onAbort);
    });
  }

  async function openTunnel(
    destination: Exclude<Destination, { action: 'refuse' }>,
    port: number,
    signal?: AbortSignal
  ): Promise<Socket> {
    const target = destination.action === 'connect' ? destination.address : destination.host;

    if (!upstream) {
      // Only 'connect' reaches here: delegation needs an upstream. `target` is an IP, so no lookup happens.
      return openSocket(target, port, false, undefined, signal);
    }

    const endpoint = upstreamEndpoint();
    const authority = formatAuthority(target, port);
    let socket: Socket;
    try {
      socket = await openSocket(
        endpoint.host,
        endpoint.port,
        endpoint.url.protocol === 'https:',
        isIP(endpoint.host) ? undefined : endpoint.host,
        signal
      );
    } catch (error) {
      if (error instanceof ClientGoneError) throw error;
      throw new UpstreamProxyRefusedError(destination.host, authority, error instanceof Error ? error.message : 'error');
    }

    const authorization = upstreamAuthorization(upstream);
    socket.write(
      `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n` +
        `${authorization ? `Proxy-Authorization: ${authorization}\r\n` : ''}\r\n`
    );

    let response: { status: number; rest: Buffer };
    try {
      response = await readConnectResponse(socket, signal);
    } catch (error) {
      socket.destroy();
      if (error instanceof ClientGoneError) throw error;
      throw new UpstreamProxyRefusedError(destination.host, authority, error instanceof Error ? error.message : 'error');
    }
    if (response.status < 200 || response.status >= 300) {
      socket.destroy();
      // No retry by hostname: that would hand resolution back to the upstream.
      throw new UpstreamProxyRefusedError(destination.host, authority, response.status);
    }
    if (response.rest.length) socket.unshift(response.rest);
    return socket;
  }

  const server = createServer({
    headersTimeout: handshakeTimeoutMs,
    // No overall request limit: downloads can legitimately be slow.
    requestTimeout: 0,
    // Node only checks headersTimeout on this interval, so keep it short enough to matter.
    connectionsCheckingInterval: Math.max(50, Math.min(1000, Math.floor(handshakeTimeoutMs / 2)))
  });

  server.on('connection', (socket: Socket) => track(socket));

  server.on('connect', async (request: IncomingMessage, clientSocket: Socket, head: Buffer) => {
    clientSocket.on('error', () => undefined);

    const client = authenticate(request.headers['proxy-authorization']);
    if (!client) {
      clientSocket.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="pi-web-agent"\r\nContent-Length: 0\r\n\r\n'
      );
      return;
    }

    const authority = parseAuthority(request.url ?? '');
    if (!authority) {
      clientSocket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n');
      return;
    }

    const destination = await decide(authority.host);
    // The lookup can take seconds. A client that left meanwhile (a cancelled
    // fetch) must not get an outbound connection opened on its behalf.
    if (closed || clientSocket.destroyed || clientSocket.readableEnded) {
      // Still record a would-be refusal so headless can attribute the failed
      // navigation to the guard, even though there's no one left to answer.
      if (destination.action === 'refuse') refuse(client, destination.error.host, destination.error);
      clientSocket.destroy();
      return;
    }
    if (destination.action === 'refuse') {
      const blocked = refuse(client, destination.error.host, destination.error);
      clientSocket.end(
        `HTTP/1.1 403 Forbidden\r\n${BLOCKED_HEADER}: ${blocked}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`
      );
      return;
    }

    // The connect (and, with an upstream, the handshake) can also take a while.
    // If the client leaves meanwhile, abort it instead of waiting out the timeout.
    const tunnelAbort = new AbortController();
    const onClientGone = () => tunnelAbort.abort();
    if (clientSocket.destroyed || clientSocket.readableEnded) {
      tunnelAbort.abort();
    } else {
      clientSocket.once('close', onClientGone);
      clientSocket.once('end', onClientGone);
    }

    let outbound: Socket;
    try {
      outbound = await openTunnel(destination, authority.port, tunnelAbort.signal);
    } catch (error) {
      clientSocket.off('close', onClientGone);
      clientSocket.off('end', onClientGone);
      if (closed || error instanceof ClientGoneError) {
        clientSocket.destroy();
        return;
      }
      if (error instanceof UpstreamProxyRefusedError) {
        const blocked = refuse(client, destination.host, error);
        clientSocket.end(
          `HTTP/1.1 502 Bad Gateway\r\n${BLOCKED_HEADER}: ${blocked}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`
        );
        return;
      }
      clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
      return;
    }
    clientSocket.off('close', onClientGone);
    clientSocket.off('end', onClientGone);

    if (closed || clientSocket.destroyed || clientSocket.readableEnded) {
      outbound.destroy();
      clientSocket.destroy();
      return;
    }

    outbound.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => outbound.destroy());
    outbound.on('close', () => clientSocket.destroy());
    clientSocket.on('close', () => outbound.destroy());
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) outbound.write(head);
    outbound.pipe(clientSocket);
    clientSocket.pipe(outbound);
  });

  server.on('request', async (request: IncomingMessage, response: ServerResponse) => {
    const client = authenticate(request.headers['proxy-authorization']);
    if (!client) {
      response.writeHead(407, { 'proxy-authenticate': 'Basic realm="pi-web-agent"', 'content-length': '0' }).end();
      return;
    }

    let target: URL;
    try {
      target = new URL(request.url ?? '');
    } catch {
      response.writeHead(400, { 'content-length': '0' }).end();
      return;
    }
    if (target.protocol !== 'http:') {
      response.writeHead(400, { 'content-length': '0' }).end();
      return;
    }

    const host = target.hostname.replace(/^\[|\]$/g, '');
    const port = Number(target.port) || 80;
    const destination = await decide(host);
    if (closed || response.destroyed) {
      // Still record a would-be refusal so headless can attribute the failed
      // navigation to the guard, even though there's no one left to answer.
      if (destination.action === 'refuse') refuse(client, destination.error.host, destination.error);
      response.destroy();
      return;
    }
    if (destination.action === 'refuse') {
      const blocked = refuse(client, destination.error.host, destination.error);
      response.writeHead(403, { [BLOCKED_HEADER]: blocked, 'content-length': '0' }).end();
      return;
    }

    const headers: OutgoingHttpHeaders = stripHopByHop({ ...request.headers });
    const path = `${target.pathname}${target.search}`;
    const address = destination.action === 'connect' ? destination.address : destination.host;
    const endpoint = upstream ? upstreamEndpoint() : undefined;
    const useTls = endpoint?.url.protocol === 'https:';

    // The socket is opened (and timed, and tracked) here, then handed to http.request.
    // If the client leaves while that connect is pending, abort it rather than waiting it out.
    const openAbort = new AbortController();
    const onResponseGone = () => openAbort.abort();
    if (response.destroyed) {
      openAbort.abort();
    } else {
      response.once('close', onResponseGone);
    }

    let socket: Socket;
    try {
      socket = endpoint
        ? await openSocket(endpoint.host, endpoint.port, useTls, isIP(endpoint.host) ? undefined : endpoint.host, openAbort.signal)
        : await openSocket(address, port, false, undefined, openAbort.signal);
    } catch (error) {
      response.off('close', onResponseGone);
      if (closed || error instanceof ClientGoneError) {
        response.destroy();
        return;
      }
      if (upstream) {
        const refusal = new UpstreamProxyRefusedError(
          destination.host,
          formatAuthority(address, port),
          error instanceof Error ? error.message : 'error'
        );
        const blocked = refuse(client, destination.host, refusal);
        response.writeHead(502, { [BLOCKED_HEADER]: blocked, 'content-length': '0' }).end();
        return;
      }
      response.writeHead(502, { 'content-length': '0' }).end();
      return;
    }
    response.off('close', onResponseGone);

    if (closed || response.destroyed) {
      // The client left while the socket was opening: nothing will ever close it otherwise.
      socket.destroy();
      response.destroy();
      return;
    }

    const authorization = upstream ? upstreamAuthorization(upstream) : undefined;
    // Plain http.request even for an https upstream: the socket is already TLS.
    const outbound = httpRequest({
      createConnection: () => socket,
      method: request.method,
      path: endpoint ? `http://${formatAuthority(address, port)}${path}` : path,
      headers: { ...headers, ...(authorization ? { 'proxy-authorization': authorization } : {}) },
      // No `agent`: with agent: false Node builds a fresh Agent and ignores createConnection.
      setHost: false
    });

    outbound.on('response', (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, stripHopByHop({ ...upstreamResponse.headers }));
      // pipe() doesn't carry an aborted body over: the client would wait forever
      // for the rest. Cut it off the same way the destination did.
      const abort = () => {
        response.destroy();
        socket.destroy();
      };
      upstreamResponse.on('error', abort);
      upstreamResponse.on('close', () => {
        if (!upstreamResponse.complete) abort();
      });
      upstreamResponse.pipe(response);
    });
    // Drop the client connection like the destination did, rather than inventing a 502
    // (or ending a truncated body as if it were complete).
    outbound.on('error', () => response.destroy());
    response.on('close', () => socket.destroy());
    request.pipe(outbound);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  server.unref();

  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    url,
    client(name = 'client') {
      clientCounter += 1;
      return { server: url, username: `${name}-${clientCounter}-${randomBytes(4).toString('hex')}`, password };
    },
    sequence: () => seq,
    refusalsSince: (username, since) => refusals.filter((entry) => entry.client === username && entry.seq > since),
    close() {
      if (closing) return closing;
      closed = true;
      closing = new Promise<void>((resolve) => {
        server.close(() => resolve());
        for (const socket of sockets) socket.destroy();
      });
      return closing;
    }
  };
}
