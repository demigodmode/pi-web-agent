import { abortError, requestSignal } from '../abort.js';
import { githubRemoteUrl, runGit, type GitEnv } from './git-runner.js';
import { REPO_MAX_SIZE_MB, REPO_META_TIMEOUT_MS } from './limits.js';
import type { RepoTarget } from './repo-url.js';
import { repoFailure, type RepoFailure } from './types.js';

export type RepoMeta = {
  owner: string;
  repo: string;
  sizeKb: number;
  private: boolean;
  sha: string;
  ref: string;
  pathScope?: string;
};
export type RepoMetaResult = { ok: true; meta: RepoMeta } | { ok: false; failure: RepoFailure };

export type RepoMetaDeps = {
  fetchImpl: typeof fetch;
  token?: string;
  signal?: AbortSignal;
  git: GitEnv;
  timeoutMs?: number;
  /** Test seam. */
  runGitImpl?: typeof runGit;
};

export type RemoteRefs = { heads: Map<string, string>; tags: Map<string, string> };

const SHA = /^[0-9a-f]{40}$/i;
const API = 'https://api.github.com';

class MetaStop extends Error {
  constructor(readonly failure: RepoFailure) {
    super(failure.message);
  }
}

function formatSize(sizeKb: number): string {
  const mb = sizeKb / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)}GB` : `${Math.round(mb)}MB`;
}

function statusFailure(status: number, headers: Headers, name: string, tokenSent: boolean): RepoFailure {
  if (status === 404) {
    if (tokenSent) {
      return repoFailure('REPO_NOT_FOUND', `${name} wasn't found, or the token doesn't have access to it.`, 'bad_request');
    }
    return repoFailure(
      'REPO_NOT_FOUND',
      `${name} wasn't found, or it's private and there's no access. For private repos run \`gh auth login\` or set GITHUB_TOKEN.`,
      'auth_failed'
    );
  }
  if (status === 401) {
    return repoFailure('REPO_AUTH_FAILED', 'GitHub rejected the token; check GITHUB_TOKEN or run `gh auth login` again.', 'auth_failed');
  }
  if (status === 429 || (status === 403 && (headers.get('x-ratelimit-remaining') === '0' || headers.has('retry-after')))) {
    return repoFailure('REPO_RATE_LIMITED', 'GitHub rate limit hit; set GITHUB_TOKEN or sign in with `gh` for a higher limit.', 'rate_limited');
  }
  if (status === 403) return repoFailure('REPO_FORBIDDEN', `GitHub refused access to ${name}.`, 'auth_failed');
  return repoFailure('REPO_META_FAILED', `GitHub answered HTTP ${status} for ${name}.`, 'transient');
}

export function parseLsRemote(output: string): RemoteRefs {
  const heads = new Map<string, string>();
  const tags = new Map<string, string>();
  for (const line of output.split('\n')) {
    const [sha, name] = line.trim().split(/\s+/);
    if (!sha || !name || !SHA.test(sha)) continue;
    if (name.startsWith('refs/heads/')) {
      heads.set(name.slice('refs/heads/'.length), sha.toLowerCase());
    } else if (name.startsWith('refs/tags/')) {
      const tag = name.slice('refs/tags/'.length);
      if (tag.endsWith('^{}')) tags.set(tag.slice(0, -3), sha.toLowerCase());
      else if (!tags.has(tag)) tags.set(tag, sha.toLowerCase());
    }
  }
  return { heads, tags };
}

export function pickRef(refs: RemoteRefs, refAndPath: string): { ref: string; sha: string; pathScope?: string } | undefined {
  let best: { ref: string; sha: string; branch: boolean } | undefined;
  const consider = (name: string, sha: string, branch: boolean) => {
    if (refAndPath !== name && !refAndPath.startsWith(`${name}/`)) return;
    if (!best || name.length > best.ref.length || (name.length === best.ref.length && branch && !best.branch)) {
      best = { ref: name, sha, branch };
    }
  };
  for (const [name, sha] of refs.heads) consider(name, sha, true);
  for (const [name, sha] of refs.tags) consider(name, sha, false);
  if (!best) return undefined;
  const pathScope = refAndPath.slice(best.ref.length).replace(/^\/+|\/+$/g, '');
  return { ref: best.ref, sha: best.sha, ...(pathScope ? { pathScope } : {}) };
}

export async function fetchRepoMeta(target: RepoTarget, deps: RepoMetaDeps): Promise<RepoMetaResult> {
  const { owner, repo } = target;
  const name = `${owner}/${repo}`;
  const timeoutMs = deps.timeoutMs ?? REPO_META_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const budget = requestSignal(deps.signal, timeoutMs);
  const tokenSent = Boolean(deps.token);
  const timedOut = () => repoFailure('REPO_META_TIMEOUT', `GitHub didn't answer within ${Math.round(timeoutMs / 1000)}s.`, 'transient');
  const base = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  const read = async (url: string, accept: string): Promise<string> => {
    try {
      const response = await deps.fetchImpl(url, {
        headers: {
          Accept: accept,
          'User-Agent': 'pi-web-agent',
          ...(tokenSent ? { Authorization: `Bearer ${deps.token}` } : {})
        },
        signal: budget
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new MetaStop(statusFailure(response.status, response.headers, name, tokenSent));
      }
      return await response.text();
    } catch (error) {
      if (error instanceof MetaStop) throw error;
      if (deps.signal?.aborted) throw abortError();
      if (budget.aborted) throw new MetaStop(timedOut());
      throw new MetaStop(repoFailure('REPO_META_FAILED', "GitHub couldn't be reached.", 'transient'));
    }
  };

  const listRefs = async (): Promise<RemoteRefs> => {
    const result = await (deps.runGitImpl ?? runGit)(['ls-remote', '--heads', '--tags', githubRemoteUrl(deps.git, owner, repo)], {
      signal: deps.signal,
      timeoutMs: Math.max(1, deadline - Date.now()),
      env: deps.token ? { ...deps.git, token: deps.token } : deps.git
    });
    if (result.ok) return parseLsRemote(result.stdout);
    if (result.failure.code === 'GIT_TIMEOUT') throw new MetaStop(timedOut());
    if (result.failure.code === 'GIT_MISSING' || result.failure.code === 'GIT_TOO_OLD') throw new MetaStop(result.failure);
    throw new MetaStop(repoFailure('REPO_META_FAILED', `Couldn't list branches and tags for ${name}: ${result.failure.message}`, 'transient'));
  };

  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await read(base, 'application/vnd.github+json'));
    } catch (error) {
      if (error instanceof MetaStop) throw error;
      if (deps.signal?.aborted) throw abortError();
      throw new MetaStop(repoFailure('REPO_META_FAILED', `GitHub sent something unexpected for ${name}.`, 'bad_response'));
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, failure: repoFailure('REPO_META_FAILED', `GitHub sent invalid metadata for ${name}.`, 'bad_response') };
    }
    const info = parsed as { size?: unknown; private?: unknown; default_branch?: unknown };
    if (typeof info.size !== 'number' || !Number.isFinite(info.size) || info.size < 0) {
      return { ok: false, failure: repoFailure('REPO_META_FAILED', `GitHub sent invalid metadata for ${name}.`, 'bad_response') };
    }
    const sizeKb = info.size;
    if (sizeKb / 1024 > REPO_MAX_SIZE_MB) {
      return {
        ok: false,
        failure: repoFailure(
          'REPO_TOO_LARGE',
          `${name} is ${formatSize(sizeKb)}, over the ${REPO_MAX_SIZE_MB}MB limit; ask about a specific file URL instead.`,
          'bad_request'
        )
      };
    }
    const defaultBranch = typeof info.default_branch === 'string' && info.default_branch ? info.default_branch : 'main';

    let ref: string;
    let sha: string;
    let pathScope: string | undefined;
    if (!target.refAndPath) {
      ref = defaultBranch;
      sha = (await read(`${base}/commits/${encodeURIComponent(ref)}`, 'application/vnd.github.sha')).trim();
    } else {
      const [first, ...rest] = target.refAndPath.split('/');
      if (SHA.test(first)) {
        ref = first.toLowerCase();
        sha = ref;
        pathScope = rest.join('/').replace(/\/+$/, '') || undefined;
      } else {
        const picked = pickRef(await listRefs(), target.refAndPath);
        if (!picked) {
          return { ok: false, failure: repoFailure('REPO_REF_NOT_FOUND', `Couldn't find that branch, tag or commit in ${name}.`, 'bad_request') };
        }
        ({ ref, sha, pathScope } = picked);
      }
    }
    if (!SHA.test(sha)) {
      return { ok: false, failure: repoFailure('REPO_META_FAILED', `GitHub didn't return a commit for ${name}.`, 'bad_response') };
    }
    return {
      ok: true,
      meta: { owner, repo, sizeKb, private: info.private === true, sha: sha.toLowerCase(), ref, ...(pathScope ? { pathScope } : {}) }
    };
  } catch (error) {
    if (error instanceof MetaStop) return { ok: false, failure: error.failure };
    if (deps.signal?.aborted) throw abortError();
    return { ok: false, failure: repoFailure('REPO_META_FAILED', `GitHub metadata failed for ${name}.`, 'transient') };
  }
}
