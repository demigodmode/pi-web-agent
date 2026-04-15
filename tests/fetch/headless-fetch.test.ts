import { describe, expect, it, vi } from 'vitest';
import { headlessFetch } from '../../src/fetch/headless-fetch.js';

describe('headless fetch', () => {
  it('returns a startup error when no browser can be resolved', async () => {
    const result = await headlessFetch('https://example.com', {
      resolveBrowser: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: 'BROWSER_NOT_FOUND',
          message: 'No compatible local browser was found for headless fetch.'
        }
      })
    });

    expect(result).toMatchObject({
      status: 'error',
      error: { code: 'BROWSER_NOT_FOUND' },
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

  it('cleans up obviously repetitive boilerplate in rendered content', async () => {
    const result = await headlessFetch('https://example.com/app', {
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
                <head><title>Busy App</title></head>
                <body>
                  <main>
                    <h1>Busy App</h1>
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
    if (result.status !== 'ok') return;
    expect(result.content.text).toContain('Main content starts here.');
    expect(result.content.text).toContain('Useful details for the user.');
    expect(result.content.text.match(/Show more/g)?.length ?? 0).toBeLessThan(4);
    expect(result.content.text.match(/Privacy Terms/g)?.length ?? 0).toBeLessThan(3);
  });
});
