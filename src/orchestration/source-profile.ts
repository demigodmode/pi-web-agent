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

export function classifySourceProfile(rawUrl: string): SourceProfile {
  const url = rawUrl.toLowerCase();

  if (url.includes('/docs/api/') || url.includes('/config/')) {
    return { kind: 'official-api', sourceKind: 'official-api', shouldPreferHeadlessWhenWeak: false };
  }

  if (
    url.includes('playwright.dev/docs') ||
    url.includes('vitest.dev/guide/') ||
    url.includes('github.com/vitest-dev/vitest') && url.includes('/docs/') ||
    url.includes('learn.microsoft.com')
  ) {
    return { kind: 'official-docs', sourceKind: 'official-docs', shouldPreferHeadlessWhenWeak: false };
  }

  if (url.includes('github.com/') && (url.includes('/issues/') || url.includes('/discussions/'))) {
    return { kind: 'issue-thread', sourceKind: 'issue-thread', shouldPreferHeadlessWhenWeak: true };
  }

  if (
    url.includes('reddit.com/r/') ||
    url.includes('stackoverflow.com/questions/') ||
    url.includes('/forum/') ||
    url.includes('/forums/') ||
    url.includes('/t/') ||
    url.includes('/topic/') ||
    url.includes('/threads/')
  ) {
    return { kind: 'forum-thread', sourceKind: 'community', shouldPreferHeadlessWhenWeak: true };
  }

  if (url.includes('npmjs.com/package/')) {
    return { kind: 'package-page', sourceKind: 'package-page', shouldPreferHeadlessWhenWeak: false };
  }

  return { kind: 'community', sourceKind: 'community', shouldPreferHeadlessWhenWeak: false };
}
