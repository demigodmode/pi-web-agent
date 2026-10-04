import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, it } from 'vitest';

it('installs the fixed brace-expansion in the coding-agent minimatch chain', () => {
  const agentRequire = createRequire(path.join(process.cwd(), 'node_modules/@earendil-works/pi-coding-agent/package.json'));
  const minimatchRequire = createRequire(agentRequire.resolve('minimatch'));
  const entry = minimatchRequire.resolve('brace-expansion');
  const metadata = JSON.parse(readFileSync(path.resolve(path.dirname(entry), '../../package.json'), 'utf8'));
  const [major, minor, patch] = metadata.version.split('.').map(Number);
  expect(major).toBe(5);
  expect(minor > 0 || patch >= 12).toBe(true);
});
