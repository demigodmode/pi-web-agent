import { chromium } from 'playwright';
import { extractReadableContentForQuery, extractReadableContentSafely } from '../extract/readability.js';
import { resolveBrowserExecutable, type BrowserResolutionResult } from './browser-resolution.js';
import { BLOCKED_HEADER, type GuardProxy } from './guard-proxy.js';
import { BLOCKED_PRIVATE_ADDRESS, BlockedAddressError, UPSTREAM_PROXY_REFUSED, type NetworkGuard } from './network-guard.js';
import type { WebFetchHeadlessResponse } from '../types.js';

export type BrowserProxyOptions = {
  server: string;
  username?: string;
  password?: string;
  bypass?: string;
};

function cleanupRenderedText(text: string): string {
  let cleaned = text.replace(/(Show more)(\s+\1){1,}/gi, '$1');
  cleaned = cleaned.replace(/(Privacy Terms)(\s+\1){1,}/gi, '$1');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

function errorResult(url: string, code: string, message: string): WebFetchHeadlessResponse {
  const guard = code === BLOCKED_PRIVATE_ADDRESS || code === UPSTREAM_PROXY_REFUSED;
  return {
    status: 'error',
    url,
    metadata: { method: 'headless', cacheHit: false },
    error: { code, message, ...(guard ? { failure: { kind: 'guard_refused' as const } } : {}) }
  };
}

function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/** Same normalization the guard applies, so refusal hosts and navigation hosts compare equal. */
function normalizeHost(host: string): string {
  return host.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.+$/, '');
}

export async function headlessFetch(
  url: string,
  {
    configuredPath,
    query,
    proxy,
    guard,
    guardProxy,
    resolveBrowser = (options?: { configuredPath?: string }) =>
      resolveBrowserExecutable({ configuredPath: options?.configuredPath }),
    launchBrowser = ({ executablePath, headless, proxy }: {
      executablePath?: string;
      headless: true;
      proxy?: BrowserProxyOptions;
    }) =>
      chromium.launch(
        executablePath ? { executablePath, headless, ...(proxy ? { proxy } : {}) } : { headless, ...(proxy ? { proxy } : {}) }
      ),
    now = () => Date.now()
  }: {
    configuredPath?: string;
    query?: string;
    /** Only used without a guard. With a guard, Chromium always goes through the guard proxy, which chains upstream itself. */
    proxy?: BrowserProxyOptions;
    guard?: NetworkGuard;
    guardProxy?: () => Promise<GuardProxy>;
    resolveBrowser?: (options?: { configuredPath?: string }) => Promise<BrowserResolutionResult>;
    launchBrowser?: (options: { executablePath?: string; headless: true; proxy?: BrowserProxyOptions }) => Promise<{
      newContext: (options?: { serviceWorkers?: 'block' }) => Promise<{
        newPage: () => Promise<any>;
        close: () => Promise<void>;
      }>;
      close: () => Promise<void>;
    }>;
    now?: () => number;
  } = {}
): Promise<WebFetchHeadlessResponse> {
  if (guard) {
    const hostname = hostnameOf(url);
    if (!guardProxy) {
      // Enforcement lives in the guard proxy. Without it, loading the page would be unguarded.
      return errorResult(
        url,
        BLOCKED_PRIVATE_ADDRESS,
        `Blocked ${hostname ?? url}: the browser could not enforce the private address guard.`
      );
    }
    if (hostname) {
      // Early, clearer refusal for an obviously blocked main url. The guard
      // proxy is what actually enforces the policy for every connection.
      const verdict = await guard.checkHost(hostname);
      if (!verdict.allowed) {
        const error = new BlockedAddressError(verdict.host, verdict.address);
        return errorResult(url, error.code, error.message);
      }
    }
  }

  const resolved = await resolveBrowser({ configuredPath });
  if (!resolved.ok && resolved.error.code === 'CONFIGURED_BROWSER_NOT_FOUND') {
    return {
      status: 'error',
      url,
      metadata: { method: 'headless', cacheHit: false },
      error: resolved.error
    };
  }

  let enforcement: { proxy: GuardProxy; username: string; since: number; launchProxy: BrowserProxyOptions } | undefined;
  if (guard && guardProxy) {
    let activeProxy: GuardProxy;
    try {
      activeProxy = await guardProxy();
    } catch {
      // The guard proxy could not start (backend set closed, or the listener
      // failed). Enforcement lives there, so the browser must not launch.
      return errorResult(
        url,
        BLOCKED_PRIVATE_ADDRESS,
        `Blocked ${hostnameOf(url) ?? url}: the private address guard is not available, so the browser was not started.`
      );
    }
    const client = activeProxy.client('headless');
    enforcement = {
      proxy: activeProxy,
      username: client.username,
      since: activeProxy.sequence(),
      // `<-loopback>` removes Chromium's implicit loopback bypass, so localhost
      // and link-local connections go through the guard proxy too.
      launchProxy: { server: client.server, username: client.username, password: client.password, bypass: '<-loopback>' }
    };
  }

  const effectiveProxy = enforcement ? enforcement.launchProxy : proxy;
  const browserName = resolved.ok ? resolved.browser : 'chromium';
  const launchOptions = resolved.ok
    ? { executablePath: resolved.executablePath, headless: true as const, ...(effectiveProxy ? { proxy: effectiveProxy } : {}) }
    : { headless: true as const, ...(effectiveProxy ? { proxy: effectiveProxy } : {}) };

  // Browser requests that failed or were refused by the proxy, from passive
  // page events only. Navigation hosts decide whether a refusal caused the
  // navigation error; subresource failures are counted one per request.
  const failedNavigationHosts = new Set<string>();
  const failedSubresourceHosts: string[] = [];
  const seenRequests = new WeakSet<object>();
  const refusals = () => (enforcement ? enforcement.proxy.refusalsSince(enforcement.username, enforcement.since) : []);
  const navigationRefusal = () => refusals().find((entry) => failedNavigationHosts.has(entry.host));
  const subresourceRefusals = () => {
    const refusedHosts = new Set(refusals().map((entry) => entry.host));
    return failedSubresourceHosts.filter((host) => refusedHosts.has(host)).length;
  };

  let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
  let context: Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>['newContext']>> | undefined;
  let page: any;

  try {
    browser = await launchBrowser(launchOptions);
    // Service workers can fetch on a page's behalf; blocking them keeps the page's traffic simple to account for.
    context = await browser.newContext(enforcement ? { serviceWorkers: 'block' } : undefined);
    if (enforcement) {
      // Watch every page in the context: popups opened by the page can hit blocked
      // hosts too. Only the primary page's main-frame navigation is "the navigation".
      let primaryPage: any;
      const recordRequest = (request: any) => {
        try {
          if (!request || seenRequests.has(request)) return;
          seenRequests.add(request);
          const host = normalizeHost(new URL(request.url()).hostname);
          if (primaryPage && request.isNavigationRequest() && request.frame() === primaryPage.mainFrame()) {
            failedNavigationHosts.add(host);
          } else {
            failedSubresourceHosts.push(host);
          }
        } catch {
          // Unparseable URL or a detached frame: nothing to attribute.
        }
      };
      const watchPage = (watched: any) => {
        watched?.on?.('requestfailed', recordRequest);
        watched?.on?.('response', (response: any) => {
          try {
            if (response.headers()[BLOCKED_HEADER]) recordRequest(response.request());
          } catch {
            // ignore
          }
        });
        // Best effort: Playwright doesn't say why a WebSocket died, so an error or a
        // close before any frame counts as failed. Only refused hosts get counted.
        watched?.on?.('websocket', (ws: any) => {
          let host: string;
          try {
            host = normalizeHost(new URL(ws.url()).hostname);
          } catch {
            return;
          }
          let framed = false;
          let recorded = false;
          const fail = () => {
            if (recorded) return;
            recorded = true;
            failedSubresourceHosts.push(host);
          };
          ws.on?.('framereceived', () => (framed = true));
          ws.on?.('framesent', () => (framed = true));
          ws.on?.('socketerror', fail);
          ws.on?.('close', () => {
            if (!framed) fail();
          });
        });
      };
      const watchedPages = new WeakSet<object>();
      const watchOnce = (candidate: any) => {
        if (!candidate || watchedPages.has(candidate)) return;
        watchedPages.add(candidate);
        watchPage(candidate);
      };
      // Registered before newPage(), so the primary page's own 'page' event is covered too.
      (context as any).on?.('page', watchOnce);
      page = await context.newPage();
      primaryPage = page;
      watchOnce(page);
    } else {
      page = await context.newPage();
    }

    const startedAt = now();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    if (enforcement && response?.headers?.()[BLOCKED_HEADER]) {
      // Normally already recorded by the 'response' event; this covers it if not.
      try {
        const request = response.request?.();
        if (request && !seenRequests.has(request)) {
          seenRequests.add(request);
          failedNavigationHosts.add(normalizeHost(new URL(request.url()).hostname));
        }
      } catch {
        // ignore
      }
      const cause = navigationRefusal();
      if (cause) return errorResult(url, cause.error.code, cause.error.message);
    }
    await page.waitForLoadState('load', { timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
    const html = await page.content();
    const finishedAt = now();

    const blockedSubresources = subresourceRefusals();
    const baselineExtraction = extractReadableContentSafely(html);
    const queryExtraction = query ? extractReadableContentForQuery(html, query) : undefined;
    const extraction = queryExtraction ?? baselineExtraction;
    const cleanedBaselineText = cleanupRenderedText(baselineExtraction.content.text);
    const cleanedContent = {
      ...extraction.content,
      text: cleanupRenderedText(extraction.content.text)
    };

    if (!cleanedBaselineText || cleanedBaselineText.length < 40) {
      return {
        status: 'blocked',
        url,
        metadata: {
          method: 'headless',
          cacheHit: false,
          browser: browserName,
          navigationMs: finishedAt - startedAt,
          ...(blockedSubresources > 0 ? { blockedSubresources } : {})
        },
        error: {
          code: 'HEADLESS_EXTRACTION_WEAK',
          message: 'Rendered page did not produce enough readable content.'
        }
      };
    }

    return {
      status: 'ok',
      url,
      content: cleanedContent,
      metadata: {
        method: 'headless',
        cacheHit: false,
        browser: browserName,
        navigationMs: finishedAt - startedAt,
        truncated: queryExtraction?.omitted ?? cleanedContent.text.length >= 4000,
        ...(blockedSubresources > 0 ? { blockedSubresources } : {})
      }
    };
  } catch (error) {
    const cause = navigationRefusal();
    if (cause) return errorResult(url, cause.error.code, cause.error.message);
    const blockedSubresources = subresourceRefusals();
    return {
      status: 'error',
      url,
      metadata: {
        method: 'headless',
        cacheHit: false,
        browser: browserName,
        ...(blockedSubresources > 0 ? { blockedSubresources } : {})
      },
      error: {
        code: 'HEADLESS_NAVIGATION_FAILED',
        message: error instanceof Error ? error.message : 'Unknown headless navigation failure.'
      }
    };
  } finally {
    await page?.close?.().catch(() => undefined);
    await context?.close?.().catch(() => undefined);
    await browser?.close?.().catch(() => undefined);
  }
}
