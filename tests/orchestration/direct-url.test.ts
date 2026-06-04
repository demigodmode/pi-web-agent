import { describe, expect, it } from 'vitest';
import { extractDirectUrls } from '../../src/orchestration/direct-url.js';

describe('extractDirectUrls', () => {
  it('extracts http and https urls from a research query', () => {
    expect(
      extractDirectUrls('Read https://example.com/post and compare it with http://example.org/docs.')
    ).toEqual(['https://example.com/post', 'http://example.org/docs']);
  });

  it('strips trailing punctuation without damaging url paths', () => {
    expect(extractDirectUrls('Read this: https://example.com/docs/foo).')).toEqual([
      'https://example.com/docs/foo'
    ]);
  });

  it('removes tracking params but keeps meaningful params', () => {
    expect(
      extractDirectUrls(
        'https://www.reddit.com/r/selfhosted/comments/1tw2ywm/comment/oplq3te/?context=3&utm_source=share&utm_medium=web3x&utm_name=web3xcss'
      )
    ).toEqual([
      'https://www.reddit.com/r/selfhosted/comments/1tw2ywm/comment/oplq3te/?context=3'
    ]);
  });

  it('deduplicates normalized urls', () => {
    expect(
      extractDirectUrls('https://example.com/a?utm_source=x https://example.com/a')
    ).toEqual(['https://example.com/a']);
  });

  it('ignores non-http urls', () => {
    expect(extractDirectUrls('Try ftp://example.com/file and mailto:a@example.com')).toEqual([]);
  });
});
