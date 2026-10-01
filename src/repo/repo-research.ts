import { abortError, throwIfAborted } from '../abort.js';
import { READER_TEXT_CAP } from '../readers/limits.js';
import type { FailureInfo, WebFetchResponse } from '../types.js';
import type { GitEnv } from './git-runner.js';
import type { GithubToken } from './repo-auth.js';
import type { RepoCache } from './repo-cache.js';
import { cloneRepo } from './repo-clone.js';
import { fetchRepoMeta, type RepoMeta } from './repo-meta.js';
import { readRepoOverview, type RepoOverview } from './repo-overview.js';
import { searchRepo, type RepoSearchResult } from './repo-search.js';
import { parseRepoUrl } from './repo-url.js';
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

function searchResponse(meta: RepoMeta, search: RepoSearchResult, overview: RepoOverview | undefined, reused: boolean): WebFetchResponse {
  const name = `${meta.owner}/${meta.repo}`;
  const sections = [
    `Repository ${name} at ${meta.ref} (${meta.sha.slice(0, 12)})${meta.pathScope ? `, folder ${meta.pathScope}` : ''}.` +
      (search.terms.length ? ` Searched the code for: ${search.terms.join(', ')}.` : '')
  ];
  for (const file of search.files) {
    for (const excerpt of file.excerpts) {
      sections.push(`${file.path} (lines ${excerpt.startLine}-${excerpt.endLine})\n${blobUrl(meta, file.path, excerpt.startLine, excerpt.endLine)}\n${excerpt.text}`);
    }
  }
  if (search.files.length === 0) {
    sections.push(search.terms.length ? 'No files matched those terms.' : 'The question had no specific terms to search the code for.');
  }
  // The README only fills in when the code search found little (#70).
  if (search.files.length < 2 && overview) {
    if (overview.readme) sections.push(`${overview.readmePath}:\n${overview.readme.slice(0, README_EXCERPT_CHARS)}`);
    if (search.files.length === 0) {
      const listing = overview.entries.map((entry) => (entry.dir ? `[dir] ${entry.name}` : entry.name)).join('\n');
      sections.push(`Contents of ${meta.pathScope ?? 'the top level'}:\n${listing || '(empty)'}`);
    }
  }
  const text = sections.join('\n\n');
  return {
    status: 'ok',
    url: treeUrl(meta),
    content: { title: name, text: text.slice(0, READER_TEXT_CAP) },
    metadata: { method: 'github', cacheHit: reused, truncated: text.length > READER_TEXT_CAP }
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
      search = await searchRepo(lease.dir, { query, pathScope: meta.pathScope, signal: readSignal, charBudget: SEARCH_CHAR_BUDGET });
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
