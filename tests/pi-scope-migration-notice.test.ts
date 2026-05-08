import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function readProjectFile(file: string) {
  return readFileSync(path.join(root, file), 'utf8');
}

describe('pi scope migration notice', () => {
  it('documents the Pi 0.74+ requirement in the README install section', () => {
    const readme = readProjectFile('README.md');

    expect(readme).toContain('requires Pi 0.74+');
    expect(readme).toContain('Update Pi before updating this package');
  });

  it('records the breaking scope migration in the changelog', () => {
    const changelog = readProjectFile('CHANGELOG.md');

    expect(changelog).toContain('Migrated Pi package imports to `@earendil-works/*`');
    expect(changelog).toContain('This release requires Pi 0.74+');
  });
});
