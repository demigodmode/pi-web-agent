export type RepoTarget = { owner: string; repo: string; refAndPath?: string };

const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

function decode(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/**
 * A repo URL the user typed: the repo root, or a /tree/<ref>/<path> link (#72).
 * Blobs, issues, pulls and every other github.com page stay with the existing
 * reader. refAndPath is kept whole because branch names can contain slashes;
 * repo-meta works out where the ref ends.
 */
export function parseRepoUrl(url: string): RepoTarget | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
  if (parsed.hostname.toLowerCase() !== 'github.com') return undefined;

  const segments = parsed.pathname.split('/').filter(Boolean).map(decode);
  if (segments.some((segment) => segment === undefined)) return undefined;
  const [owner, rawRepo, kind, ...rest] = segments as string[];
  if (!owner || !rawRepo) return undefined;

  const repo = rawRepo.replace(/\.git$/i, '');
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') return undefined;

  if (kind === undefined) return { owner, repo };
  if (kind === 'tree' && rest.length > 0) return { owner, repo, refAndPath: rest.join('/') };
  return undefined;
}
