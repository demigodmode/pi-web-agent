import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const packageJson = JSON.parse(
  readFileSync(path.join(root, 'package.json'), 'utf8')
) as Record<string, any>;

describe('release foundation', () => {
  it('has a changelog file checked into the repo', () => {
    expect(existsSync(path.join(root, 'CHANGELOG.md'))).toBe(true);
  });

  it('has a license file checked into the repo', () => {
    expect(existsSync(path.join(root, 'LICENSE'))).toBe(true);
  });

  it('keeps package metadata compatible with open source publishing', () => {
    expect(packageJson.license).toBe('AGPL-3.0-only');
  });
});
