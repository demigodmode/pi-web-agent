import { execFile } from 'node:child_process';
import { homedir } from 'node:os';

export const BROWSER_PATH_ENV = 'PI_WEB_AGENT_BROWSER_PATH';
export const BROWSER_PATH_CONFIG_KEY = 'backends.headless.executablePath';

const EXTERNAL_LOOKUP_TIMEOUT_MS = 2_000;
const REGISTRY_APP_PATHS = 'Software\\Microsoft\\Windows\\CurrentVersion\\App Paths';

type SupportedPlatform = NodeJS.Platform | string;
type LookupEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;
type DetectedBrowser = 'chrome' | 'edge' | 'brave' | 'chromium';
type BrowserName = 'configured' | DetectedBrowser;

type BrowserCandidate = {
  browser: DetectedBrowser;
  paths: string[];
  commands: string[];
  /** App Paths value name on Windows, e.g. chrome.exe. */
  registryName?: string;
  /** macOS bundle id and the executable inside Contents/MacOS. */
  bundle?: { id: string; binary: string };
};

export type BrowserResolutionResult =
  | {
      ok: true;
      executablePath: string;
      browser: BrowserName;
      source: 'config' | 'env' | 'auto';
      /** Found through a Flatpak export or snap wrapper, which may not start under Playwright. */
      sandboxed?: true;
    }
  | {
      ok: false;
      error: {
        code: 'BROWSER_NOT_FOUND' | 'CONFIGURED_BROWSER_NOT_FOUND';
        message: string;
      };
    };

function homePaths(home: string | undefined, relative: string): string[] {
  return home ? [`${home}/${relative}`] : [];
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function windowsCandidates(env: LookupEnv): BrowserCandidate[] {
  const programDirs = unique(['C:/Program Files', 'C:/Program Files (x86)', env.ProgramFiles, env['ProgramFiles(x86)']]);
  const localAppData = env.LOCALAPPDATA ? [env.LOCALAPPDATA] : [];
  const installs = (relative: string) =>
    [...programDirs, ...localAppData].map((root) => `${root}/${relative}`);

  return [
    {
      browser: 'chrome',
      paths: installs('Google/Chrome/Application/chrome.exe'),
      commands: ['chrome.exe', 'chrome', 'google-chrome'],
      registryName: 'chrome.exe'
    },
    {
      browser: 'edge',
      paths: installs('Microsoft/Edge/Application/msedge.exe'),
      commands: ['msedge.exe', 'msedge', 'microsoft-edge'],
      registryName: 'msedge.exe'
    },
    {
      browser: 'brave',
      paths: installs('BraveSoftware/Brave-Browser/Application/brave.exe'),
      commands: ['brave.exe', 'brave'],
      registryName: 'brave.exe'
    },
    {
      browser: 'chromium',
      paths: installs('Chromium/Application/chrome.exe'),
      commands: ['chromium.exe', 'chromium']
    }
  ];
}

function macosCandidates(home: string | undefined): BrowserCandidate[] {
  const appPaths = (app: string, binary: string) => [
    `/Applications/${app}.app/Contents/MacOS/${binary}`,
    ...homePaths(home, `Applications/${app}.app/Contents/MacOS/${binary}`)
  ];

  return [
    {
      browser: 'chrome',
      paths: appPaths('Google Chrome', 'Google Chrome'),
      commands: ['google-chrome', 'chrome'],
      bundle: { id: 'com.google.Chrome', binary: 'Google Chrome' }
    },
    {
      browser: 'edge',
      paths: appPaths('Microsoft Edge', 'Microsoft Edge'),
      commands: ['microsoft-edge', 'msedge'],
      bundle: { id: 'com.microsoft.edgemac', binary: 'Microsoft Edge' }
    },
    {
      browser: 'brave',
      paths: appPaths('Brave Browser', 'Brave Browser'),
      commands: ['brave-browser', 'brave'],
      bundle: { id: 'com.brave.Browser', binary: 'Brave Browser' }
    },
    {
      browser: 'chromium',
      paths: appPaths('Chromium', 'Chromium'),
      commands: ['chromium', 'chromium-browser'],
      bundle: { id: 'org.chromium.Chromium', binary: 'Chromium' }
    }
  ];
}

function linuxCandidates(home: string | undefined): BrowserCandidate[] {
  return [
    {
      browser: 'chrome',
      paths: [
        '/usr/bin/google-chrome',
        '/usr/local/bin/google-chrome',
        '/opt/google/chrome/chrome',
        '/opt/google/chrome-beta/chrome',
        ...homePaths(home, '.nix-profile/bin/google-chrome'),
        '/run/current-system/sw/bin/google-chrome',
        '/var/lib/flatpak/exports/bin/com.google.Chrome',
        ...homePaths(home, '.local/share/flatpak/exports/bin/com.google.Chrome')
      ],
      commands: ['google-chrome', 'google-chrome-stable', 'google-chrome-beta', 'google-chrome-unstable', 'chrome']
    },
    {
      browser: 'edge',
      paths: [
        '/usr/bin/microsoft-edge',
        '/opt/microsoft/msedge/msedge',
        '/var/lib/flatpak/exports/bin/com.microsoft.Edge',
        ...homePaths(home, '.local/share/flatpak/exports/bin/com.microsoft.Edge')
      ],
      commands: ['microsoft-edge', 'microsoft-edge-stable', 'microsoft-edge-beta', 'msedge']
    },
    {
      browser: 'brave',
      paths: [
        '/usr/bin/brave-browser',
        '/usr/local/bin/brave-browser',
        '/opt/brave.com/brave/brave',
        '/opt/brave.com/brave-beta/brave',
        '/var/lib/flatpak/exports/bin/com.brave.Browser',
        ...homePaths(home, '.local/share/flatpak/exports/bin/com.brave.Browser')
      ],
      commands: ['brave-browser', 'brave-browser-stable', 'brave-browser-beta', 'brave']
    },
    {
      browser: 'chromium',
      paths: [
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/lib/chromium/chromium',
        '/usr/lib/chromium-browser/chromium-browser',
        '/usr/lib64/chromium-browser/chromium-browser',
        '/snap/bin/chromium',
        ...homePaths(home, '.nix-profile/bin/chromium'),
        '/run/current-system/sw/bin/chromium',
        '/var/lib/flatpak/exports/bin/org.chromium.Chromium',
        ...homePaths(home, '.local/share/flatpak/exports/bin/org.chromium.Chromium')
      ],
      commands: ['chromium', 'chromium-browser', 'ungoogled-chromium', 'chromium-freeworld']
    }
  ];
}

function getCandidatesForPlatform(platform: SupportedPlatform, env: LookupEnv, home: string | undefined): BrowserCandidate[] {
  if (platform === 'win32') return windowsCandidates(env);
  if (platform === 'darwin') return macosCandidates(home);
  if (platform === 'linux') return linuxCandidates(home);

  return [...windowsCandidates(env), ...macosCandidates(home), ...linuxCandidates(home)];
}

function getPathCommandCandidates(
  commands: string[],
  platform: SupportedPlatform,
  env: LookupEnv
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

function isSandboxedPath(path: string): boolean {
  return /^\/snap\/bin\//.test(path) || /\/flatpak\/exports\/bin\//.test(path);
}

function configuredNotFound(path: string, source: 'config' | 'env'): BrowserResolutionResult {
  const label = source === 'config' ? BROWSER_PATH_CONFIG_KEY : BROWSER_PATH_ENV;
  return {
    ok: false,
    error: {
      code: 'CONFIGURED_BROWSER_NOT_FOUND',
      message: `Configured browser path was not found: ${path} (from ${label})`
    }
  };
}

/**
 * Registry and Spotlight lookups are slow and can hang. They get a deadline
 * of their own, and any failure reads as "not found".
 */
async function withLookupDeadline(lookup: () => Promise<string>): Promise<string | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(resolve, EXTERNAL_LOOKUP_TIMEOUT_MS, undefined);
  });
  try {
    return await Promise.race([Promise.resolve().then(lookup).catch(() => undefined), deadline]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function expandEnvVars(value: string, env: LookupEnv): string {
  return value.replace(/%([^%]+)%/g, (whole, name: string) => {
    const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name.toUpperCase());
    return key && env[key] !== undefined ? (env[key] as string) : whole;
  });
}

/**
 * Reads the default value from `reg query <key> /ve` output. The label is
 * localized, so the line is found by its type token instead.
 */
export function parseRegDefaultValue(output: string, env: LookupEnv = {}): string | undefined {
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/\s(REG_SZ|REG_EXPAND_SZ)\s+(.+)$/);
    if (!match) continue;

    let value = match[2].trim();
    if (value.startsWith('"')) {
      const end = value.indexOf('"', 1);
      value = end > 0 ? value.slice(1, end) : value.slice(1);
    }
    value = value.trim();
    if (!value) continue;

    return match[1] === 'REG_EXPAND_SZ' ? expandEnvVars(value, env) : value;
  }
  return undefined;
}

async function findRegisteredPath(
  registryName: string,
  env: LookupEnv,
  queryRegistry: (key: string) => Promise<string>,
  fileExists: (path: string) => Promise<boolean>
): Promise<string | undefined> {
  for (const hive of ['HKEY_CURRENT_USER', 'HKEY_LOCAL_MACHINE']) {
    const output = await withLookupDeadline(() => queryRegistry(`${hive}\\${REGISTRY_APP_PATHS}\\${registryName}`));
    const path = output ? parseRegDefaultValue(output, env) : undefined;
    if (path && (await fileExists(path))) return path;
  }
  return undefined;
}

async function findBundlePath(
  bundle: NonNullable<BrowserCandidate['bundle']>,
  findAppBundle: (bundleId: string) => Promise<string>,
  fileExists: (path: string) => Promise<boolean>
): Promise<string | undefined> {
  const output = await withLookupDeadline(() => findAppBundle(bundle.id));
  for (const line of (output ?? '').split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
    const path = `${line}/Contents/MacOS/${bundle.binary}`;
    if (await fileExists(path)) return path;
  }
  return undefined;
}

function runCommandText(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: EXTERNAL_LOOKUP_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout));
    });
  });
}

export async function resolveBrowserExecutable({
  configuredPath,
  platform = process.platform,
  env = process.env,
  homeDir,
  fileExists = defaultFileExists,
  queryRegistry = (key: string) => runCommandText('reg', ['query', key, '/ve']),
  findAppBundle = (bundleId: string) => runCommandText('mdfind', [`kMDItemCFBundleIdentifier == '${bundleId}'`])
}: {
  configuredPath?: string;
  platform?: SupportedPlatform;
  env?: LookupEnv;
  homeDir?: string;
  fileExists?: (path: string) => Promise<boolean>;
  queryRegistry?: (key: string) => Promise<string>;
  findAppBundle?: (bundleId: string) => Promise<string>;
} = {}): Promise<BrowserResolutionResult> {
  // Config wins over the env var, which wins over detection.
  const fromConfig = configuredPath?.trim();
  if (fromConfig) {
    if (await fileExists(fromConfig)) {
      return { ok: true, executablePath: fromConfig, browser: 'configured', source: 'config' };
    }
    return configuredNotFound(fromConfig, 'config');
  }

  const fromEnv = env[BROWSER_PATH_ENV]?.trim();
  if (fromEnv) {
    if (await fileExists(fromEnv)) {
      return { ok: true, executablePath: fromEnv, browser: 'configured', source: 'env' };
    }
    return configuredNotFound(fromEnv, 'env');
  }

  const home = homeDir ?? (env.HOME || homedir());
  const candidates = getCandidatesForPlatform(platform, env, home);
  const found = (candidate: BrowserCandidate, executablePath: string): BrowserResolutionResult => ({
    ok: true,
    executablePath,
    browser: candidate.browser,
    source: 'auto',
    ...(isSandboxedPath(executablePath) ? { sandboxed: true as const } : {})
  });

  // Native installs come first. Flatpak exports and snap wrappers only win when
  // nothing native exists, so a broken sandboxed launcher never shadows a working browser.
  const probes = [
    ...candidates.flatMap((candidate) => candidate.paths.map((path) => ({ candidate, path }))),
    ...candidates.flatMap((candidate) =>
      getPathCommandCandidates(candidate.commands, platform, env).map((path) => ({ candidate, path }))
    )
  ];

  for (const { candidate, path } of probes) {
    if (!isSandboxedPath(path) && (await fileExists(path))) return found(candidate, path);
  }

  if (platform === 'win32') {
    for (const candidate of candidates) {
      if (!candidate.registryName) continue;
      const path = await findRegisteredPath(candidate.registryName, env, queryRegistry, fileExists);
      if (path) return found(candidate, path);
    }
  }

  if (platform === 'darwin') {
    for (const candidate of candidates) {
      if (!candidate.bundle) continue;
      const path = await findBundlePath(candidate.bundle, findAppBundle, fileExists);
      if (path) return found(candidate, path);
    }
  }

  for (const { candidate, path } of probes) {
    if (isSandboxedPath(path) && (await fileExists(path))) return found(candidate, path);
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
