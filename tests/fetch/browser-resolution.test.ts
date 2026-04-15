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
});
