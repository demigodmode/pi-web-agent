import { readFileSync } from 'node:fs';
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
