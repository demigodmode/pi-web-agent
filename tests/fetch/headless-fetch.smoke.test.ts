import { describe, expect, it } from 'vitest';
import { resolveBrowserExecutable } from '../../src/fetch/browser-resolution.js';
import { headlessFetch } from '../../src/fetch/headless-fetch.js';

const runSmoke = process.env.PI_HEADLESS_SMOKE === '1';

describe.skipIf(!runSmoke)('headless fetch smoke', () => {
  it('launches a local browser when one is available', async () => {
    const resolved = await resolveBrowserExecutable({});
    expect(resolved.ok).toBe(true);

    if (!resolved.ok) return;

    const result = await headlessFetch('https://example.com', {
      configuredPath: resolved.executablePath
    });

    expect(['ok', 'blocked']).toContain(result.status);
    expect(result.metadata.method).toBe('headless');
  }, 30000);
});
