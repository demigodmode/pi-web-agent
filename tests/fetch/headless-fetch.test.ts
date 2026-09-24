import { describe, expect, it, vi } from 'vitest';
import { headlessFetch } from '../../src/fetch/headless-fetch.js';
import { createNetworkGuard } from '../../src/fetch/network-guard.js';
import { fakeLookup } from './fake-lookup.js';
import type { GuardProxy, Refusal } from '../../src/fetch/guard-proxy.js';
import { BlockedAddressError, UnverifiedDestinationError, type GuardError } from '../../src/fetch/network-guard.js';

describe('headless fetch', () => {
  it('selects a late relevant rendered section when given a query', async () => {
    const earlyText = 'General documentation background. '.repeat(220);
    const result = await headlessFetch('https://example.com/guide', {
      query: 'cancellation deadline',
      resolveBrowser: vi.fn().mockResolvedValue({ ok: false, error: { code: 'BROWSER_NOT_FOUND', message: 'missing' } }),
      launchBrowser: vi.fn(async () => ({
        newContext: async () => ({
          newPage: async () => ({
            goto: async () => undefined,
            waitForLoadState: async () => undefined,
            content: async () => `<html><body><article><p>${earlyText}</p><h2 id="cancellation">Cancellation deadline</h2><p>The cancellation deadline is 48 hours before departure.</p></article></body></html>`,
            close: async () => undefined
          }),
          close: async () => undefined
        }),
        close: async () => undefined
      }))
    });

    expect(result).toMatchObject({ status: 'ok', content: { sectionAnchor: 'cancellation' }, metadata: { truncated: true } });
    expect(result.content?.text).toContain('48 hours before departure');
    expect(result.content?.text.length).toBeLessThanOrEqual(4000);
  });

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

  type PageEvents = {
    /** A request that went out and came back (optionally carrying headers such as the blocked header). */
    response(url: string, options?: { navigation?: boolean; headers?: Record<string, string> }): { headers: () => Record<string, string> };
    /** A request that failed, like Playwright's 'requestfailed'. */
    failed(url: string, navigation?: boolean): void;
    /** A WebSocket; the returned emitter fires its 'socketerror' / 'framereceived' / 'close' events. */
    websocket(url: string): (event: string) => void;
  };

  /** `goto` receives passive page events shaped like Playwright's: request, response, requestfailed, websocket. */
  function page(goto: (events: PageEvents) => Promise<unknown>) {
    const listeners = new Map<string, Array<(payload: unknown) => void>>();
    const fire = (event: string, payload: unknown) => {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    };
    const mainFrame = {};
    const request = (url: string, navigation: boolean) => {
      const req = { url: () => url, isNavigationRequest: () => navigation, frame: () => mainFrame };
      fire('request', req);
      return req;
    };
    const events: PageEvents = {
      response(url, { navigation = true, headers = {} } = {}) {
        const req = request(url, navigation);
        const res = { headers: () => headers, request: () => req, url: () => url };
        fire('response', res);
        return res;
      },
      failed(url, navigation = true) {
        fire('requestfailed', request(url, navigation));
      },
      websocket(url) {
        const wsListeners = new Map<string, Array<(payload?: unknown) => void>>();
        fire('websocket', {
          url: () => url,
          on: (event: string, listener: (payload?: unknown) => void) => {
            wsListeners.set(event, [...(wsListeners.get(event) ?? []), listener]);
          }
        });
        return (event: string) => {
          for (const listener of wsListeners.get(event) ?? []) listener();
        };
      }
    };
    return {
      on: vi.fn((event: string, listener: (payload: unknown) => void) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      }),
      mainFrame: () => mainFrame,
      goto: vi.fn(() => goto(events)),
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
    expect(result.error?.failure?.kind).toBe('guard_refused');
    expect(getProxy).not.toHaveBeenCalled();
    expect(launchBrowser).not.toHaveBeenCalled();
  });

  it('launches the browser against the guard proxy with no loopback bypass and service workers blocked', async () => {
    const { launchBrowser, newContext } = fakeBrowser(
      page(async (events) => events.response('https://example.com/'))
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
      page(async (events) => {
        events.response('https://example.com/', { headers: { location: 'https://evil.example/steal' } });
        events.failed('https://evil.example/steal');
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
      page(async (events) => {
        events.response('https://example.com/', { headers: { location: 'http://nope.example/' } });
        return events.response('http://nope.example/', { headers: { 'x-pi-web-agent-blocked': 'BLOCKED_PRIVATE_ADDRESS x' } });
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
      page(async (events) => {
        events.response('https://example.com/', { headers: { 'content-type': 'text/html' } });
        events.failed('https://img.example/pixel.png', false);
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
      page(async (events) => {
        const response = events.response('https://example.com/');
        events.failed('https://evil.example/a.js', false);
        events.failed('https://evil.example/b.png', false);
        return response;
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

  it('counts a refused navigation in a popup page as blocked, without failing the primary page', async () => {
    // The popup's own events fire from the primary page's goto, after the context announced it.
    let popupGoto: (events: PageEvents) => Promise<unknown> = async () => undefined;
    const popup = page((events) => popupGoto(events));
    const contextListeners: Array<(page: unknown) => void> = [];
    const primary = page(async (events) => {
      const response = events.response('https://example.com/');
      for (const listener of contextListeners) listener(popup);
      popupGoto = async (popupEvents) => popupEvents.failed('https://evil.example/popup', true);
      await popup.goto();
      return response;
    });
    const context = {
      on: vi.fn((event: string, listener: (page: unknown) => void) => {
        if (event === 'page') contextListeners.push(listener);
      }),
      newPage: async () => primary,
      close: async () => undefined
    };
    const launchBrowser = vi.fn(async () => ({ newContext: async () => context, close: async () => undefined }));

    const result = await headlessFetch('https://example.com/', {
      resolveBrowser,
      launchBrowser,
      guard,
      guardProxy: async () => fakeProxy([refusal('evil.example')])
    });

    expect(context.on).toHaveBeenCalledWith('page', expect.any(Function));
    expect(result.status).toBe('ok');
    expect(result.error).toBeUndefined();
    expect(result.content?.text).toContain('Rendered page');
    expect(result.metadata.blockedSubresources).toBe(1);
  });

  it('counts a refused subresource on the same host as the page that loaded', async () => {
    const { launchBrowser } = fakeBrowser(
      page(async (events) => {
        const response = events.response('https://example.com/');
        events.failed('https://example.com/pixel.png', false);
        return response;
      })
    );

    const result = await headlessFetch('https://example.com/', {
      resolveBrowser,
      launchBrowser,
      guard,
      guardProxy: async () => fakeProxy([refusal('example.com')])
    });

    expect(result.status).toBe('ok');
    expect(result.metadata.blockedSubresources).toBe(1);
  });

  it('counts a header-blocked subresource and a websocket that errored, once per request', async () => {
    const { launchBrowser } = fakeBrowser(
      page(async (events) => {
        const response = events.response('https://example.com/');
        events.response('http://evil.example/frame.html', {
          navigation: false,
          headers: { 'x-pi-web-agent-blocked': 'BLOCKED_PRIVATE_ADDRESS 1 x' }
        });
        const ws = events.websocket('wss://evil.example/socket');
        ws('socketerror');
        ws('close');
        // Not refused, so not counted.
        events.failed('https://cdn.example/lib.js', false);
        return response;
      })
    );

    const result = await headlessFetch('https://example.com/', {
      resolveBrowser,
      launchBrowser,
      guard,
      guardProxy: async () => fakeProxy([refusal('evil.example'), refusal('evil.example'), refusal('evil.example')])
    });

    expect(result.status).toBe('ok');
    expect(result.metadata.blockedSubresources).toBe(2);
  });

  it('gets past the pre-launch check when the lookup never settles', async () => {
    const getProxy = vi.fn(async () => fakeProxy());
    const { launchBrowser } = fakeBrowser(page(async () => ({ headers: () => ({}) })));
    const hanging = createNetworkGuard({}, { lookup: () => new Promise(() => undefined), lookupTimeoutMs: 50 });

    const outcome = await Promise.race([
      headlessFetch('https://slow-dns.example/', { resolveBrowser, launchBrowser, guard: hanging, guardProxy: getProxy }),
      new Promise((resolve) => setTimeout(() => resolve('still pending'), 2000))
    ]);

    expect(outcome).not.toBe('still pending');
    expect(getProxy).toHaveBeenCalled();
  });

  it('refuses to run with a guard but no guard proxy', async () => {
    const launchBrowser = vi.fn();

    const result = await headlessFetch('https://example.com/', { resolveBrowser, launchBrowser: launchBrowser as any, guard });

    expect(result).toMatchObject({ status: 'error', error: { code: 'BLOCKED_PRIVATE_ADDRESS' } });
    expect(launchBrowser).not.toHaveBeenCalled();
  });

  it('refuses without launching the browser when the guard proxy fails to start', async () => {
    const launchBrowser = vi.fn();
    const getProxy = vi.fn(async () => {
      throw new Error('listen EADDRINUSE');
    });

    const result = await headlessFetch('https://example.com/', {
      resolveBrowser,
      launchBrowser: launchBrowser as any,
      guard,
      guardProxy: getProxy
    });

    expect(result).toMatchObject({
      status: 'error',
      error: {
        code: 'BLOCKED_PRIVATE_ADDRESS',
        message: 'Blocked example.com: the private address guard is not available, so the browser was not started.'
      }
    });
    expect(result.error?.failure?.kind).toBe('guard_refused');
    expect(launchBrowser).not.toHaveBeenCalled();
  });
});
