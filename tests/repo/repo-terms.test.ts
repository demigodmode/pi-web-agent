import { describe, expect, it } from 'vitest';
import { queryTerms } from '../../src/repo/repo-terms.js';

describe('queryTerms', () => {
  it('removes URLs and common question words', () => {
    expect(queryTerms('where does this project refresh OAuth tokens? https://github.com/acme/widget').map(({ term }) => term)).toEqual([
      'refresh',
      'oauth',
      'tokens'
    ]);
  });

  it('keeps identifiers and adds their useful parts', () => {
    expect(queryTerms('what calls refreshAccessToken and token_store').map(({ term }) => term)).toEqual([
      'calls',
      'refreshaccesstoken',
      'refresh',
      'access',
      'token',
      'token_store',
      'store'
    ]);
  });

  it('adds simple singular variants', () => {
    expect(queryTerms('tokens policies caches process')).toEqual([
      { term: 'tokens', variants: ['tokens', 'token'] },
      { term: 'policies', variants: ['policies', 'policy'] },
      { term: 'caches', variants: ['caches', 'cache', 'cach'] },
      { term: 'process', variants: ['process'] }
    ]);
  });

  it('returns no terms when a URL and stopwords are the whole query', () => {
    expect(queryTerms('what is this? https://github.com/acme/widget')).toEqual([]);
  });

  it('excludes pure numbers while keeping meaningful words', () => {
    expect(queryTerms('issue 1234 in version 2').map(({ term }) => term)).toEqual(['issue', 'version']);
  });
});
