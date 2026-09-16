import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Decides whether a destination the *model* chose is safe to fetch (#53).
 *
 * web_explore fetches URLs the model picks, partly from pages it just read, so
 * a hostile page can point it at cloud metadata (169.254.169.254), services on
 * localhost, or the user's LAN. This module only answers "is this address
 * allowed"; guarded-fetch.ts and headless-fetch.ts enforce it. User-configured
 * endpoints (search APIs, SearXNG, Firecrawl, the proxy) never go through it.
 */

export type Cidr = { family: 4 | 6; network: bigint; prefix: number };

type ParsedAddress = { family: 4 | 6; value: bigint };

export type LookupFn = (host: string) => Promise<Array<{ address: string; family: number }>>;

export type NetworkGuardConfig = { allowRanges?: string[] };

export type GuardVerdict =
  | { allowed: true; unresolved?: true }
  | { allowed: false; host: string; address: string };

export type HostResolution =
  | { status: 'allowed'; host: string; addresses: string[] }
  | { status: 'blocked'; host: string; address: string }
  | { status: 'unresolved'; host: string };

export type NetworkGuard = {
  isBlockedAddress(address: string): boolean;
  /** Resolves once and checks every answer. The guard proxy connects to one of `addresses`, never re-resolving. */
  resolveHost(host: string): Promise<HostResolution>;
  checkHost(host: string): Promise<GuardVerdict>;
  assertUrlAllowed(url: string): Promise<void>;
};

export const BLOCKED_PRIVATE_ADDRESS = 'BLOCKED_PRIVATE_ADDRESS';

export class BlockedAddressError extends Error {
  readonly code = BLOCKED_PRIVATE_ADDRESS;

  constructor(
    readonly host: string,
    readonly address: string
  ) {
    super(
      `Blocked ${host}: resolves to private address ${address}. ` +
        'Add it to backends.network.allowRanges if this is intended.'
    );
    this.name = 'BlockedAddressError';
  }
}

/** No address could be verified, so we refuse rather than let something else resolve it. */
export class UnverifiedDestinationError extends Error {
  readonly code = BLOCKED_PRIVATE_ADDRESS;

  constructor(readonly host: string) {
    super(`Blocked ${host}: could not verify its address before connecting.`);
    this.name = 'UnverifiedDestinationError';
  }
}

export const UPSTREAM_PROXY_REFUSED = 'UPSTREAM_PROXY_REFUSED';

/** The user's upstream proxy would not accept the approved IP. We never retry by hostname. */
export class UpstreamProxyRefusedError extends Error {
  readonly code = UPSTREAM_PROXY_REFUSED;

  constructor(
    readonly host: string,
    readonly target: string,
    readonly status: number | string
  ) {
    super(
      `Upstream proxy refused ${target} for ${host} (HTTP ${status}). ` +
        'If it only accepts hostnames, set backends.network.trustProxyDns to trust it to enforce private-address restrictions.'
    );
    this.name = 'UpstreamProxyRefusedError';
  }
}

export type GuardError = BlockedAddressError | UnverifiedDestinationError | UpstreamProxyRefusedError;

export function findGuardError(error: unknown): GuardError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (
      current instanceof BlockedAddressError ||
      current instanceof UnverifiedDestinationError ||
      current instanceof UpstreamProxyRefusedError
    ) {
      return current;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** undici wraps connect errors as `TypeError: fetch failed` with the real error in `cause`. */
export function findBlockedAddressError(error: unknown): BlockedAddressError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (current instanceof BlockedAddressError) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

const IPV4_WIDTH = 32;
const IPV6_WIDTH = 128;

function ipv4ToBigInt(address: string): bigint | undefined {
  const parts = address.split('.');
  if (parts.length !== 4) return undefined;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

function ipv6ToBigInt(address: string): bigint | undefined {
  let text = address.split('%')[0];

  // Embedded IPv4 tail, e.g. ::ffff:127.0.0.1
  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':');
    const v4 = ipv4ToBigInt(text.slice(lastColon + 1));
    if (v4 === undefined) return undefined;
    const high = ((v4 >> 16n) & 0xffffn).toString(16);
    const low = (v4 & 0xffffn).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && missing !== 0) return undefined;
  if (halves.length === 2 && missing < 1) return undefined;

  const groups = [...head, ...new Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return undefined;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

const NAT64_WELL_KNOWN_NET = (ipv6ToBigInt('64:ff9b::') as bigint) >> 32n;
const NAT64_LOCAL_NET = (ipv6ToBigInt('64:ff9b:1::') as bigint) >> 80n;
const SIXTOFOUR_NET = (ipv6ToBigInt('2002::') as bigint) >> 112n;

function parseAddress(address: string): ParsedAddress | undefined {
  const family = isIP(address.split('%')[0]);
  if (family === 4) {
    const value = ipv4ToBigInt(address);
    return value === undefined ? undefined : { family: 4, value };
  }
  if (family === 6) {
    const value = ipv6ToBigInt(address);
    if (value === undefined) return undefined;
    // IPv4-mapped (::ffff:a.b.c.d): judge it as the IPv4 address it really is.
    if (value >> 32n === 0xffffn) return { family: 4, value: value & 0xffffffffn };
    // IPv4-compatible (deprecated ::a.b.c.d), but not the special addresses :: and ::1.
    if (value >> 32n === 0n && value > 1n) return { family: 4, value };
    // NAT64 (64:ff9b::/96 well-known, 64:ff9b:1::/48 local-use): IPv4 is the low 32 bits.
    // DNS64 networks translate every IPv4-only host into these prefixes, so we cannot
    // block the prefix outright -- judge the embedded address on its own merits instead.
    if (value >> 32n === NAT64_WELL_KNOWN_NET) return { family: 4, value: value & 0xffffffffn };
    // Local-use NAT64 lets the operator pick a prefix shorter than /96; only the /96
    // case has the IPv4 address in the low 32 bits, so only unwrap when bits 48-95
    // (between the /48 prefix and the embedded address) are all zero.
    if (value >> 80n === NAT64_LOCAL_NET && ((value >> 32n) & 0xffffffffffffn) === 0n) {
      return { family: 4, value: value & 0xffffffffn };
    }
    // 6to4 (2002::/16): IPv4 is bits 16-48 from the top.
    if (value >> 112n === SIXTOFOUR_NET) return { family: 4, value: (value >> 80n) & 0xffffffffn };
    return { family: 6, value };
  }
  return undefined;
}

export function parseCidr(text: string): Cidr | undefined {
  const trimmed = text.trim();
  const slash = trimmed.indexOf('/');
  if (slash <= 0) return undefined;
  const prefixText = trimmed.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefixText)) return undefined;
  const prefix = Number(prefixText);

  const address = parseAddress(trimmed.slice(0, slash));
  if (!address) return undefined;
  // A mapped IPv6 CIDR would be ambiguous; require the plain family.
  const family = isIP(trimmed.slice(0, slash)) as 4 | 6;
  const width = family === 4 ? IPV4_WIDTH : IPV6_WIDTH;
  if (prefix > width) return undefined;

  const value = family === 4 ? (ipv4ToBigInt(trimmed.slice(0, slash)) as bigint) : (ipv6ToBigInt(trimmed.slice(0, slash)) as bigint);
  const shift = BigInt(width - prefix);
  return { family, network: (value >> shift) << shift, prefix };
}

function cidrContains(cidr: Cidr, address: ParsedAddress): boolean {
  if (cidr.family !== address.family) return false;
  const width = cidr.family === 4 ? IPV4_WIDTH : IPV6_WIDTH;
  const shift = BigInt(width - cidr.prefix);
  return address.value >> shift === cidr.network >> shift;
}

const BLOCKED_RANGES: Cidr[] = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '::1/128',
  '::/128',
  '64:ff9b:1::/48',
  'fc00::/7',
  'fe80::/10',
  'fec0::/10',
  'ff00::/8'
].map((range) => parseCidr(range) as Cidr);

/** Parses an allow list, dropping invalid entries and anything that allows every address. */
export function usableAllowRanges(allowRanges: string[] = []): Cidr[] {
  return allowRanges
    .map((range) => parseCidr(range))
    .filter((cidr): cidr is Cidr => cidr !== undefined && cidr.prefix > 0);
}

const defaultLookup: LookupFn = (host) => dnsLookup(host, { all: true, verbatim: true });

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

export function createNetworkGuard(
  config: NetworkGuardConfig = {},
  { lookup = defaultLookup }: { lookup?: LookupFn } = {}
): NetworkGuard {
  const allow = usableAllowRanges(config.allowRanges);

  function isBlockedAddress(address: string): boolean {
    const parsed = parseAddress(address);
    if (!parsed) return true; // fail closed
    if (allow.some((cidr) => cidrContains(cidr, parsed))) return false;
    return BLOCKED_RANGES.some((cidr) => cidrContains(cidr, parsed));
  }

  async function resolveHost(rawHost: string): Promise<HostResolution> {
    const host = stripBrackets(rawHost.toLowerCase()).replace(/\.+$/, '');

    if (host === 'localhost' || host.endsWith('.localhost')) {
      return isBlockedAddress('127.0.0.1')
        ? { status: 'blocked', host, address: '127.0.0.1' }
        : { status: 'allowed', host, addresses: ['127.0.0.1'] };
    }

    if (isIP(host)) {
      return isBlockedAddress(host)
        ? { status: 'blocked', host, address: host }
        : { status: 'allowed', host, addresses: [host] };
    }

    let answers: Array<{ address: string }>;
    try {
      answers = await lookup(host);
    } catch {
      return { status: 'unresolved', host };
    }
    if (!answers || answers.length === 0) return { status: 'unresolved', host };

    // Any private answer blocks: which address a connection would pick is not ours to control.
    const blocked = answers.find((entry) => isBlockedAddress(entry.address));
    if (blocked) return { status: 'blocked', host, address: blocked.address };
    return { status: 'allowed', host, addresses: answers.map((entry) => entry.address) };
  }

  async function checkHost(rawHost: string): Promise<GuardVerdict> {
    const resolution = await resolveHost(rawHost);
    if (resolution.status === 'blocked') {
      return { allowed: false, host: resolution.host, address: resolution.address };
    }
    return resolution.status === 'unresolved' ? { allowed: true, unresolved: true } : { allowed: true };
  }

  async function assertUrlAllowed(url: string): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return; // not a URL; the tools reject it with UNSUPPORTED_URL
    }
    const verdict = await checkHost(parsed.hostname);
    if (!verdict.allowed) throw new BlockedAddressError(verdict.host, verdict.address);
  }

  return { isBlockedAddress, resolveHost, checkHost, assertUrlAllowed };
}
