import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BACKEND_CONFIG,
  extractBackendConfigOverride,
  extractProxyConfig,
  mergeBackendConfigLayers,
  validateBackendConfig,
  usableSearchProviders
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
    })).toContain('search fallback duckduckgo is only supported when search provider is searxng, brave, youcom, exa, or tavily');
  });

  it('accepts youcom search provider with duckduckgo fallback', () => {
    const override = extractBackendConfigOverride({
      backends: {
        search: { provider: 'youcom', fallback: 'duckduckgo', baseUrl: 'https://ignored.example' }
      }
    });

    expect(override.search).toEqual({ provider: 'youcom', fallback: 'duckduckgo' });
  });

  it('allows duckduckgo fallback for youcom', () => {
    expect(validateBackendConfig({
      ...DEFAULT_BACKEND_CONFIG,
      search: { provider: 'youcom', fallback: 'duckduckgo' }
    })).toEqual([]);
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

  it('accepts exa search provider with duckduckgo fallback', () => {
    const override = extractBackendConfigOverride({
      backends: {
        search: { provider: 'exa', fallback: 'duckduckgo', baseUrl: 'https://ignored.example' }
      }
    });

    expect(override.search).toEqual({ provider: 'exa', fallback: 'duckduckgo' });
  });

  it('allows duckduckgo fallback for exa', () => {
    expect(validateBackendConfig({
      ...DEFAULT_BACKEND_CONFIG,
      search: { provider: 'exa', fallback: 'duckduckgo' }
    })).toEqual([]);
  });

  it('accepts tavily search provider with duckduckgo fallback', () => {
    const override = extractBackendConfigOverride({
      backends: {
        search: { provider: 'tavily', fallback: 'duckduckgo', baseUrl: 'https://ignored.example' }
      }
    });

    expect(override.search).toEqual({ provider: 'tavily', fallback: 'duckduckgo' });
  });

  it('allows duckduckgo fallback for tavily', () => {
    expect(validateBackendConfig({
      ...DEFAULT_BACKEND_CONFIG,
      search: { provider: 'tavily', fallback: 'duckduckgo' }
    })).toEqual([]);
  });
});

describe('fanout config', () => {
  it('parses a valid fanout block', () => {
    const override = extractBackendConfigOverride({
      backends: { search: { provider: 'brave', fanout: { mode: 'auto', providers: ['duckduckgo', 'brave', 'exa'] } } }
    });
    expect(override.search?.fanout).toEqual({ mode: 'auto', providers: ['duckduckgo', 'brave', 'exa'] });
  });

  it('drops the fanout block on unknown provider names or invalid mode', () => {
    const badMode = extractBackendConfigOverride({
      backends: { search: { provider: 'brave', fanout: { mode: 'sideways', providers: ['brave'] } } }
    });
    expect(badMode.search?.fanout).toBeUndefined();

    const badProvider = extractBackendConfigOverride({
      backends: { search: { provider: 'brave', fanout: { mode: 'on', providers: ['brave', 'bogus'] } } }
    });
    expect(badProvider.search?.fanout).toBeUndefined();
  });

  it('flags searxng in the fanout set without a base url', () => {
    const issues = validateBackendConfig({
      ...DEFAULT_BACKEND_CONFIG,
      search: { provider: 'duckduckgo', fanout: { mode: 'on', providers: ['duckduckgo', 'searxng'] } }
    });
    expect(issues.some((i) => i.includes('searxng'))).toBe(true);
  });

  it('parses fanout even when no provider is set (provider inherited)', () => {
    const override = extractBackendConfigOverride({
      backends: { search: { fanout: { mode: 'auto', providers: ['duckduckgo', 'brave'] } } }
    });
    expect(override.search?.provider).toBeUndefined();
    expect(override.search?.fanout).toEqual({ mode: 'auto', providers: ['duckduckgo', 'brave'] });
  });

  it('project fanout off overrides an inherited global fanout on after reload', () => {
    const globalOverride = extractBackendConfigOverride({ backends: { search: { provider: 'brave', fanout: { mode: 'on' } } } });
    const projectOverride = extractBackendConfigOverride({ backends: { search: { fanout: { mode: 'off' } } } });
    const effective = mergeBackendConfigLayers(DEFAULT_BACKEND_CONFIG, globalOverride, projectOverride);
    expect(effective.search.fanout?.mode).toBe('off');
  });
});

describe('usableSearchProviders', () => {
  it('returns only duckduckgo when no baseUrl and no env keys', () => {
    const providers = usableSearchProviders(
      { provider: 'duckduckgo' },
      {} // empty env
    );
    expect(providers).toEqual(['duckduckgo']);
  });

  it('includes searxng when baseUrl is set', () => {
    const providers = usableSearchProviders(
      { provider: 'duckduckgo', baseUrl: 'http://localhost:8080' },
      {} // empty env
    );
    expect(providers).toEqual(['duckduckgo', 'searxng']);
  });

  it('includes brave when PI_WEB_AGENT_BRAVE_API_KEY is set', () => {
    const providers = usableSearchProviders(
      { provider: 'duckduckgo' },
      { PI_WEB_AGENT_BRAVE_API_KEY: 'test-key' }
    );
    expect(providers).toEqual(['duckduckgo', 'brave']);
  });

  it('includes youcom when YDC_API_KEY is set', () => {
    const providers = usableSearchProviders(
      { provider: 'duckduckgo' },
      { YDC_API_KEY: 'test-key' }
    );
    expect(providers).toEqual(['duckduckgo', 'youcom']);
  });

  it('includes exa when EXA_API_KEY is set', () => {
    const providers = usableSearchProviders(
      { provider: 'duckduckgo' },
      { EXA_API_KEY: 'test-key' }
    );
    expect(providers).toEqual(['duckduckgo', 'exa']);
  });

  it('includes tavily when TAVILY_API_KEY is set', () => {
    const providers = usableSearchProviders(
      { provider: 'duckduckgo' },
      { TAVILY_API_KEY: 'test-key' }
    );
    expect(providers).toEqual(['duckduckgo', 'tavily']);
  });

  it('treats a whitespace-only key as not usable', () => {
    const providers = usableSearchProviders(
      { provider: 'duckduckgo' },
      { EXA_API_KEY: '   ' } as NodeJS.ProcessEnv
    );
    expect(providers).not.toContain('exa');
    expect(providers).toEqual(['duckduckgo']);
  });

  it('returns all usable providers when all are configured', () => {
    const providers = usableSearchProviders(
      { provider: 'duckduckgo', baseUrl: 'http://localhost:8080' },
      {
        PI_WEB_AGENT_BRAVE_API_KEY: 'brave-key',
        YDC_API_KEY: 'ydc-key',
        EXA_API_KEY: 'exa-key',
        TAVILY_API_KEY: 'tavily-key'
      }
    );
    expect(providers).toEqual(['duckduckgo', 'searxng', 'brave', 'youcom', 'exa', 'tavily']);
  });
});

describe('proxy config', () => {
  it('extracts proxy config from the config file', () => {
    const override = extractBackendConfigOverride({
      backends: {
        proxy: { url: 'http://127.0.0.1:7890', username: 'user', password: 'secret' }
      }
    });

    expect(override.proxy).toEqual({ url: 'http://127.0.0.1:7890', username: 'user', password: 'secret' });
  });

  it('drops proxy entries with missing or non-http(s) urls', () => {
    expect(extractBackendConfigOverride({ backends: { proxy: {} } }).proxy).toBeUndefined();
    expect(extractBackendConfigOverride({ backends: { proxy: { url: 'not a url' } } }).proxy).toBeUndefined();
    expect(extractBackendConfigOverride({ backends: { proxy: { url: 'ftp://nope.example' } } }).proxy).toBeUndefined();
    expect(extractBackendConfigOverride({ backends: { proxy: { url: 42 } } }).proxy).toBeUndefined();
  });

  it('ignores empty usernames but keeps passwords', () => {
    const override = extractBackendConfigOverride({
      backends: { proxy: { url: 'http://127.0.0.1:7890', username: '   ', password: '' } }
    });

    expect(override.proxy).toEqual({ url: 'http://127.0.0.1:7890', password: '' });
  });

  it('merges proxy fields across config layers', () => {
    expect(
      mergeBackendConfigLayers(
        DEFAULT_BACKEND_CONFIG,
        { proxy: { url: 'http://127.0.0.1:7890', username: 'user' } },
        { proxy: { url: 'http://127.0.0.1:7891', password: 'secret' } }
      ).proxy
    ).toEqual({ url: 'http://127.0.0.1:7891', username: 'user', password: 'secret' });
  });

  it('reads an explicit blank url as a disable-proxy marker', () => {
    expect(extractBackendConfigOverride({ backends: { proxy: { url: '' } } }).proxy).toEqual({ url: '' });
    expect(extractProxyConfig({ url: '' })).toEqual({ url: '' });
  });

  it('lets an explicit disable in a higher layer clear a lower-layer proxy', () => {
    expect(
      mergeBackendConfigLayers(
        DEFAULT_BACKEND_CONFIG,
        { proxy: { url: 'http://127.0.0.1:7890', username: 'user' } },
        { proxy: { url: '' } }
      ).proxy
    ).toBeUndefined();
  });

  it('lets a later real proxy re-enable after an explicit disable', () => {
    expect(
      mergeBackendConfigLayers(
        DEFAULT_BACKEND_CONFIG,
        { proxy: { url: '' } },
        { proxy: { url: 'http://127.0.0.1:7891' } }
      ).proxy
    ).toEqual({ url: 'http://127.0.0.1:7891' });
  });

  it('flags a malformed proxy url in a hand-built config', () => {
    expect(
      validateBackendConfig({
        search: { provider: 'duckduckgo' },
        fetch: { provider: 'http' },
        headless: { provider: 'local-browser' },
        proxy: { url: 'not a url' }
      })
    ).toContain('backends.proxy.url must be an http or https URL');
  });
});
