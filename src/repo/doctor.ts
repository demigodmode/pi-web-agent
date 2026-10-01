import { ensureGitVersion, productionGitEnv, type GitResult } from './git-runner.js';
import { resolveGithubToken, type GithubToken } from './repo-auth.js';

/** One doctor line for repo research (#72). Never prints the token. */
export async function repoResearchDoctorLine({
  checkGit = () => ensureGitVersion(productionGitEnv()),
  resolveToken = () => resolveGithubToken()
}: { checkGit?: () => Promise<GitResult>; resolveToken?: () => Promise<GithubToken> } = {}): Promise<string> {
  const git = await checkGit();
  if (!git.ok) {
    if (git.failure.code === 'GIT_MISSING') return 'repo research: git not found (repo questions will say git is missing)';
    return `repo research: warning (${git.failure.message})`;
  }
  const version = /git version (\S+)/.exec(git.stdout)?.[1] ?? 'unknown';
  const { source } = await resolveToken();
  const auth =
    source === 'env' ? 'GitHub token from GITHUB_TOKEN' : source === 'gh' ? 'GitHub token from gh' : 'no GitHub login (public repos only)';
  return `repo research: git ${version}, ${auth}`;
}
