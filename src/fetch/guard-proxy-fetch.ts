import { ProxyAgent, fetch as undiciFetch } from 'undici';
import type { GuardProxy, GuardProxyClient } from './guard-proxy.js';
import { BLOCKED_HEADER } from './guard-proxy.js';

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
 */
export type GuardProxyFetch = typeof fetch & {
  /** Closes the ProxyAgent (awaiting it if still being created) and rejects later calls. Idempotent. */
  close(): Promise<void>;
};

export function createGuardProxyFetch(
  getProxy: () => Promise<GuardProxy>,
  { tls }: { tls?: { ca?: string | Buffer } } = {}
): GuardProxyFetch {
  let ready: Promise<{ proxy: GuardProxy; client: GuardProxyClient; agent: ProxyAgent }> | undefined;
  let closed = false;

  const ensure = () =>
    (ready ??= getProxy().then((proxy) => {
      const client = proxy.client('node');
      const agent = new ProxyAgent({
        uri: client.server,
        token: `Basic ${Buffer.from(`${client.username}:${client.password}`).toString('base64')}`,
        ...(tls ? { requestTls: tls } : {})
      });
      return { proxy, client, agent };
    }));

  const guardedFetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (closed) throw new Error('Guard proxy fetch is closed.');
    const { proxy, client, agent } = await ensure();
    const host = hostOf(input);
    const since = proxy.sequence();

    const refusalFor = () =>
      proxy
        .refusalsSince(client.username, since)
        .reverse()
        .find((entry) => host === undefined || entry.host === host);

    let response: Response;
    try {
      response = (await undiciFetch(
        input as Parameters<typeof undiciFetch>[0],
        { ...(init as Record<string, unknown> | undefined), dispatcher: agent } as unknown as Parameters<typeof undiciFetch>[1]
      )) as unknown as Response;
    } catch (error) {
      const refusal = refusalFor();
      if (refusal) throw refusal.error;
      throw error;
    }

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
      if (!ready) return; // never used: nothing to close, and don't start the proxy now
      const created = await ready.catch(() => undefined);
      await created?.agent.close().catch(() => undefined);
    }
  });
}
