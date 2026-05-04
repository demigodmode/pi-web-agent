import { describe, expect, it } from 'vitest';
import { DEFAULT_BACKEND_CONFIG, mergeBackendConfigLayers } from '../../src/backends/config.js';

describe('backend config', () => {
  it('defaults to existing providers', () => {
    expect(DEFAULT_BACKEND_CONFIG).toEqual({
      search: { provider: 'duckduckgo' },
      fetch: { provider: 'http' },
      headless: { provider: 'local-browser' }
    });
  });

  it('merges project overrides over global overrides', () => {
    expect(
      mergeBackendConfigLayers(
        DEFAULT_BACKEND_CONFIG,
        { search: { provider: 'duckduckgo' }, fetch: { provider: 'http' } },
        { headless: { provider: 'local-browser' } }
      )
    ).toEqual(DEFAULT_BACKEND_CONFIG);
  });
});
