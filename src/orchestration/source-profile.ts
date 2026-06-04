import type { ResearchSourceKind } from './research-types.js';

export type SourceProfileKind =
  | 'official-docs'
  | 'official-api'
  | 'issue-thread'
  | 'forum-thread'
  | 'package-page'
  | 'community';

export type SourceProfile = {
  kind: SourceProfileKind;
  sourceKind: ResearchSourceKind;
  shouldPreferHeadlessWhenWeak: boolean;
};

const COMMUNITY_FORUM_HOST_RE = /(^|\.)(community|forum|forums|discuss|discourse)\./;

function profile(
  kind: SourceProfileKind,
  sourceKind: ResearchSourceKind,
  shouldPreferHeadlessWhenWeak: boolean
): SourceProfile {
  return { kind, sourceKind, shouldPreferHeadlessWhenWeak };
}

function parseUrl(rawUrl: string): URL | undefined {
  try {
    return new URL(rawUrl);
  } catch {
    return undefined;
  }
}

function isOfficialApi(host: string, path: string) {
  return (
    (host === 'playwright.dev' && path.startsWith('/docs/api/')) ||
    (host === 'vitest.dev' && path.startsWith('/config/'))
  );
}

function isOfficialDocs(host: string, path: string) {
  return (
    (host === 'playwright.dev' && path.startsWith('/docs/')) ||
    (host === 'vitest.dev' && path.startsWith('/guide/')) ||
    (host === 'github.com' && path.startsWith('/vitest-dev/vitest/') && path.includes('/docs/')) ||
    host === 'learn.microsoft.com'
  );
}

function isIssueThread(host: string, path: string) {
  return host === 'github.com' && (path.includes('/issues/') || path.includes('/discussions/'));
}

function hasForumThreadPath(path: string) {
  return (
    path.includes('/forum/') ||
    path.includes('/forums/') ||
    path.includes('/t/') ||
    path.includes('/topic/') ||
    path.includes('/threads/')
  );
}

function isForumThread(host: string, path: string) {
  return (
    (host === 'reddit.com' && path.includes('/comments/')) ||
    (host === 'stackoverflow.com' && path.startsWith('/questions/')) ||
    (COMMUNITY_FORUM_HOST_RE.test(`${host}.`) && hasForumThreadPath(path))
  );
}

export function classifySourceProfile(rawUrl: string): SourceProfile {
  const parsed = parseUrl(rawUrl);
  if (!parsed) return profile('community', 'community', false);

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = parsed.pathname.toLowerCase();

  if (isOfficialApi(host, path)) {
    return profile('official-api', 'official-api', false);
  }

  if (isOfficialDocs(host, path)) {
    return profile('official-docs', 'official-docs', false);
  }

  if (isIssueThread(host, path)) {
    return profile('issue-thread', 'issue-thread', true);
  }

  if (isForumThread(host, path)) {
    return profile('forum-thread', 'community', true);
  }

  if (host === 'npmjs.com' && path.startsWith('/package/')) {
    return profile('package-page', 'package-page', false);
  }

  return profile('community', 'community', false);
}
