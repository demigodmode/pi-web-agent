import { describe, expect, it, vi } from 'vitest';
import { resolveBrowserExecutable } from '../../src/fetch/browser-resolution.js';

describe('browser resolution', () => {
  it('prefers an explicit configured browser path', async () => {
    const result = await resolveBrowserExecutable({
      configuredPath: 'C:/Browsers/Chrome/chrome.exe',
      fileExists: vi.fn(async (path) => path === 'C:/Browsers/Chrome/chrome.exe')
    });

    expect(result).toEqual({
      ok: true,
      executablePath: 'C:/Browsers/Chrome/chrome.exe',
      browser: 'configured'
    });
  });

  it('falls back to detected Windows Chrome before Edge', async () => {
    const result = await resolveBrowserExecutable({
      platform: 'win32',
      fileExists: vi.fn(async (path) =>
        path === 'C:/Program Files/Google/Chrome/Application/chrome.exe'
      )
    });

    expect(result).toEqual({
      ok: true,
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      browser: 'chrome'
    });
  });

  it('returns a structured startup error when no browser exists', async () => {
    const result = await resolveBrowserExecutable({
      fileExists: vi.fn(async () => false)
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'BROWSER_NOT_FOUND',
        message: 'No compatible local browser was found for headless fetch.'
      }
    });
  });

  it('detects Chrome from a macOS app bundle', async () => {
    const result = await resolveBrowserExecutable({
      platform: 'darwin',
      env: {},
      fileExists: vi.fn(async (path) =>
        path === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      )
    });

    expect(result).toEqual({
      ok: true,
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      browser: 'chrome'
    });
  });

  it('detects Chromium from PATH on Linux', async () => {
    const result = await resolveBrowserExecutable({
      platform: 'linux',
      env: { PATH: '/usr/local/bin:/usr/bin' },
      fileExists: vi.fn(async (path) => path === '/usr/bin/chromium')
    });

    expect(result).toEqual({
      ok: true,
      executablePath: '/usr/bin/chromium',
      browser: 'chromium'
    });
  });

  it('detects Brave on Windows when Chrome and Edge are absent', async () => {
    const result = await resolveBrowserExecutable({
      platform: 'win32',
      env: {},
      fileExists: vi.fn(async (path) =>
        path === 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe'
      )
    });

    expect(result).toEqual({
      ok: true,
      executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
      browser: 'brave'
    });
  });
});
