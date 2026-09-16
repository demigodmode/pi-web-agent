import { chromium } from 'playwright';
import { extractReadableContentSafely } from '../extract/readability.js';
import { resolveBrowserExecutable, type BrowserResolutionResult } from './browser-resolution.js';
import { BLOCKED_PRIVATE_ADDRESS, BlockedAddressError, type GuardVerdict, type NetworkGuard } from './network-guard.js';
import type { WebFetchHeadlessResponse } from '../types.js';

export type BrowserProxyOptions = {
  server: string;
  username?: string;
  password?: string;
};

type BlockedNavigation = { host: string; address?: string; unresolved?: true };

function cleanupRenderedText(text: string): string {
  let cleaned = text.replace(/(Show more)(\s+\1){1,}/gi, '$1');
  cleaned = cleaned.replace(/(Privacy Terms)(\s+\1){1,}/gi, '$1');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

function blockedResult(url: string, host: string, address: string): WebFetchHeadlessResponse {
  const error = new BlockedAddressError(host, address);
  return {
    status: 'error',
    url,
    metadata: { method: 'headless', cacheHit: false },
    error: { code: error.code, message: error.message }
  };
}

/** Used when the guard couldn't resolve a host at all (see the DNS-rebinding note below). */
function unresolvedBlockedResult(url: string, host: string): WebFetchHeadlessResponse {
  return {
    status: 'error',
    url,
    metadata: { method: 'headless', cacheHit: false },
    error: {
      code: BLOCKED_PRIVATE_ADDRESS,
      message: `Blocked ${host}: could not verify its address before loading it in the browser.`
    }
  };
}

function blockedNavigationResult(url: string, blocked: BlockedNavigation): WebFetchHeadlessResponse {
  return blocked.unresolved
    ? unresolvedBlockedResult(url, blocked.host)
    : blockedResult(url, blocked.host, blocked.address as string);
}

/** Used when this Playwright build/context can't give us the hooks the guard depends on. */
function enforcementUnavailableResult(url: string): WebFetchHeadlessResponse {
  let host = url;
  try {
    host = new URL(url).hostname || url;
  } catch {
    // keep the raw url as the best available label
  }
  return {
    status: 'error',
    url,
    metadata: { method: 'headless', cacheHit: false },
    error: {
      code: BLOCKED_PRIVATE_ADDRESS,
      message: `Blocked ${host}: the browser could not enforce the private address guard.`
    }
  };
}

export async function headlessFetch(
  url: string,
  {
    configuredPath,
    proxy,
    guard,
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
    proxy?: BrowserProxyOptions;
    guard?: NetworkGuard;
    resolveBrowser?: (options?: { configuredPath?: string }) => Promise<BrowserResolutionResult>;
    launchBrowser?: (options: { executablePath?: string; headless: true; proxy?: BrowserProxyOptions }) => Promise<{
      newContext: (options?: { serviceWorkers?: 'block' }) => Promise<{
        newPage: () => Promise<any>;
        route?(pattern: string, handler: (route: any) => unknown): Promise<unknown>;
        routeWebSocket?(pattern: unknown, handler: (ws: any) => unknown): Promise<unknown>;
        close: () => Promise<void>;
      }>;
      close: () => Promise<void>;
    }>;
    now?: () => number;
  } = {}
): Promise<WebFetchHeadlessResponse> {
  if (guard) {
    let hostname: string | undefined;
    try {
      hostname = new URL(url).hostname;
    } catch {
      hostname = undefined; // not a URL; the tools reject it with UNSUPPORTED_URL
    }
    if (hostname) {
      const verdict = await guard.checkHost(hostname);
      if (!verdict.allowed) {
        // Refuse before launching a browser at all.
        return blockedResult(url, verdict.host, verdict.address);
      }
      // DNS rebinding: this check and Chromium's own resolution happen at
      // different times, so this is best effort, not a hard guarantee -- see
      // the note below. When the guard can't get an answer at all, refuse
      // rather than let Chromium load an address we never got to see, unless
      // a proxy is configured: then the proxy resolves names and local DNS
      // legitimately differs.
      if (verdict.unresolved && !proxy) {
        return unresolvedBlockedResult(url, hostname);
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

  const browserName = resolved.ok ? resolved.browser : 'chromium';
  const launchOptions = resolved.ok
    ? { executablePath: resolved.executablePath, headless: true as const, ...(proxy ? { proxy } : {}) }
    : { headless: true as const, ...(proxy ? { proxy } : {}) };

  let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
  let context: Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>['newContext']>> | undefined;
  let page: Awaited<ReturnType<Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>['newContext']>>['newPage']>> | undefined;
  let blockedSubresources = 0;
  let blockedNavigation: BlockedNavigation | undefined;

  try {
    browser = await launchBrowser(launchOptions);
    // Blocking service workers keeps them from fetching on the page's behalf
    // outside of page/context routing, which would otherwise bypass the guard.
    context = await browser.newContext(guard ? { serviceWorkers: 'block' } : undefined);

    if (guard) {
      // Both hooks fail open if missing: page.route/context.route silently
      // never firing, or an unrouted WebSocket connecting straight out, would
      // let the model-chosen page reach a private address unguarded. Refuse
      // rather than proceed without the enforcement the rest of this function
      // assumes is in place.
      if (typeof context.route !== 'function' || typeof context.routeWebSocket !== 'function') {
        return enforcementUnavailableResult(url);
      }

      const verdicts = new Map<string, Promise<GuardVerdict>>();
      const getVerdict = (hostname: string): Promise<GuardVerdict> => {
        let verdict = verdicts.get(hostname);
        if (!verdict) {
          verdict = guard.checkHost(hostname);
          verdicts.set(hostname, verdict);
        }
        return verdict;
      };

      // Routed on the context, not the page: page.route only covers the page
      // it's called on, so a popup or a window.open target would otherwise
      // load unguarded. Registered before newPage() so it's in place for the
      // very first navigation.
      await context.route('**/*', async (route: any) => {
        const request = route.request();
        let hostname: string;
        try {
          const parsed = new URL(request.url());
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            await route.continue();
            return;
          }
          hostname = parsed.hostname;
        } catch {
          await route.continue();
          return;
        }

        const outcome = await getVerdict(hostname);
        const blocked: BlockedNavigation | undefined = !outcome.allowed
          ? { host: outcome.host, address: outcome.address }
          : outcome.unresolved && !proxy
            ? { host: hostname, unresolved: true }
            : undefined;

        if (!blocked) {
          await route.continue();
          return;
        }

        // Chromium re-resolves DNS itself after this check, so a host that
        // rebinds between here and the real connection is not fully closed
        // off -- this is best effort, same as the pre-launch check above.
        // Popups have their own main frame, so it won't match `page`'s and a
        // blocked popup navigation is counted as a subresource, which is fine:
        // it still never loads.
        if (request.isNavigationRequest() && request.frame() === page?.mainFrame()) {
          blockedNavigation = blocked;
        } else {
          // Not reported to the model: it adds nothing it can act on.
          blockedSubresources += 1;
        }
        await route.abort('blockedbyclient');
      });

      // WebSockets aren't covered by page.route/context.route, so they get
      // their own hook (presence checked above).
      await context.routeWebSocket(/.*/, async (ws: any) => {
        let hostname: string;
        try {
          hostname = new URL(ws.url()).hostname;
        } catch {
          ws.connectToServer();
          return;
        }
        const outcome = await getVerdict(hostname);
        const blocked = !outcome.allowed || (outcome.unresolved === true && !proxy);
        if (blocked) {
          await ws.close();
        } else {
          ws.connectToServer();
        }
      });
    }

    page = await context.newPage();

    const startedAt = now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    if (blockedNavigation) {
      return blockedNavigationResult(url, blockedNavigation);
    }
    await page.waitForLoadState('load', { timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
    const html = await page.content();
    const finishedAt = now();

    const extraction = extractReadableContentSafely(html);
    const cleanedContent = {
      ...extraction.content,
      text: cleanupRenderedText(extraction.content.text)
    };

    if (!cleanedContent.text || cleanedContent.text.length < 40) {
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
        truncated: cleanedContent.text.length >= 4000,
        ...(blockedSubresources > 0 ? { blockedSubresources } : {})
      }
    };
  } catch (error) {
    if (blockedNavigation) {
      return blockedNavigationResult(url, blockedNavigation);
    }
    return {
      status: 'error',
      url,
      metadata: {
        method: 'headless',
        cacheHit: false,
        browser: browserName
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
