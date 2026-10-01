import { rm } from 'node:fs/promises';
import { githubRemoteUrl, runGit, type GitEnv } from './git-runner.js';
import { REPO_CLONE_TIMEOUT_MS } from './limits.js';
import { repoFailure, type RepoFailure } from './types.js';

export type CloneTarget = { owner: string; repo: string; sha: string; dest: string };
export type CloneResult = { ok: true; sha: string } | { ok: false; failure: RepoFailure };
export type CloneDeps = { signal?: AbortSignal; timeoutMs?: number; git: GitEnv; runGitImpl?: typeof runGit };

function describeFailure(failure: RepoFailure, name: string, timeoutMs: number): RepoFailure {
  if (failure.code === 'GIT_TIMEOUT') {
    return repoFailure('REPO_CLONE_TIMEOUT', `Cloning ${name} timed out after ${Math.round(timeoutMs / 1000)}s.`, 'transient');
  }
  if (failure.code === 'GIT_MISSING' || failure.code === 'GIT_TOO_OLD') return failure;
  return repoFailure('REPO_CLONE_FAILED', `Cloning ${name} failed: ${failure.message}`, 'transient');
}

/**
 * One path for branches, tags and SHAs (#72): init, fetch exactly `sha` at depth 1, check it out,
 * verify HEAD. The cached commit is therefore the one metadata resolved, even if the branch has
 * moved since. One timeout covers all steps. On any failure or cancel the folder is removed.
 */
export async function cloneRepo(target: CloneTarget, deps: CloneDeps): Promise<CloneResult> {
  const { owner, repo, sha, dest } = target;
  const name = `${owner}/${repo}`;
  const timeoutMs = deps.timeoutMs ?? REPO_CLONE_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const run = deps.runGitImpl ?? runGit;
  const step = (args: string[]) => run(args, { signal: deps.signal, timeoutMs: Math.max(1, deadline - Date.now()), env: deps.git });
  const cleanup = () => rm(dest, { recursive: true, force: true }).catch(() => undefined);

  try {
    for (const args of [
      ['init', '-q', dest],
      ['-C', dest, 'fetch', '-q', '--depth', '1', '--no-tags', githubRemoteUrl(deps.git, owner, repo), sha],
      ['-C', dest, 'checkout', '-q', '--detach', 'FETCH_HEAD']
    ]) {
      const result = await step(args);
      if (!result.ok) {
        await cleanup();
        return { ok: false, failure: describeFailure(result.failure, name, timeoutMs) };
      }
    }
    const head = await step(['-C', dest, 'rev-parse', 'HEAD']);
    if (!head.ok) {
      await cleanup();
      return { ok: false, failure: describeFailure(head.failure, name, timeoutMs) };
    }
    const actual = head.stdout.trim().toLowerCase();
    if (actual !== sha.toLowerCase()) {
      await cleanup();
      return {
        ok: false,
        failure: repoFailure('REPO_CLONE_MISMATCH', `Cloning ${name} gave commit ${actual.slice(0, 12)} instead of ${sha.slice(0, 12)}.`, 'bad_response')
      };
    }
    return { ok: true, sha: actual };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
