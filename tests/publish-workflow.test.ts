import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'publish.yml');
const workflow = readFileSync(workflowPath, 'utf8');

describe('publish workflow', () => {
  it('uses npm trusted publishing instead of passing tokens manually', () => {
    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain('registry-url: https://registry.npmjs.org');
    expect(workflow).toContain("token: ''");
    expect(workflow).toContain('npx --yes npm@11.13.0 publish --access public --provenance');
    expect(workflow).not.toContain('NODE_AUTH_TOKEN');
    expect(workflow).not.toContain('NPM_TOKEN');
    expect(workflow).not.toContain('npm config set "//registry.npmjs.org/:_authToken"');
    expect(workflow).not.toContain('ACTIONS_ID_TOKEN_REQUEST_URL');
  });

  it('prints node and npm versions before publishing', () => {
    expect(workflow).toContain('npm -v');
    expect(workflow).toContain('node -v');
  });

  it('still publishes the package with public access and provenance enabled', () => {
    expect(workflow).toContain('npx --yes npm@11.13.0 publish --access public --provenance');
  });

  it('can be rerun manually for a tag after fixing the workflow on main', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('tag:');
    expect(workflow).toContain("TAG_NAME: ${{ github.event_name == 'workflow_dispatch' && inputs.tag || github.ref_name }}");
  });

  it('creates the GitHub release independently from npm publish with scoped release notes', () => {
    expect(workflow).toContain('release:');
    expect(workflow).toContain('needs: release');
    expect(workflow).toContain('node scripts/release-notes.mjs "$TAG_NAME" release-notes.md');
    expect(workflow).toContain('gh release view "$TAG_NAME" >/dev/null 2>&1 || gh release create "$TAG_NAME" --title "$TAG_NAME" --notes-file release-notes.md');
    expect(workflow).not.toContain('--notes-file CHANGELOG.md');
  });
});


describe('requested release tag', () => {
  it('shares the tag and checks out the validated commit in both jobs', () => {
    expect(workflow).toMatch(/env:\n  TAG_NAME:/);
    expect(workflow).toContain('ref: refs/tags/${{ env.TAG_NAME }}');
    expect(workflow).toContain('fetch-depth: 0');
    expect(workflow).toContain('commit: ${{ steps.validate-tag.outputs.commit }}');
    expect(workflow).toContain('ref: ${{ needs.release.outputs.commit }}');
  });

  it('validates the checked-out tag with local Git fixtures', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pi-publish-tag-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const guard = workflow.match(/- name: Tag must be on main[\s\S]*?run: \|\n([\s\S]*?)(?=      -)/)?.[1]
      ?.split('\n').map((line) => line.replace(/^          /, '')).join('\n');
    expect(guard).toBeDefined();
    try {
      git('init', '-b', 'main');
      git('config', 'user.name', 'Test');
      git('config', 'user.email', 'test@example.invalid');
      writeFileSync(path.join(root, 'package.json'), '{"version":"1.0.0"}');
      git('add', 'package.json');
      git('commit', '-m', 'First version');
      git('tag', 'v1.0.0');
      const tagCommit = git('rev-parse', 'HEAD');
      writeFileSync(path.join(root, 'package.json'), '{"version":"1.1.0"}');
      git('commit', '-am', 'Next version');
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      git('checkout', '-b', 'off-main');
      writeFileSync(path.join(root, 'package.json'), '{"version":"2.0.0"}');
      git('commit', '-am', 'Unmerged version');
      git('tag', 'v2.0.0');
      const output = path.join(root, 'output');
      const run = (tag: string) => spawnSync('bash', ['-euo', 'pipefail', '-c', guard!], {
        cwd: root, encoding: 'utf8', env: { ...process.env, TAG_NAME: tag, GITHUB_OUTPUT: output }
      });
      expect(run('v1.0.0').status).not.toBe(0); // dispatch ref differs from requested tag
      git('checkout', '--detach', 'refs/tags/v1.0.0');
      expect(run('v1.0.0').status).toBe(0);
      expect(readFileSync(output, 'utf8')).toContain(`commit=${tagCommit}`);
      expect(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version).toBe('1.0.0');
      for (const tag of ['unknown', 'main', '../main', '-bad']) expect(run(tag).status).not.toBe(0);
      git('checkout', '--detach', 'refs/tags/v2.0.0');
      expect(run('v2.0.0').status).not.toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
