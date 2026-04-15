const WINDOWS_CANDIDATES = {
  chrome: [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
  ],
  edge: [
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ]
} as const;

export type BrowserResolutionResult =
  | {
      ok: true;
      executablePath: string;
      browser: 'configured' | 'chrome' | 'edge';
    }
  | {
      ok: false;
      error: {
        code: 'BROWSER_NOT_FOUND' | 'CONFIGURED_BROWSER_NOT_FOUND';
        message: string;
      };
    };

export async function resolveBrowserExecutable({
  configuredPath,
  fileExists = defaultFileExists
}: {
  configuredPath?: string;
  fileExists?: (path: string) => Promise<boolean>;
}): Promise<BrowserResolutionResult> {
  if (configuredPath) {
    if (await fileExists(configuredPath)) {
      return {
        ok: true,
        executablePath: configuredPath,
        browser: 'configured'
      };
    }

    return {
      ok: false,
      error: {
        code: 'CONFIGURED_BROWSER_NOT_FOUND',
        message: `Configured browser path was not found: ${configuredPath}`
      }
    };
  }

  for (const path of WINDOWS_CANDIDATES.chrome) {
    if (await fileExists(path)) {
      return { ok: true, executablePath: path, browser: 'chrome' };
    }
  }

  for (const path of WINDOWS_CANDIDATES.edge) {
    if (await fileExists(path)) {
      return { ok: true, executablePath: path, browser: 'edge' };
    }
  }

  return {
    ok: false,
    error: {
      code: 'BROWSER_NOT_FOUND',
      message: 'No compatible local browser was found for headless fetch.'
    }
  };
}

async function defaultFileExists(path: string): Promise<boolean> {
  try {
    const { access } = await import('node:fs/promises');
    await access(path);
    return true;
  } catch {
    return false;
  }
}
