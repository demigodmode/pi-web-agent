import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { throwIfAborted } from '../abort.js';
import { REPO_MAX_FILES } from './limits.js';
import { resolveInside } from './repo-overview.js';
import { queryTerms, type QueryTerm } from './repo-terms.js';

export type RepoSearchExcerpt = { startLine: number; endLine: number; text: string };
export type RepoSearchFile = { path: string; score: number; excerpts: RepoSearchExcerpt[] };
export type RepoSearchResult = { scopeFound: boolean; terms: string[]; files: RepoSearchFile[] };
export type RepoSearchOptions = {
  query: string;
  pathScope?: string;
  /** Checked between files; the caller combines its own signal with lease.signal. */
  signal?: AbortSignal;
  maxFiles?: number;
  /** Total characters of excerpt text across all files. */
  charBudget?: number;
  contextLines?: number;
};

export const MAX_SEARCH_FILE_BYTES = 512 * 1024;
const MAX_SCANNED_FILES = 20_000;
const DEFAULT_CONTEXT_LINES = 20;

const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', '.next', 'target', '__pycache__', '.venv']);
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
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.kt', '.kts', '.rb',
  '.php', '.cs', '.c', '.h', '.cc', '.cpp', '.hpp', '.swift', '.scala', '.sh', '.lua', '.ex', '.exs', '.clj', '.dart',
  '.vue', '.svelte', '.zig', '.hs', '.ml', '.sql'
]);
const TEST_OR_DOC = /(^|\/)(tests?|__tests__|specs?|fixtures?|docs?|examples?)(\/|$)|\.(test|spec)\.[a-z0-9]+$|\.(md|markdown|rst|txt|adoc)$/i;
const GENERATED = /\.min\.(js|css)$|(^|\/)(generated|__generated__)(\/|$)|\.(generated|gen)\.[a-z0-9]+$/i;

type Candidate = { path: string; score: number; text: string };

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

/** Distinct terms in the content count most, then terms in the path; code beats docs, tests and generated files. */
export function scoreFile(path: string, text: string, terms: QueryTerm[]): number {
  const lowerPath = path.toLowerCase();
  const lowerText = text.toLowerCase();
  let contentHits = 0;
  let pathHits = 0;
  for (const term of terms) {
    if (matches(term, lowerText)) contentHits++;
    if (matches(term, lowerPath)) pathHits++;
  }
  if (contentHits === 0 && pathHits === 0) return 0;
  let score = contentHits * 10 + pathHits * 6;
  if (SOURCE_EXTENSIONS.has(extname(lowerPath))) score += 3;
  if (TEST_OR_DOC.test(path)) score -= 5;
  if (GENERATED.test(path)) score -= 8;
  return Math.max(1, score);
}

/** About `contextLines` lines either side of every matching line, overlapping windows merged. */
export function buildExcerpts(text: string, terms: QueryTerm[], contextLines = DEFAULT_CONTEXT_LINES): RepoSearchExcerpt[] {
  const lines = text.split('\n');
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
      const text = excerpt.text.slice(0, lineBreak > 0 ? lineBreak : room);
      excerpts.push({ startLine: excerpt.startLine, endLine: excerpt.startLine + text.split('\n').length - 1, text });
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
  top.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  if (top.length > limit) top.length = limit;
}

async function readCandidate(base: string, abs: string, terms: QueryTerm[], signal?: AbortSignal): Promise<Candidate | undefined> {
  const info = await lstat(abs).catch(() => undefined);
  throwIfAborted(signal);
  if (!info?.isFile() || info.size > MAX_SEARCH_FILE_BYTES) return undefined;

  const real = await realpath(abs).catch(() => undefined);
  throwIfAborted(signal);
  if (!real || !inside(base, real)) return undefined;

  const handle = await open(real, 'r').catch(() => undefined);
  if (!handle) {
    throwIfAborted(signal);
    return undefined;
  }

  let bytesRead: number | undefined;
  let buffer: Buffer | undefined;
  let readFailed = false;
  try {
    throwIfAborted(signal);
    buffer = Buffer.alloc(MAX_SEARCH_FILE_BYTES + 1);
    ({ bytesRead } = await handle.read(buffer, 0, buffer.length, 0));
  } catch {
    // A clone can be pruned while searching it; skip that one file.
    readFailed = true;
  } finally {
    await handle.close().catch(() => undefined);
  }
  throwIfAborted(signal);
  if (readFailed || !buffer || bytesRead === undefined || bytesRead > MAX_SEARCH_FILE_BYTES || buffer.subarray(0, Math.min(bytesRead, 512)).includes(0)) return undefined;

  const path = relative(base, real).split(sep).join('/');
  const text = buffer.subarray(0, bytesRead).toString('utf8');
  const score = scoreFile(path, text, terms);
  return score > 0 ? { path, score, text } : undefined;
}

async function safeDirectory(base: string, dir: string, signal?: AbortSignal): Promise<string | undefined> {
  const info = await lstat(dir).catch(() => undefined);
  throwIfAborted(signal);
  if (!info?.isDirectory()) return undefined;
  const real = await realpath(dir).catch(() => undefined);
  throwIfAborted(signal);
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
  const terms = queryTerms(options.query);
  if (await scopeHasSymlink(root, options.pathScope, options.signal)) {
    return { scopeFound: false, terms: terms.map((term) => term.term), files: [] };
  }
  const start = await resolveInside(root, options.pathScope);
  throwIfAborted(options.signal);
  if (!start) return { scopeFound: false, terms: terms.map((term) => term.term), files: [] };
  if (terms.length === 0) return { scopeFound: true, terms: [], files: [] };

  const base = await realpath(root);
  throwIfAborted(options.signal);
  const maxFiles = options.maxFiles ?? REPO_MAX_FILES;
  const top: Candidate[] = [];
  let scanned = 0;
  const stack = [start];

  while (stack.length && scanned < MAX_SCANNED_FILES) {
    throwIfAborted(options.signal);
    const dir = await safeDirectory(base, stack.pop()!, options.signal);
    if (!dir) continue;
    const items = await readdir(dir, { withFileTypes: true }).catch(() => []);
    throwIfAborted(options.signal);
    for (const item of items) {
      if (item.isSymbolicLink() || isGitAlias(item.name)) continue;
      const abs = join(dir, item.name);
      if (item.isDirectory()) {
        if (!SKIP_DIRS.has(item.name)) stack.push(abs);
        continue;
      }
      if (!item.isFile() || LOCKFILES.has(item.name) || BINARY_EXTENSIONS.has(extname(item.name).toLowerCase())) continue;
      if (++scanned > MAX_SCANNED_FILES) break;
      throwIfAborted(options.signal);
      const candidate = await readCandidate(base, abs, terms, options.signal);
      if (candidate) keepTop(top, candidate, maxFiles);
    }
  }

  const files = top.map((candidate) => ({
    path: candidate.path,
    score: candidate.score,
    excerpts: buildExcerpts(candidate.text, terms, options.contextLines)
  }));
  return { scopeFound: true, terms: terms.map((term) => term.term), files: fitToBudget(files, options.charBudget ?? Number.POSITIVE_INFINITY) };
}
