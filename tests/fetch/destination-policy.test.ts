import { describe, expect, it } from 'vitest';
import { decideDestination } from '../../src/fetch/destination-policy.js';
import {
  BlockedAddressError,
  UnverifiedDestinationError,
  createNetworkGuard
} from '../../src/fetch/network-guard.js';
import { fakeLookup } from './fake-lookup.js';

const guard = createNetworkGuard(
  {},
  { lookup: fakeLookup({ 'ok.test': ['93.184.216.34', '93.184.216.35'], 'evil.test': ['10.0.0.9'] }) }
);

describe('decideDestination', () => {
  it('connects to the first approved address when there is no upstream', async () => {
    await expect(decideDestination('ok.test', guard, { upstream: false })).resolves.toEqual({
      action: 'connect',
      host: 'ok.test',
      address: '93.184.216.34'
    });
  });

  it('sends the approved address upstream by default', async () => {
    await expect(decideDestination('ok.test', guard, { upstream: true })).resolves.toEqual({
      action: 'connect',
      host: 'ok.test',
      address: '93.184.216.34'
    });
  });

  it('refuses a blocked destination in every mode', async () => {
    for (const mode of [
      { upstream: false },
      { upstream: true },
      { upstream: true, trustProxyDns: true },
      { upstream: false, trustProxyDns: true }
    ]) {
      const decision = await decideDestination('evil.test', guard, mode);
      expect(decision.action).toBe('refuse');
      expect(decision.action === 'refuse' && decision.error).toBeInstanceOf(BlockedAddressError);
    }
  });

  it('refuses an unresolved destination unless an upstream is trusted', async () => {
    for (const mode of [{ upstream: false }, { upstream: true }, { upstream: false, trustProxyDns: true }]) {
      const decision = await decideDestination('nope.test', guard, mode);
      expect(decision.action).toBe('refuse');
      expect(decision.action === 'refuse' && decision.error).toBeInstanceOf(UnverifiedDestinationError);
    }

    await expect(decideDestination('nope.test', guard, { upstream: true, trustProxyDns: true })).resolves.toEqual({
      action: 'delegate',
      host: 'nope.test'
    });
  });

  it('delegates the hostname when the upstream is trusted', async () => {
    await expect(decideDestination('ok.test', guard, { upstream: true, trustProxyDns: true })).resolves.toEqual({
      action: 'delegate',
      host: 'ok.test'
    });
  });

  it('still refuses literal private addresses and localhost when the upstream is trusted', async () => {
    for (const host of ['127.0.0.2', 'localhost', '[::1]']) {
      const decision = await decideDestination(host, guard, { upstream: true, trustProxyDns: true });
      expect(decision.action).toBe('refuse');
    }
  });
});
