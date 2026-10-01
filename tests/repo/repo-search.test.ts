import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const handleCalls = vi.hoisted(() => ({
  closed: 0,
  lengths: [] as number[],
  blockOpen: false,
  openEntered: undefined as (() => void) | undefined,
  releaseOpen: undefined as (() => void) | undefined,
  onRead: undefined as (() => void) | undefined,
  openPaths: [] as string[],
  realpathPaths: [] as string[],
  onRealpath: undefined as (() => void) | undefined,
  reverseReaddir: false
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    readdir: async (...args: Parameters<typeof original.readdir>) => {
      const entries = await original.readdir(...args);
      return handleCalls.reverseReaddir && Array.isArray(entries) ? [...entries].reverse() : entries;
    },
    realpath: async (...args: Parameters<typeof original.realpath>) => {
      const result = await original.realpath(...args);
      handleCalls.realpathPaths.push(String(args[0]));
      handleCalls.onRealpath?.();
      return result;
    },
    open: async (...args: Parameters<typeof original.open>) => {
      handleCalls.openPaths.push(String(args[0]));
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
          handleCalls.onRead?.();
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

import { MAX_SEARCH_FILE_BYTES, buildExcerpts, fitToBudget, scoreFile, searchRepo } from '../../src/repo/repo-search.js';
import { safeSlice } from '../../src/repo/safe-slice.js';
import { queryTerms } from '../../src/repo/repo-terms.js';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  handleCalls.closed = 0;
  handleCalls.lengths.length = 0;
  handleCalls.blockOpen = false;
  handleCalls.openEntered = undefined;
  handleCalls.releaseOpen = undefined;
  handleCalls.onRead = undefined;
  handleCalls.openPaths.length = 0;
  handleCalls.realpathPaths.length = 0;
  handleCalls.onRealpath = undefined;
  handleCalls.reverseReaddir = false;
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
    expect(result.terms).toEqual(['refresh', 'oauth', 'auth', 'tokens']);
    expect(result.files.map((file) => file.path)).toEqual(['src/auth/token-refresh.ts', 'README.md']);
    expect(result.files[0].score).toBeGreaterThan(result.files[1].score);
  });

  it('ranks dense cooccurring terms above the same terms scattered through other files', async () => {
    const spacedTerms = Array.from({ length: 120 }, (_, index) => {
      if (index === 0) return 'refresh';
      if (index === 60) return 'oauth';
      if (index === 119) return 'tokens';
      return `line ${index}`;
    }).join('\n');
    const root = tree({
      'data/records.json': spacedTerms,
      'CHANGELOG': spacedTerms,
      'src/query.graphql': 'query RefreshTokens { refresh oauth tokens }'
    });

    const result = await searchRepo(root, { query: 'refresh oauth tokens' });

    expect(result.files.map((file) => file.path)).toEqual(['src/query.graphql', 'CHANGELOG', 'data/records.json']);
    expect(result.files[0].score).toBeGreaterThan(result.files[1].score);
    expect(result.files[1].score).toBe(result.files[2].score);
  });

  it('scores only the most term-dense content window', () => {
    const spacedTerms = Array.from({ length: 100 }, (_, index) =>
      index === 0 ? 'refresh' : index === 50 ? 'oauth' : index === 99 ? 'tokens' : `line ${index}`
    ).join('\n');
    const terms = queryTerms('refresh oauth tokens');

    expect(scoreFile('src/query.graphql', 'refresh oauth tokens', terms)).toBeGreaterThan(
      scoreFile('src/query.graphql', spacedTerms, terms)
    );
  });

  it('skips vendored folders, lockfiles, generated artifacts, binaries and huge files', async () => {
    const root = tree({
      'src/auth/token-refresh.ts': impl,
      'node_modules/oauth-lib/refresh-token.js': impl,
      'vendor/refresh.go': impl,
      'dist/bundle.js': impl,
      'package-lock.json': '{"refresh":"oauth token"}',
      'source-map.map': 'refresh oauth tokens SECRET-VALUE',
      'render.snap': 'refresh oauth tokens SECRET-VALUE',
      'dependency.lock': 'refresh oauth tokens SECRET-VALUE',
      'logo.svg': 'refresh oauth tokens SECRET-VALUE',
      'assets/refresh-token.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x72, 0x65]),
      'data/blob.dat': Buffer.concat([Buffer.from('refresh oauth token'), Buffer.from([0]), Buffer.from('x')]),
      'big/refresh-token.ts': `// refresh oauth token\n${'x'.repeat(MAX_SEARCH_FILE_BYTES)}`
    });
    const result = await searchRepo(root, { query: 'refresh OAuth tokens' });
    expect(result.files.map((file) => file.path)).toEqual(['src/auth/token-refresh.ts']);
  });

  it('skips build output only at the clone root and the scoped root', async () => {
    const root = tree({
      'dist/root.ts': impl,
      'build/root.ts': impl,
      'target/root.ts': impl,
      'out/root.ts': impl,
      'src/dist/oauth.ts': impl,
      'src/build/oauth.ts': impl,
      'src/target/oauth.ts': impl,
      'src/out/oauth.ts': impl,
      'src/node_modules/oauth.ts': impl,
      'scope/dist/root.ts': impl,
      'scope/build/root.ts': impl,
      'scope/target/root.ts': impl,
      'scope/out/root.ts': impl,
      'scope/lib/dist/oauth.ts': impl,
      'scope/lib/build/oauth.ts': impl,
      'scope/lib/target/oauth.ts': impl,
      'scope/lib/out/oauth.ts': impl
    });

    const cloneResult = await searchRepo(root, { query: 'refresh OAuth tokens', maxFiles: 20 });
    expect(cloneResult.files.map((file) => file.path)).toEqual([
      'scope/lib/build/oauth.ts',
      'scope/lib/dist/oauth.ts',
      'scope/lib/out/oauth.ts',
      'scope/lib/target/oauth.ts',
      'src/build/oauth.ts',
      'src/dist/oauth.ts',
      'src/out/oauth.ts',
      'src/target/oauth.ts',
      'scope/build/root.ts',
      'scope/dist/root.ts',
      'scope/out/root.ts',
      'scope/target/root.ts'
    ]);

    const scopedResult = await searchRepo(root, { query: 'refresh OAuth tokens', pathScope: 'scope', maxFiles: 20 });
    expect(scopedResult.files.map((file) => file.path)).toEqual([
      'scope/lib/build/oauth.ts',
      'scope/lib/dist/oauth.ts',
      'scope/lib/out/oauth.ts',
      'scope/lib/target/oauth.ts'
    ]);
  });

  it('penalizes structured data and all-caps extensionless project documents like docs', () => {
    const terms = queryTerms('refresh oauth tokens');
    const content = 'refresh oauth tokens';

    expect(scoreFile('data/records.json', content, terms)).toBe(25);
    expect(scoreFile('metrics.csv', content, terms)).toBe(25);
    expect(scoreFile('events.tsv', content, terms)).toBe(25);
    expect(scoreFile('CHANGELOG', content, terms)).toBe(25);
    expect(scoreFile('LICENSE', content, terms)).toBe(25);
    expect(scoreFile('NOTICE', content, terms)).toBe(25);
    expect(scoreFile('AUTHORS', content, terms)).toBe(25);
    expect(scoreFile('COPYING', content, terms)).toBe(25);
    expect(scoreFile('CONTRIBUTING', content, terms)).toBe(25);
  });

  it('keeps build and dependency config text above ordinary text while retaining independent documentation penalties', async () => {
    const terms = queryTerms('refresh oauth tokens');
    const content = 'refresh oauth tokens';
    const root = tree({
      'CMakeLists.txt': content,
      'requirements.txt': content,
      'requirements-dev.txt': content,
      'notes.txt': content,
      'docs/CMakeLists.txt': content,
      'tests/requirements.txt': content,
      'src/requirements.test.txt': content
    });

    expect(scoreFile('CMakeLists.txt', content, terms)).toBe(30);
    expect(scoreFile('requirements.txt', content, terms)).toBe(30);
    expect(scoreFile('requirements-dev.txt', content, terms)).toBe(30);
    expect(scoreFile('notes.txt', content, terms)).toBe(25);
    expect(scoreFile('docs/CMakeLists.txt', content, terms)).toBe(25);
    expect(scoreFile('tests/requirements.txt', content, terms)).toBe(25);
    expect(scoreFile('src/requirements.test.txt', content, terms)).toBe(25);

    const result = await searchRepo(root, { query: 'refresh oauth tokens', maxFiles: 10 });
    expect(result.files.map((file) => file.path)).toEqual([
      'CMakeLists.txt',
      'requirements-dev.txt',
      'requirements.txt',
      'docs/CMakeLists.txt',
      'notes.txt',
      'src/requirements.test.txt',
      'tests/requirements.txt'
    ]);
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

  it('skips a root .git file without opening its gitdir contents', async () => {
    const root = tree({
      'src/auth/token-refresh.ts': impl,
      '.git': 'gitdir: ../outside\nrefresh oauth token SECRET-VALUE'
    });

    const result = await searchRepo(root, { query: 'refresh OAuth tokens' });

    expect(result.files.map((file) => file.path)).toEqual(['src/auth/token-refresh.ts']);
    expect(handleCalls.openPaths).not.toContain(join(root, '.git'));
    expect(JSON.stringify(result)).not.toContain('SECRET-VALUE');
  });

  it.each(['.GIT', '.GIT.'])('rejects a normalized %s search scope without exposing its contents', async (gitDirectory) => {
    const root = tree({
      [`src/${gitDirectory}/secret.ts`]: 'refresh oauth token SECRET-VALUE',
      'src/auth/token-refresh.ts': impl
    });

    const result = await searchRepo(root, { query: 'refresh OAuth tokens', pathScope: `src/${gitDirectory}` });

    expect(result).toMatchObject({ scopeFound: false, files: [] });
    expect(handleCalls.openPaths).not.toContain(join(root, 'src', gitDirectory, 'secret.ts'));
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
    expect(handleCalls.lengths).toEqual([Buffer.byteLength(impl) + 1]);
    expect(handleCalls.closed).toBe(1);
  });

  it('stops before opening files beyond the scanned-file budget', async () => {
    const root = tree({ 'a.ts': impl, 'b.ts': impl });
    const result = await searchRepo(root, { query: 'refresh OAuth tokens', maxScannedFiles: 1 });
    expect(handleCalls.lengths).toHaveLength(1);
    expect(handleCalls.closed).toBe(1);
    expect(result).toMatchObject({ partial: true, budget: 'files', scannedFiles: 1 });
  });

  it('bounds a read by the remaining byte budget and skips its incomplete candidate', async () => {
    const root = tree({ 'a.ts': impl });
    const result = await searchRepo(root, { query: 'refresh OAuth tokens', maxScannedBytes: 12 });
    expect(handleCalls.lengths).toEqual([12]);
    expect(handleCalls.closed).toBe(1);
    expect(result.files).toEqual([]);
    expect(result).toMatchObject({ partial: true, budget: 'bytes', scannedFiles: 1 });
  });

  it('stops before opening files after the search time budget expires', async () => {
    const root = tree({ 'a.ts': impl });
    let calls = 0;
    const result = await searchRepo(root, {
      query: 'refresh OAuth tokens',
      maxSearchMs: 10,
      now: () => calls++ === 0 ? 0 : 10
    });
    expect(handleCalls.lengths).toEqual([]);
    expect(result).toMatchObject({ partial: true, budget: 'time', scannedFiles: 0 });
  });

  it('stops after scope resolution reaches the deadline', async () => {
    const root = tree({ 'src/a.ts': impl });
    let elapsed = 0;
    handleCalls.onRealpath = () => {
      elapsed = 10;
    };
    const result = await searchRepo(root, {
      query: 'refresh OAuth tokens',
      pathScope: 'src',
      maxSearchMs: 10,
      now: () => elapsed
    });
    expect(result).toEqual({ scopeFound: true, terms: ['refresh', 'oauth', 'auth', 'tokens'], files: [], partial: true, budget: 'time', scannedFiles: 0 });
    expect(handleCalls.realpathPaths).toEqual([root]);
    expect(handleCalls.lengths).toEqual([]);
  });

  it('drops a candidate when the deadline expires during its read', async () => {
    const root = tree({ 'a.ts': impl });
    let elapsed = 0;
    handleCalls.onRead = () => {
      elapsed = 10;
    };
    const result = await searchRepo(root, {
      query: 'refresh OAuth tokens',
      maxSearchMs: 10,
      now: () => elapsed
    });
    expect(result.files).toEqual([]);
    expect(handleCalls.closed).toBe(1);
    expect(result).toMatchObject({ partial: true, budget: 'time', scannedFiles: 1 });
  });

  it('still throws when cancellation arrives during a deadline-expiring read', async () => {
    const root = tree({ 'a.ts': impl });
    const controller = new AbortController();
    let elapsed = 0;
    handleCalls.onRead = () => {
      elapsed = 10;
      controller.abort();
    };
    await expect(searchRepo(root, {
      query: 'refresh OAuth tokens',
      signal: controller.signal,
      maxSearchMs: 10,
      now: () => elapsed
    })).rejects.toThrow('Operation aborted');
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

  it('uses code-unit ordering for traversal and equal-score paths despite creation and filesystem entry order', async () => {
    const root = tree({ 'a.ts': 'refresh oauth token', 'Z.ts': 'refresh oauth token', 'm.ts': 'refresh oauth token' });
    const normal = await searchRepo(root, { query: 'refresh oauth token', maxScannedFiles: 2 });
    const reorderedRoot = tree({ 'm.ts': 'refresh oauth token', 'Z.ts': 'refresh oauth token', 'a.ts': 'refresh oauth token' });
    handleCalls.reverseReaddir = true;
    const reversed = await searchRepo(reorderedRoot, { query: 'refresh oauth token', maxScannedFiles: 2 });
    expect(reversed.files.map((file) => file.path)).toEqual(normal.files.map((file) => file.path));
    expect(normal.files.map((file) => file.path)).toEqual(['Z.ts', 'a.ts']);
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

  it('normalizes CRLF search excerpts while keeping terminal and blank lines in their ranges', async () => {
    const result = await searchRepo(tree({
      'src/crlf.ts': 'before\r\nneedle\r\n\r\nafter\r\n'
    }), { query: 'needle', contextLines: 10 });

    expect(result.files[0].excerpts).toEqual([
      { startLine: 1, endLine: 4, text: 'before\nneedle\n\nafter' }
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

  it('backs a bounded search excerpt away from an emoji boundary', async () => {
    const result = await searchRepo(tree({ 'a.ts': `needle${'x'.repeat(2)}😀tail` }), {
      query: 'needle',
      charBudget: 9
    });
    expect(result.files[0].excerpts).toEqual([{ startLine: 1, endLine: 1, text: 'needlexx' }]);
  });

  it('does not return an unpaired high surrogate from a shared slice', () => {
    expect(safeSlice('a😀', 2)).toBe('a');
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
