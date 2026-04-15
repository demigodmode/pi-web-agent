import { chromium } from 'playwright-core';
import { extractReadableContent } from '../extract/readability.js';
import { resolveBrowserExecutable, type BrowserResolutionResult } from './browser-resolution.js';
import type { WebFetchHeadlessResponse } from '../types.js';

export async function headlessFetch(
  url: string,
  {
    configuredPath,
    resolveBrowser = (options?: { configuredPath?: string }) =>
      resolveBrowserExecutable({ configuredPath: options?.configuredPath }),
    launchBrowser = ({ executablePath }: { executablePath: string }) =>
      chromium.launch({ executablePath, headless: true }),
    now = () => Date.now()
  }: {
    configuredPath?: string;
    resolveBrowser?: (options?: { configuredPath?: string }) => Promise<BrowserResolutionResult>;
    launchBrowser?: (options: { executablePath: string }) => Promise<{
      newContext: () => Promise<{ newPage: () => Promise<any>; close: () => Promise<void> }>;
      close: () => Promise<void>;
    }>;
    now?: () => number;
  } = {}
): Promise<WebFetchHeadlessResponse> {
  const resolved = await resolveBrowser({ configuredPath });
  if (!resolved.ok) {
    return {
      status: 'error',
      url,
      metadata: { method: 'headless', cacheHit: false },
      error: resolved.error
    };
  }

  let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
  let context: Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>['newContext']>> | undefined;
  let page: Awaited<ReturnType<Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>['newContext']>>['newPage']>> | undefined;

  try {
    browser = await launchBrowser({ executablePath: resolved.executablePath });
    context = await browser.newContext();
    page = await context.newPage();

    const startedAt = now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('load', { timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
    const html = await page.content();
    const finishedAt = now();

    const content = extractReadableContent(html);
    if (!content.text || content.text.length < 40) {
      return {
        status: 'blocked',
        url,
        metadata: {
          method: 'headless',
          cacheHit: false,
          browser: resolved.browser,
          navigationMs: finishedAt - startedAt
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
      content,
      metadata: {
        method: 'headless',
        cacheHit: false,
        browser: resolved.browser,
        navigationMs: finishedAt - startedAt,
        truncated: content.text.length >= 4000
      }
    };
  } catch (error) {
    return {
      status: 'error',
      url,
      metadata: {
        method: 'headless',
        cacheHit: false,
        browser: resolved.browser
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
