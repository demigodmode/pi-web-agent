import {
  BlockedAddressError,
  UnverifiedDestinationError,
  type NetworkGuard
} from './network-guard.js';

export type Destination =
  | { action: 'connect'; host: string; address: string }
  | { action: 'delegate'; host: string }
  | { action: 'refuse'; error: BlockedAddressError | UnverifiedDestinationError };

export type DestinationMode = {
  /** An upstream proxy is configured. */
  upstream: boolean;
  /**
   * The user explicitly trusts the upstream proxy to enforce private-address
   * restrictions. Only meaningful with an upstream.
   */
  trustProxyDns?: boolean;
};

/**
 * Turns one resolution into where a connection may go (spec revision 2).
 *
 * - blocked answers are refused in every mode
 * - by default the connection goes to an address we checked, never a hostname
 *   something else will resolve
 * - with a trusted upstream the hostname is delegated, which also covers names
 *   only that proxy can resolve
 * - anything else unresolvable is refused
 */
export async function decideDestination(
  host: string,
  guard: NetworkGuard,
  mode: DestinationMode
): Promise<Destination> {
  const resolution = await guard.resolveHost(host);

  if (resolution.status === 'blocked') {
    return { action: 'refuse', error: new BlockedAddressError(resolution.host, resolution.address) };
  }

  if (mode.upstream && mode.trustProxyDns) {
    return { action: 'delegate', host: resolution.host };
  }

  if (resolution.status === 'unresolved') {
    return { action: 'refuse', error: new UnverifiedDestinationError(resolution.host) };
  }

  return { action: 'connect', host: resolution.host, address: resolution.addresses[0] };
}
