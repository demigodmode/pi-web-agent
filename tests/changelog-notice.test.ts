import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getLatestChangelogEntry,
  getUpdateChangelogNotice,
  markChangelogSeen,
  parseChangelogEntries
} from '../src/changelog-notice.js';

const temps: string[] = [];

async function makeTemp(prefix: string) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  temps.push(root);
  return root;
}

async function makePackage(version = '1.0.0', changelog = `# Changelog\n\n## [1.0.0] - 2026-05-08\n### Breaking\n- This release requires Pi 0.74+.\n\n## [0.6.0] - 2026-05-04\n### Fixed\n- Old fix.\n`) {
  const root = await makeTemp('pi-web-agent-changelog-');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: '@demigodmode/pi-web-agent', version }), 'utf8');
  await writeFile(path.join(root, 'CHANGELOG.md'), changelog, 'utf8');
  return root;
}

describe('changelog notice', () => {
  afterEach(async () => {
    await Promise.all(temps.splice(0).map(root => rm(root, { recursive: true, force: true })));
  });

  it('parses version sections from changelog text', () => {
    const entries = parseChangelogEntries(`# Changelog\n\n## Unreleased\n\n### Changed\n- Draft.\n\n## [1.0.0] - 2026-05-08\n### Breaking\n- Requires Pi 0.74+.\n\n## [0.6.0] - 2026-05-04\n### Fixed\n- Prior fix.\n`);

    expect(entries).toEqual([
      { version: '1.0.0', content: '## [1.0.0] - 2026-05-08\n### Breaking\n- Requires Pi 0.74+.' },
      { version: '0.6.0', content: '## [0.6.0] - 2026-05-04\n### Fixed\n- Prior fix.' }
    ]);
  });

  it('suppresses startup notice on first run and records the current version', async () => {
    const packageRoot = await makePackage('1.0.0');
    const statePath = path.join(await makeTemp('pi-web-agent-state-'), 'state.json');

    await expect(getUpdateChangelogNotice({ packageRoot, statePath })).resolves.toBeUndefined();
    await expect(readFile(statePath, 'utf8')).resolves.toContain('"lastChangelogVersion": "1.0.0"');
  });

  it('shows newer changelog entries once after update', async () => {
    const packageRoot = await makePackage('1.0.0');
    const statePath = path.join(await makeTemp('pi-web-agent-state-'), 'state.json');
    await writeFile(statePath, JSON.stringify({ lastChangelogVersion: '0.6.0' }), 'utf8');

    const notice = await getUpdateChangelogNotice({ packageRoot, statePath });

    expect(notice).toContain('## [1.0.0] - 2026-05-08');
    expect(notice).toContain('This release requires Pi 0.74+.');
    expect(await getUpdateChangelogNotice({ packageRoot, statePath })).toBeUndefined();
  });

  it('returns latest changelog entry for manual display without changing state', async () => {
    const packageRoot = await makePackage('1.0.0');

    await expect(getLatestChangelogEntry({ packageRoot })).resolves.toContain('## [1.0.0] - 2026-05-08');
  });

  it('fails closed when package files are missing or malformed', async () => {
    const packageRoot = await makeTemp('pi-web-agent-broken-');
    const statePath = path.join(packageRoot, 'state.json');

    await expect(getUpdateChangelogNotice({ packageRoot, statePath })).resolves.toBeUndefined();
    await expect(getLatestChangelogEntry({ packageRoot })).resolves.toBeUndefined();
    await expect(markChangelogSeen({ statePath, version: '1.0.0' })).resolves.toBeUndefined();
  });
});
