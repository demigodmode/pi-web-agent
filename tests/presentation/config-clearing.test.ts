import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BackendConfig, DEFAULT_BACKEND_CONFIG, extractBackendConfigOverride, mergeBackendConfigLayers,
  resolveSearchBaseUrl, usableSearchProviders
} from '../../src/backends/config.js';
import { createBackendSet } from '../../src/backends/factory.js';
import {
  applySettingsValue, collapseBackendConfigToOverride, createSettingsDraftState,
  registerWebAgentConfigCommands, getInheritedBackendsForScope
} from '../../src/commands/web-agent-config.js';
import {
  loadPresentationConfigLayers, resetPresentationConfigScope, saveBackendConfigScope
} from '../../src/presentation/config-store.js';

async function searchRequests(config: BackendConfig): Promise<string[]> {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return new Response(JSON.stringify({ results: [], organic: [] }), { headers: { 'content-type': 'application/json' } });
  }));
  vi.stubEnv('PI_WEB_AGENT_GOOGLE_SERP_API_KEY', 'fixture-key');
  const backends = createBackendSet(config);
  try {
    await backends.search({ query: 'endpoint fixture' });
    return urls;
  } finally {
    await backends.close();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
}

describe('persisted backend layers', () => {
  let root: string;
  let options: { homeDir: string; projectDir: string };
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'pi-backend-clearing-'));
    options = { homeDir: path.join(root, 'home'), projectDir: path.join(root, 'project') };
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it.each(['duckduckgo', 'brave', 'youcom', 'exa', 'tavily'] as const)(
    'keeps the legacy SearXNG endpoint with %s selected', async (provider) => {
      await saveBackendConfigScope(options, 'global', {
        search: { provider, baseUrl: 'https://searx.invalid/search', fanout: { mode: 'on', providers: ['duckduckgo', 'searxng'] } }
      });
      const { effectiveBackends } = await loadPresentationConfigLayers(options);
      expect(resolveSearchBaseUrl(effectiveBackends.search, 'searxng')).toBe('https://searx.invalid/search');
      expect(usableSearchProviders(effectiveBackends.search, {})).toContain('searxng');
      expect(resolveSearchBaseUrl(effectiveBackends.search, 'google-serp')).toBeUndefined();
    }
  );

  it('keeps a URL-only project override of the inherited provider', async () => {
    await saveBackendConfigScope(options, 'global', { search: { provider: 'searxng', baseUrl: 'https://old.invalid' } });
    await saveBackendConfigScope(options, 'project', { search: { baseUrl: 'https://new.invalid' } });
    expect((await loadPresentationConfigLayers(options)).effectiveBackends.search.baseUrl).toBe('https://new.invalid');
  });

  for (const provider of ['searxng', 'google-serp'] as const) {
    for (const storage of ['legacy', 'per-provider', 'both'] as const) {
      it(`clears, resaves, restores and resets an inherited ${provider} ${storage} endpoint`, async () => {
        const other = provider === 'searxng' ? 'google-serp' : 'searxng';
        await saveBackendConfigScope(options, 'global', { search: {
          provider,
          ...(storage !== 'per-provider' ? { baseUrl: 'https://old.invalid/search' } : {}),
          baseUrls: { [other]: 'https://other.invalid/search', ...(storage !== 'legacy' ? { [provider]: 'https://slot.invalid/search' } : {}) }
        } });
        const loaded = await loadPresentationConfigLayers(options);
        const inherited = getInheritedBackendsForScope(loaded, 'project');
        const draft = applySettingsValue(createSettingsDraftState(loaded, 'project'), 'backend:search:baseUrl', '');
        await saveBackendConfigScope(options, 'project', collapseBackendConfigToOverride(draft.backends, inherited));
        let reloaded = await loadPresentationConfigLayers(options);
        expect(resolveSearchBaseUrl(reloaded.effectiveBackends.search, provider)).toBeUndefined();
        expect(resolveSearchBaseUrl(reloaded.effectiveBackends.search, other)).toBe('https://other.invalid/search');
        expect(reloaded.project.rawBackends).toHaveProperty('cleared');
        expect(await searchRequests(reloaded.effectiveBackends)).toEqual([]);
        expect(resolveSearchBaseUrl(loaded.effectiveBackends.search, provider)).toBeDefined();

        await saveBackendConfigScope(options, 'project', collapseBackendConfigToOverride(reloaded.effectiveBackends, inherited));
        reloaded = await loadPresentationConfigLayers(options);
        expect(resolveSearchBaseUrl(reloaded.effectiveBackends.search, provider)).toBeUndefined();

        const restored = applySettingsValue(createSettingsDraftState(reloaded, 'project'), 'backend:search:baseUrl', 'https://restored.invalid/search');
        await saveBackendConfigScope(options, 'project', collapseBackendConfigToOverride(restored.backends, inherited));
        const restoredConfig = (await loadPresentationConfigLayers(options)).effectiveBackends;
        expect(resolveSearchBaseUrl(restoredConfig.search, provider)).toBe('https://restored.invalid/search');
        const requests = await searchRequests(restoredConfig);
        expect(requests.length).toBeGreaterThan(0);
        expect(requests.every((url) => url.startsWith('https://restored.invalid/'))).toBe(true);

        await resetPresentationConfigScope(options, 'project');
        expect(resolveSearchBaseUrl((await loadPresentationConfigLayers(options)).effectiveBackends.search, provider)).toBe(resolveSearchBaseUrl(inherited.search, provider));
      });
    }
  }

  it('keeps later global endpoints for other providers after clearing the only endpoint slot', async () => {
    await saveBackendConfigScope(options, 'global', { search: { provider: 'searxng', baseUrls: { searxng: 'https://old.invalid' } } });
    const loaded = await loadPresentationConfigLayers(options);
    const draft = applySettingsValue(createSettingsDraftState(loaded, 'project'), 'backend:search:baseUrl', '');
    await saveBackendConfigScope(options, 'project', collapseBackendConfigToOverride(draft.backends, getInheritedBackendsForScope(loaded, 'project')));
    await saveBackendConfigScope(options, 'global', { search: { provider: 'searxng', baseUrls: { searxng: 'https://old.invalid', 'google-serp': 'https://google.invalid' } } });
    const reloaded = await loadPresentationConfigLayers(options);
    expect(resolveSearchBaseUrl(reloaded.effectiveBackends.search, 'searxng')).toBeUndefined();
    expect(resolveSearchBaseUrl(reloaded.effectiveBackends.search, 'google-serp')).toBe('https://google.invalid');
  });

  it('preserves existing masks during unrelated saves while the global values are absent', async () => {
    await saveBackendConfigScope(options, 'project', { cleared: ['search.keyHeader', 'fetch.options'] });
    const loaded = await loadPresentationConfigLayers(options);
    const draft = applySettingsValue(createSettingsDraftState(loaded, 'project'), 'backend:search:fanout:mode', 'on');
    await saveBackendConfigScope(options, 'project', collapseBackendConfigToOverride(
      draft.backends, getInheritedBackendsForScope(loaded, 'project'), loaded.project.rawBackends
    ));
    await saveBackendConfigScope(options, 'global', { search: { keyHeader: 'Global-Key' }, fetch: { options: { formats: ['markdown'] } } });
    const reloaded = await loadPresentationConfigLayers(options);
    expect(reloaded.project.rawBackends?.cleared).toEqual(['search.keyHeader', 'fetch.options']);
    expect(reloaded.effectiveBackends.search.keyHeader).toBeUndefined();
    expect(reloaded.effectiveBackends.fetch.options).toBeUndefined();
  });

  it.each([['proxy', 'network'], ['network.allowRanges']] as const)(
    'preserves existing compatibility masks %j through the settings command', async (...paths) => {
      const cleared = paths.flat();
      await saveBackendConfigScope(options, 'project', { cleared });
      const loaded = await loadPresentationConfigLayers(options);
      const draft = applySettingsValue(createSettingsDraftState(loaded, 'project'), 'backend:search:fanout:mode', 'on');
      let handler: (args: string, ctx: unknown) => Promise<void> = async () => { throw new Error('command missing'); };
      registerWebAgentConfigCommands({ registerCommand: (_name: string, command: { handler: typeof handler }) => { handler = command.handler; } } as never, {
        load: () => loadPresentationConfigLayers(options),
        saveBackends: (scope, config) => saveBackendConfigScope(options, scope, config)
      });
      const custom = vi.fn().mockResolvedValueOnce('backends').mockResolvedValueOnce({
        action: 'save', scope: 'project', config: draft.config, backends: draft.backends
      });
      await handler('settings', { ui: { custom, notify: vi.fn() } });
      const reloaded = await loadPresentationConfigLayers(options);
      expect(reloaded.project.rawBackends?.cleared).toEqual(cleared);
      await saveBackendConfigScope(options, 'global', {
        proxy: { url: 'https://proxy.invalid' }, network: { allowRanges: ['10.0.0.0/8'], trustProxyDns: true }
      });
      const effective = (await loadPresentationConfigLayers(options)).effectiveBackends;
      if (cleared.includes('proxy')) expect(effective.proxy).toBeUndefined();
      expect(effective.network?.allowRanges).toBeUndefined();
    }
  );

  it('restores optional settings without repeating the inherited providers', async () => {
    await saveBackendConfigScope(options, 'global', {
      search: { provider: 'searxng', baseUrl: 'https://searx.invalid' },
      fetch: { provider: 'firecrawl', baseUrl: 'https://old-crawl.invalid' }
    });
    const loaded = await loadPresentationConfigLayers(options);
    const inherited = getInheritedBackendsForScope(loaded, 'project');
    const desired = {
      ...inherited,
      search: { ...inherited.search, fallback: 'duckduckgo' as const, options: { language: 'en' } },
      fetch: { ...inherited.fetch, baseUrl: 'https://new-crawl.invalid', fallback: 'http' as const, options: { formats: ['markdown'] } }
    };
    await saveBackendConfigScope(options, 'project', collapseBackendConfigToOverride(desired, inherited));
    const reloaded = await loadPresentationConfigLayers(options);
    expect(reloaded.effectiveBackends.search).toEqual(desired.search);
    expect(reloaded.effectiveBackends.fetch).toEqual(desired.fetch);
  });

  it('clears inherited fallback, headers and options without mutating the global layer', async () => {
    await saveBackendConfigScope(options, 'global', {
      search: { provider: 'searxng', baseUrl: 'https://searx.invalid', fallback: 'duckduckgo', keyHeader: 'Custom-Key', options: { language: 'en' } },
      fetch: { provider: 'firecrawl', baseUrl: 'https://crawl.invalid', fallback: 'http', options: { formats: ['markdown'] } }
    });
    const loaded = await loadPresentationConfigLayers(options);
    const inherited = getInheritedBackendsForScope(loaded, 'project');
    const draft = { ...inherited, search: { provider: 'searxng' as const }, fetch: { provider: 'firecrawl' as const } };
    await saveBackendConfigScope(options, 'project', collapseBackendConfigToOverride(draft, inherited));
    const reloaded = await loadPresentationConfigLayers(options);
    expect(reloaded.effectiveBackends.search).toEqual(draft.search);
    expect(reloaded.effectiveBackends.fetch).toEqual(draft.fetch);
    expect(inherited.search.options).toEqual({ language: 'en' });
    expect(reloaded.global.rawBackends?.fetch?.baseUrl).toBe('https://crawl.invalid');
  });
});

it('applies valid clear markers before explicit values and rejects required or prototype paths', () => {
  const base = mergeBackendConfigLayers(DEFAULT_BACKEND_CONFIG, {
    search: { baseUrl: 'https://old.invalid', keyHeader: 'Old-Key' },
    proxy: { url: 'https://proxy.invalid', username: 'name', password: 'secret' },
    network: { allowRanges: ['10.0.0.0/8'], trustProxyDns: true }
  });
  const override = extractBackendConfigOverride({ backends: {
    cleared: ['search.baseUrl', 'search.keyHeader', 'proxy.username', 'proxy.password', 'network.allowRanges', 'network.trustProxyDns', 'search.provider', '__proto__.polluted'],
    search: { keyHeader: 'New-Key' }
  } });
  const merged = mergeBackendConfigLayers(base, override);
  expect(merged.search).toEqual({ provider: 'duckduckgo', keyHeader: 'New-Key' });
  expect(merged.proxy).toEqual({ url: 'https://proxy.invalid' });
  expect(merged.network).toEqual({});
  expect(base.proxy?.password).toBe('secret');
  expect(merged).not.toHaveProperty('cleared');
  expect(mergeBackendConfigLayers(base, {}).search.baseUrl).toBe('https://old.invalid');
  expect(mergeBackendConfigLayers(base, override, { search: { baseUrl: 'https://higher.invalid' } }).search.baseUrl).toBe('https://higher.invalid');
  expect({}).not.toHaveProperty('polluted');
});
