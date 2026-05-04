type SupportedPlatform = NodeJS.Platform | string;
type BrowserName = 'configured' | 'chrome' | 'edge' | 'brave' | 'chromium';

type BrowserCandidate = {
  browser: Exclude<BrowserName, 'configured'>;
  paths: string[];
  commands: string[];
};

const WINDOWS_CANDIDATES: BrowserCandidate[] = [
  {
    browser: 'chrome',
    paths: [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
    ],
    commands: ['chrome.exe', 'chrome', 'google-chrome']
  },
  {
    browser: 'edge',
    paths: [
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
    ],
    commands: ['msedge.exe', 'msedge', 'microsoft-edge']
  },
  {
    browser: 'brave',
    paths: [
      'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
      'C:/Program Files (x86)/BraveSoftware/Brave-Browser/Application/brave.exe'
    ],
    commands: ['brave.exe', 'brave']
  },
  {
    browser: 'chromium',
    paths: [
      'C:/Program Files/Chromium/Application/chrome.exe',
      'C:/Program Files (x86)/Chromium/Application/chrome.exe'
    ],
    commands: ['chromium.exe', 'chromium']
  }
];

const MACOS_CANDIDATES: BrowserCandidate[] = [
  {
    browser: 'chrome',
    paths: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    commands: ['google-chrome', 'chrome']
  },
  {
    browser: 'edge',
    paths: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    commands: ['microsoft-edge', 'msedge']
  },
  {
    browser: 'brave',
    paths: ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
    commands: ['brave-browser', 'brave']
  },
  {
    browser: 'chromium',
    paths: ['/Applications/Chromium.app/Contents/MacOS/Chromium'],
    commands: ['chromium', 'chromium-browser']
  }
];

const LINUX_CANDIDATES: BrowserCandidate[] = [
  {
    browser: 'chrome',
    paths: ['/usr/bin/google-chrome', '/usr/local/bin/google-chrome', '/opt/google/chrome/chrome'],
    commands: ['google-chrome', 'google-chrome-stable', 'chrome']
  },
  {
    browser: 'edge',
    paths: ['/usr/bin/microsoft-edge', '/opt/microsoft/msedge/msedge'],
    commands: ['microsoft-edge', 'microsoft-edge-stable', 'msedge']
  },
  {
    browser: 'brave',
    paths: ['/usr/bin/brave-browser', '/usr/local/bin/brave-browser', '/opt/brave.com/brave/brave'],
    commands: ['brave-browser', 'brave']
  },
  {
    browser: 'chromium',
    paths: ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'],
    commands: ['chromium', 'chromium-browser']
  }
];

export type BrowserResolutionResult =
  | {
      ok: true;
      executablePath: string;
      browser: BrowserName;
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
  platform = process.platform,
  env = process.env,
  fileExists = defaultFileExists
}: {
  configuredPath?: string;
  platform?: SupportedPlatform;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
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

  const candidates = getCandidatesForPlatform(platform);

  for (const candidate of candidates) {
    for (const path of candidate.paths) {
      if (await fileExists(path)) {
        return { ok: true, executablePath: path, browser: candidate.browser };
      }
    }
  }

  for (const candidate of candidates) {
    for (const path of getPathCommandCandidates(candidate.commands, platform, env)) {
      if (await fileExists(path)) {
        return { ok: true, executablePath: path, browser: candidate.browser };
      }
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

function getCandidatesForPlatform(platform: SupportedPlatform): BrowserCandidate[] {
  if (platform === 'win32') return WINDOWS_CANDIDATES;
  if (platform === 'darwin') return MACOS_CANDIDATES;
  if (platform === 'linux') return LINUX_CANDIDATES;

  return [...WINDOWS_CANDIDATES, ...MACOS_CANDIDATES, ...LINUX_CANDIDATES];
}

function getPathCommandCandidates(
  commands: string[],
  platform: SupportedPlatform,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): string[] {
  const pathValue = env.PATH ?? env.Path ?? env.path;
  if (!pathValue) return [];

  const delimiter = platform === 'win32' ? ';' : ':';
  const dirs = pathValue.split(delimiter).filter(Boolean);
  const extensions = platform === 'win32' ? ['', '.exe'] : [''];

  return dirs.flatMap((dir) =>
    commands.flatMap((command) =>
      extensions.map((extension) => {
        const normalizedCommand = command.toLowerCase().endsWith(extension) ? command : `${command}${extension}`;
        return `${dir.replace(/[\\/]$/, '')}/${normalizedCommand}`;
      })
    )
  );
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
