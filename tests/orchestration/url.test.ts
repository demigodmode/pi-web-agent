import { describe, it, expect } from 'vitest';
import { canonicalizeUrl, redactUrlForDisplay, redactUrlsInText } from '../../src/orchestration/url.js';

describe('canonicalizeUrl', () => {
  it('strips tracking params, fragment, trailing slash, and www', () => {
    expect(canonicalizeUrl('https://www.example.com/a/?utm_source=x#frag')).toBe('https://example.com/a');
    expect(canonicalizeUrl('https://example.com/a')).toBe('https://example.com/a');
  });

  it('lowercases the host but keeps the path case', () => {
    expect(canonicalizeUrl('https://Example.COM/Path')).toBe('https://example.com/Path');
  });

  it('treats trailing-slash and non-slash as the same', () => {
    expect(canonicalizeUrl('https://example.com/a/')).toBe(canonicalizeUrl('https://example.com/a'));
  });

  it('returns undefined for non-http(s) or unparseable urls', () => {
    expect(canonicalizeUrl('mailto:x@y.com')).toBeUndefined();
    expect(canonicalizeUrl('not a url')).toBeUndefined();
  });

  it('preserves www when canonicalizeHost is false (host still lowercased by URL parser)', () => {
    expect(canonicalizeUrl('https://www.Example.com/A/?utm_source=x', { canonicalizeHost: false }))
      .toBe('https://www.example.com/A');
  });
});

describe('redactUrlForDisplay', () => {
  it('removes userinfo and keeps the rest of the URL', () => {
    expect(redactUrlForDisplay('https://alice:secret@example.com/doc')).toBe('https://example.com/doc');
  });

  it('redacts secret-looking query values and keeps other params', () => {
    expect(redactUrlForDisplay('https://example.com/doc?token=secret&id=123')).toBe('https://example.com/doc?token=REDACTED&id=123');
    expect(redactUrlForDisplay('https://example.com/doc?id=123')).toBe('https://example.com/doc?id=123');
  });

  it('redacts signed URL params by name', () => {
    expect(redactUrlForDisplay('https://bucket.example.com/file.pdf?X-Amz-Signature=abc&X-Amz-Date=20260101')).toBe('https://bucket.example.com/file.pdf?X-Amz-Signature=REDACTED&X-Amz-Date=20260101');
  });

  it('matches whole name segments so ordinary params stay readable', () => {
    for (const name of ['token', 'access_token', 'api_key', 'apikey', 'X-Amz-Signature', 'X-Amz-Credential', 'X-Goog-Signature', 'sig', 'auth', 'session']) {
      expect(redactUrlForDisplay(`https://example.com/a?${name}=v`)).toBe(`https://example.com/a?${name}=REDACTED`);
    }
    for (const name of ['author', 'keyword', 'monkey', 'design', 'signup', 'assign', 'id', 'q']) {
      expect(redactUrlForDisplay(`https://example.com/a?${name}=v`)).toBe(`https://example.com/a?${name}=v`);
    }
  });

  it('matches camelCase and percent-encoded secret names without flagging lookalikes', () => {
    for (const name of ['accessToken', 'clientSecret', '%74oken', 'refreshToken', 'X-Amz-Signature', 'api_key', 'apiKey', 'sessionId']) {
      expect(redactUrlForDisplay(`https://example.com/a?${name}=secret&id=1`)).toBe(`https://example.com/a?${name}=REDACTED&id=1`);
    }
    for (const name of ['author', 'keyword', 'design', 'signup', 'monkey', 'id', 'q', 'tokenizer', 'keyboard']) {
      expect(redactUrlForDisplay(`https://example.com/a?${name}=v`)).toBe(`https://example.com/a?${name}=v`);
    }
  });

  it('drops a fragment that carries a secret and keeps a plain one', () => {
    expect(redactUrlForDisplay('https://example.com/cb#access_token=abc')).toBe('https://example.com/cb');
    expect(redactUrlForDisplay('https://example.com/a#section=intro')).toBe('https://example.com/a#section=intro');
  });

  it('returns a plain URL unchanged', () => {
    expect(redactUrlForDisplay('https://example.com/a/b?page=2#top')).toBe('https://example.com/a/b?page=2#top');
  });

  it('handles unparseable input', () => {
    expect(redactUrlForDisplay('not a url')).toBe('not a url');
    expect(redactUrlForDisplay('example.com/doc?token=secret')).toBe('example.com/doc?token=secret');
    expect(redactUrlForDisplay('alice:secret@example.com/doc')).toBe('example.com/doc');
  });
});

describe('redactUrlsInText', () => {
  it('redacts every URL inside a sentence and leaves the rest alone', () => {
    expect(redactUrlsInText('Could not read https://alice:secret@example.com/doc?token=secret&id=7, try again.'))
      .toBe('Could not read https://example.com/doc?token=REDACTED&id=7, try again.');
  });
});
