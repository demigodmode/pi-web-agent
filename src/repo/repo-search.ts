import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { throwIfAborted } from '../abort.js';
import { MAX_SCANNED_BYTES, MAX_SEARCH_MS, REPO_MAX_FILES } from './limits.js';
import { hasGitSegment, resolveInside } from './repo-overview.js';
import { queryTerms, type QueryTerm } from './repo-terms.js';
import { safeSlice } from './safe-slice.js';

export type RepoSearchExcerpt = { startLine: number; endLine: number; text: string };
export type RepoSearchFile = { path: string; score: number; excerpts: RepoSearchExcerpt[] };
export type RepoSearchBudget = 'files' | 'bytes' | 'time';
export type RepoSearchResult = {
  scopeFound: boolean;
  terms: string[];
  files: RepoSearchFile[];
  /** Present when a scan cap is reached. */
  partial?: true;
  budget?: RepoSearchBudget;
  scannedFiles?: number;
};
export type RepoSearchOptions = {
  query: string;
  pathScope?: string;
  /** Checked between files; the caller combines its own signal with lease.signal. */
  signal?: AbortSignal;
  maxFiles?: number;
  /** Total characters of excerpt text across all files. */
  charBudget?: number;
  contextLines?: number;
  /** Internal scan bounds used by focused tests. */
  maxScannedFiles?: number;
  maxScannedBytes?: number;
  maxSearchMs?: number;
  now?: () => number;
};

export const MAX_SEARCH_FILE_BYTES = 512 * 1024;
const MAX_SCANNED_FILES = 20_000;
const DEFAULT_CONTEXT_LINES = 20;

const SKIP_DIRS = new Set(['node_modules', 'vendor', '.next', '__pycache__', '.venv']);
const ROOT_SKIP_DIRS = new Set(['dist', 'build', 'target', 'out']);
const LOCKFILES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'Cargo.lock', 'poetry.lock',
  'Pipfile.lock', 'Gemfile.lock', 'composer.lock', 'go.sum', 'mix.lock', 'flake.lock'
]);
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff', '.psd', '.pdf', '.zip', '.gz', '.tgz', '.tar',
  '.bz2', '.xz', '.7z', '.rar', '.jar', '.war', '.class', '.so', '.dylib', '.dll', '.exe', '.bin', '.wasm', '.woff',
  '.woff2', '.ttf', '.otf', '.eot', '.mp3', '.mp4', '.mov', '.avi', '.webm', '.ogg', '.wav', '.flac', '.sqlite',
  '.db', '.pyc', '.o', '.a', '.lib', '.node'
]);
const SKIPPED_EXTENSIONS = new Set(['.map', '.snap', '.lock', '.svg']);
const DATA_EXTENSIONS = new Set(['.json', '.csv', '.tsv']);
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.kt', '.kts', '.rb',
  '.php', '.cs', '.c', '.h', '.cc', '.cpp', '.hpp', '.swift', '.scala', '.sh', '.lua', '.ex', '.exs', '.clj', '.dart',
  '.vue', '.svelte', '.zig', '.hs', '.ml', '.sql'
]);
const PROJECT_DOCUMENT_NAMES = new Set(['CHANGELOG', 'LICENSE', 'NOTICE', 'AUTHORS', 'COPYING', 'CONTRIBUTING']);
const TEST_OR_DOC = /(^|\/)(tests?|__tests__|specs?|fixtures?|docs?|examples?)(\/|$)|\.(test|spec)\.[a-z0-9]+$|\.(md|markdown|rst|adoc)$/i;
const EXEMPT_TEXT_FILES = /^(CMakeLists\.txt|requirements.*\.txt)$/;
const GENERATED = /\.min\.(js|css)$|(^|\/)(generated|__generated__)(\/|$)|\.(generated|gen)\.[a-z0-9]+$/i;
const SCORE_WINDOW_LINES = 41;

type Candidate = { path: string; score: number; text: string };
type ReadCandidate = { candidate?: Candidate; bytesRead: number; incomplete?: boolean };

function inside(base: string, target: string): boolean {
  return target === base || target.startsWith(base + sep);
}

function normalizedDirectoryName(name: string): string {
  return name.replace(/[. ]+$/, '').toLowerCase();
}

function isGitAlias(name: string): boolean {
  return normalizedDirectoryName(name) === '.git';
}

function matches(term: QueryTerm, haystack: string): boolean {
  return term.variants.some((variant) => haystack.includes(variant));
}

function maximumContentHits(text: string, terms: QueryTerm[]): number {
  const lines = sourceLines(text);
  if (lines.length === 0) return 0;
  const counts = new Array<number>(terms.length).fill(0);
  let distinct = 0;
  let maximum = 0;
  const add = (line: string, direction: 1 | -1) => {
    const lower = line.toLowerCase();
    terms.forEach((term, index) => {
      if (!matches(term, lower)) return;
      if (direction === 1 && counts[index]++ === 0) distinct++;
      if (direction === -1 && --counts[index] === 0) distinct--;
    });
  };
  const firstEnd = Math.min(lines.length, SCORE_WINDOW_LINES);
  for (let index = 0; index < firstEnd; index++) add(lines[index], 1);
  maximum = distinct;
  for (let start = 1; start + SCORE_WINDOW_LINES <= lines.length; start++) {
    add(lines[start - 1], -1);
    add(lines[start + SCORE_WINDOW_LINES - 1], 1);
    maximum = Math.max(maximum, distinct);
  }
  return maximum;
}

/** Distinct terms in the content count most, then terms in the path; code beats docs, tests and generated files. */
export function scoreFile(path: string, text: string, terms: QueryTerm[]): number {
  const lowerPath = path.toLowerCase();
  const contentHits = maximumContentHits(text, terms);
  let pathHits = 0;
  for (const term of terms) {
    if (matches(term, lowerPath)) pathHits++;
  }
  if (contentHits === 0 && pathHits === 0) return 0;
  let score = contentHits * 10 + pathHits * 6;
  if (SOURCE_EXTENSIONS.has(extname(lowerPath))) score += 3;
  const filename = path.split('/').at(-1) ?? path;
  if (TEST_OR_DOC.test(path) || (extname(lowerPath) === '.txt' && !EXEMPT_TEXT_FILES.test(filename)) || DATA_EXTENSIONS.has(extname(lowerPath)) || (extname(filename) === '' && PROJECT_DOCUMENT_NAMES.has(filename))) score -= 5;
  if (GENERATED.test(path)) score -= 8;
  return Math.max(1, score);
}

function sourceLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split(/\r?\n/);
  if (text.endsWith('\n')) lines.pop();
  return lines;
}

/** About `contextLines` lines either side of every matching line, overlapping windows merged. */
export function buildExcerpts(text: string, terms: QueryTerm[], contextLines = DEFAULT_CONTEXT_LINES): RepoSearchExcerpt[] {
  const lines = sourceLines(text);
  const windows: Array<[number, number]> = [];
  lines.forEach((line, index) => {
    const lower = line.toLowerCase();
    if (!terms.some((term) => matches(term, lower))) return;
    const start = Math.max(0, index - contextLines);
    const end = Math.min(lines.length - 1, index + contextLines);
    const last = windows.at(-1);
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else windows.push([start, end]);
  });
  if (windows.length === 0) {
    // Only the path matched: the top of the file is the best we have.
    if (lines.length === 0) return [];
    const end = Math.min(lines.length, contextLines * 2);
    return [{ startLine: 1, endLine: end, text: lines.slice(0, end).join('\n') }];
  }
  return windows.map(([start, end]) => ({ startLine: start + 1, endLine: end + 1, text: lines.slice(start, end + 1).join('\n') }));
}

/**
 * Trims excerpts to `charBudget` characters in total. Each file gets a fair share of what's left,
 * unused room rolls over to the next file, and cuts land on a line break when there is one.
 */
export function fitToBudget(files: RepoSearchFile[], charBudget: number): RepoSearchFile[] {
  if (!Number.isFinite(charBudget)) return files;
  let remaining = charBudget;
  const out: RepoSearchFile[] = [];
  files.forEach((file, index) => {
    const share = Math.floor(remaining / (files.length - index));
    let used = 0;
    const excerpts: RepoSearchExcerpt[] = [];
    for (const excerpt of file.excerpts) {
      const room = share - used;
      if (room <= 0) break;
      if (excerpt.text.length <= room) {
        excerpts.push(excerpt);
        used += excerpt.text.length;
        continue;
      }
      const lineBreak = excerpt.text.lastIndexOf('\n', room - 1);
      const text = safeSlice(excerpt.text, lineBreak > 0 ? lineBreak : room);
      if (text.length === 0) break;
      excerpts.push({ startLine: excerpt.startLine, endLine: excerpt.startLine + text.split(/\r?\n/).length - 1, text });
      used += text.length;
      break;
    }
    remaining -= used;
    if (excerpts.length > 0) out.push({ ...file, excerpts });
  });
  return out;
}

function keepTop(top: Candidate[], candidate: Candidate, limit: number): void {
  top.push(candidate);
  top.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (top.length > limit) top.length = limit;
}

async function readCandidate(base: string, abs: string, terms: QueryTerm[], remainingBytes: number, timedOut: () => boolean, signal?: AbortSignal): Promise<ReadCandidate> {
  const info = await lstat(abs).catch(() => undefined);
  throwIfAborted(signal);
  if (timedOut()) return { bytesRead: 0 };
  if (!info?.isFile() || info.size > MAX_SEARCH_FILE_BYTES) return { bytesRead: 0 };

  const real = await realpath(abs).catch(() => undefined);
  throwIfAborted(signal);
  if (timedOut()) return { bytesRead: 0 };
  if (!real || !inside(base, real)) return { bytesRead: 0 };

  const handle = await open(real, 'r').catch(() => undefined);
  if (!handle) {
    throwIfAborted(signal);
    return { bytesRead: 0 };
  }

  let bytesRead: number | undefined;
  let buffer: Buffer | undefined;
  let requested = 0;
  let readFailed = false;
  let expiredDuringRead = false;
  try {
    throwIfAborted(signal);
    if (timedOut()) return { bytesRead: 0 };
    buffer = Buffer.alloc(Math.min(info.size, MAX_SEARCH_FILE_BYTES) + 1);
    requested = Math.min(buffer.length, remainingBytes);
    ({ bytesRead } = await handle.read(buffer, 0, requested, 0));
    expiredDuringRead = timedOut();
  } catch {
    // A clone can be pruned while searching it; skip that one file.
    readFailed = true;
  } finally {
    await handle.close().catch(() => undefined);
  }
  throwIfAborted(signal);
  if (expiredDuringRead || readFailed || !buffer || bytesRead === undefined) {
    return { bytesRead: bytesRead ?? 0 };
  }
  const incomplete = requested !== buffer.length;
  if (incomplete || bytesRead === buffer.length || buffer.subarray(0, Math.min(bytesRead, 512)).includes(0)) {
    return { bytesRead, ...(incomplete ? { incomplete: true } : {}) };
  }

  const path = relative(base, real).split(sep).join('/');
  const text = buffer.subarray(0, bytesRead).toString('utf8');
  const score = scoreFile(path, text, terms);
  return { candidate: score > 0 ? { path, score, text } : undefined, bytesRead };
}

function eligibleForSearch(item: { name: string; isFile(): boolean }): boolean {
  const extension = extname(item.name).toLowerCase();
  return item.isFile() && !LOCKFILES.has(item.name) && !SKIPPED_EXTENSIONS.has(extension) && !BINARY_EXTENSIONS.has(extension);
}

function leavesWalkWork(item: { name: string; isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }, dir: string, start: string): boolean {
  if (item.isSymbolicLink() || isGitAlias(item.name)) return false;
  return eligibleForSearch(item) || (item.isDirectory() && !SKIP_DIRS.has(item.name) && !(dir === start && ROOT_SKIP_DIRS.has(item.name)));
}

async function safeDirectory(base: string, dir: string, timedOut: () => boolean, signal?: AbortSignal): Promise<string | undefined> {
  const info = await lstat(dir).catch(() => undefined);
  throwIfAborted(signal);
  if (timedOut()) return undefined;
  if (!info?.isDirectory()) return undefined;
  const real = await realpath(dir).catch(() => undefined);
  throwIfAborted(signal);
  if (timedOut()) return undefined;
  return real && inside(base, real) ? real : undefined;
}

async function scopeHasSymlink(root: string, pathScope: string | undefined, signal?: AbortSignal): Promise<boolean> {
  if (!pathScope) return false;
  const base = await realpath(root);
  throwIfAborted(signal);
  let current = base;
  for (const segment of pathScope.split(/[\\/]+/)) {
    if (!segment || segment === '.') continue;
    current = resolve(current, segment);
    if (!inside(base, current)) return false;
    const info = await lstat(current).catch(() => undefined);
    throwIfAborted(signal);
    if (info?.isSymbolicLink()) return true;
  }
  return false;
}

/**
 * Keyword search over a clone (#70). No model calls. Never follows symlinks, and any file whose
 * real path leaves the clone is skipped. Throws abortError() when `signal` fires.
 */
export async function searchRepo(root: string, options: RepoSearchOptions): Promise<RepoSearchResult> {
  throwIfAborted(options.signal);
  const now = options.now ?? performance.now.bind(performance);
  const searchStartedAt = now();
  const terms = queryTerms(options.query);
  if (options.pathScope && hasGitSegment(options.pathScope)) {
    return { scopeFound: false, terms: terms.map((term) => term.term), files: [] };
  }
  const maxFiles = options.maxFiles ?? REPO_MAX_FILES;
  const maxScannedFiles = options.maxScannedFiles ?? MAX_SCANNED_FILES;
  const maxScannedBytes = options.maxScannedBytes ?? MAX_SCANNED_BYTES;
  const maxSearchMs = options.maxSearchMs ?? MAX_SEARCH_MS;
  const timedOut = () => now() - searchStartedAt >= maxSearchMs;
  const result = (scopeFound: boolean, files: RepoSearchFile[], partial?: RepoSearchBudget, scannedFiles = 0): RepoSearchResult => ({
    scopeFound,
    terms: terms.map((term) => term.term),
    files,
    ...(partial ? { partial: true, budget: partial, scannedFiles } : {})
  });
  const scopeHasLink = await scopeHasSymlink(root, options.pathScope, options.signal);
  throwIfAborted(options.signal);
  if (scopeHasLink) {
    return result(false, []);
  }
  if (timedOut()) return result(true, [], 'time');
  const start = await resolveInside(root, options.pathScope);
  throwIfAborted(options.signal);
  if (!start) return result(false, []);
  if (timedOut()) return result(true, [], 'time');
  if (terms.length === 0) return { scopeFound: true, terms: [], files: [] };

  const base = await realpath(root);
  throwIfAborted(options.signal);
  if (timedOut()) return result(true, [], 'time');
  const top: Candidate[] = [];
  let scanned = 0;
  let scannedBytes = 0;
  const stack = [start];
  let stoppedBy: RepoSearchBudget | undefined;

  while (stack.length) {
    if (timedOut()) {
      stoppedBy = 'time';
      break;
    }
    if (scanned >= maxScannedFiles || scannedBytes >= maxScannedBytes) {
      stoppedBy = scanned >= maxScannedFiles ? 'files' : 'bytes';
      break;
    }
    throwIfAborted(options.signal);
    const dir = await safeDirectory(base, stack.pop()!, timedOut, options.signal);
    if (timedOut()) {
      stoppedBy = 'time';
      break;
    }
    if (!dir) continue;
    const items = await readdir(dir, { withFileTypes: true }).catch(() => []);
    throwIfAborted(options.signal);
    if (timedOut()) {
      stoppedBy = 'time';
      break;
    }
    items.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (item.isSymbolicLink() || isGitAlias(item.name)) continue;
      const abs = join(dir, item.name);
      if (item.isDirectory()) {
        if (!SKIP_DIRS.has(item.name) && !(dir === start && ROOT_SKIP_DIRS.has(item.name))) stack.push(abs);
        continue;
      }
      if (!eligibleForSearch(item)) continue;
      if (timedOut()) {
        stoppedBy = 'time';
        break;
      }
      if (scanned >= maxScannedFiles || scannedBytes >= maxScannedBytes) {
        stoppedBy = scanned >= maxScannedFiles ? 'files' : 'bytes';
        break;
      }
      scanned++;
      throwIfAborted(options.signal);
      const read = await readCandidate(base, abs, terms, maxScannedBytes - scannedBytes, timedOut, options.signal);
      scannedBytes += read.bytesRead;
      if (timedOut()) {
        stoppedBy = 'time';
        break;
      }
      if (read.incomplete) {
        stoppedBy = 'bytes';
        break;
      }
      if (read.candidate) keepTop(top, read.candidate, maxFiles);
      if (scanned >= maxScannedFiles || scannedBytes >= maxScannedBytes) {
        if (stack.length || items.slice(index + 1).some((remaining) => leavesWalkWork(remaining, dir, start))) stoppedBy = scanned >= maxScannedFiles ? 'files' : 'bytes';
        break;
      }
    }
    if (stoppedBy) break;
  }

  const files = top.map((candidate) => ({
    path: candidate.path,
    score: candidate.score,
    excerpts: buildExcerpts(candidate.text, terms, options.contextLines)
  }));
  return result(true, fitToBudget(files, options.charBudget ?? Number.POSITIVE_INFINITY), stoppedBy, scanned);
}
