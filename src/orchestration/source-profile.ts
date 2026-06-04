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

export function classifySourceProfile(rawUrl: string): SourceProfile {
  const parsed = parseUrl(rawUrl);
  if (!parsed) return profile('community', 'community', false);

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = parsed.pathname.toLowerCase();

  if (host === 'playwright.dev' && path.startsWith('/docs/api/')) {
    return profile('official-api', 'official-api', false);
  }

  if (host === 'vitest.dev' && path.startsWith('/config/')) {
    return profile('official-api', 'official-api', false);
  }

  if (
    host === 'playwright.dev' && path.startsWith('/docs/') ||
    host === 'vitest.dev' && path.startsWith('/guide/') ||
    host === 'github.com' && path.startsWith('/vitest-dev/vitest/') && path.includes('/docs/') ||
    host === 'learn.microsoft.com'
  ) {
    return profile('official-docs', 'official-docs', false);
  }

  if (host === 'github.com' && (path.includes('/issues/') || path.includes('/discussions/'))) {
    return profile('issue-thread', 'issue-thread', true);
  }

  if (
    host === 'reddit.com' && path.includes('/comments/') ||
    host === 'stackoverflow.com' && path.startsWith('/questions/') ||
    COMMUNITY_FORUM_HOST_RE.test(`${host}.`) && (
      path.includes('/forum/') ||
      path.includes('/forums/') ||
      path.includes('/t/') ||
      path.includes('/topic/') ||
      path.includes('/threads/')
    )
  ) {
    return profile('forum-thread', 'community', true);
  }

  if (host === 'npmjs.com' && path.startsWith('/package/')) {
    return profile('package-page', 'package-page', false);
  }

  return profile('community', 'community', false);
}
