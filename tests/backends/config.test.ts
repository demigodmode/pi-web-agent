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
        { search: { provider: 'searxng', baseUrl: 'http://global-searxng' }, fetch: { provider: 'http' } },
        { search: { provider: 'duckduckgo' }, fetch: { provider: 'firecrawl', baseUrl: 'http://firecrawl' } }
      )
    ).toEqual({
      search: { provider: 'duckduckgo', baseUrl: 'http://global-searxng' },
      fetch: { provider: 'firecrawl', baseUrl: 'http://firecrawl' },
      headless: { provider: 'local-browser' }
    });
  });

  it('extracts self-hosted backend config', () => {
    expect(
      mergeBackendConfigLayers(DEFAULT_BACKEND_CONFIG, {
        search: { provider: 'searxng', baseUrl: 'http://localhost:8080' },
        fetch: { provider: 'firecrawl', baseUrl: 'http://localhost:3002', apiKey: 'test-key' }
      })
    ).toEqual({
      search: { provider: 'searxng', baseUrl: 'http://localhost:8080' },
      fetch: { provider: 'firecrawl', baseUrl: 'http://localhost:3002', apiKey: 'test-key' },
      headless: { provider: 'local-browser' }
    });
  });
});
