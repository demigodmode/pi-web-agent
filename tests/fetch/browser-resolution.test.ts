import { describe, expect, it, vi } from 'vitest';
import { parseRegDefaultValue, resolveBrowserExecutable } from '../../src/fetch/browser-resolution.js';

describe('browser resolution', () => {
  it('prefers an explicit configured browser path', async () => {
    const result = await resolveBrowserExecutable({
      configuredPath: 'C:/Browsers/Chrome/chrome.exe',
      fileExists: vi.fn(async (path) => path === 'C:/Browsers/Chrome/chrome.exe')
    });

    expect(result).toEqual({
      ok: true,
      executablePath: 'C:/Browsers/Chrome/chrome.exe',
      browser: 'configured',
      source: 'config'
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
      browser: 'chrome',
      source: 'auto'
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
      browser: 'chrome',
      source: 'auto'
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
      browser: 'chromium',
      source: 'auto'
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
      browser: 'brave',
      source: 'auto'
    });
  });
});

function filesystem(paths: string[]) {
  const known = new Set(paths);
  return vi.fn(async (path: string) => known.has(path));
}

describe('browser detection locations', () => {
  it.each([
    ['chrome', 'C:/Users/me/AppData/Local/Google/Chrome/Application/chrome.exe'],
    ['edge', 'C:/Users/me/AppData/Local/Microsoft/Edge/Application/msedge.exe'],
    ['brave', 'C:/Users/me/AppData/Local/BraveSoftware/Brave-Browser/Application/brave.exe'],
    ['chromium', 'C:/Users/me/AppData/Local/Chromium/Application/chrome.exe']
  ])('finds a per-user %s install under LOCALAPPDATA', async (browser, path) => {
    const result = await resolveBrowserExecutable({
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:/Users/me/AppData/Local' },
      fileExists: filesystem([path])
    });

    expect(result).toEqual({ ok: true, executablePath: path, browser, source: 'auto' });
  });

  it('checks the ProgramFiles env variants', async () => {
    const result = await resolveBrowserExecutable({
      platform: 'win32',
      env: { ProgramFiles: 'D:/Apps', 'ProgramFiles(x86)': 'D:/Apps86' },
      fileExists: filesystem(['D:/Apps86/Microsoft/Edge/Application/msedge.exe'])
    });

    expect(result).toMatchObject({ ok: true, executablePath: 'D:/Apps86/Microsoft/Edge/Application/msedge.exe', browser: 'edge' });
  });

  it('reads the Windows App Paths default value from HKCU', async () => {
    const queryRegistry = vi.fn(async (key: string) =>
      key.endsWith('\\chrome.exe')
        ? '\r\n' + key + '\r\n    (Default)    REG_SZ    D:\\Chrome\\chrome.exe\r\n\r\n'
        : ''
    );

    const result = await resolveBrowserExecutable({
      platform: 'win32',
      env: {},
      fileExists: filesystem(['D:\\Chrome\\chrome.exe']),
      queryRegistry
    });

    expect(result).toEqual({ ok: true, executablePath: 'D:\\Chrome\\chrome.exe', browser: 'chrome', source: 'auto' });
    expect(queryRegistry).toHaveBeenCalledWith(
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe'
    );
  });

  it('falls back to the HKLM App Paths entry after HKCU has nothing', async () => {
    const queryRegistry = vi.fn(async (key: string) =>
      key.startsWith('HKEY_LOCAL_MACHINE') && key.endsWith('brave.exe') ? '    (Default)    REG_SZ    D:/Brave/brave.exe' : ''
    );

    const result = await resolveBrowserExecutable({
      platform: 'win32',
      env: {},
      fileExists: filesystem(['D:/Brave/brave.exe']),
      queryRegistry
    });

    expect(result).toMatchObject({ ok: true, executablePath: 'D:/Brave/brave.exe', browser: 'brave' });
    expect(queryRegistry).toHaveBeenCalledWith(expect.stringContaining('HKEY_LOCAL_MACHINE'));
  });

  it('does not treat a registry value that points at a missing file as a browser', async () => {
    const result = await resolveBrowserExecutable({
      platform: 'win32',
      env: {},
      fileExists: filesystem([]),
      queryRegistry: async () => '    (Default)    REG_SZ    D:/Gone/chrome.exe'
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'BROWSER_NOT_FOUND' } });
  });

  it('treats registry failures as not found without throwing', async () => {
    const result = await resolveBrowserExecutable({
      platform: 'win32',
      env: {},
      fileExists: filesystem([]),
      queryRegistry: vi.fn(async () => {
        throw new Error('reg.exe missing');
      })
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'BROWSER_NOT_FOUND' } });
  });

  it('gives up on a hanging registry query and keeps going', async () => {
    vi.useFakeTimers();
    try {
      const pending = resolveBrowserExecutable({
        platform: 'win32',
        env: {},
        fileExists: filesystem(['D:/Edge/msedge.exe']),
        queryRegistry: (key: string) =>
          key.includes('msedge.exe') ? Promise.resolve('    (Default)    REG_SZ    D:/Edge/msedge.exe') : new Promise<string>(() => undefined)
      });
      await vi.advanceTimersByTimeAsync(60_000);

      await expect(pending).resolves.toMatchObject({ ok: true, executablePath: 'D:/Edge/msedge.exe', browser: 'edge' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not query the registry on other platforms', async () => {
    const queryRegistry = vi.fn(async () => '');
    const findAppBundle = vi.fn(async () => '');

    await resolveBrowserExecutable({ platform: 'linux', env: {}, fileExists: filesystem([]), queryRegistry, findAppBundle });

    expect(queryRegistry).not.toHaveBeenCalled();
    expect(findAppBundle).not.toHaveBeenCalled();
  });

  it('parses the (Default) REG_SZ value only', () => {
    expect(parseRegDefaultValue('    (Default)    REG_SZ    C:\\Apps\\chrome.exe\r\n')).toBe('C:\\Apps\\chrome.exe');
    expect(parseRegDefaultValue('    Path    REG_SZ    C:\\x.exe')).toBeUndefined();
    expect(parseRegDefaultValue('    (Default)    REG_EXPAND_SZ    C:\\x.exe')).toBeUndefined();
  });

  it('detects Chrome from the macOS user Applications folder', async () => {
    const result = await resolveBrowserExecutable({
      platform: 'darwin',
      env: {},
      homeDir: '/Users/me',
      fileExists: filesystem(['/Users/me/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'])
    });

    expect(result).toEqual({
      ok: true,
      executablePath: '/Users/me/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      browser: 'chrome',
      source: 'auto'
    });
  });

  it('detects Brave from the macOS user Applications folder', async () => {
    const result = await resolveBrowserExecutable({
      platform: 'darwin',
      env: {},
      homeDir: '/Users/me',
      fileExists: filesystem(['/Users/me/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'])
    });

    expect(result).toMatchObject({ ok: true, browser: 'brave' });
  });

  it('finds an app through Spotlight when it is not in a fixed location', async () => {
    const findAppBundle = vi.fn(async (bundleId: string) =>
      bundleId === 'com.microsoft.edgemac' ? '/Volumes/Apps/Microsoft Edge.app\n' : ''
    );

    const result = await resolveBrowserExecutable({
      platform: 'darwin',
      env: {},
      homeDir: '/Users/me',
      fileExists: filesystem(['/Volumes/Apps/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']),
      findAppBundle
    });

    expect(result).toEqual({
      ok: true,
      executablePath: '/Volumes/Apps/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      browser: 'edge',
      source: 'auto'
    });
    expect(findAppBundle).toHaveBeenCalledWith('com.google.Chrome');
  });

  it('skips Spotlight when a fixed location already matched', async () => {
    const findAppBundle = vi.fn(async () => '');

    await resolveBrowserExecutable({
      platform: 'darwin',
      env: {},
      homeDir: '/Users/me',
      fileExists: filesystem(['/Applications/Chromium.app/Contents/MacOS/Chromium']),
      findAppBundle
    });

    expect(findAppBundle).not.toHaveBeenCalled();
  });

  it('treats Spotlight failures and timeouts as not found', async () => {
    vi.useFakeTimers();
    try {
      const pending = resolveBrowserExecutable({
        platform: 'darwin',
        env: {},
        homeDir: '/Users/me',
        fileExists: filesystem([]),
        findAppBundle: (bundleId: string) =>
          bundleId === 'com.brave.Browser' ? Promise.reject(new Error('mdfind failed')) : new Promise<string>(() => undefined)
      });
      await vi.advanceTimersByTimeAsync(60_000);

      await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'BROWSER_NOT_FOUND' } });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['chromium', '/usr/lib/chromium/chromium'],
    ['chromium', '/usr/lib/chromium-browser/chromium-browser'],
    ['chromium', '/usr/lib64/chromium-browser/chromium-browser'],
    ['chrome', '/opt/google/chrome-beta/chrome'],
    ['brave', '/opt/brave.com/brave-beta/brave'],
    ['chrome', '/run/current-system/sw/bin/google-chrome'],
    ['chrome', '/home/me/.nix-profile/bin/google-chrome'],
    ['chromium', '/run/current-system/sw/bin/chromium'],
    ['chromium', '/home/me/.nix-profile/bin/chromium']
  ])('detects %s at %s on Linux', async (browser, path) => {
    const result = await resolveBrowserExecutable({
      platform: 'linux',
      env: {},
      homeDir: '/home/me',
      fileExists: filesystem([path])
    });

    expect(result).toEqual({ ok: true, executablePath: path, browser, source: 'auto' });
  });

  it.each([
    ['chromium', '/var/lib/flatpak/exports/bin/org.chromium.Chromium'],
    ['chrome', '/var/lib/flatpak/exports/bin/com.google.Chrome'],
    ['brave', '/home/me/.local/share/flatpak/exports/bin/com.brave.Browser'],
    ['edge', '/var/lib/flatpak/exports/bin/com.microsoft.Edge'],
    ['chromium', '/snap/bin/chromium']
  ])('marks %s at %s as sandboxed', async (browser, path) => {
    const result = await resolveBrowserExecutable({
      platform: 'linux',
      env: {},
      homeDir: '/home/me',
      fileExists: filesystem([path])
    });

    expect(result).toEqual({ ok: true, executablePath: path, browser, source: 'auto', sandboxed: true });
  });

  it('does not mark ordinary installs as sandboxed', async () => {
    const result = await resolveBrowserExecutable({
      platform: 'linux',
      env: {},
      fileExists: filesystem(['/usr/bin/chromium'])
    });

    expect(result).not.toHaveProperty('sandboxed');
  });

  it.each([
    ['google-chrome-unstable', 'chrome', '/opt/x/bin/google-chrome-unstable'],
    ['google-chrome-beta', 'chrome', '/opt/x/bin/google-chrome-beta'],
    ['brave-browser-beta', 'brave', '/opt/x/bin/brave-browser-beta'],
    ['microsoft-edge-beta', 'edge', '/opt/x/bin/microsoft-edge-beta'],
    ['ungoogled-chromium', 'chromium', '/opt/x/bin/ungoogled-chromium'],
    ['chromium-freeworld', 'chromium', '/opt/x/bin/chromium-freeworld']
  ])('finds %s on PATH', async (_command, browser, path) => {
    const result = await resolveBrowserExecutable({
      platform: 'linux',
      env: { PATH: '/opt/x/bin' },
      fileExists: filesystem([path])
    });

    expect(result).toEqual({ ok: true, executablePath: path, browser, source: 'auto' });
  });

  it('keeps chrome ahead of chromium when both are installed', async () => {
    const result = await resolveBrowserExecutable({
      platform: 'linux',
      env: {},
      fileExists: filesystem(['/usr/bin/chromium', '/opt/google/chrome-beta/chrome'])
    });

    expect(result).toMatchObject({ browser: 'chrome', executablePath: '/opt/google/chrome-beta/chrome' });
  });
});

describe('browser path precedence', () => {
  const both = ['/opt/configured/chrome', '/opt/from-env/chrome'];

  it('prefers the config path over the env var', async () => {
    const result = await resolveBrowserExecutable({
      configuredPath: '/opt/configured/chrome',
      env: { PI_WEB_AGENT_BROWSER_PATH: '/opt/from-env/chrome' },
      platform: 'linux',
      fileExists: filesystem(both)
    });

    expect(result).toEqual({ ok: true, executablePath: '/opt/configured/chrome', browser: 'configured', source: 'config' });
  });

  it('uses the env var when no config path is set', async () => {
    const result = await resolveBrowserExecutable({
      env: { PI_WEB_AGENT_BROWSER_PATH: '  /opt/from-env/chrome  ' },
      platform: 'linux',
      fileExists: filesystem(both)
    });

    expect(result).toEqual({ ok: true, executablePath: '/opt/from-env/chrome', browser: 'configured', source: 'env' });
  });

  it('prefers the env var over auto-detection', async () => {
    const result = await resolveBrowserExecutable({
      env: { PI_WEB_AGENT_BROWSER_PATH: '/opt/from-env/chrome' },
      platform: 'linux',
      fileExists: filesystem(['/usr/bin/chromium', '/opt/from-env/chrome'])
    });

    expect(result).toMatchObject({ ok: true, source: 'env', executablePath: '/opt/from-env/chrome' });
  });

  it('ignores a blank env var and auto-detects', async () => {
    const result = await resolveBrowserExecutable({
      env: { PI_WEB_AGENT_BROWSER_PATH: '   ' },
      platform: 'linux',
      fileExists: filesystem(['/usr/bin/chromium'])
    });

    expect(result).toEqual({ ok: true, executablePath: '/usr/bin/chromium', browser: 'chromium', source: 'auto' });
  });

  it('errors on a missing config path instead of falling back, and names the config key', async () => {
    const result = await resolveBrowserExecutable({
      configuredPath: '/opt/missing/chrome',
      env: { PI_WEB_AGENT_BROWSER_PATH: '/opt/from-env/chrome' },
      platform: 'linux',
      fileExists: filesystem(['/usr/bin/chromium', '/opt/from-env/chrome'])
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'CONFIGURED_BROWSER_NOT_FOUND',
        message: 'Configured browser path was not found: /opt/missing/chrome (from backends.headless.executablePath)'
      }
    });
  });

  it('errors on a missing env path instead of falling back, and names the env var', async () => {
    const result = await resolveBrowserExecutable({
      env: { PI_WEB_AGENT_BROWSER_PATH: '/opt/missing/chrome' },
      platform: 'linux',
      fileExists: filesystem(['/usr/bin/chromium'])
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'CONFIGURED_BROWSER_NOT_FOUND',
        message: 'Configured browser path was not found: /opt/missing/chrome (from PI_WEB_AGENT_BROWSER_PATH)'
      }
    });
  });
});
