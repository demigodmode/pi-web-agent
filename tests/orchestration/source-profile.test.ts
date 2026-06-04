import { describe, expect, it } from 'vitest';
import { classifySourceProfile } from '../../src/orchestration/source-profile.js';

describe('classifySourceProfile', () => {
  it('classifies reddit posts and comments as forum threads', () => {
    expect(classifySourceProfile('https://www.reddit.com/r/selfhosted/comments/abc/post_title/')).toEqual({
      kind: 'forum-thread',
      sourceKind: 'community',
      shouldPreferHeadlessWhenWeak: true
    });
    expect(classifySourceProfile('https://www.reddit.com/r/selfhosted/comments/abc/comment/def/?context=3')).toEqual({
      kind: 'forum-thread',
      sourceKind: 'community',
      shouldPreferHeadlessWhenWeak: true
    });
  });

  it('classifies GitHub issues and discussions as issue threads', () => {
    expect(classifySourceProfile('https://github.com/org/repo/issues/123').sourceKind).toBe('issue-thread');
    expect(classifySourceProfile('https://github.com/org/repo/discussions/456').sourceKind).toBe('issue-thread');
  });

  it('classifies stack overflow and forum-like paths as forum threads', () => {
    expect(classifySourceProfile('https://stackoverflow.com/questions/123/example').kind).toBe('forum-thread');
    expect(classifySourceProfile('https://community.example.com/t/a-thread/123').kind).toBe('forum-thread');
    expect(classifySourceProfile('https://forum.example.com/topic/123').kind).toBe('forum-thread');
  });

  it('keeps package pages low-value by default', () => {
    expect(classifySourceProfile('https://www.npmjs.com/package/foo')).toEqual({
      kind: 'package-page',
      sourceKind: 'package-page',
      shouldPreferHeadlessWhenWeak: false
    });
  });
});
