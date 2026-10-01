import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const handleCalls = vi.hoisted(() => ({
  closed: 0,
  lengths: [] as number[],
  blockOpen: false,
  openEntered: undefined as (() => void) | undefined,
  releaseOpen: undefined as (() => void) | undefined
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    open: async (...args: Parameters<typeof original.open>) => {
      const handle = await original.open(...args);
      if (handleCalls.blockOpen) {
        handleCalls.openEntered?.();
        await new Promise<void>((resolve) => {
          handleCalls.releaseOpen = resolve;
        });
      }
      return {
        read: async (buffer: Buffer, offset: number, length: number, position: number) => {
          handleCalls.lengths.push(length);
          return handle.read(buffer, offset, length, position);
        },
        close: async () => {
          handleCalls.closed++;
          return handle.close();
        }
      };
    }
  };
});

import { MAX_SEARCH_FILE_BYTES, buildExcerpts, fitToBudget, searchRepo } from '../../src/repo/repo-search.js';
import { queryTerms } from '../../src/repo/repo-terms.js';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  handleCalls.closed = 0;
  handleCalls.lengths.length = 0;
  handleCalls.blockOpen = false;
  handleCalls.openEntered = undefined;
  handleCalls.releaseOpen = undefined;
});

function tree(files: Record<string, string | Buffer | { symlink: string }>): string {
  const root = mkdtempSync(join(tmpdir(), 'pwa-search-'));
  temps.push(root);
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    if (typeof content === 'object' && !Buffer.isBuffer(content)) symlinkSync(content.symlink, target);
    else writeFileSync(target, content);
  }
  return root;
}

const impl = `import { oauthClient } from './client';

export async function refreshToken(session) {
  // Swap the refresh token for a new OAuth access token before it expires.
  const response = await oauthClient.post('/token', { grant_type: 'refresh_token', refresh_token: session.refreshToken });
  session.accessToken = response.access_token;
  return session;
}
`;

describe('searchRepo walk and scoring', () => {
  it('ranks the nested implementation above a README that mentions the terms', async () => {
    const root = tree({
      'README.md': '# Widget\nWe refresh OAuth tokens for you.',
      'src/auth/token-refresh.ts': impl,
      'src/ui/button.ts': 'export const Button = 1;'
    });
    const result = await searchRepo(root, { query: 'where does this project refresh OAuth tokens?' });
    expect(result.scopeFound).toBe(true);
    expect(result.terms).toEqual(['refresh', 'oauth', 'tokens']);
    expect(result.files.map((file) => file.path)).toEqual(['src/auth/token-refresh.ts', 'README.md']);
    expect(result.files[0].score).toBeGreaterThan(result.files[1].score);
  });

  it('skips vendored folders, lockfiles, binaries and huge files', async () => {
    const root = tree({
      'src/auth/token-refresh.ts': impl,
      'node_modules/oauth-lib/refresh-token.js': impl,
      'vendor/refresh.go': impl,
      'dist/bundle.js': impl,
      'package-lock.json': '{"refresh":"oauth token"}',
      'assets/refresh-token.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x72, 0x65]),
      'data/blob.dat': Buffer.concat([Buffer.from('refresh oauth token'), Buffer.from([0]), Buffer.from('x')]),
      'big/refresh-token.ts': `// refresh oauth token\n${'x'.repeat(MAX_SEARCH_FILE_BYTES)}`
    });
    const result = await searchRepo(root, { query: 'refresh OAuth tokens' });
    expect(result.files.map((file) => file.path)).toEqual(['src/auth/token-refresh.ts']);
  });

  it('never reads through symlinks', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'pwa-outside-'));
    temps.push(outside);
    writeFileSync(join(outside, 'secret.ts'), 'refresh oauth token SECRET-VALUE');
    const root = tree({
      'src/auth/token-refresh.ts': impl,
      'src/link.ts': { symlink: join(outside, 'secret.ts') },
      'src/linkdir': { symlink: outside }
    });
    const result = await searchRepo(root, { query: 'refresh OAuth tokens' });
    expect(result.files.map((file) => file.path)).toEqual(['src/auth/token-refresh.ts']);
    expect(JSON.stringify(result)).not.toContain('SECRET-VALUE');
  });

  it('skips .git aliases while walking', async () => {
    const root = tree({
      'src/auth/token-refresh.ts': impl,
      '.GiT./secret.ts': 'refresh oauth token SECRET-VALUE',
      'nested/.git /secret.ts': 'refresh oauth token SECRET-VALUE'
    });
    const result = await searchRepo(root, { query: 'refresh OAuth tokens' });
    expect(result.files.map((file) => file.path)).toEqual(['src/auth/token-refresh.ts']);
    expect(JSON.stringify(result)).not.toContain('SECRET-VALUE');
  });

  it('limits the search to the folder scope and keeps paths relative to the repo root', async () => {
    const root = tree({ 'src/auth/token-refresh.ts': impl, 'lib/refresh.ts': impl });
    const result = await searchRepo(root, { query: 'refresh OAuth tokens', pathScope: 'src/auth' });
    expect(result.files.map((file) => file.path)).toEqual(['src/auth/token-refresh.ts']);
  });

  it('rejects direct and intermediate symlinks in a search scope', async () => {
    const root = tree({
      'src/auth/token-refresh.ts': impl,
      'src/auth/secret.ts': 'refresh oauth token SECRET-VALUE'
    });
    symlinkSync(join(root, 'src/auth'), join(root, 'direct'));
    symlinkSync(join(root, 'src'), join(root, 'alias'));

    for (const pathScope of ['direct', 'alias/auth']) {
      const result = await searchRepo(root, { query: 'refresh OAuth tokens', pathScope });
      expect(result).toMatchObject({ scopeFound: false, files: [] });
      expect(JSON.stringify(result)).not.toContain('SECRET-VALUE');
    }
  });

  it('reports a missing or escaping scope', async () => {
    const root = tree({ 'src/a.ts': impl });
    await expect(searchRepo(root, { query: 'refresh', pathScope: 'nope' })).resolves.toMatchObject({ scopeFound: false, files: [] });
    await expect(searchRepo(root, { query: 'refresh', pathScope: '../..' })).resolves.toMatchObject({ scopeFound: false, files: [] });
  });

  it('returns no files when the question has no terms', async () => {
    const root = tree({ 'src/a.ts': impl });
    await expect(searchRepo(root, { query: 'what is this?' })).resolves.toEqual({ scopeFound: true, terms: [], files: [] });
  });

  it('keeps only the best few files', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 10; i++) files[`src/f${i}.ts`] = `refresh ${i % 2 ? 'oauth' : ''} token`;
    const result = await searchRepo(tree(files), { query: 'refresh oauth tokens', maxFiles: 4 });
    expect(result.files).toHaveLength(4);
    for (const file of result.files) expect(Number(file.path.match(/f(\d)/)![1]) % 2).toBe(1);
  });

  it('reads at most the configured cap and closes each handle', async () => {
    const root = tree({ 'src/auth/token-refresh.ts': impl });
    await searchRepo(root, { query: 'refresh OAuth tokens' });
    expect(handleCalls.lengths).toEqual([MAX_SEARCH_FILE_BYTES + 1]);
    expect(handleCalls.closed).toBe(1);
  });

  it('closes a handle when cancellation arrives while it is opening', async () => {
    const root = tree({ 'src/auth/token-refresh.ts': impl });
    const controller = new AbortController();
    const opened = new Promise<void>((resolve) => {
      handleCalls.openEntered = resolve;
    });
    handleCalls.blockOpen = true;
    const search = searchRepo(root, { query: 'refresh OAuth tokens', signal: controller.signal });
    await opened;
    controller.abort();
    handleCalls.releaseOpen!();
    await expect(search).rejects.toThrow('Operation aborted');
    expect(handleCalls.closed).toBe(1);
  });

  it('stops when the signal fires', async () => {
    const root = tree({ 'src/a.ts': impl });
    const controller = new AbortController();
    controller.abort();
    await expect(searchRepo(root, { query: 'refresh', signal: controller.signal })).rejects.toThrow('Operation aborted');
  });
});

describe('excerpts', () => {
  const numbered = (count: number, hits: Record<number, string>) =>
    Array.from({ length: count }, (_, i) => hits[i + 1] ?? `line ${i + 1}`).join('\n');

  it('merges nearby matches into one excerpt with 1-based line numbers', () => {
    const text = numbered(100, { 10: 'refresh here', 25: 'oauth there' });
    const excerpts = buildExcerpts(text, queryTerms('refresh oauth'), 20);
    expect(excerpts).toHaveLength(1);
    expect(excerpts[0]).toMatchObject({ startLine: 1, endLine: 45 });
    expect(excerpts[0].text.split('\n')[9]).toBe('refresh here');
  });

  it('keeps far-apart matches as separate excerpts', () => {
    const text = numbered(200, { 10: 'refresh', 150: 'oauth' });
    const excerpts = buildExcerpts(text, queryTerms('refresh oauth'), 5);
    expect(excerpts.map((e) => [e.startLine, e.endLine])).toEqual([
      [5, 15],
      [145, 155]
    ]);
  });

  it('shows the top of the file when only the path matched', () => {
    const excerpts = buildExcerpts(numbered(100, {}), queryTerms('refresh'), 10);
    expect(excerpts).toEqual([{ startLine: 1, endLine: 20, text: numbered(20, {}) }]);
  });

  it('does not count a terminal newline as an extra matching line', () => {
    expect(buildExcerpts('refresh\n', queryTerms('refresh'))).toEqual([
      { startLine: 1, endLine: 1, text: 'refresh' }
    ]);
  });

  it('keeps a real trailing blank line', () => {
    expect(buildExcerpts('refresh\n\n', queryTerms('refresh'))).toEqual([
      { startLine: 1, endLine: 2, text: 'refresh\n' }
    ]);
  });

  it('does not count a terminal newline as an extra path-only line', () => {
    expect(buildExcerpts('plain\n', queryTerms('refresh'))).toEqual([
      { startLine: 1, endLine: 1, text: 'plain' }
    ]);
  });

  it('returns no excerpt for an empty path-only file', () => {
    expect(buildExcerpts('', queryTerms('refresh'))).toEqual([]);
  });

  it('fits all files into the budget, sharing it fairly and cutting on line breaks', () => {
    const big = { startLine: 1, endLine: 400, text: Array.from({ length: 400 }, (_, i) => `line ${i + 1} ${'x'.repeat(20)}`).join('\n') };
    const files = [
      { path: 'a.ts', score: 30, excerpts: [big] },
      { path: 'b.ts', score: 20, excerpts: [big] },
      { path: 'c.ts', score: 10, excerpts: [{ startLine: 3, endLine: 4, text: 'short\ntext' }] }
    ];
    const fitted = fitToBudget(files, 2_000);
    const total = fitted.flatMap((f) => f.excerpts).reduce((sum, e) => sum + e.text.length, 0);
    expect(total).toBeLessThanOrEqual(2_000);
    expect(fitted.map((f) => f.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
    const cut = fitted[0].excerpts[0];
    expect(cut.text.endsWith('\n')).toBe(false);
    expect(cut.endLine).toBe(cut.startLine + cut.text.split('\n').length - 1);
  });

  it('keeps line ranges aligned when a budget cut ends on a newline', () => {
    const fitted = fitToBudget([
      { path: 'a.ts', score: 1, excerpts: [{ startLine: 3, endLine: 5, text: 'one\ntwo\nthree' }] }
    ], 4);
    expect(fitted[0].excerpts).toEqual([{ startLine: 3, endLine: 3, text: 'one' }]);
  });

  it('respects the char budget inside searchRepo', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 4; i++) files[`src/f${i}.ts`] = Array.from({ length: 300 }, (_, n) => `refresh oauth token ${i}-${n}`).join('\n');
    const result = await searchRepo(tree(files), { query: 'refresh oauth tokens', charBudget: 3_000 });
    const total = result.files.flatMap((f) => f.excerpts).reduce((sum, e) => sum + e.text.length, 0);
    expect(total).toBeLessThanOrEqual(3_000);
    expect(result.files.length).toBe(4);
  });
});
