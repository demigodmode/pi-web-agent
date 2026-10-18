import { describe, expect, test } from 'vitest';
import { createPresentationStats } from '../../src/orchestration/presentation-stats.js';
import type { WebFetchHeadlessResponse, WebFetchResponse } from '../../src/types.js';

function response(overrides: Partial<WebFetchResponse> = {}): WebFetchResponse {
  return {
    status: 'ok',
    url: 'https://example.test/page',
    content: { text: 'Readable page text' },
    metadata: { method: 'http', cacheHit: false },
    ...overrides
  };
}

function headless(overrides: Partial<WebFetchHeadlessResponse> = {}): WebFetchHeadlessResponse {
  return {
    status: 'ok',
    url: 'https://example.test/page',
    content: { text: 'Readable page text' },
    metadata: { method: 'headless', cacheHit: false },
    ...overrides
  };
}

describe('createPresentationStats', () => {
  test('counts logical searches and clones snapshots', () => {
    const stats = createPresentationStats();
    stats.recordSearch('first query');
    stats.recordSearch('first query');
    const snapshot = stats.snapshot();
    snapshot.executedQueries.push('mutated');
    snapshot.methods.http = 9;

    expect(stats.snapshot()).toEqual({
      searches: 2,
      executedQueries: ['first query', 'first query'],
      pagesRead: 0,
      failedReads: 0,
      methods: {}
    });
  });

  test('counts readable successful content even without a relevant passage', () => {
    const stats = createPresentationStats();
    stats.recordRead(response({ content: { text: 'ordinary text with no matching passage' } }));
    stats.recordRead(response({ url: 'https://example.test/empty', content: { text: '' } }));
    stats.recordRead(response({ url: 'https://example.test/bot', content: { text: 'Checking your browser' } }));
    stats.recordRead(response({ status: 'error', url: 'https://example.test/error', content: undefined }));

    expect(stats.snapshot()).toMatchObject({ pagesRead: 1, failedReads: 3, methods: { http: 1 } });
  });

  test('settles headless-pending URLs against later browser successes', () => {
    const stats = createPresentationStats();
    stats.recordRead(response({ status: 'needs_headless', url: 'https://example.test/a' }));
    stats.recordRead(response({ status: 'needs_headless', url: 'https://example.test/b' }));
    stats.recordRead(response({ status: 'needs_headless', url: 'https://example.test/c' }));
    stats.recordRead(headless({ url: 'https://example.test/a' }));

    expect(stats.snapshot()).toMatchObject({ pagesRead: 1, failedReads: 2, methods: { headless: 1 } });
  });

  test('deduplicates failures and clears them after a successful headless retry', () => {
    const stats = createPresentationStats();
    stats.recordFailure('https://example.test/a?utm_source=one');
    stats.recordRead(response({ status: 'error', url: 'https://example.test/a?utm_source=two', content: undefined }));
    stats.recordRead(response({ status: 'error', url: 'https://example.test/a', content: undefined }));
    stats.recordRead(headless({ url: 'https://example.test/a' }));

    expect(stats.snapshot()).toMatchObject({ pagesRead: 1, failedReads: 0, methods: { headless: 1 } });
  });

  test('deduplicates successful redirects and headless retries by final URL', () => {
    const stats = createPresentationStats();
    stats.recordRead(response({ url: 'https://www.example.test/article/?utm_source=x' }), 'http', 'https://short.test/a');
    stats.recordRead(headless({ url: 'https://example.test/article' }), 'headless', 'https://short.test/a');

    expect(stats.snapshot()).toMatchObject({ pagesRead: 1, failedReads: 0, methods: { http: 1 } });
  });

  test('uses requested URL as a failure alias for a retry whose final URL changes', () => {
    const stats = createPresentationStats();
    stats.recordRead(response({ status: 'error', url: 'https://example.test/failed-final', content: undefined }), 'http', 'https://short.test/a');
    stats.recordRead(headless({ url: 'https://example.test/success-final' }), 'headless', 'https://short.test/a');

    expect(stats.snapshot()).toMatchObject({ pagesRead: 1, failedReads: 0, methods: { headless: 1 } });
  });

  test('settles a final URL when any of its requested failure aliases later succeeds', () => {
    const stats = createPresentationStats();
    stats.recordRead(response({ status: 'error', url: 'https://example.test/failed-final', content: undefined }), 'http', 'https://short.test/a');
    stats.recordRead(response({ status: 'error', url: 'https://example.test/failed-final', content: undefined }), 'http', 'https://short.test/b');
    stats.recordRead(headless({ url: 'https://example.test/success-final' }), 'headless', 'https://short.test/b');

    expect(stats.snapshot()).toMatchObject({ pagesRead: 1, failedReads: 0, methods: { headless: 1 } });
  });

  test('settles pending headless URLs when any requested alias later succeeds', () => {
    const stats = createPresentationStats();
    stats.recordRead(response({ status: 'needs_headless', url: 'https://example.test/needs-browser' }), 'http', 'https://short.test/a');
    stats.recordRead(response({ status: 'needs_headless', url: 'https://example.test/needs-browser' }), 'http', 'https://short.test/b');
    stats.recordRead(headless({ url: 'https://example.test/success-final' }), 'headless', 'https://short.test/b');

    expect(stats.snapshot()).toMatchObject({ pagesRead: 1, failedReads: 0, methods: { headless: 1 } });
  });

  test('keeps repo separate from github and trusts repo content that resembles a bot check', () => {
    const stats = createPresentationStats();
    const botPhrase = response({ metadata: { method: 'github', cacheHit: false }, content: { text: 'Checking your browser is mentioned in this issue.' } });
    stats.recordRead(botPhrase, 'repo');
    stats.recordRead({ ...botPhrase, url: 'https://example.test/issue' });

    expect(stats.snapshot()).toMatchObject({ pagesRead: 1, failedReads: 1, methods: { repo: 1 } });
  });
});
