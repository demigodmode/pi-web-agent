import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type ChangelogEntry = {
  version: string;
  content: string;
};

type ChangelogState = {
  lastChangelogVersion?: string;
};

type ChangelogOptions = {
  packageRoot?: string;
  statePath?: string;
};

export function parseChangelogEntries(changelog: string): ChangelogEntry[] {
  const lines = changelog.split(/\r?\n/);
  const entries: ChangelogEntry[] = [];
  let currentVersion: string | undefined;
  let currentLines: string[] = [];

  function flush() {
    if (currentVersion && currentLines.length > 0) {
      entries.push({ version: currentVersion, content: currentLines.join('\n').trim() });
    }
  }

  for (const line of lines) {
    if (line.startsWith('## ')) {
      flush();
      const match = line.match(/^##\s+\[?(\d+\.\d+\.\d+)\]?/);
      currentVersion = match?.[1];
      currentLines = currentVersion ? [line] : [];
      continue;
    }

    if (currentVersion) {
      currentLines.push(line);
    }
  }

  flush();
  return entries;
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);

  for (let i = 0; i < 3; i += 1) {
    const diff = (leftParts[i] || 0) - (rightParts[i] || 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

function defaultPackageRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.basename(here) === 'dist' ? path.dirname(here) : path.dirname(here);
}

function defaultStatePath() {
  const homeDir = process.env.USERPROFILE ?? process.env.HOME ?? '';
  return path.join(homeDir, '.pi', 'agent', 'extensions', 'pi-web-agent', 'state.json');
}

async function readPackageVersion(packageRoot: string): Promise<string | undefined> {
  try {
    const raw = await readFile(path.join(packageRoot, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

async function readChangelogEntries(packageRoot: string): Promise<ChangelogEntry[]> {
  try {
    return parseChangelogEntries(await readFile(path.join(packageRoot, 'CHANGELOG.md'), 'utf8'));
  } catch {
    return [];
  }
}

async function readState(statePath: string): Promise<ChangelogState> {
  try {
    return JSON.parse(await readFile(statePath, 'utf8')) as ChangelogState;
  } catch {
    return {};
  }
}

export async function markChangelogSeen({ statePath = defaultStatePath(), version }: { statePath?: string; version: string }) {
  try {
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, `${JSON.stringify({ lastChangelogVersion: version }, null, 2)}\n`, 'utf8');
  } catch {
    // Changelog display is best effort. Never block extension startup on state persistence.
  }
}

export async function getUpdateChangelogNotice(options: ChangelogOptions = {}): Promise<string | undefined> {
  const packageRoot = options.packageRoot ?? defaultPackageRoot();
  const statePath = options.statePath ?? defaultStatePath();
  const version = await readPackageVersion(packageRoot);
  if (!version) return undefined;

  const state = await readState(statePath);
  if (!state.lastChangelogVersion) {
    await markChangelogSeen({ statePath, version });
    return undefined;
  }

  if (compareVersions(version, state.lastChangelogVersion) <= 0) {
    return undefined;
  }

  const entries = (await readChangelogEntries(packageRoot))
    .filter((entry) => compareVersions(entry.version, state.lastChangelogVersion || '0.0.0') > 0)
    .map((entry) => entry.content);

  await markChangelogSeen({ statePath, version });
  return entries.length > 0 ? entries.join('\n\n') : undefined;
}

export async function getLatestChangelogEntry(options: ChangelogOptions = {}): Promise<string | undefined> {
  const entries = await readChangelogEntries(options.packageRoot ?? defaultPackageRoot());
  return entries[0]?.content;
}
