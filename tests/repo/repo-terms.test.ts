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

  it('keeps terms from a Cyrillic question', () => {
    expect(queryTerms('Как обновляются токены?').map(({ term }) => term)).toEqual([
      'как',
      'обновляются',
      'токены'
    ]);
  });

  it('splits acronym prefixes while keeping the whole identifier', () => {
    expect(queryTerms('what calls HTTPServer').map(({ term }) => term)).toEqual([
      'calls',
      'httpserver',
      'http',
      'server'
    ]);
  });

  it.each([
    ['OAuth', ['oauth']],
    ['iOS', ['ios']],
    ['XHttp', ['xhttp']]
  ])('does not add a clipped camel part for %s', (identifier, terms) => {
    expect(queryTerms(identifier).map(({ term }) => term)).toEqual(terms);
  });

  it('keeps underscore parts when the first part is one letter', () => {
    expect(queryTerms('x_token').map(({ term }) => term)).toEqual(['x_token', 'token']);
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
