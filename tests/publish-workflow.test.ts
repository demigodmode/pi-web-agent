import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'publish.yml');
const workflow = readFileSync(workflowPath, 'utf8');

describe('publish workflow', () => {
  it('uses npm trusted publishing instead of an npm token', () => {
    expect(workflow).toContain('id-token: write');
    expect(workflow).not.toContain('NODE_AUTH_TOKEN');
    expect(workflow).not.toContain('NPM_TOKEN');
  });

  it('does not self-upgrade npm before publishing', () => {
    expect(workflow).not.toContain('npm install -g npm@latest');
    expect(workflow).toContain('npm -v');
    expect(workflow).toContain('node -v');
  });

  it('still publishes the package with public access and provenance enabled', () => {
    expect(workflow).toContain('npm publish --access public --provenance');
  });

  it('creates the GitHub release independently from npm publish', () => {
    expect(workflow).toContain('release:');
    expect(workflow).toContain('needs: release');
    expect(workflow).toContain('gh release view "$GITHUB_REF_NAME" >/dev/null 2>&1 || gh release create "$GITHUB_REF_NAME"');
  });
});
