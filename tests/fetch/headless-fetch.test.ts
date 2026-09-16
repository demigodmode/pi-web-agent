import { describe, expect, it, vi } from 'vitest';
import { headlessFetch } from '../../src/fetch/headless-fetch.js';
import { createNetworkGuard } from '../../src/fetch/network-guard.js';
import { fakeLookup } from './fake-lookup.js';

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

  function routedPage(simulate: (dispatch: (url: string, options?: boolean | { navigation?: boolean; frame?: unknown }) => Promise<any>) => Promise<void>) {
    let handler: ((route: any) => Promise<void>) | undefined;
    let socketHandler: ((ws: any) => Promise<void>) | undefined;
    const mainFrame = {};
    const routes: any[] = [];

    const dispatch = async (url: string, options: boolean | { navigation?: boolean; frame?: unknown } = {}) => {
      const navigation = typeof options === 'boolean' ? options : (options.navigation ?? false);
      const frame = typeof options === 'boolean' ? mainFrame : (options.frame ?? mainFrame);
      const route = {
        request: () => ({ url: () => url, isNavigationRequest: () => navigation, frame: () => frame }),
        abort: vi.fn(async () => undefined),
        continue: vi.fn(async () => undefined)
      };
      routes.push(route);
      await handler?.(route);
      return route;
    };

    const page = {
      mainFrame: () => mainFrame,
      goto: vi.fn(async () => simulate(dispatch)),
      waitForLoadState: vi.fn(async () => undefined),
      content: vi.fn(async () => readable),
      close: vi.fn(async () => undefined)
    };

    const context = {
      route: vi.fn(async (_pattern: string, h: (route: any) => Promise<void>) => {
        handler = h;
      }),
      routeWebSocket: vi.fn(async (_pattern: unknown, h: (ws: any) => Promise<void>) => {
        socketHandler = h;
      }),
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined)
    };

    const newContext = vi.fn(async (_options?: { serviceWorkers?: 'block' }) => context);
    const closeBrowser = vi.fn(async () => undefined);

    const launchBrowser = vi.fn(async () => ({
      newContext,
      close: closeBrowser
    }));

    return {
      page,
      context,
      routes,
      launchBrowser,
      newContext,
      closeBrowser,
      dispatchSocket: async (wsUrl: string) => {
        const ws = { url: () => wsUrl, close: vi.fn(async () => undefined), connectToServer: vi.fn() };
        await socketHandler?.(ws);
        return ws;
      }
    };
  }

  const guard = createNetworkGuard(
    {},
    {
      lookup: fakeLookup({
        'example.com': ['93.184.216.34'],
        'cdn.example.com': ['93.184.216.35'],
        'evil.example': ['10.0.0.9']
      })
    }
  );

  it('refuses a private main url without launching a browser', async () => {
    const launchBrowser = vi.fn();

    const result = await headlessFetch('http://169.254.169.254/latest/meta-data/', {
      resolveBrowser,
      launchBrowser: launchBrowser as any,
      guard
    });

    expect(launchBrowser).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'error',
      metadata: { method: 'headless', cacheHit: false },
      error: { code: 'BLOCKED_PRIVATE_ADDRESS' }
    });
  });

  it('aborts private subresources, counts them, and keeps them out of the content', async () => {
    const { routes, launchBrowser } = routedPage(async (dispatch) => {
      await dispatch('https://example.com/', true);
      await dispatch('http://169.254.169.254/latest/meta-data/iam/');
      await dispatch('https://cdn.example.com/app.js');
      await dispatch('data:image/png;base64,AAAA');
    });

    const result = await headlessFetch('https://example.com/', { resolveBrowser, launchBrowser, guard });

    expect(result.status).toBe('ok');
    expect(result.metadata.blockedSubresources).toBe(1);
    expect(routes[0].continue).toHaveBeenCalled();
    expect(routes[1].abort).toHaveBeenCalledWith('blockedbyclient');
    expect(routes[2].continue).toHaveBeenCalled();
    expect(routes[3].continue).toHaveBeenCalled();
    expect(result.content?.text).not.toContain('169.254');
  });

  it('reports a main navigation redirected to a private address as blocked', async () => {
    const { launchBrowser } = routedPage(async (dispatch) => {
      await dispatch('https://example.com/', true);
      await dispatch('http://evil.example/', true);
      throw new Error('net::ERR_BLOCKED_BY_CLIENT at http://evil.example/');
    });

    const result = await headlessFetch('https://example.com/', { resolveBrowser, launchBrowser, guard });

    expect(result).toMatchObject({ status: 'error', error: { code: 'BLOCKED_PRIVATE_ADDRESS' } });
    expect(result.error?.message).toContain('evil.example');
  });

  it('looks each hostname up once per page', async () => {
    const lookup = vi.fn(fakeLookup({ 'example.com': ['93.184.216.34'], 'cdn.example.com': ['93.184.216.35'] }));
    const { launchBrowser } = routedPage(async (dispatch) => {
      await dispatch('https://example.com/', true);
      for (let i = 0; i < 5; i += 1) await dispatch(`https://cdn.example.com/img-${i}.png`);
    });

    await headlessFetch('https://example.com/', {
      resolveBrowser,
      launchBrowser,
      guard: createNetworkGuard({}, { lookup })
    });

    // one call for the pre-launch main url check, one each inside the page
    expect(lookup.mock.calls.filter(([host]) => host === 'cdn.example.com')).toHaveLength(1);
  });

  it('does not intercept requests when no guard is given', async () => {
    const { context, launchBrowser } = routedPage(async () => undefined);

    await headlessFetch('https://example.com/', { resolveBrowser, launchBrowser });

    expect(context.route).not.toHaveBeenCalled();
  });

  it('registers the route on the context so popups and other pages are covered too', async () => {
    const { context, launchBrowser } = routedPage(async () => undefined);

    await headlessFetch('https://example.com/', { resolveBrowser, launchBrowser, guard });

    expect(context.route).toHaveBeenCalled();
  });

  it('aborts a private popup navigation and counts it as a subresource, not the main navigation', async () => {
    const popupFrame = {};
    const { routes, launchBrowser } = routedPage(async (dispatch) => {
      await dispatch('https://example.com/', true);
      await dispatch('http://169.254.169.254/popup', { navigation: true, frame: popupFrame });
    });

    const result = await headlessFetch('https://example.com/', { resolveBrowser, launchBrowser, guard });

    expect(result.status).toBe('ok');
    expect(result.metadata.blockedSubresources).toBe(1);
    expect(routes[1].abort).toHaveBeenCalledWith('blockedbyclient');
  });

  it('requests serviceWorkers: block from the context when a guard is given', async () => {
    const { launchBrowser, newContext } = routedPage(async () => undefined);

    await headlessFetch('https://example.com/', { resolveBrowser, launchBrowser, guard });

    expect(newContext).toHaveBeenCalledWith({ serviceWorkers: 'block' });
  });

  it('does not restrict service workers when no guard is given', async () => {
    const { launchBrowser, newContext } = routedPage(async () => undefined);

    await headlessFetch('https://example.com/', { resolveBrowser, launchBrowser });

    expect(newContext).toHaveBeenCalledWith(undefined);
  });

  it('routes websockets through the guard when the context supports it', async () => {
    const { launchBrowser, dispatchSocket } = routedPage(async () => undefined);

    await headlessFetch('https://example.com/', { resolveBrowser, launchBrowser, guard });

    const blockedSocket = await dispatchSocket('ws://169.254.169.254/socket');
    expect(blockedSocket.close).toHaveBeenCalled();
    expect(blockedSocket.connectToServer).not.toHaveBeenCalled();

    const allowedSocket = await dispatchSocket('wss://example.com/socket');
    expect(allowedSocket.connectToServer).toHaveBeenCalled();
    expect(allowedSocket.close).not.toHaveBeenCalled();
  });

  it('refuses to proceed when the context has no route support, without ever opening a page', async () => {
    const { context, page, launchBrowser, closeBrowser } = routedPage(async () => undefined);
    delete (context as any).route;

    const result = await headlessFetch('https://example.com/', { resolveBrowser, launchBrowser, guard });

    expect(result).toMatchObject({
      status: 'error',
      error: {
        code: 'BLOCKED_PRIVATE_ADDRESS',
        message: 'Blocked example.com: the browser could not enforce the private address guard.'
      }
    });
    expect(context.newPage).not.toHaveBeenCalled();
    expect(page.goto).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalled();
    expect(closeBrowser).toHaveBeenCalled();
    expect(launchBrowser).toHaveBeenCalled();
  });

  it('refuses to proceed when the context has no routeWebSocket support, without ever opening a page', async () => {
    const { context, page, launchBrowser, closeBrowser } = routedPage(async () => undefined);
    delete (context as any).routeWebSocket;

    const result = await headlessFetch('https://example.com/', { resolveBrowser, launchBrowser, guard });

    expect(result).toMatchObject({
      status: 'error',
      error: {
        code: 'BLOCKED_PRIVATE_ADDRESS',
        message: 'Blocked example.com: the browser could not enforce the private address guard.'
      }
    });
    expect(context.newPage).not.toHaveBeenCalled();
    expect(page.goto).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalled();
    expect(closeBrowser).toHaveBeenCalled();
  });

  it('does not require route or routeWebSocket on the context when no guard is given', async () => {
    const { context, launchBrowser } = routedPage(async () => undefined);
    delete (context as any).route;
    delete (context as any).routeWebSocket;

    await expect(headlessFetch('https://example.com/', { resolveBrowser, launchBrowser })).resolves.toMatchObject({
      status: 'ok'
    });
  });

  it('blocks the main navigation when the host cannot be resolved and no proxy is configured', async () => {
    const launchBrowser = vi.fn();
    const unresolvableGuard = createNetworkGuard({}, { lookup: fakeLookup({}) });

    const result = await headlessFetch('https://unresolvable.example/', {
      resolveBrowser,
      launchBrowser: launchBrowser as any,
      guard: unresolvableGuard
    });

    expect(launchBrowser).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'error',
      error: {
        code: 'BLOCKED_PRIVATE_ADDRESS',
        message: 'Blocked unresolvable.example: could not verify its address before loading it in the browser.'
      }
    });
  });

  it('allows the main navigation when the host is unresolvable but a proxy is configured', async () => {
    const { launchBrowser } = routedPage(async (dispatch) => {
      await dispatch('https://unresolvable.example/', true);
    });
    const unresolvableGuard = createNetworkGuard({}, { lookup: fakeLookup({}) });

    const result = await headlessFetch('https://unresolvable.example/', {
      resolveBrowser,
      launchBrowser,
      guard: unresolvableGuard,
      proxy: { server: 'http://127.0.0.1:7890' }
    });

    expect(launchBrowser).toHaveBeenCalled();
    expect(result.status).toBe('ok');
  });

  it('aborts an unresolvable subresource and counts it when no proxy is configured', async () => {
    const { routes, launchBrowser } = routedPage(async (dispatch) => {
      await dispatch('https://example.com/', true);
      await dispatch('https://unresolvable.example/asset.js');
    });
    const partiallyResolvableGuard = createNetworkGuard(
      {},
      { lookup: fakeLookup({ 'example.com': ['93.184.216.34'] }) }
    );

    const result = await headlessFetch('https://example.com/', {
      resolveBrowser,
      launchBrowser,
      guard: partiallyResolvableGuard
    });

    expect(result.status).toBe('ok');
    expect(result.metadata.blockedSubresources).toBe(1);
    expect(routes[1].abort).toHaveBeenCalledWith('blockedbyclient');
  });

  it('leaves the http-path guard behavior unchanged for unresolved hosts', async () => {
    const unresolvableGuard = createNetworkGuard({}, { lookup: fakeLookup({}) });
    const verdict = await unresolvableGuard.checkHost('unresolvable.example');
    expect(verdict).toEqual({ allowed: true, unresolved: true });
  });
});
