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

  it('warns for fallback values that do not match the selected provider', () => {
    expect(
      validateBackendConfig({
        search: { provider: 'duckduckgo', fallback: 'duckduckgo' },
        fetch: { provider: 'http', fallback: 'http' },
        headless: { provider: 'local-browser' }
      })
    ).toEqual([
      'search fallback duckduckgo is only supported when search provider is searxng, brave, or youcom',
      'fetch fallback http is only supported when fetch provider is firecrawl'
    ]);
  });

  it('warns for malformed supported options', () => {
    expect(
      validateBackendConfig({
        search: {
          provider: 'searxng',
          baseUrl: 'http://localhost:8080',
          options: { categories: [], language: '', safesearch: 9 as 0 }
        },
        fetch: {
          provider: 'firecrawl',
          baseUrl: 'http://localhost:3002',
          options: { formats: [], onlyMainContent: true }
        },
        headless: { provider: 'local-browser' }
      })
    ).toEqual([
      'search options.categories must contain at least one category when provided',
      'search options.language must not be empty when provided',
      'search options.safesearch must be 0, 1, or 2 when provided',
      'fetch options.formats must contain at least one format when provided'
    ]);
  });
});
