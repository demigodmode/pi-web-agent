import type { LookupFn } from '../../src/fetch/network-guard.js';

/** Promise-style DNS fake for the network guard. Unknown hosts fail like ENOTFOUND. */
export function fakeLookup(table: Record<string, string[]>): LookupFn {
  return async (host) => {
    const addresses = table[host];
    if (!addresses) {
      throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
    }
    return addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
}

/** Callback-style (dns.lookup shaped) fake, for the connect-time lookup hook. */
export function callbackLookup(table: Record<string, string>) {
  return (hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
    const address = table[hostname];
    if (!address) {
      callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }));
      return;
    }
    const family = address.includes(':') ? 6 : 4;
    if (options?.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}
