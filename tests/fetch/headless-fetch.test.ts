import { describe, expect, it, vi } from 'vitest';
import { headlessFetch } from '../../src/fetch/headless-fetch.js';
import { createNetworkGuard } from '../../src/fetch/network-guard.js';
import { fakeLookup } from './fake-lookup.js';
import type { GuardProxy, Refusal } from '../../src/fetch/guard-proxy.js';
import { BlockedAddressError, UnverifiedDestinationError, type GuardError } from '../../src/fetch/network-guard.js';

describe('headless fetch', () => {
  it('falls back to Playwright-managed Chromium when no local browser can be resolved', async () => {
    const launchBrowser = vi.fn(async () => ({
      newContext: async () => ({
        newPage: async () => ({
          goto: async () => undefined,
          waitForLoadState: async () => undefined,
          content: async () => '<html><body><article><p>Managed Chromium rendered enough readable content for extraction.</p></article></body></html>',
          close: async () => undefined
        }),
        close: async () => undefined
      }),
      close: async () => undefined
    }));

    const result = await headlessFetch('https://example.com', {
      resolveBrowser: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: 'BROWSER_NOT_FOUND',
          message: 'No compatible local browser was found for headless fetch.'
        }
      }),
      launchBrowser
    });

    expect(launchBrowser).toHaveBeenCalledWith({ headless: true });
    expect(result.status).toBe('ok');
    expect(result.metadata.browser).toBe('chromium');
  });

  it('returns a startup error when configured browser cannot be resolved', async () => {
    const result = await headlessFetch('https://example.com', {
      resolveBrowser: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: 'CONFIGURED_BROWSER_NOT_FOUND',
          message: 'Configured browser path was not found: C:/missing/chrome.exe'
        }
      })
    });

    expect(result).toMatchObject({
      status: 'error',
      error: { code: 'CONFIGURED_BROWSER_NOT_FOUND' },
      metadata: { method: 'headless', cacheHit: false }
    });
  });

  it('extracts rendered page content and includes navigation metadata', async () => {
    const closePage = vi.fn(async () => undefined);
    const closeContext = vi.fn(async () => undefined);
    const closeBrowser = vi.fn(async () => undefined);

    const page = {
      goto: vi.fn(async () => undefined),
      waitForLoadState: vi.fn(async () => undefined),
      content: vi.fn(async () => '<html><body><article><p>Rendered text with enough content to pass extraction.</p></article></body></html>'),
      close: closePage
    };

    const context = {
      newPage: vi.fn(async () => page),
      close: closeContext
    };

    const browser = {
      newContext: vi.fn(async () => context),
      close: closeBrowser
    };

    const result = await headlessFetch('https://example.com', {
      resolveBrowser: vi.fn().mockResolvedValue({
        ok: true,
        executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
        browser: 'chrome'
      }),
      launchBrowser: vi.fn(async () => browser),
      now: vi.fn()
        .mockReturnValueOnce(1000)
        .mockReturnValueOnce(2600)
    });

    expect(result.status).toBe('ok');
    expect(result.metadata.method).toBe('headless');
    expect(result.metadata.browser).toBe('chrome');
    expect(result.metadata.navigationMs).toBe(1600);
    expect(result.content?.text).toContain('Rendered text');
    expect(closePage).toHaveBeenCalledTimes(1);
    expect(closeContext).toHaveBeenCalledTimes(1);
    expect(closeBrowser).toHaveBeenCalledTimes(1);
  });

  it('still cleans up browser resources when navigation fails', async () => {
    const closePage = vi.fn(async () => undefined);
    const closeContext = vi.fn(async () => undefined);
    const closeBrowser = vi.fn(async () => undefined);

    const page = {
      goto: vi.fn(async () => {
        throw new Error('navigation failed');
      }),
      waitForLoadState: vi.fn(async () => undefined),
      content: vi.fn(async () => ''),
      close: closePage
    };

    const context = {
      newPage: vi.fn(async () => page),
      close: closeContext
    };

    const browser = {
      newContext: vi.fn(async () => context),
      close: closeBrowser
    };

    const result = await headlessFetch('https://example.com', {
      resolveBrowser: vi.fn().mockResolvedValue({
        ok: true,
        executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
        browser: 'chrome'
      }),
      launchBrowser: vi.fn(async () => browser)
    });

    expect(result).toMatchObject({
      status: 'error',
      error: { code: 'HEADLESS_NAVIGATION_FAILED' }
    });
    expect(closePage).toHaveBeenCalledTimes(1);
    expect(closeContext).toHaveBeenCalledTimes(1);
    expect(closeBrowser).toHaveBeenCalledTimes(1);
  });

  it('uses safe extraction for rendered pages with broken stylesheet content', async () => {
    const result = await headlessFetch('https://example.com/broken-css', {
      resolveBrowser: vi.fn().mockResolvedValue({
        ok: true,
        browser: 'edge',
        executablePath: 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
      }),
      launchBrowser: vi.fn(async () => ({
        newContext: async () => ({
          newPage: async () => ({
            goto: async () => undefined,
            waitForLoadState: async () => undefined,
            content: async () => `
              <html>
                <head>
                  <title>Broken CSS Page</title>
                  <style>
                    .btn {
                      color: red;
                      &:hover {
                        color: blue;
                      }
                    }
                  </style>
                </head>
                <body>
                  <main>
                    <h1>Broken CSS Page</h1>
                    <p>Main content starts here.</p>
                    <p>Show more Show more Show more Show more</p>
                    <p>Useful details for the user.</p>
                    <p>Privacy Terms Privacy Terms Privacy Terms</p>
                  </main>
                </body>
              </html>
            `,
            close: async () => undefined
          }),
          close: async () => undefined
        }),
        close: async () => undefined
      })),
      now: (() => {
        let tick = 0;
        return () => (tick += 100);
      })()
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok' || !result.content) return;
    expect(result.content.title).toBe('Broken CSS Page');
    expect(result.content.text).toContain('Main content starts here.');
    expect(result.content.text).toContain('Useful details for the user.');
    expect(result.content.text.match(/Show more/g)?.length ?? 0).toBeLessThan(4);
    expect(result.content.text.match(/Privacy Terms/g)?.length ?? 0).toBeLessThan(3);
  });

  it('passes the proxy to the browser launch options', async () => {
    const launchBrowser = vi.fn(async () => ({
      newContext: async () => ({
        newPage: async () => ({
          goto: async () => undefined,
          waitForLoadState: async () => undefined,
          content: async () =>
            '<html><body><article><p>Rendered content that is long enough for extraction to consider it reliable enough.</p></article></body></html>',
          close: async () => undefined
        }),
        close: async () => undefined
      }),
      close: async () => undefined
    }));

    const result = await headlessFetch('https://example.com', {
      resolveBrowser: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: 'BROWSER_NOT_FOUND',
          message: 'No compatible local browser was found for headless fetch.'
        }
      }),
      launchBrowser,
      proxy: { server: 'http://127.0.0.1:7890', username: 'user', password: 'secret' }
    });

    expect(result.status).toBe('ok');
    expect(launchBrowser).toHaveBeenCalledWith({
      headless: true,
      proxy: { server: 'http://127.0.0.1:7890', username: 'user', password: 'secret' }
    });
  });
});


describe('headless private address guard', () => {
  const resolveBrowser = vi.fn().mockResolvedValue({ ok: true, browser: 'chromium', executablePath: '/usr/bin/chromium' });
  const readable =
    '<html><body><article><p>Rendered page with plenty of readable content so extraction succeeds here.</p></article></body></html>';

  function fakeProxy(refusals: Refusal[] = []): GuardProxy {
    return {
      url: 'http://127.0.0.1:9',
      client: vi.fn(() => ({ server: 'http://127.0.0.1:9', username: 'headless-1', password: 'pw' })),
      sequence: vi.fn(() => 0),
      refusalsSince: vi.fn(() => refusals),
      close: vi.fn(async () => undefined)
    };
  }

  function refusal(host: string, error: GuardError = new BlockedAddressError(host, '10.0.0.9')): Refusal {
    return { seq: 1, client: 'headless-1', host, error };
  }

  function fakeBrowser(page: Record<string, unknown>) {
    const newContext = vi.fn(async () => ({ newPage: async () => page, close: async () => undefined }));
    const launchBrowser = vi.fn(async () => ({ newContext, close: async () => undefined }));
    return { launchBrowser, newContext };
  }

  /** `goto` receives `emit`, which fires a passive 'request' event like Playwright does for each navigation hop. */
  function page(goto: (emit: (url: string, navigation?: boolean) => void) => Promise<unknown>) {
    const listeners: Array<(request: unknown) => void> = [];
    const mainFrame = {};
    const emit = (url: string, navigation = true) => {
      for (const listener of listeners) {
        listener({ url: () => url, isNavigationRequest: () => navigation, frame: () => mainFrame });
      }
    };
    return {
      on: vi.fn((event: string, listener: (request: unknown) => void) => {
        if (event === 'request') listeners.push(listener);
      }),
      mainFrame: () => mainFrame,
      goto: vi.fn(() => goto(emit)),
      waitForLoadState: vi.fn(async () => undefined),
      content: vi.fn(async () => readable),
      close: vi.fn(async () => undefined)
    };
  }

  const guard = createNetworkGuard({}, { lookup: fakeLookup({ 'example.com': ['93.184.216.34'] }) });

  it('refuses a private main url without starting the proxy or a browser', async () => {
    const getProxy = vi.fn(async () => fakeProxy());
    const launchBrowser = vi.fn();

    const result = await headlessFetch('http://169.254.169.254/latest/meta-data/', {
      resolveBrowser,
      launchBrowser: launchBrowser as any,
      guard,
      guardProxy: getProxy
    });

    expect(result).toMatchObject({ status: 'error', error: { code: 'BLOCKED_PRIVATE_ADDRESS' } });
    expect(getProxy).not.toHaveBeenCalled();
    expect(launchBrowser).not.toHaveBeenCalled();
  });

  it('launches the browser against the guard proxy with no loopback bypass and service workers blocked', async () => {
    const { launchBrowser, newContext } = fakeBrowser(
      page(async (emit) => {
        emit('https://example.com/');
        return { headers: () => ({}) };
      })
    );

    const result = await headlessFetch('https://example.com/', {
      resolveBrowser,
      launchBrowser,
      guard,
      guardProxy: async () => fakeProxy()
    });

    expect(result.status).toBe('ok');
    expect(launchBrowser).toHaveBeenCalledWith(
      expect.objectContaining({
        proxy: { server: 'http://127.0.0.1:9', username: 'headless-1', password: 'pw', bypass: '<-loopback>' }
      })
    );
    expect(newContext).toHaveBeenCalledWith({ serviceWorkers: 'block' });
  });

  it('reports a refused redirect hop of the navigation as the cause', async () => {
    const blocked = refusal('evil.example');
    const { launchBrowser } = fakeBrowser(
      page(async (emit) => {
        emit('https://example.com/');
        emit('https://evil.example/steal');
        throw new Error('net::ERR_TUNNEL_CONNECTION_FAILED at https://evil.example/steal');
      })
    );

    const result = await headlessFetch('https://example.com/', {
      resolveBrowser,
      launchBrowser,
      guard,
      guardProxy: async () => fakeProxy([blocked])
    });

    expect(result).toMatchObject({ status: 'error', error: { code: 'BLOCKED_PRIVATE_ADDRESS', message: blocked.error.message } });
  });

  it('reports a navigation response carrying the blocked header as blocked', async () => {
    const blocked = refusal('nope.example', new UnverifiedDestinationError('nope.example'));
    const { launchBrowser } = fakeBrowser(
      page(async (emit) => {
        emit('https://example.com/');
        emit('http://nope.example/');
        return { headers: () => ({ 'x-pi-web-agent-blocked': 'BLOCKED_PRIVATE_ADDRESS x' }) };
      })
    );

    const result = await headlessFetch('https://example.com/', {
      resolveBrowser,
      launchBrowser,
      guard,
      guardProxy: async () => fakeProxy([blocked])
    });

    expect(result).toMatchObject({ status: 'error', error: { message: blocked.error.message } });
  });

  it('keeps the original navigation error when only a subresource was refused', async () => {
    const { launchBrowser } = fakeBrowser(
      page(async (emit) => {
        emit('https://example.com/');
        emit('https://img.example/pixel.png', false);
        throw new Error('net::ERR_CONNECTION_RESET at https://example.com/');
      })
    );

    const result = await headlessFetch('https://example.com/', {
      resolveBrowser,
      launchBrowser,
      guard,
      guardProxy: async () => fakeProxy([refusal('img.example')])
    });

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('HEADLESS_NAVIGATION_FAILED');
    expect(result.error?.message).toContain('ERR_CONNECTION_RESET');
    expect(result.metadata.blockedSubresources).toBe(1);
  });

  it('counts refused subresources on a page that loaded', async () => {
    const { launchBrowser } = fakeBrowser(
      page(async (emit) => {
        emit('https://example.com/');
        return { headers: () => ({}) };
      })
    );

    const result = await headlessFetch('https://example.com/', {
      resolveBrowser,
      launchBrowser,
      guard,
      guardProxy: async () => fakeProxy([refusal('evil.example'), refusal('evil.example')])
    });

    expect(result.status).toBe('ok');
    expect(result.metadata.blockedSubresources).toBe(2);
  });

  it('refuses to run with a guard but no guard proxy', async () => {
    const launchBrowser = vi.fn();

    const result = await headlessFetch('https://example.com/', { resolveBrowser, launchBrowser: launchBrowser as any, guard });

    expect(result).toMatchObject({ status: 'error', error: { code: 'BLOCKED_PRIVATE_ADDRESS' } });
    expect(launchBrowser).not.toHaveBeenCalled();
  });
});
