import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BACKEND_CONFIG,
  extractBackendConfigOverride,
  mergeBackendConfigLayers,
  validateBackendConfig
} from '../../src/backends/config.js';

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
      search: { provider: 'duckduckgo' },
      fetch: { provider: 'firecrawl', baseUrl: 'http://firecrawl' },
      headless: { provider: 'local-browser' }
    });
  });

  it('drops provider-specific fields when a higher-precedence layer changes provider', () => {
    expect(
      mergeBackendConfigLayers(
        DEFAULT_BACKEND_CONFIG,
        {
          search: { provider: 'searxng', baseUrl: 'http://global-searxng' },
          fetch: { provider: 'firecrawl', baseUrl: 'http://global-firecrawl', apiKey: 'global-key' }
        },
        {
          search: { provider: 'duckduckgo' },
          fetch: { provider: 'http' }
        }
      )
    ).toEqual({
      search: { provider: 'duckduckgo' },
      fetch: { provider: 'http' },
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

  it('extracts fallback and supported backend options', () => {
    expect(
      mergeBackendConfigLayers(DEFAULT_BACKEND_CONFIG, {
        search: {
          provider: 'searxng',
          baseUrl: 'http://localhost:8080',
          fallback: 'duckduckgo',
          options: { categories: ['general', 'it'], language: 'en', safesearch: 1 }
        },
        fetch: {
          provider: 'firecrawl',
          baseUrl: 'http://localhost:3002',
          fallback: 'http',
          options: { formats: ['markdown'], onlyMainContent: true }
        }
      })
    ).toEqual({
      search: {
        provider: 'searxng',
        baseUrl: 'http://localhost:8080',
        fallback: 'duckduckgo',
        options: { categories: ['general', 'it'], language: 'en', safesearch: 1 }
      },
      fetch: {
        provider: 'firecrawl',
        baseUrl: 'http://localhost:3002',
        fallback: 'http',
        options: { formats: ['markdown'], onlyMainContent: true }
      },
      headless: { provider: 'local-browser' }
    });
  });

  it('accepts brave search provider with duckduckgo fallback', () => {
    const override = extractBackendConfigOverride({
      backends: {
        search: { provider: 'brave', fallback: 'duckduckgo', baseUrl: 'https://ignored.example' }
      }
    });

    expect(override.search).toEqual({ provider: 'brave', fallback: 'duckduckgo' });
  });

  it('allows duckduckgo fallback for brave but not duckduckgo itself', () => {
    expect(validateBackendConfig({
      ...DEFAULT_BACKEND_CONFIG,
      search: { provider: 'brave', fallback: 'duckduckgo' }
    })).toEqual([]);

    expect(validateBackendConfig({
      ...DEFAULT_BACKEND_CONFIG,
      search: { provider: 'duckduckgo', fallback: 'duckduckgo' }
    })).toContain('search fallback duckduckgo is only supported when search provider is searxng or brave');
  });

  it('drops provider-specific fallback and options when provider changes', () => {
    expect(
      mergeBackendConfigLayers(
        DEFAULT_BACKEND_CONFIG,
        {
          search: {
            provider: 'searxng',
            baseUrl: 'http://localhost:8080',
            fallback: 'duckduckgo',
            options: { categories: ['it'] }
          },
          fetch: {
            provider: 'firecrawl',
            baseUrl: 'http://localhost:3002',
            fallback: 'http',
            options: { formats: ['markdown'] }
          }
        },
        { search: { provider: 'duckduckgo' }, fetch: { provider: 'http' } }
      )
    ).toEqual({
      search: { provider: 'duckduckgo' },
      fetch: { provider: 'http' },
      headless: { provider: 'local-browser' }
    });
  });
});
