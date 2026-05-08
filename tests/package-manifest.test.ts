import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const packageJsonPath = path.join(process.cwd(), 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, any>;

describe('package manifest', () => {
  it('is configured for publishing as a public pi package', () => {
    expect(packageJson.private).not.toBe(true);
    expect(packageJson.name).toBe('@demigodmode/pi-web-agent');
    expect(packageJson.keywords).toContain('pi-package');
    expect(packageJson.publishConfig).toEqual({ access: 'public' });
  });

  it('points pi to the packaged runtime entrypoint', () => {
    expect(packageJson.pi).toEqual({
      extensions: ['./dist/extension.js']
    });
  });

  it('keeps runtime imports in dependencies', () => {
    expect(packageJson.dependencies).toHaveProperty('typebox');
    expect(packageJson.dependencies?.['@sinclair/typebox']).toBeUndefined();
    expect(packageJson.peerDependencies?.['@sinclair/typebox']).toBeUndefined();
  });

  it('declares the migrated pi package scope only', () => {
    expect(packageJson.peerDependencies).toMatchObject({
      '@earendil-works/pi-coding-agent': '*',
      '@earendil-works/pi-tui': '*'
    });
    expect(packageJson.peerDependencies?.['@mariozechner/pi-coding-agent']).toBeUndefined();
    expect(packageJson.peerDependencies?.['@mariozechner/pi-tui']).toBeUndefined();
    expect(packageJson.peerDependenciesMeta).toBeUndefined();
  });

  it('declares a clean package surface', () => {
    expect(packageJson.main).toBe('./dist/extension.js');
    expect(packageJson.types).toBe('./dist/extension.d.ts');
    expect(packageJson.exports).toEqual({
      '.': {
        types: './dist/extension.d.ts',
        import: './dist/extension.js'
      }
    });
    expect(packageJson.files).toEqual(['dist', 'README.md', 'CHANGELOG.md']);
  });
});
