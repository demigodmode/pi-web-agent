import { describe, expect, it } from 'vitest';
import { createNetworkGuard, parseCidr } from '../../src/fetch/network-guard.js';
import { vi } from 'vitest';
import { BlockedAddressError, findBlockedAddressError } from '../../src/fetch/network-guard.js';
import { fakeLookup } from './fake-lookup.js';

const guard = createNetworkGuard();

describe('network guard address matching', () => {
  it.each([
    '0.0.0.0',
    '0.255.255.255',
    '10.0.0.0',
    '10.255.255.255',
    '100.64.0.0',
    '100.127.255.255',
    '127.0.0.1',
    '127.255.255.255',
    '169.254.0.0',
    '169.254.169.254',
    '169.254.255.255',
    '172.16.0.0',
    '172.31.255.255',
    '192.0.0.0',
    '192.0.0.255',
    '192.168.0.0',
    '192.168.255.255',
    '198.18.0.0',
    '198.19.255.255',
    '224.0.0.1',
    '239.255.255.255',
    '240.0.0.0',
    '255.255.255.255'
  ])('blocks %s', (address) => {
    expect(guard.isBlockedAddress(address)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '93.184.216.34',
    '9.255.255.255',
    '11.0.0.0',
    '100.63.255.255',
    '100.128.0.0',
    '126.255.255.255',
    '128.0.0.0',
    '169.253.255.255',
    '169.255.0.0',
    '172.15.255.255',
    '172.32.0.0',
    '192.167.255.255',
    '192.169.0.0',
    '198.17.255.255',
    '198.20.0.0',
    '223.255.255.255'
  ])('allows %s', (address) => {
    expect(guard.isBlockedAddress(address)).toBe(false);
  });

  it.each([
    '::1',
    '::',
    'fc00::1',
    'fdff:ffff::1',
    'fe80::1',
    'febf:ffff::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    '::ffff:10.0.0.1',
    '::ffff:7f00:1'
  ])('blocks IPv6 %s', (address) => {
    expect(guard.isBlockedAddress(address)).toBe(true);
  });

  it.each(['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8'])('allows IPv6 %s', (address) => {
    expect(guard.isBlockedAddress(address)).toBe(false);
  });

  it('fails closed on something that is not an IP address', () => {
    expect(guard.isBlockedAddress('not-an-ip')).toBe(true);
  });

  it('exempts only addresses inside an allowed range', () => {
    const allowing = createNetworkGuard({ allowRanges: ['198.18.0.0/15'] });
    expect(allowing.isBlockedAddress('198.18.5.5')).toBe(false);
    expect(allowing.isBlockedAddress('198.19.255.255')).toBe(false);
    expect(allowing.isBlockedAddress('10.0.0.1')).toBe(true);
  });

  it('ignores invalid and all-address allow entries', () => {
    const allowing = createNetworkGuard({ allowRanges: ['0.0.0.0/0', '::/0', 'nonsense', '10.0.0.0/33'] });
    expect(allowing.isBlockedAddress('10.0.0.1')).toBe(true);
    expect(allowing.isBlockedAddress('::1')).toBe(true);
  });

  it('applies IPv4 allow ranges to IPv4-mapped IPv6 addresses', () => {
    const allowing = createNetworkGuard({ allowRanges: ['10.0.0.0/8'] });
    expect(allowing.isBlockedAddress('::ffff:10.1.2.3')).toBe(false);
  });

  it.each(['::7f00:1', '64:ff9b::a9fe:a9fe', '64:ff9b:1::7f00:1', '2002:a9fe:a9fe::', 'fec0::1'])(
    'blocks IPv6 forms that embed or alias private IPv4 addresses: %s',
    (address) => {
      expect(guard.isBlockedAddress(address)).toBe(true);
    }
  );

  it('still allows a normal public IPv6 address', () => {
    expect(guard.isBlockedAddress('2606:4700:4700::1111')).toBe(false);
  });

  it.each(['64:ff9b::808:808', '2002:808:808::1', '64:ff9b:1::808:808'])(
    'does not block a DNS64/NAT64 or 6to4 address that embeds a public IPv4 host: %s',
    (address) => {
      expect(guard.isBlockedAddress(address)).toBe(false);
    }
  );

  it('blocks a 64:ff9b:1::/48 address using a shorter operator prefix, since the low 32 bits are not the embedded IPv4', () => {
    expect(guard.isBlockedAddress('64:ff9b:1:ffff::808:808')).toBe(true);
  });

  it('applies IPv4 allow ranges to an embedded NAT64 address', () => {
    const allowing = createNetworkGuard({ allowRanges: ['10.0.0.0/8'] });
    expect(allowing.isBlockedAddress('64:ff9b::a00:1')).toBe(false);
  });
});

describe('parseCidr', () => {
  it('parses valid ranges', () => {
    expect(parseCidr('10.0.0.0/8')).toMatchObject({ family: 4, prefix: 8 });
    expect(parseCidr('fd00::/8')).toMatchObject({ family: 6, prefix: 8 });
    expect(parseCidr(' 198.18.0.0/15 ')).toMatchObject({ family: 4, prefix: 15 });
  });

  it.each(['10.0.0.0', '10.0.0.0/33', 'fd00::/129', '300.0.0.0/8', '10.0.0.0/abc', '', '/8'])(
    'rejects %s',
    (value) => {
      expect(parseCidr(value)).toBeUndefined();
    }
  );
});

describe('network guard host checks', () => {
  it('blocks a hostname that resolves to loopback', async () => {
    const hostGuard = createNetworkGuard({}, { lookup: fakeLookup({ 'rebind.example': ['127.0.0.1'] }) });
    const error = await hostGuard.assertUrlAllowed('http://rebind.example/x').catch((e) => e);

    expect(error).toBeInstanceOf(BlockedAddressError);
    expect(error).toMatchObject({ code: 'BLOCKED_PRIVATE_ADDRESS', host: 'rebind.example', address: '127.0.0.1' });
    expect(error.message).toBe(
      'Blocked rebind.example: resolves to private address 127.0.0.1. Add it to backends.network.allowRanges if this is intended.'
    );
  });

  it('blocks when any one of several resolved addresses is private', async () => {
    const hostGuard = createNetworkGuard({}, { lookup: fakeLookup({ 'mixed.example': ['93.184.216.34', '10.0.0.5'] }) });
    await expect(hostGuard.checkHost('mixed.example')).resolves.toEqual({
      allowed: false,
      host: 'mixed.example',
      address: '10.0.0.5'
    });
  });

  it('allows a hostname that only resolves to public addresses', async () => {
    const hostGuard = createNetworkGuard({}, { lookup: fakeLookup({ 'example.com': ['93.184.216.34'] }) });
    await expect(hostGuard.assertUrlAllowed('https://example.com/docs')).resolves.toBeUndefined();
  });

  it('checks IP literals without a DNS lookup', async () => {
    const lookup = vi.fn();
    const hostGuard = createNetworkGuard({}, { lookup });

    await expect(hostGuard.assertUrlAllowed('http://169.254.169.254/latest/meta-data/')).rejects.toBeInstanceOf(
      BlockedAddressError
    );
    await expect(hostGuard.assertUrlAllowed('http://[::1]:8080/')).rejects.toBeInstanceOf(BlockedAddressError);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('blocks localhost names without a DNS lookup', async () => {
    const lookup = vi.fn();
    const hostGuard = createNetworkGuard({}, { lookup });

    await expect(hostGuard.assertUrlAllowed('http://localhost:3000/')).rejects.toBeInstanceOf(BlockedAddressError);
    await expect(hostGuard.assertUrlAllowed('http://api.localhost/')).rejects.toBeInstanceOf(BlockedAddressError);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('lets a DNS failure through so the fetch reports its own error', async () => {
    const hostGuard = createNetworkGuard({}, { lookup: fakeLookup({}) });
    await expect(hostGuard.assertUrlAllowed('https://nope.invalid/')).resolves.toBeUndefined();
  });

  it('ignores strings that are not URLs', async () => {
    await expect(createNetworkGuard().assertUrlAllowed('not a url')).resolves.toBeUndefined();
  });

  it('respects the allow list for resolved hostnames', async () => {
    const hostGuard = createNetworkGuard(
      { allowRanges: ['198.18.0.0/15'] },
      { lookup: fakeLookup({ 'fakeip.example': ['198.18.0.20'] }) }
    );
    await expect(hostGuard.assertUrlAllowed('https://fakeip.example/')).resolves.toBeUndefined();
  });

  it('blocks a localhost hostname with a trailing dot, without a DNS lookup', async () => {
    const lookup = vi.fn();
    const hostGuard = createNetworkGuard({}, { lookup });

    await expect(hostGuard.assertUrlAllowed('http://LOCALHOST./')).rejects.toBeInstanceOf(BlockedAddressError);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('blocks a localhost hostname with multiple trailing dots, without a DNS lookup', async () => {
    const lookup = vi.fn();
    const hostGuard = createNetworkGuard({}, { lookup });

    await expect(hostGuard.assertUrlAllowed('http://localhost../')).rejects.toBeInstanceOf(BlockedAddressError);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('allows localhost when 127.0.0.1 is on the allow list', async () => {
    const lookup = vi.fn();
    const hostGuard = createNetworkGuard({ allowRanges: ['127.0.0.0/8'] }, { lookup });

    await expect(hostGuard.assertUrlAllowed('http://localhost/')).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe('findBlockedAddressError', () => {
  it('finds the error nested in a fetch failure cause', () => {
    const blocked = new BlockedAddressError('a.example', '127.0.0.1');
    expect(findBlockedAddressError(new TypeError('fetch failed', { cause: blocked }))).toBe(blocked);
  });

  it('returns undefined for unrelated errors', () => {
    expect(findBlockedAddressError(new Error('boom'))).toBeUndefined();
    expect(findBlockedAddressError(undefined)).toBeUndefined();
  });
});
