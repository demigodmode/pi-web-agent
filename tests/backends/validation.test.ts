import { describe, expect, it } from 'vitest';
import { validateBackendConfig } from '../../src/backends/config.js';

describe('backend config validation', () => {
  it('accepts default backend config', () => {
    expect(
      validateBackendConfig({
        search: { provider: 'duckduckgo' },
        fetch: { provider: 'http' },
        headless: { provider: 'local-browser' }
      })
    ).toEqual([]);
  });

  it('requires baseUrl for self-hosted providers', () => {
    expect(
      validateBackendConfig({
        search: { provider: 'searxng' },
        fetch: { provider: 'firecrawl' },
        headless: { provider: 'local-browser' }
      })
    ).toEqual([
      'search provider searxng requires backends.search.baseUrl',
      'fetch provider firecrawl requires backends.fetch.baseUrl'
    ]);
  });
});
