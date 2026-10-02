import { describe, it, expect, vi } from 'vitest';
import { createGithubReader } from '../../src/readers/github-reader.js';

function ok(body: string, contentType = 'text/plain') {
  return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body), headers: new Headers({ 'content-type': contentType }) };
}

describe('createGithubReader', () => {
  it('claims only the supported github.com shapes', () => {
    const reader = createGithubReader({ fetchImpl: vi.fn() });
    // supported
    expect(reader.canHandle('https://github.com/o/r/blob/main/src/x.ts')).toBe(true);
    expect(reader.canHandle('https://github.com/o/r/blob/feature/foo/src/x.ts')).toBe(true); // slash branch
    expect(reader.canHandle('https://github.com/o/r/issues/12')).toBe(true);
    expect(reader.canHandle('https://github.com/o/r/pull/12')).toBe(true);
    expect(reader.canHandle('https://github.com/o/r')).toBe(true);
    // NOT claimed -> fall through to normal fetch
    expect(reader.canHandle('https://github.com/o/r/discussions/5')).toBe(false);
    expect(reader.canHandle('https://gist.github.com/user/abc')).toBe(false);
    expect(reader.canHandle('https://github.com/o/r/tree/main/src')).toBe(false);
    expect(reader.canHandle('https://github.com/o/r/commits/main')).toBe(false);
    expect(reader.canHandle('https://github.com/o')).toBe(false);
    expect(reader.canHandle('https://github.com/o/r/blob/main')).toBe(false); // no path
    expect(reader.canHandle('https://example.com/github.com/a')).toBe(false);
  });

  it('reads a blob url from raw.githubusercontent.com', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok('export const x = 1;\n'));
    const reader = createGithubReader({ fetchImpl });
    const res = await reader.read('https://github.com/owner/repo/blob/main/src/x.ts');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/owner/repo/main/src/x.ts',
      expect.anything()
    );
    expect(res.status).toBe('ok');
    expect(res.metadata.method).toBe('github');
    expect(res.content?.text).toContain('export const x = 1;');
    expect(res.content?.title).toBe('owner/repo/src/x.ts');
  });

  it('encodes path segments with percent-encoded characters in blob urls', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok('file content'));
    const reader = createGithubReader({ fetchImpl });
    const res = await reader.read('https://github.com/owner/repo/blob/main/my%20file.ts');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/owner/repo/main/my%20file.ts',
      expect.anything()
    );
    expect(res.status).toBe('ok');
  });

  it('builds the correct raw url for a slash-containing branch', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'x', json: async () => ({}), headers: new Headers() });
    const reader = createGithubReader({ fetchImpl });
    await reader.read('https://github.com/o/r/blob/feature/foo/src/x.ts');
    expect(fetchImpl).toHaveBeenCalledWith('https://raw.githubusercontent.com/o/r/feature/foo/src/x.ts', expect.anything());
  });

  it('single-encodes a percent-encoded (slash) ref instead of double-encoding', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'x', json: async () => ({}), headers: new Headers() });
    const reader = createGithubReader({ fetchImpl });
    await reader.read('https://github.com/o/r/blob/feature%2Fone/src/x.ts');
    expect(fetchImpl).toHaveBeenCalledWith('https://raw.githubusercontent.com/o/r/feature%2Fone/src/x.ts', expect.anything());
  });

  it('reads an issue body plus comments from the api', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok(JSON.stringify({ title: 'Bug', body: 'It breaks' }), 'application/json'))
      .mockResolvedValueOnce(ok(JSON.stringify([{ body: 'me too' }]), 'application/json'));
    const reader = createGithubReader({ fetchImpl });
    const res = await reader.read('https://github.com/owner/repo/issues/12');
    expect(res.status).toBe('ok');
    expect(res.content?.title).toBe('Bug');
    expect(res.content?.text).toContain('It breaks');
    expect(res.content?.text).toContain('me too');
  });

  it('adds an authorization header when GITHUB_TOKEN is set', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(JSON.stringify({ title: 't', body: 'b' }), 'application/json'));
    const reader = createGithubReader({ fetchImpl, token: 'secret' });
    await reader.read('https://github.com/owner/repo/issues/1');
    const headers = (fetchImpl.mock.calls[0][1] as { headers: Record<string, string> }).headers;
    expect(headers.Authorization).toBe('Bearer secret');
  });

  it('returns a caveated error response on 404 instead of throwing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'Not Found', json: async () => ({}), headers: new Headers() });
    const reader = createGithubReader({ fetchImpl });
    const res = await reader.read('https://github.com/owner/repo/blob/main/missing.ts');
    expect(res.status).toBe('error');
    expect(res.metadata.method).toBe('github');
    expect(res.error?.code).toBe('GITHUB_FETCH_FAILED');
  });
});

describe('github reader cancellation', () => {
  it('gives every request a signal tied to the caller', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('file body'));
    const controller = new AbortController();
    await createGithubReader({ fetchImpl: fetchImpl as unknown as typeof fetch, token: undefined }).read('https://github.com/o/r/blob/main/src/x.ts', controller.signal);
    const signal = (fetchImpl.mock.calls[0][1] as RequestInit).signal!;
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });
});
