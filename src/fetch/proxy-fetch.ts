import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { stripProxyCredentials, type ProxyConfig } from '../backends/config.js';

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
 */
export function createProxyFetch(proxy: ProxyConfig, options: ProxyFetchOptions = {}): typeof fetch {
  const credentials = resolveProxyCredentials(proxy);
  const agent = new ProxyAgent({
    // Never trust credentials embedded in the URL; they come from config fields
    // or the PI_WEB_AGENT_PROXY_* env vars via resolveProxyCredentials.
    uri: stripProxyCredentials(proxy.url),
    // undici's `token` option is used verbatim as the Proxy-Authorization header
    // value for both CONNECT tunnels and forwarded HTTP requests.
    ...(credentials.username !== undefined
      ? {
          token: `Basic ${Buffer.from(
            credentials.password !== undefined
              ? `${credentials.username}:${credentials.password}`
              : `${credentials.username}:`
          ).toString('base64')}`
        }
      : {}),
    ...(options.tls ? { requestTls: { rejectUnauthorized: options.tls.rejectUnauthorized } } : {})
  });

  // undici's Request/Response types are structurally near-identical to Node's
  // global fetch types but not nominatively identical, so the wrapper is cast
  // to the standard fetch signature (runtime behavior is identical: Node's
  // global fetch is built on this same undici engine).
  const proxyFetch = (input: unknown, init?: unknown) =>
    undiciFetch(
      input as Parameters<typeof undiciFetch>[0],
      {
        ...(init as Record<string, unknown> | undefined),
        dispatcher: agent
      } as unknown as Parameters<typeof undiciFetch>[1]
    );

  return proxyFetch as unknown as typeof fetch;
}
