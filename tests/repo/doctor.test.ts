import { describe, expect, it } from 'vitest';
import { repoResearchDoctorLine } from '../../src/repo/doctor.js';

const git = (stdout: string) => async () => ({ ok: true as const, stdout });

describe('repo research doctor line', () => {
  it.each([
    ['env', 'repo research: git 2.55.0, GitHub token from GITHUB_TOKEN'],
    ['gh', 'repo research: git 2.55.0, GitHub token from gh'],
    ['none', 'repo research: git 2.55.0, no GitHub login (public repos only)']
  ] as const)('reports the %s token source', async (source, line) => {
    await expect(
      repoResearchDoctorLine({ checkGit: git('git version 2.55.0\n'), resolveToken: async () => ({ source, token: source === 'none' ? undefined : 'sekret' }) })
    ).resolves.toBe(line);
  });

  it('never prints the token', async () => {
    const line = await repoResearchDoctorLine({ checkGit: git('git version 2.55.0'), resolveToken: async () => ({ source: 'env', token: 'sekret' }) });
    expect(line).not.toContain('sekret');
  });

  it('reports a missing git', async () => {
    await expect(
      repoResearchDoctorLine({
        checkGit: async () => ({ ok: false, failure: { code: 'GIT_MISSING', message: 'x', failure: { kind: 'not_configured' } } }),
        resolveToken: async () => ({ source: 'none' })
      })
    ).resolves.toBe('repo research: git not found (repo questions will say git is missing)');
  });

  it('reports an old git', async () => {
    await expect(
      repoResearchDoctorLine({
        checkGit: async () => ({ ok: false, failure: { code: 'GIT_TOO_OLD', message: 'git 2.32 or newer is needed to search repo code.', failure: { kind: 'not_configured' } } }),
        resolveToken: async () => ({ source: 'none' })
      })
    ).resolves.toBe('repo research: warning (git 2.32 or newer is needed to search repo code.)');
  });
});
