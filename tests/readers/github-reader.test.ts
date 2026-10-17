import { describe, it, expect, vi } from 'vitest';
import { createGithubReader } from '../../src/readers/github-reader.js';

function ok(body: string, contentType = 'text/plain') {
  return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body), headers: new Headers({ 'content-type': contentType }) };
}

describe('createGithubReader', () => {
  it('uses a scrubbed requested URL in successful reader responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok('content'));
    const res = await createGithubReader({ fetchImpl }).read('https://user:secret@github.com/o/r/blob/main/a.ts?access_token=private-secret');
    expect(res.status).toBe('ok');
    expect(res.url).toBe('https://github.com/o/r/blob/main/a.ts');
    expect(JSON.stringify(res)).not.toContain('private-secret');
  });

  it('uses a scrubbed requested URL in error responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404, headers: new Headers(), text: async () => '' });
    const res = await createGithubReader({ fetchImpl }).read('https://user:secret@github.com/o/r/blob/main/a.ts?access_token=private-secret');
    expect(res.url).toBe('https://github.com/o/r/blob/main/a.ts');
    expect(JSON.stringify(res)).not.toContain('private-secret');
  });
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
    const reader = createGithubReader({ fetchImpl, resolveToken: async () => ({ token: 'secret', source: 'env' }) });
    await reader.read('https://github.com/owner/repo/issues/1');
    const headers = (fetchImpl.mock.calls[0][1] as { headers: Record<string, string> }).headers;
    expect(headers.Authorization).toBe('Bearer secret');
  });

  it('caches a resolved credential briefly and shares the lookup across concurrent reads', async () => {
    const resolveToken = vi.fn(async () => ({ token: 'secret', source: 'gh' as const }));
    const fetchImpl = vi.fn().mockResolvedValue(ok('body'));
    const reader = createGithubReader({ fetchImpl, resolveToken });
    await Promise.all([
      reader.read('https://github.com/o/r/blob/main/a.ts'),
      reader.read('https://github.com/o/r/blob/main/b.ts')
    ]);
    await reader.read('https://github.com/o/r/blob/main/c.ts');
    expect(resolveToken).toHaveBeenCalledTimes(1);
    expect((fetchImpl.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer secret' });
  });

  it('does not cache an anonymous token result', async () => {
    const resolveToken = vi.fn()
      .mockResolvedValueOnce({ source: 'none' })
      .mockResolvedValueOnce({ token: 'secret', source: 'gh' });
    const fetchImpl = vi.fn().mockResolvedValue(ok('body'));
    const reader = createGithubReader({ fetchImpl, resolveToken });
    await reader.read('https://github.com/o/r/blob/main/a.ts');
    await reader.read('https://github.com/o/r/blob/main/b.ts');
    expect(resolveToken).toHaveBeenCalledTimes(2);
  });

  it('marks a missing anonymous GitHub resource as not found or inaccessible with login guidance', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404, headers: new Headers(), text: async () => 'Not Found' });
    const reader = createGithubReader({ fetchImpl, resolveToken: async () => ({ source: 'none' }) });
    const res = await reader.read('https://github.com/o/r/blob/main/missing.ts');
    expect(res.error?.failure).toMatchObject({ kind: 'not_found_or_inaccessible', httpStatus: 404 });
    expect(res.error?.message).toMatch(/sign in/i);
  });

  it('does not leak a token-bearing README download URL after a failed download', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok(JSON.stringify({ download_url: 'https://raw.githubusercontent.com/o/r/main/README.md?token=private-secret' }), 'application/json'))
      .mockResolvedValueOnce({ ok: false, status: 503, headers: new Headers(), text: async () => 'nope' });
    const res = await createGithubReader({ fetchImpl, resolveToken: async () => ({ token: 'secret', source: 'env' }) }).read('https://github.com/o/r');
    expect(res.error?.message).not.toContain('private-secret');
    expect(res.error?.message).toContain('https://github.com/o/r');
    expect(res.error?.failure).toMatchObject({ kind: 'transient', httpStatus: 503 });
  });

  it('reads up to three pages of issue comments and labels pull comments as review comments', async () => {
    const next = '<https://api.github.com/repos/o/r/issues/1/comments?page=2&per_page=100>; rel="next"';
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok(JSON.stringify({ title: 'Issue', body: 'body' }), 'application/json'))
      .mockResolvedValueOnce({ ...ok(JSON.stringify([{ body: 'first' }]), 'application/json'), headers: new Headers({ link: next }) })
      .mockResolvedValueOnce(ok(JSON.stringify([{ body: 'second' }]), 'application/json'));
    const res = await createGithubReader({ fetchImpl }).read('https://github.com/o/r/issues/1');
    expect(res.content?.text).toContain('first');
    expect(res.content?.text).toContain('second');
    expect(fetchImpl).toHaveBeenCalledWith('https://api.github.com/repos/o/r/issues/1/comments?page=2&per_page=100', expect.anything());
  });

  it('keeps fetched issue comments when a later page fails', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok(JSON.stringify({ title: 'Issue', body: 'body' }), 'application/json'))
      .mockResolvedValueOnce({ ...ok(JSON.stringify([{ body: 'first' }]), 'application/json'), headers: new Headers({ link: '<https://api.github.com/repos/o/r/issues/1/comments?page=2&per_page=100>; rel="next"' }) })
      .mockResolvedValueOnce({ ok: false, status: 503, headers: new Headers(), text: async () => '' });
    const res = await createGithubReader({ fetchImpl }).read('https://github.com/o/r/issues/1');
    expect(res.status).toBe('ok');
    expect(res.content?.text).toContain('first');
    expect(res.metadata.partialComments).toBe(true);
  });

  it('marks comments partial when a fourth page is available', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok(JSON.stringify({ title: 'Issue', body: 'body' }), 'application/json'))
      .mockResolvedValueOnce({ ...ok(JSON.stringify([{ body: 'one' }]), 'application/json'), headers: new Headers({ link: '<https://api.github.com/repos/o/r/issues/1/comments?page=2>; rel="next"' }) })
      .mockResolvedValueOnce({ ...ok(JSON.stringify([{ body: 'two' }]), 'application/json'), headers: new Headers({ link: '<https://api.github.com/repos/o/r/issues/1/comments?page=3>; rel="next"' }) })
      .mockResolvedValueOnce({ ...ok(JSON.stringify([{ body: 'three' }]), 'application/json'), headers: new Headers({ link: '<https://api.github.com/repos/o/r/issues/1/comments?page=4>; rel="next"' }) });
    const res = await createGithubReader({ fetchImpl }).read('https://github.com/o/r/issues/1');
    expect(res.content?.text).toContain('three');
    expect(res.metadata.partialComments).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('marks comments partial when the reader cap cuts them', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok(JSON.stringify({ title: 'Issue', body: 'body' }), 'application/json'))
      .mockResolvedValueOnce(ok(JSON.stringify([{ body: 'x'.repeat(25_000) }]), 'application/json'));
    const res = await createGithubReader({ fetchImpl }).read('https://github.com/o/r/issues/1');
    expect(res.metadata.truncated).toBe(true);
    expect(res.metadata.partialComments).toBe(true);
  });

  it('marks comments partial when a capped issue body hides all fetched comments', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok(JSON.stringify({ title: 'Issue', body: 'x'.repeat(25_000) }), 'application/json'))
      .mockResolvedValueOnce(ok(JSON.stringify([{ body: 'hidden comment' }]), 'application/json'));
    const res = await createGithubReader({ fetchImpl }).read('https://github.com/o/r/issues/1');
    expect(res.metadata.truncated).toBe(true);
    expect(res.metadata.partialComments).toBe(true);
    expect(res.content?.text).not.toContain('hidden comment');
  });

  it.each([
    [401, new Headers(), 'auth_failed'],
    [403, new Headers(), 'auth_failed'],
    [403, new Headers({ 'x-ratelimit-remaining': '0', 'retry-after': '7' }), 'rate_limited'],
    [429, new Headers({ 'retry-after': '9' }), 'rate_limited']
  ] as const)('classifies GitHub HTTP %s as %s', async (status, headers, kind) => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status, headers, text: async () => '' });
    const res = await createGithubReader({ fetchImpl, resolveToken: async () => ({ token: 'secret', source: 'env' }) }).read('https://github.com/o/r/blob/main/a.ts');
    expect(res.error?.failure).toMatchObject({ kind, httpStatus: status });
    if (kind === 'rate_limited') expect(res.error?.failure?.providerRetryAfterMs).toBe((status === 403 ? 7 : 9) * 1000);
  });

  it('classifies network and timeout errors as transient without exposing their messages', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('request failed https://raw.githubusercontent.com/o/r/a?token=private-secret'));
    const res = await createGithubReader({ fetchImpl }).read('https://github.com/o/r/blob/main/a.ts');
    expect(res.error?.failure?.kind).toBe('transient');
    expect(res.error?.message).not.toContain('private-secret');
  });

  it('classifies a timeout error as transient without exposing its tokenized URL', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('request timed out https://raw.githubusercontent.com/o/r/a?token=private-secret'));
    const res = await createGithubReader({ fetchImpl }).read('https://github.com/o/r/blob/main/a.ts');
    expect(res.error?.failure?.kind).toBe('transient');
    expect(res.error?.message).not.toContain('private-secret');
    expect(res.error?.message).not.toContain('raw.githubusercontent.com');
  });

  it('does not expose secret-bearing non-HTTP reader errors', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('bad JSON https://raw.githubusercontent.com/o/r/a?token=private-secret'));
    const res = await createGithubReader({ fetchImpl }).read('https://github.com/o/r/blob/main/a.ts');
    expect(res.error?.message).not.toContain('private-secret');
    expect(res.error?.message).not.toContain('raw.githubusercontent.com');
  });

  it.each([
    '<http://api.github.com/repos/o/r/issues/1/comments?page=2>; rel="next"',
    '<https://api.github.com/repos/other/r/issues/1/comments?page=2>; rel="next"',
    '<https://api.github.com/repos/o/r/issues/2/comments?page=2>; rel="next"'
  ])('does not follow an invalid comment Link target: %s', async (link) => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok(JSON.stringify({ title: 'Issue', body: 'body' }), 'application/json'))
      .mockResolvedValueOnce({ ...ok(JSON.stringify([{ body: 'first' }]), 'application/json'), headers: new Headers({ link }) });
    const res = await createGithubReader({ fetchImpl }).read('https://github.com/o/r/issues/1');
    expect(res.status).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('marks rejected advertised next links as partial comments', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok(JSON.stringify({ title: 'Issue', body: 'body' }), 'application/json'))
      .mockResolvedValueOnce({ ...ok(JSON.stringify([{ body: 'first' }]), 'application/json'), headers: new Headers({ link: '<https://api.github.com/repos/other/r/issues/1/comments?page=2>; rel="next"' }) });
    const res = await createGithubReader({ fetchImpl }).read('https://github.com/o/r/issues/1');
    expect(res.status).toBe('ok');
    expect(res.metadata.partialComments).toBe(true);
  });

  it('propagates caller cancellation during a later comments page', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok(JSON.stringify({ title: 'Issue', body: 'body' }), 'application/json'))
      .mockResolvedValueOnce({ ...ok(JSON.stringify([{ body: 'first' }]), 'application/json'), headers: new Headers({ link: '<https://api.github.com/repos/o/r/issues/1/comments?page=2>; rel="next"' }) })
      .mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('Operation aborted')), { once: true })));
    const controller = new AbortController();
    const read = createGithubReader({ fetchImpl }).read('https://github.com/o/r/issues/1', controller.signal);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    controller.abort();
    await expect(read).rejects.toMatchObject({ message: 'Operation aborted' });
  });

  it('does not wait for credential lookup after caller cancellation', async () => {
    let resolveCredential!: (value: { source: 'none' }) => void;
    const resolveToken = vi.fn(() => new Promise<{ source: 'none' }>((resolve) => { resolveCredential = resolve; }));
    const controller = new AbortController();
    const read = createGithubReader({ fetchImpl: vi.fn(), resolveToken }).read('https://github.com/o/r/blob/main/a.ts', controller.signal);
    await vi.waitFor(() => expect(resolveToken).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(read).rejects.toMatchObject({ name: 'AbortError' });
    resolveCredential({ source: 'none' });
  });

  it('retains the thread body and marks comments partial when the first comments page fails', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok(JSON.stringify({ title: 'Issue', body: 'body' }), 'application/json'))
      .mockResolvedValueOnce({ ok: false, status: 503, headers: new Headers(), text: async () => '' });
    const res = await createGithubReader({ fetchImpl }).read('https://github.com/o/r/issues/1');
    expect(res.status).toBe('ok');
    expect(res.content?.text).toContain('body');
    expect(res.metadata.partialComments).toBe(true);
  });

  it('retains the thread body when the reader timeout interrupts the first comments page', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok(JSON.stringify({ title: 'Issue', body: 'body' }), 'application/json'))
      .mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_, reject) => {
        if (init.signal?.aborted) reject(new Error('reader timeout'));
        else init.signal?.addEventListener('abort', () => reject(new Error('reader timeout')), { once: true });
      }));
    const res = await createGithubReader({ fetchImpl, timeoutMs: 1 }).read('https://github.com/o/r/issues/1');
    expect(res.status).toBe('ok');
    expect(res.content?.text).toContain('body');
    expect(res.metadata.partialComments).toBe(true);
  });

  it('does not attach authorization to an unapproved README download host', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok(JSON.stringify({ download_url: 'https://outside.example/readme' }), 'application/json'))
      .mockResolvedValueOnce(ok('readme'))
      .mockResolvedValueOnce(ok(JSON.stringify([]), 'application/json'));
    await createGithubReader({ fetchImpl, resolveToken: async () => ({ token: 'secret', source: 'env' }) }).read('https://github.com/o/r');
    expect((fetchImpl.mock.calls[1][1] as { headers: Record<string, string> }).headers.Authorization).toBeUndefined();
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
    await createGithubReader({ fetchImpl: fetchImpl as unknown as typeof fetch }).read('https://github.com/o/r/blob/main/src/x.ts', controller.signal);
    const signal = (fetchImpl.mock.calls[0][1] as RequestInit).signal!;
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });
});
