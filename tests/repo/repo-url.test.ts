import { describe, expect, it } from 'vitest';
import { parseRepoUrl } from '../../src/repo/repo-url.js';

describe('parseRepoUrl', () => {
  it.each([
    ['https://github.com/acme/widget', { owner: 'acme', repo: 'widget' }],
    ['https://github.com/acme/widget/', { owner: 'acme', repo: 'widget' }],
    ['https://github.com/acme/widget.git', { owner: 'acme', repo: 'widget' }],
    ['http://GitHub.com/acme/widget?tab=readme#top', { owner: 'acme', repo: 'widget' }],
    ['https://github.com/acme/widget/tree/main', { owner: 'acme', repo: 'widget', refAndPath: 'main' }],
    ['https://github.com/acme/widget/tree/feature/x/src/auth', { owner: 'acme', repo: 'widget', refAndPath: 'feature/x/src/auth' }],
    ['https://github.com/acme/my.repo_name-2/tree/v1.2.0/docs', { owner: 'acme', repo: 'my.repo_name-2', refAndPath: 'v1.2.0/docs' }]
  ])('accepts %s', (url, expected) => {
    expect(parseRepoUrl(url)).toEqual(expected);
  });

  it('keeps refAndPath raw because branch names can contain slashes', () => {
    expect(parseRepoUrl('https://github.com/acme/widget/tree/release/2026/q3/lib')?.refAndPath).toBe('release/2026/q3/lib');
  });

  it.each([
    'https://github.com/acme/widget/blob/main/README.md',
    'https://github.com/acme/widget/issues/3',
    'https://github.com/acme/widget/pull/4',
    'https://github.com/acme/widget/tree',
    'https://github.com/acme/widget/settings',
    'https://github.com/acme',
    'https://github.com/',
    'https://gitlab.com/acme/widget',
    'https://raw.githubusercontent.com/acme/widget/main/README.md',
    'https://github.com.evil.example/acme/widget',
    'ftp://github.com/acme/widget',
    'https://github.com/acme/..',
    'not a url'
  ])('rejects %s', (url) => {
    expect(parseRepoUrl(url)).toBeUndefined();
  });
});
