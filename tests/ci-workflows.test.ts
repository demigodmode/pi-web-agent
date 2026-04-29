import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function workflow(name: string) {
  return readFileSync(path.join(process.cwd(), '.github', 'workflows', name), 'utf8');
}

describe('CI workflows', () => {
  it('builds from npm ci without patch-installing Rollup optional packages', () => {
    for (const name of ['ci.yml', 'docs.yml', 'publish.yml']) {
      const text = workflow(name);
      expect(text).toContain('npm ci');
      expect(text).not.toContain('npm install --no-save @rollup/rollup-linux-x64-gnu');
    }
  });
});
