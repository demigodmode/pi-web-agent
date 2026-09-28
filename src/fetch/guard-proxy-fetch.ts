import { ProxyAgent, fetch as undiciFetch } from 'undici';
import type { GuardProxy, GuardProxyClient } from './guard-proxy.js';
import { BLOCKED_HEADER } from './guard-proxy.js';
import { abortError, throwIfAborted } from '../abort.js';

function hostOf(input: Parameters<typeof fetch>[0]): string | undefined {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  try {
    return new URL(raw).hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.+$/, '');
  } catch {
    return undefined;
  }
}

/**
 * Model-chosen Node fetches connect through the guard proxy, which is where the
 * address policy is enforced. A refusal comes back as a 403/502 on the tunnel
 * or the forwarded request; the proxy's refusal log turns that into the typed
 * guard error. Only refusals recorded during this call count, so an earlier
 * block can't be blamed for a later unrelated failure.
 *
 * Each call gets its own ProxyAgent (undici builds the CONNECT tunnel inside
 * the agent's connector, and aborting a dispatched request doesn't reach in
 * and destroy that tunnel socket — see #59). Tying the agent's lifetime to the
 * call means an aborted call can destroy just its own agent, which is what
 * actually makes the guard proxy notice the client left and tear down its side
 * of the chain to the upstream proxy.
 */
export type GuardProxyFetch = typeof fetch & {
  /** Closes any in-flight agents and rejects later calls. Idempotent. */
  close(): Promise<void>;
};

export function createGuardProxyFetch(
  getProxy: () => Promise<GuardProxy>,
  { tls }: { tls?: { ca?: string | Buffer } } = {}
): GuardProxyFetch {
  let ready: Promise<{ proxy: GuardProxy; client: GuardProxyClient }> | undefined;
  let closed = false;
  const inFlight = new Set<ProxyAgent>();

  const ensure = () => {
    if (ready) return ready;
    const started = getProxy().then((proxy) => {
      const client = proxy.client('node');
      return { proxy, client };
    });
    ready = started;
    // Don't let one failed attempt poison every later fetch: clear it so the
    // next call retries, unless a newer attempt has already replaced it.
    started.catch(() => {
      if (ready === started) ready = undefined;
    });
    return started;
  };

  const guardedFetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (closed) throw new Error('Guard proxy fetch is closed.');
    const signal = init?.signal ?? undefined;
    throwIfAborted(signal ?? undefined);
    const { proxy, client } = await ensure();
    if (closed) throw new Error('Guard proxy fetch is closed.');
    throwIfAborted(signal ?? undefined);
    const host = hostOf(input);
    const since = proxy.sequence();

    const refusalFor = () =>
      proxy
        .refusalsSince(client.username, since)
        .reverse()
        .find((entry) => host === undefined || entry.host === host);

    const agent = new ProxyAgent({
      uri: client.server,
      token: `Basic ${Buffer.from(`${client.username}:${client.password}`).toString('base64')}`,
      ...(tls ? { requestTls: tls } : {})
    });
    inFlight.add(agent);

    let onAbort: (() => void) | undefined;
    if (signal) {
      onAbort = () => {
        agent.destroy().catch(() => undefined);
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }

    let response: Response;
    try {
      response = (await undiciFetch(
        input as Parameters<typeof undiciFetch>[0],
        { ...(init as Record<string, unknown> | undefined), dispatcher: agent } as unknown as Parameters<typeof undiciFetch>[1]
      )) as unknown as Response;
    } catch (error) {
      inFlight.delete(agent);
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      agent.destroy().catch(() => undefined);
      if (signal?.aborted) throw abortError();
      const refusal = refusalFor();
      if (refusal) throw refusal.error;
      throw error;
    }

    // The response resolved; the tunnel/request succeeded, so close the agent
    // gracefully (undici's close() waits for in-flight requests, meaning the
    // body can still be read) rather than destroying it out from under the
    // caller. Don't await: the caller is still reading the body.
    inFlight.delete(agent);
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    agent.close().catch(() => undefined);

    const blockedHeader = response.headers.get(BLOCKED_HEADER);
    if (blockedHeader) {
      // Only the exact refusal the proxy named counts. A destination can send this
      // header too, and a concurrent call may have been refused for the same host.
      const seq = Number(/^\S+ (\d+)(?: |$)/.exec(blockedHeader)?.[1]);
      const refusal = Number.isSafeInteger(seq)
        ? proxy
            .refusalsSince(client.username, since)
            .find((entry) => entry.seq === seq && (host === undefined || entry.host === host))
        : undefined;
      if (refusal) {
        await response.body?.cancel().catch(() => undefined);
        throw refusal.error;
      }
    }
    return response;
  }) as typeof fetch;

  return Object.assign(guardedFetch, {
    async close() {
      closed = true;
      const agents = [...inFlight];
      inFlight.clear();
      await Promise.all(agents.map((agent) => agent.destroy().catch(() => undefined)));
    }
  });
}
