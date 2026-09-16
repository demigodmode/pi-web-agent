import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { BlockedAddressError, type NetworkGuard } from './network-guard.js';

export const MAX_REDIRECTS = 5;

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

const CROSS_ORIGIN_UNSAFE_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];

function originOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}

/** Every hop must be plain http/https. Unparseable URLs are left to fail naturally, as before. */
function assertHttpProtocol(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }
}

/**
 * Follows redirects itself so every hop gets checked. A check on the first URL
 * alone is worthless: a public page can 302 to http://169.254.169.254/.
 */
export function createGuardedFetch(baseFetch: typeof fetch, guard: NetworkGuard): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    let currentInit: RequestInit = { ...init };

    if (input instanceof Request) {
      // A Request's body is a stream that can only be read once, but a 307/308
      // redirect must resend it. Buffer it up front instead of passing the stream
      // through, which also lets us drop `duplex` (only needed for streaming bodies).
      const body = input.body ? await input.clone().arrayBuffer() : undefined;
      const seeded: RequestInit = {
        method: input.method,
        headers: input.headers,
        body,
        signal: input.signal
      };
      currentInit = { ...seeded, ...init };
    }

    let url = requestUrl(input);

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      assertHttpProtocol(url);
      await guard.assertUrlAllowed(url);
      const response = await baseFetch(url, { ...currentInit, redirect: 'manual' });

      const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
      if (!location) return response;

      await response.body?.cancel().catch(() => undefined);

      const previousUrl = url;
      const nextUrl = new URL(location, url).toString();
      const method = (currentInit.method ?? 'GET').toUpperCase();
      const headers = new Headers(currentInit.headers);
      let nextInit: RequestInit = { ...currentInit, headers };

      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
        nextInit = { ...nextInit, method: 'GET', body: undefined };
        headers.delete('content-type');
        headers.delete('content-length');
      }

      if (originOf(nextUrl) !== originOf(previousUrl)) {
        for (const name of CROSS_ORIGIN_UNSAFE_HEADERS) headers.delete(name);
      }

      currentInit = nextInit;
      url = nextUrl;
    }

    throw new Error(`Too many redirects (more than ${MAX_REDIRECTS}).`);
  }) as typeof fetch;
}

type CallbackLookup = (
  hostname: string,
  options: { all?: boolean; family?: number },
  callback: (...args: any[]) => void
) => void;

/**
 * Direct (no proxy) path only. Checks the addresses actually used to connect,
 * so a DNS server that answers public for the pre-check and private for the
 * connect (rebinding) is still stopped. Not usable behind a proxy: the local
 * connection goes to the proxy, which is usually 127.0.0.1.
 *
 * IP literals never reach this lookup: net.connect skips DNS resolution for
 * them entirely. So this must always sit behind createGuardedFetch, whose
 * assertUrlAllowed catches literals before a connection is attempted.
 */
export function createPinnedFetch(
  guard: NetworkGuard,
  { lookup = dnsLookup as unknown as CallbackLookup }: { lookup?: CallbackLookup } = {}
): typeof fetch {
  const pinnedLookup: CallbackLookup = (hostname, options, callback) => {
    lookup(hostname, { ...options, all: true }, (error: Error | null, addresses: LookupAddress[]) => {
      if (error) {
        callback(error);
        return;
      }
      if (!addresses || addresses.length === 0) {
        callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }));
        return;
      }
      const blocked = addresses.find((entry) => guard.isBlockedAddress(entry.address));
      if (blocked) {
        callback(new BlockedAddressError(hostname, blocked.address));
        return;
      }
      if (options?.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    });
  };

  const agent = new Agent({ connect: { lookup: pinnedLookup as unknown as LookupFunction } });

  return ((input: unknown, init?: unknown) =>
    undiciFetch(
      input as Parameters<typeof undiciFetch>[0],
      { ...(init as Record<string, unknown> | undefined), dispatcher: agent } as unknown as Parameters<typeof undiciFetch>[1]
    )) as unknown as typeof fetch;
}
