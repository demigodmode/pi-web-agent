import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { stripProxyCredentials, type ProxyConfig } from '../backends/config.js';
import { abortError, throwIfAborted } from '../abort.js';

export type ProxyCredentials = {
  username?: string;
  password?: string;
};

export type ProxyFetchOptions = {
  /** TLS options for the tunneled connection to the origin (https targets). */
  tls?: { rejectUnauthorized?: boolean };
};

/**
 * Resolve proxy credentials from the config, falling back to environment
 * variables so secrets can stay out of config files (same policy as API keys).
 */
export function resolveProxyCredentials(
  proxy: ProxyConfig,
  env: NodeJS.ProcessEnv = process.env
): ProxyCredentials {
  const username = proxy.username ?? env.PI_WEB_AGENT_PROXY_USERNAME;
  const password = proxy.password ?? env.PI_WEB_AGENT_PROXY_PASSWORD;

  return {
    username: username?.trim() ? username : undefined,
    password: password ? password : undefined
  };
}

/**
 * Build a fetch implementation that routes all traffic through the configured
 * HTTP/HTTPS proxy. Uses undici (the engine behind Node's global fetch) with a
 * ProxyAgent dispatcher while keeping the standard fetch API surface.
 *
 * Each call gets its own ProxyAgent. undici builds the CONNECT tunnel inside
 * the agent's connector, and aborting a dispatched request doesn't reach in
 * and destroy that tunnel socket, so a proxy that never answers CONNECT would
 * otherwise keep the connection open well past the caller's abort (#59).
 */
export function createProxyFetch(proxy: ProxyConfig, options: ProxyFetchOptions = {}): typeof fetch {
  const credentials = resolveProxyCredentials(proxy);
  const uri = stripProxyCredentials(proxy.url);
  const token =
    credentials.username !== undefined
      ? `Basic ${Buffer.from(
          credentials.password !== undefined ? `${credentials.username}:${credentials.password}` : `${credentials.username}:`
        ).toString('base64')}`
      : undefined;

  // undici's Request/Response types are structurally near-identical to Node's
  // global fetch types but not nominatively identical, so the wrapper is cast
  // to the standard fetch signature (runtime behavior is identical: Node's
  // global fetch is built on this same undici engine).
  const proxyFetch = async (input: unknown, init?: unknown) => {
    const requestInit = init as Record<string, unknown> | undefined;
    const signal = (requestInit?.signal as AbortSignal | undefined) ?? undefined;
    throwIfAborted(signal);

    const agent = new ProxyAgent({
      uri,
      // undici's `token` option is used verbatim as the Proxy-Authorization header
      // value for both CONNECT tunnels and forwarded HTTP requests.
      ...(token !== undefined ? { token } : {}),
      ...(options.tls ? { requestTls: { rejectUnauthorized: options.tls.rejectUnauthorized } } : {})
    });

    let onAbort: (() => void) | undefined;
    if (signal) {
      onAbort = () => {
        agent.destroy().catch(() => undefined);
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      const response = await undiciFetch(
        input as Parameters<typeof undiciFetch>[0],
        { ...requestInit, dispatcher: agent } as unknown as Parameters<typeof undiciFetch>[1]
      );
      // The request settled; close gracefully so the body can still be read
      // (undici's close() waits for in-flight requests). Don't await it.
      agent.close().catch(() => undefined);
      return response;
    } catch (error) {
      agent.destroy().catch(() => undefined);
      if (signal?.aborted) throw abortError();
      throw error;
    } finally {
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    }
  };

  return proxyFetch as unknown as typeof fetch;
}
