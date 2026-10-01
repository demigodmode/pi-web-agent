import { abortError, throwIfAborted } from '../abort.js';
import { READER_TEXT_CAP } from '../readers/limits.js';
import type { FailureInfo, WebFetchResponse } from '../types.js';
import type { GitEnv } from './git-runner.js';
import type { GithubToken } from './repo-auth.js';
import type { RepoCache } from './repo-cache.js';
import { cloneRepo } from './repo-clone.js';
import { fetchRepoMeta, type RepoMeta } from './repo-meta.js';
import { readRepoOverview, type RepoOverview } from './repo-overview.js';
import { searchRepo, type RepoSearchOptions, type RepoSearchResult } from './repo-search.js';
import { parseRepoUrl } from './repo-url.js';
import { safeSlice } from './safe-slice.js';
import { repoFailure, type RepoFailure } from './types.js';

export type RepoResearchError = { code: string; message: string; failure: FailureInfo };
export type RepoResearchResult = { ok: true; response: WebFetchResponse } | { ok: false; error: RepoResearchError };
export type RepoResearchInput = { url: string; query: string; signal?: AbortSignal };

export type RepoResearchDeps = {
  /** GitHub API fetch (the backend set's model fetch, so the configured proxy applies). */
  fetchImpl: typeof fetch;
  cache: RepoCache;
  /** Proxy (and, in tests, fixture transport). The token is added per call. */
  git: GitEnv;
  resolveToken: () => Promise<GithubToken>;
  metaTimeoutMs?: number;
  cloneTimeoutMs?: number;
  /** Internal test seam for proving capped scans are disclosed; never user configuration. */
  searchLimits?: Pick<RepoSearchOptions, 'maxScannedFiles' | 'maxScannedBytes' | 'maxSearchMs'>;
  searchNow?: () => number;
};

const fail = (failure: RepoFailure): RepoResearchResult => ({ ok: false, error: failure });

/** Room kept for headers, citations and the README when excerpts are fitted into READER_TEXT_CAP. */
const SEARCH_CHAR_BUDGET = READER_TEXT_CAP - 4_000;
const README_EXCERPT_CHARS = 2_000;

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function treeUrl(meta: RepoMeta): string {
  return `https://github.com/${meta.owner}/${meta.repo}/tree/${meta.sha}${meta.pathScope ? `/${encodePath(meta.pathScope)}` : ''}`;
}

function blobUrl(meta: RepoMeta, path: string, startLine: number, endLine: number): string {
  return `https://github.com/${meta.owner}/${meta.repo}/blob/${meta.sha}/${encodePath(path)}#L${startLine}-L${endLine}`;
}

function excerptSection(meta: RepoMeta, path: string, startLine: number, text: string): string {
  const endLine = startLine + text.split(/\r?\n/).length - 1;
  return `${path} (lines ${startLine}-${endLine})\n${blobUrl(meta, path, startLine, endLine)}\n${text}`;
}

function fitExcerptSection(meta: RepoMeta, path: string, excerpt: RepoSearchResult['files'][number]['excerpts'][number], maxChars: number): string | undefined {
  const full = excerptSection(meta, path, excerpt.startLine, excerpt.text);
  if (full.length <= maxChars) return full;

  const lines = excerpt.text.split(/\r?\n/);
  let best: string | undefined;
  for (const line of lines) {
    const candidate = best === undefined ? line : `${best}\n${line}`;
    if (excerptSection(meta, path, excerpt.startLine, candidate).length > maxChars) break;
    best = candidate;
  }
  if (best !== undefined && best.length > 0) return excerptSection(meta, path, excerpt.startLine, best);

  const line = lines[0] ?? '';
  let low = 1;
  let high = line.length;
  let shortened = '';
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = safeSlice(line, middle);
    if (excerptSection(meta, path, excerpt.startLine, candidate).length <= maxChars) {
      shortened = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return shortened ? excerptSection(meta, path, excerpt.startLine, shortened) : undefined;
}

function searchResponse(meta: RepoMeta, search: RepoSearchResult, overview: RepoOverview | undefined, reused: boolean): WebFetchResponse {
  const name = `${meta.owner}/${meta.repo}`;
  const partialNotice = search.partial
    ? `Searched the first ${search.scannedFiles} files only (large repo); paste a /tree/ folder link to narrow it.`
    : undefined;
  const contentCap = READER_TEXT_CAP - (partialNotice ? partialNotice.length + 2 : 0);
  const header =
    `Repository ${name} at ${meta.ref} (${meta.sha.slice(0, 12)})${meta.pathScope ? `, folder ${meta.pathScope}` : ''}.` +
      (search.terms.length ? ` Searched the code for: ${search.terms.join(', ')}.` : '');
  let truncated = header.length > contentCap || search.partial === true;
  const sections = [safeSlice(header, contentCap)];
  let length = sections[0].length;
  let exhausted = false;

  for (let index = 0; !exhausted && search.files.some((file) => file.excerpts[index]); index++) {
    for (const file of search.files) {
      const excerpt = file.excerpts[index];
      if (!excerpt) continue;
      const available = contentCap - length - 2;
      const full = excerptSection(meta, file.path, excerpt.startLine, excerpt.text);
      const section = fitExcerptSection(meta, file.path, excerpt, available);
      if (!section) {
        truncated = true;
        exhausted = true;
        break;
      }
      sections.push(section);
      length += section.length + 2;
      if (section !== full) {
        truncated = true;
        exhausted = true;
        break;
      }
    }
  }

  const appendPlain = (section: string) => {
    const available = contentCap - length - 2;
    if (section.length <= available) {
      sections.push(section);
      length += section.length + 2;
      return;
    }
    if (available > 0) {
      const shortened = safeSlice(section, available);
      if (shortened.length > 0) {
        sections.push(shortened);
        length += shortened.length + 2;
      }
    }
    truncated = true;
  };
  if (search.files.length === 0) {
    appendPlain(search.terms.length ? 'No files matched those terms.' : 'The question had no specific terms to search the code for.');
  }
  // The README only fills in when the code search found little (#70).
  if (search.files.length < 2 && overview) {
    if (overview.readme) appendPlain(`${overview.readmePath}:\n${safeSlice(overview.readme, README_EXCERPT_CHARS)}`);
    if (search.files.length === 0) {
      const listing = overview.entries.map((entry) => (entry.dir ? `[dir] ${entry.name}` : entry.name)).join('\n');
      appendPlain(`Contents of ${meta.pathScope ?? 'the top level'}:\n${listing || '(empty)'}`);
    }
  }
  if (partialNotice) sections.push(partialNotice);
  const text = sections.join('\n\n');
  return {
    status: 'ok',
    url: treeUrl(meta),
    content: { title: name, text },
    metadata: { method: 'github', cacheHit: reused, truncated }
  };
}

/**
 * A typed GitHub repo URL (#72): token, metadata, a leased clone from the session cache, then the
 * clone's keyword search for the question (#70), with the README when little matched. Throws only
 * abortError(); every other problem is { ok: false } and the orchestrator ends the run with it.
 */
export async function researchRepo(url: string, { query, signal }: { query: string; signal?: AbortSignal }, deps: RepoResearchDeps): Promise<RepoResearchResult> {
  throwIfAborted(signal);
  const target = parseRepoUrl(url);
  if (!target) return fail(repoFailure('REPO_URL_INVALID', `${url} isn't a GitHub repo link.`, 'bad_request'));

  const { token } = await deps.resolveToken();
  throwIfAborted(signal);
  const git: GitEnv = token ? { ...deps.git, token } : deps.git;

  const metaResult = await fetchRepoMeta(target, { fetchImpl: deps.fetchImpl, token, signal, git, timeoutMs: deps.metaTimeoutMs });
  if (!metaResult.ok) return fail(metaResult.failure);
  const { meta } = metaResult;

  const key = `${meta.owner}/${meta.repo}@${meta.sha}`.toLowerCase();
  const acquired = await deps.cache.acquire(
    key,
    (dest, cloneSignal) => cloneRepo({ owner: meta.owner, repo: meta.repo, sha: meta.sha, dest }, { signal: cloneSignal, git, timeoutMs: deps.cloneTimeoutMs }),
    signal
  );
  if (!acquired.ok) return fail(acquired.failure);
  const { lease } = acquired;

  try {
    const readSignal = signal ? AbortSignal.any([signal, lease.signal]) : lease.signal;
    let search: RepoSearchResult;
    let overview: RepoOverview | undefined;
    try {
      search = await searchRepo(lease.dir, {
        query,
        pathScope: meta.pathScope,
        signal: readSignal,
        charBudget: SEARCH_CHAR_BUDGET,
        ...deps.searchLimits,
        ...(deps.searchNow ? { now: deps.searchNow } : {})
      });
      if (search.scopeFound && search.files.length < 2) {
        overview = await readRepoOverview(lease.dir, { pathScope: meta.pathScope, signal: readSignal });
      }
      throwIfAborted(readSignal);
    } catch (error) {
      if (signal?.aborted) throw abortError();
      if (lease.signal.aborted) return fail(repoFailure('REPO_CACHE_CLOSED', 'The session is ending, so the repo was not searched.', 'transient'));
      return fail(repoFailure('REPO_READ_FAILED', `Couldn't read the clone of ${meta.owner}/${meta.repo}: ${error instanceof Error ? error.message : String(error)}`, 'transient'));
    }
    if (!search.scopeFound) {
      return fail(repoFailure('REPO_PATH_NOT_FOUND', `There's no folder ${meta.pathScope} in ${meta.owner}/${meta.repo} at ${meta.ref}.`, 'bad_request'));
    }
    return { ok: true, response: searchResponse(meta, search, overview, lease.reused) };
  } finally {
    lease.release();
  }
}
