import { open, readdir, realpath, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { throwIfAborted } from '../abort.js';
import { READER_TEXT_CAP } from '../readers/limits.js';
import { safeSlice } from './safe-slice.js';

export type RepoOverview = {
  readmePath?: string;
  readme?: string;
  entries: Array<{ name: string; dir: boolean }>;
};

const README = /^readme(\.(md|markdown|rst|txt))?$/i;

function inside(base: string, target: string): boolean {
  return target === base || target.startsWith(base + sep);
}

export function hasGitSegment(pathScope: string): boolean {
  return pathScope.split(/[\\/]+/).some((segment) => segment.replace(/[. ]+$/, '').toLowerCase() === '.git');
}

/** A folder inside the clone, or undefined for anything missing, not a folder, or outside it. */
export async function resolveInside(root: string, pathScope?: string): Promise<string | undefined> {
  const base = await realpath(root);
  if (!pathScope) return base;
  if (hasGitSegment(pathScope)) return undefined;
  const target = resolve(base, pathScope);
  if (!inside(base, target)) return undefined;
  try {
    const real = await realpath(target);
    if (!inside(base, real)) return undefined;
    return (await stat(real)).isDirectory() ? real : undefined;
  } catch {
    return undefined;
  }
}

async function findReadme(dir: string): Promise<string | undefined> {
  const items = await readdir(dir, { withFileTypes: true });
  return items.find((item) => item.isFile() && README.test(item.name))?.name;
}

/** README and listing for a folder in a clone (PR 1 of #72). Checks `signal` between steps. */
export async function readRepoOverview(
  root: string,
  { pathScope, signal }: { pathScope?: string; signal?: AbortSignal }
): Promise<RepoOverview | undefined> {
  const dir = await resolveInside(root, pathScope);
  throwIfAborted(signal);
  if (!dir) return undefined;

  const items = (await readdir(dir, { withFileTypes: true }))
    .filter((item) => item.name !== '.git' && !item.isSymbolicLink())
    .sort((a, b) => a.name.localeCompare(b.name));
  const entries = items.map((item) => ({ name: item.name, dir: item.isDirectory() }));
  throwIfAborted(signal);

  const base = await realpath(root);
  let readmeDir = dir;
  let readmeName = await findReadme(dir);
  if (!readmeName && dir !== base) {
    readmeDir = base;
    readmeName = await findReadme(base);
  }
  throwIfAborted(signal);
  if (!readmeName) {
    throwIfAborted(signal);
    return { entries };
  }

  const readmePath = join(readmeDir, readmeName).slice(base.length + 1);
  const handle = await open(join(readmeDir, readmeName), 'r');
  let readme: string;
  try {
    const buffer = Buffer.alloc(READER_TEXT_CAP * 4);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    readme = safeSlice(buffer.subarray(0, bytesRead).toString('utf8'), READER_TEXT_CAP);
  } finally {
    await handle.close();
  }
  throwIfAborted(signal);
  return { readmePath, readme, entries };
}
