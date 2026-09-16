import { createHash, createPublicKey } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveBrowserExecutable } from '../../src/fetch/browser-resolution.js';
import { startGuardProxy, type GuardProxy, type UpstreamProxy } from '../../src/fetch/guard-proxy.js';
import { headlessFetch } from '../../src/fetch/headless-fetch.js';
import { createNetworkGuard, type LookupFn } from '../../src/fetch/network-guard.js';
import { fakeLookup } from './fake-lookup.js';
import { FIXTURE_CERT, READABLE_PAGE, startRecordingUpstream, startServerPair } from './guard-proxy-fixtures.js';

const localBrowser = await resolveBrowserExecutable({});
const managedAvailable = existsSync(chromium.executablePath());
const browserAvailable = localBrowser.ok || managedAvailable;

if (!browserAvailable && process.env.PI_WEB_AGENT_REQUIRE_BROWSER_TESTS === '1') {
  throw new Error('Browser acceptance tests are required here, but no Chromium-based browser was found.');
}

const spkiPin = createHash('sha256')
  .update(createPublicKey(FIXTURE_CERT).export({ type: 'spki', format: 'der' }))
  .digest('base64');

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

/**
 * Runs headlessFetch against a real browser and a real guard proxy. Returns the
 * hosts the proxy refused for this browser session, so each negative test can
 * prove the proxy did the blocking rather than the request never starting.
 */
async function fetchInBrowser(
  url: string,
  options: { lookup: LookupFn; allowRanges?: string[]; upstream?: UpstreamProxy }
) {
  const guard = createNetworkGuard({ allowRanges: options.allowRanges ?? ['127.0.0.1/32'] }, { lookup: options.lookup });
  const proxy = await startGuardProxy({ guard, upstream: options.upstream });
  cleanups.push(() => proxy.close());

  const sessionUsernames: string[] = [];
  const trackedProxy: GuardProxy = {
    ...proxy,
    client: (name) => {
      const client = proxy.client(name);
      sessionUsernames.push(client.username);
      return client;
    }
  };

  const result = await headlessFetch(url, {
    guard,
    guardProxy: async () => trackedProxy,
    launchBrowser: ({ executablePath, proxy: launchProxy }) =>
      chromium.launch({
        ...(executablePath ? { executablePath } : {}),
        headless: true,
        ...(launchProxy ? { proxy: launchProxy } : {}),
        // Trust only the fixture certificate; everything else is still verified.
        args: [`--ignore-certificate-errors-spki-list=${spkiPin}`]
      })
  });

  const refusedHosts = () =>
    sessionUsernames.flatMap((username) => proxy.refusalsSince(username, 0).map((refusal) => refusal.host));

  expect(sessionUsernames).toHaveLength(1);
  return { result, refusedHosts };
}

const pairLookup = () => fakeLookup({ 'ok.test': ['127.0.0.1'], 'evil.test': ['127.0.0.2'] });

describe.skipIf(!browserAvailable || process.platform !== 'linux')('guard proxy with a real browser', () => {
  it('stops an HTTP redirect to a blocked address and attributes it to the navigation', async () => {
    const pair = await startServerPair({
      okHandler: (request, response) => {
        response.writeHead(302, { location: `http://evil.test:${pair.port}/steal` });
        response.end();
      }
    });
    cleanups.push(() => pair.close());

    const { result, refusedHosts } = await fetchInBrowser(`http://ok.test:${pair.port}/`, { lookup: pairLookup() });

    expect(result).toMatchObject({ status: 'error', error: { code: 'BLOCKED_PRIVATE_ADDRESS' } });
    expect(result.error?.message).toContain('evil.test');
    expect(pair.ok.connections).toBeGreaterThanOrEqual(1);
    expect(pair.evil.connections).toBe(0);
    expect(refusedHosts()).toContain('evil.test');
  }, 60_000);

  it('stops an HTTPS redirect to a blocked address and attributes it to the navigation', async () => {
    const pair = await startServerPair({
      tls: true,
      okHandler: (request, response) => {
        response.writeHead(302, { location: `https://evil.test:${pair.port}/steal` });
        response.end();
      }
    });
    cleanups.push(() => pair.close());

    const { result, refusedHosts } = await fetchInBrowser(`https://ok.test:${pair.port}/`, { lookup: pairLookup() });

    expect(result).toMatchObject({ status: 'error', error: { code: 'BLOCKED_PRIVATE_ADDRESS' } });
    expect(result.error?.message).toContain('evil.test');
    expect(pair.ok.requests.length).toBeGreaterThanOrEqual(1);
    expect(pair.evil.connections).toBe(0);
    expect(refusedHosts()).toContain('evil.test');
  }, 60_000);

  it('blocks a subresource on a blocked address while the page still loads', async () => {
    const pair = await startServerPair({
      okHandler: (request, response) => {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end(READABLE_PAGE.replace('</article>', `</article><img src="http://evil.test:${pair.port}/pixel.png">`));
      }
    });
    cleanups.push(() => pair.close());

    const { result, refusedHosts } = await fetchInBrowser(`http://ok.test:${pair.port}/`, { lookup: pairLookup() });

    expect(result.status).toBe('ok');
    expect(result.metadata.blockedSubresources).toBeGreaterThanOrEqual(1);
    expect(pair.evil.connections).toBe(0);
    expect(refusedHosts()).toContain('evil.test');
  }, 60_000);

  it('blocks a WebSocket to a blocked address while an allowed WebSocket opens', async () => {
    const pair = await startServerPair({
      websocket: true,
      okHandler: (request, response) => {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end(`<html><body><article><p id="status">WebSocket probe page with enough readable text for extraction to work:</p></article>
<script>
  const status = document.getElementById('status');
  const settle = (label) => { status.textContent += ' ' + label; };
  const allowed = new WebSocket('ws://ok.test:${pair.port}/allowed');
  allowed.onopen = () => settle('allowed-open');
  allowed.onerror = () => settle('allowed-error');
  const blocked = new WebSocket('ws://evil.test:${pair.port}/blocked');
  blocked.onopen = () => settle('blocked-open');
  blocked.onerror = () => settle('blocked-error');
</script></body></html>`);
      }
    });
    cleanups.push(() => pair.close());

    const { result, refusedHosts } = await fetchInBrowser(`http://ok.test:${pair.port}/`, { lookup: pairLookup() });

    // Positive control: WebSockets work through the guard proxy at all.
    expect(result.status).toBe('ok');
    expect(result.content?.text).toContain('allowed-open');
    expect(pair.ok.upgrades).toBe(1);
    // Both sockets settled before extraction, and the blocked one failed because the proxy refused it.
    expect(result.content?.text).toContain('blocked-error');
    expect(result.content?.text).not.toContain('blocked-open');
    expect(pair.evil.connections).toBe(0);
    expect(refusedHosts()).toContain('evil.test');
  }, 60_000);

  it('never reaches the blocked server when DNS changes between checks', async () => {
    const pair = await startServerPair();
    cleanups.push(() => pair.close());
    const lookup: LookupFn = vi
      .fn()
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
      .mockResolvedValue([{ address: '127.0.0.2', family: 4 }]);

    const { result, refusedHosts } = await fetchInBrowser(`http://flip.test:${pair.port}/`, { lookup });

    // The early main-url check saw 127.0.0.1; the proxy's own lookup saw 127.0.0.2 and refused.
    expect(result).toMatchObject({ status: 'error', error: { code: 'BLOCKED_PRIVATE_ADDRESS' } });
    expect(pair.evil.connections).toBe(0);
    expect(refusedHosts()).toContain('flip.test');
  }, 60_000);

  it('counts a same-host subresource refused after DNS changes, while the page itself loads', async () => {
    const pair = await startServerPair({
      okHandler: (request, response) => {
        if (request.url === '/pixel.png') {
          response.writeHead(200, { 'content-type': 'image/png', 'content-length': '0' });
          response.end();
          return;
        }
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end(READABLE_PAGE.replace('</article>', `</article><img src="http://flip.test:${pair.port}/pixel.png">`));
      }
    });
    cleanups.push(() => pair.close());
    // Call 1 is headless's pre-launch check, call 2 the proxy resolving the page
    // navigation. Every later call (the image's own forwarded request) sees 127.0.0.2.
    const lookup = vi
      .fn<LookupFn>()
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
      .mockResolvedValue([{ address: '127.0.0.2', family: 4 }]);

    const { result, refusedHosts } = await fetchInBrowser(`http://flip.test:${pair.port}/`, { lookup });

    expect(lookup.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(lookup.mock.calls.every(([host]) => host === 'flip.test')).toBe(true);
    expect(result.status).toBe('ok');
    expect(result.metadata.blockedSubresources).toBeGreaterThanOrEqual(1);
    expect(pair.evil.connections).toBe(0);
    expect(refusedHosts()).toContain('flip.test');
  }, 60_000);

  it('sends loopback traffic through the guard proxy despite the browser default bypass', async () => {
    // Page on 127.0.0.2 (allowed here), victim on 127.0.0.1 (not allowed).
    const pair = await startServerPair({
      evilHandler: (request, response) => {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end(READABLE_PAGE.replace('</article>', `</article><img src="http://127.0.0.1:${pair.port}/pixel.png">`));
      }
    });
    cleanups.push(() => pair.close());

    const { result, refusedHosts } = await fetchInBrowser(`http://page.test:${pair.port}/`, {
      lookup: fakeLookup({ 'page.test': ['127.0.0.2'] }),
      allowRanges: ['127.0.0.2/32']
    });

    expect(result.status).toBe('ok');
    expect(pair.ok.connections).toBe(0);
    // Recorded by the proxy, so the browser did not bypass it for loopback.
    expect(refusedHosts()).toContain('127.0.0.1');
  }, 60_000);

  it('sends the approved IP to an upstream proxy while the destination sees the original Host and SNI', async () => {
    const pair = await startServerPair({ tls: true });
    const upstream = await startRecordingUpstream();
    cleanups.push(() => pair.close(), () => upstream.close());

    const { result } = await fetchInBrowser(`https://ok.test:${pair.port}/`, {
      lookup: fakeLookup({ 'ok.test': ['127.0.0.1'] }),
      upstream: { url: upstream.url }
    });

    expect(result.status).toBe('ok');
    expect(upstream.targets.length).toBeGreaterThanOrEqual(1);
    expect(upstream.targets.every((target) => target === `127.0.0.1:${pair.port}`)).toBe(true);
    expect(pair.ok.requests[0]).toMatchObject({ host: `ok.test:${pair.port}`, servername: 'ok.test' });
  }, 60_000);
});
