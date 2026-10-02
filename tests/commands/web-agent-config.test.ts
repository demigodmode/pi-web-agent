import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  applySettingsValue,
  buildBackendSettingsItems,
  collapseBackendConfigToOverride,
  collapsePresentationConfigToOverride,
  createBackendUrlEditor,
  createSettingsDraftState,
  handleSettingsShortcut,
  registerWebAgentConfigCommands,
  validateAllowRanges,
  validateBackendUrl
} from '../../src/commands/web-agent-config.js';
import { DEFAULT_PRESENTATION_CONFIG, mergePresentationConfigLayers } from '../../src/presentation/config.js';
import { DEFAULT_BACKEND_CONFIG, extractBackendConfigOverride, mergeBackendConfigLayers } from '../../src/backends/config.js';
import { createBackendSet } from '../../src/backends/factory.js';
import { createNetworkGuard } from '../../src/fetch/network-guard.js';
import type { BrowserResolutionResult } from '../../src/fetch/browser-resolution.js';

beforeEach(() => {
  vi.stubEnv('PI_WEB_AGENT_BRAVE_API_KEY', '');
  vi.stubEnv('YDC_API_KEY', '');
  vi.stubEnv('EXA_API_KEY', '');
  vi.stubEnv('TAVILY_API_KEY', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('web-agent config draft helpers', () => {
  it('switches to the selected scope draft instead of keeping the old scope values', () => {
    const loaded = {
      global: {
        path: '/global/config.json',
        exists: true,
        rawConfig: {
          defaultMode: 'preview' as const,
          tools: { web_explore: { mode: 'verbose' as const } }
        }
      },
      project: {
        path: '/project/config.json',
        exists: true,
        rawConfig: {
          tools: { web_explore: { mode: 'compact' as const } }
        }
      },
      effectiveConfig: mergePresentationConfigLayers(
        DEFAULT_PRESENTATION_CONFIG,
        {
          defaultMode: 'preview',
          tools: { web_explore: { mode: 'verbose' } }
        },
        {
          tools: { web_explore: { mode: 'compact' } }
        }
      ),
      effectiveBackends: {
        search: { provider: 'duckduckgo' as const },
        fetch: { provider: 'http' as const },
        headless: { provider: 'local-browser' as const }
      }
    };

    const initialState = createSettingsDraftState(loaded, 'project');
    const switchedState = applySettingsValue(initialState, 'scope', 'global');

    expect(initialState.scope).toBe('project');
    expect(initialState.config).toEqual({
      defaultMode: 'preview',
      tools: { web_explore: { mode: 'compact' } }
    });
    expect(switchedState.scope).toBe('global');
    expect(switchedState.config).toEqual({
      defaultMode: 'preview',
      tools: { web_explore: { mode: 'verbose' } }
    });
  });

  it('collapses inherited values instead of materializing them into the saved override', () => {
    expect(
      collapsePresentationConfigToOverride(
        {
          defaultMode: 'preview',
          tools: { web_explore: { mode: 'verbose' } }
        },
        {
          defaultMode: 'preview',
          tools: {}
        }
      )
    ).toEqual({
      tools: { web_explore: { mode: 'verbose' } }
    });
  });

  it('switches backend settings with the selected scope draft', () => {
    const loaded = {
      global: {
        path: '/global/config.json',
        exists: true,
        rawConfig: { tools: {} },
        rawBackends: {
          search: { provider: 'searxng' as const, baseUrl: 'http://global-searxng', fallback: 'duckduckgo' as const },
          fetch: { provider: 'http' as const }
        }
      },
      project: {
        path: '/project/config.json',
        exists: true,
        rawConfig: { tools: {} },
        rawBackends: {
          fetch: { provider: 'firecrawl' as const, baseUrl: 'http://project-firecrawl', fallback: 'http' as const }
        }
      },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: {
        search: { provider: 'searxng' as const, baseUrl: 'http://global-searxng', fallback: 'duckduckgo' as const },
        fetch: { provider: 'firecrawl' as const, baseUrl: 'http://project-firecrawl', fallback: 'http' as const },
        headless: { provider: 'local-browser' as const }
      }
    };

    const initial = createSettingsDraftState(loaded, 'project');
    expect(initial.backends.fetch.provider).toBe('firecrawl');

    const switched = applySettingsValue(initial, 'scope', 'global');
    expect(switched.backends.fetch.provider).toBe('http');
  });

  it('collapses backend values inherited from the parent scope', () => {
    expect(
      collapseBackendConfigToOverride(
        {
          search: { provider: 'searxng', baseUrl: 'http://localhost:8080', fallback: 'duckduckgo' },
          fetch: { provider: 'http' },
          headless: { provider: 'local-browser' }
        },
        {
          search: { provider: 'searxng', baseUrl: 'http://localhost:8080', fallback: 'duckduckgo' },
          fetch: { provider: 'http' },
          headless: { provider: 'local-browser' }
        }
      )
    ).toEqual({});
  });

  it('carries a hand-written baseUrls entry through a collapse instead of dropping it', () => {
    // A layer can add a per-provider endpoint (baseUrls) the parent does not have. The collapse
    // used to omit baseUrls, so saving anything from /web-agent settings dropped the endpoint
    // and fanout discarded the provider without saying anything.
    expect(
      collapseBackendConfigToOverride(
        {
          search: {
            provider: 'google-serp',
            baseUrl: 'https://google.example/search',
            baseUrls: { searxng: 'http://localhost:8080' }
          },
          fetch: { provider: 'http' },
          headless: { provider: 'local-browser' }
        },
        {
          search: { provider: 'google-serp', baseUrl: 'https://google.example/search' },
          fetch: { provider: 'http' },
          headless: { provider: 'local-browser' }
        }
      )
    ).toEqual({ search: { baseUrls: { searxng: 'http://localhost:8080' } } });
  });

  it('omits baseUrls when it matches the parent scope', () => {
    expect(
      collapseBackendConfigToOverride(
        {
          search: {
            provider: 'google-serp',
            baseUrl: 'https://google.example/search',
            baseUrls: { searxng: 'http://localhost:8080' }
          },
          fetch: { provider: 'http' },
          headless: { provider: 'local-browser' }
        },
        {
          search: {
            provider: 'google-serp',
            baseUrl: 'https://google.example/search',
            baseUrls: { searxng: 'http://localhost:8080' }
          },
          fetch: { provider: 'http' },
          headless: { provider: 'local-browser' }
        }
      )
    ).toEqual({});
  });

  it('records an explicit proxy disable when clearing a proxy inherited from the parent scope', () => {
    expect(
      collapseBackendConfigToOverride(
        {
          search: { provider: 'duckduckgo' },
          fetch: { provider: 'http' },
          headless: { provider: 'local-browser' }
        },
        {
          search: { provider: 'duckduckgo' },
          fetch: { provider: 'http' },
          headless: { provider: 'local-browser' },
          proxy: { url: 'http://127.0.0.1:7890' }
        }
      )
    ).toEqual({ proxy: { url: '' } });
  });

  it('writes a proxy override when the scope sets a proxy that differs from the parent', () => {
    expect(
      collapseBackendConfigToOverride(
        {
          search: { provider: 'duckduckgo' },
          fetch: { provider: 'http' },
          headless: { provider: 'local-browser' },
          proxy: { url: 'http://127.0.0.1:7891' }
        },
        {
          search: { provider: 'duckduckgo' },
          fetch: { provider: 'http' },
          headless: { provider: 'local-browser' },
          proxy: { url: 'http://127.0.0.1:7890' }
        }
      )
    ).toEqual({ proxy: { url: 'http://127.0.0.1:7891' } });
  });

  it('applies backend provider, fallback, and url draft values', () => {
    const loaded = {
      global: { path: '/global/config.json', exists: false },
      project: { path: '/project/config.json', exists: false },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: DEFAULT_BACKEND_CONFIG
    };

    const state = createSettingsDraftState(loaded, 'project');

    const searchProviderState = applySettingsValue(state, 'backend:search:provider', 'searxng');
    const fetchProviderState = applySettingsValue(state, 'backend:fetch:provider', 'firecrawl');

    expect(searchProviderState.backends.search.provider).toBe('searxng');
    expect(applySettingsValue(searchProviderState, 'backend:search:fallback', 'duckduckgo').backends.search.fallback).toBe('duckduckgo');
    expect(fetchProviderState.backends.fetch.provider).toBe('firecrawl');
    expect(applySettingsValue(fetchProviderState, 'backend:fetch:fallback', 'http').backends.fetch.fallback).toBe('http');

    const searchUrlState = applySettingsValue(searchProviderState, 'backend:search:baseUrl', 'http://localhost:8080');
    expect(searchUrlState.backends.search.provider).toBe('searxng');
    expect(searchUrlState.backends.search.baseUrl).toBe('http://localhost:8080');

    const fetchUrlState = applySettingsValue(state, 'backend:fetch:baseUrl', 'http://localhost:3002');
    expect(fetchUrlState.backends.fetch.provider).toBe('firecrawl');
    expect(fetchUrlState.backends.fetch.baseUrl).toBe('http://localhost:3002');
  });

  it('applies search fanout mode draft values', () => {
    const loaded = {
      global: { path: '/global/config.json', exists: false },
      project: { path: '/project/config.json', exists: false },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: DEFAULT_BACKEND_CONFIG
    };

    const state = createSettingsDraftState(loaded, 'project');

    const fanoutOnState = applySettingsValue(state, 'backend:search:fanout:mode', 'on');
    expect(fanoutOnState.backends.search.fanout).toEqual({ mode: 'on', providers: undefined });

    const fanoutAutoState = applySettingsValue(state, 'backend:search:fanout:mode', 'auto');
    expect(fanoutAutoState.backends.search.fanout).toEqual({ mode: 'auto', providers: undefined });

    const fanoutOffState = applySettingsValue(fanoutOnState, 'backend:search:fanout:mode', 'off');
    expect(fanoutOffState.backends.search.fanout).toEqual({ mode: 'off' });
  });

  it('applies brave backend draft values without preserving searxng-only fields', () => {
    const loaded = {
      global: { path: '/global/config.json', exists: false },
      project: { path: '/project/config.json', exists: false },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: {
        search: {
          provider: 'searxng' as const,
          baseUrl: 'http://localhost:8080',
          fallback: 'duckduckgo' as const,
          options: { language: 'en' }
        },
        fetch: { provider: 'http' as const },
        headless: { provider: 'local-browser' as const }
      }
    };

    const state = createSettingsDraftState(loaded, 'project');
    const braveState = applySettingsValue(state, 'backend:search:provider', 'brave');
    const fallbackState = applySettingsValue(braveState, 'backend:search:fallback', 'duckduckgo');

    expect(braveState.backends.search).toEqual({ provider: 'brave' });
    expect(fallbackState.backends.search).toEqual({ provider: 'brave', fallback: 'duckduckgo' });
  });

  it('selects searxng when a SearXNG URL is entered', () => {
    const loaded = {
      global: { path: '/global/config.json', exists: false },
      project: { path: '/project/config.json', exists: false },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: DEFAULT_BACKEND_CONFIG
    };

    const state = createSettingsDraftState(loaded, 'project');
    const braveState = applySettingsValue(state, 'backend:search:provider', 'brave');
    const editedState = applySettingsValue(braveState, 'backend:search:baseUrl', 'http://localhost:8080');

    expect(editedState.backends.search).toEqual({ provider: 'searxng', baseUrl: 'http://localhost:8080' });
  });

  it('re-promotes back to searxng with a fresh URL after switching away and back', () => {
    const loaded = {
      global: { path: '/global/config.json', exists: false },
      project: { path: '/project/config.json', exists: false },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: DEFAULT_BACKEND_CONFIG
    };

    const state = createSettingsDraftState(loaded, 'project');
    const withUrl = applySettingsValue(state, 'backend:search:baseUrl', 'http://localhost:8080');
    expect(withUrl.backends.search).toEqual({ provider: 'searxng', baseUrl: 'http://localhost:8080' });

    // Switching provider away from searxng drops the searxng-only baseUrl.
    const switchedAway = applySettingsValue(withUrl, 'backend:search:provider', 'brave');
    expect(switchedAway.backends.search).toEqual({ provider: 'brave' });

    // Entering a new URL switches back to searxng with the new value, not the stale one.
    const switchedBack = applySettingsValue(switchedAway, 'backend:search:baseUrl', 'http://localhost:9090');
    expect(switchedBack.backends.search).toEqual({ provider: 'searxng', baseUrl: 'http://localhost:9090' });
  });

  it('promotes duckduckgo (the default) to searxng when a URL is entered', () => {
    const loaded = {
      global: { path: '/global/config.json', exists: false },
      project: { path: '/project/config.json', exists: false },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: DEFAULT_BACKEND_CONFIG
    };

    const state = createSettingsDraftState(loaded, 'project');
    const editedState = applySettingsValue(state, 'backend:search:baseUrl', 'http://localhost:8080');

    expect(editedState.backends.search).toEqual({ provider: 'searxng', baseUrl: 'http://localhost:8080' });
  });

  it('clearing the SearXNG URL does not change the selected provider', () => {
    const loaded = {
      global: {
        path: '/global/config.json',
        exists: true,
        rawConfig: { tools: {} },
        rawBackends: {
          search: { provider: 'searxng' as const, baseUrl: 'http://localhost:8080' }
        }
      },
      project: { path: '/project/config.json', exists: false },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: {
        search: { provider: 'searxng' as const, baseUrl: 'http://localhost:8080' },
        fetch: { provider: 'http' as const },
        headless: { provider: 'local-browser' as const }
      }
    };

    const state = createSettingsDraftState(loaded, 'project');
    const editedState = applySettingsValue(state, 'backend:search:baseUrl', '');

    expect(editedState.backends.search).toEqual({ provider: 'searxng' });
  });

  it('promotes http (the default) to firecrawl when a Firecrawl URL is entered', () => {
    const loaded = {
      global: { path: '/global/config.json', exists: false },
      project: { path: '/project/config.json', exists: false },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: DEFAULT_BACKEND_CONFIG
    };

    const state = createSettingsDraftState(loaded, 'project');
    const editedState = applySettingsValue(state, 'backend:fetch:baseUrl', 'http://localhost:3002');

    expect(editedState.backends.fetch).toEqual({ provider: 'firecrawl', baseUrl: 'http://localhost:3002' });
  });

  it('clearing the Firecrawl URL does not change the selected fetch provider', () => {
    const loaded = {
      global: {
        path: '/global/config.json',
        exists: true,
        rawConfig: { tools: {} },
        rawBackends: {
          fetch: { provider: 'firecrawl' as const, baseUrl: 'http://localhost:3002' }
        }
      },
      project: { path: '/project/config.json', exists: false },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: {
        search: { provider: 'duckduckgo' as const },
        fetch: { provider: 'firecrawl' as const, baseUrl: 'http://localhost:3002' },
        headless: { provider: 'local-browser' as const }
      }
    };

    const state = createSettingsDraftState(loaded, 'project');
    const editedState = applySettingsValue(state, 'backend:fetch:baseUrl', '');

    expect(editedState.backends.fetch).toEqual({ provider: 'firecrawl' });
  });

  it('creates an inline URL editor component instead of a modal prompt', () => {
    const theme = { fg: (_style: string, text: string) => text, bold: (text: string) => text };
    const editor = createBackendUrlEditor(theme, 'SearXNG base URL', 'http://localhost:8080');

    let selected: string | undefined;
    let doneCalled = false;
    const component = editor('not set', (value) => {
      doneCalled = true;
      selected = value;
    });

    expect(component.render).toBeInstanceOf(Function);
    expect(component.handleInput).toBeInstanceOf(Function);

    component.handleInput?.('\r');

    expect(doneCalled).toBe(true);
    expect(selected).toBe('http://localhost:8080');
  });

  it('rejects an invalid URL from the inline editor without closing it', () => {
    const theme = { fg: (_style: string, text: string) => text, bold: (text: string) => text };
    const editor = createBackendUrlEditor(theme, 'SearXNG base URL', 'http://localhost:8080');

    let done = false;
    const component = editor('http://localhost:8080', () => {
      done = true;
    });

    component.handleInput?.('\x1b[F');
    for (let i = 0; i < 'http://localhost:8080'.length; i++) {
      component.handleInput?.('\x7f');
    }
    for (const ch of 'not-a-url') {
      component.handleInput?.(ch);
    }
    component.handleInput?.('\r');

    expect(done).toBe(false);
  });

  it('clears the URL from the inline editor when submitted empty', () => {
    const theme = { fg: (_style: string, text: string) => text, bold: (text: string) => text };
    const editor = createBackendUrlEditor(theme, 'SearXNG base URL', 'http://localhost:8080');

    let selected: string | undefined = 'unset-sentinel';
    const component = editor('http://localhost:8080', (value) => {
      selected = value;
    });

    component.handleInput?.('\x1b[F');
    for (let i = 0; i < 'http://localhost:8080'.length; i++) {
      component.handleInput?.('\x7f');
    }
    component.handleInput?.('\r');

    expect(selected).toBe('');
  });

  it('cancels the inline editor on escape without a value', () => {
    const theme = { fg: (_style: string, text: string) => text, bold: (text: string) => text };
    const editor = createBackendUrlEditor(theme, 'SearXNG base URL', 'http://localhost:8080');

    let selected: string | undefined = 'unset-sentinel';
    const component = editor('http://localhost:8080', (value) => {
      selected = value;
    });

    component.handleInput?.('\x1b');

    expect(selected).toBeUndefined();
  });

  it('places the cursor at the end of the pre-filled value so typing does not insert mid-string', () => {
    const theme = { fg: (_style: string, text: string) => text, bold: (text: string) => text };
    const editor = createBackendUrlEditor(theme, 'SearXNG base URL', 'http://localhost:8080');

    let selected: string | undefined;
    const component = editor('http://localhost:8080', (value) => {
      selected = value;
    });

    // A user who opens the field and immediately types (without pressing End
    // first) should append, not insert at the start of the pre-filled value.
    component.handleInput?.('/');
    component.handleInput?.('x');
    component.handleInput?.('\r');

    expect(selected).toBe('http://localhost:8080/x');
  });

  it('reports open/close state via onOpenChange so the host can defer global shortcuts', () => {
    const theme = { fg: (_style: string, text: string) => text, bold: (text: string) => text };
    const openStates: boolean[] = [];
    const editor = createBackendUrlEditor(theme, 'SearXNG base URL', 'http://localhost:8080', (open) => {
      openStates.push(open);
    });

    const component = editor('not set', () => {});
    expect(openStates).toEqual([true]);

    component.handleInput?.('\x1b');
    expect(openStates).toEqual([true, false]);
  });


  it('applies youcom backend draft values without preserving searxng-only fields', () => {
    const loaded = {
      global: { path: '/global/config.json', exists: false },
      project: { path: '/project/config.json', exists: false },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: {
        search: {
          provider: 'searxng' as const,
          baseUrl: 'http://localhost:8080',
          fallback: 'duckduckgo' as const,
          options: { language: 'en' }
        },
        fetch: { provider: 'http' as const },
        headless: { provider: 'local-browser' as const }
      }
    };

    const state = createSettingsDraftState(loaded, 'project');
    const youcomState = applySettingsValue(state, 'backend:search:provider', 'youcom');
    const fallbackState = applySettingsValue(youcomState, 'backend:search:fallback', 'duckduckgo');

    expect(youcomState.backends.search).toEqual({ provider: 'youcom' });
    expect(fallbackState.backends.search).toEqual({ provider: 'youcom', fallback: 'duckduckgo' });
  });

  it('does not set fallback values for providers that do not support them', () => {
    const loaded = {
      global: { path: '/global/config.json', exists: false },
      project: { path: '/project/config.json', exists: false },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: DEFAULT_BACKEND_CONFIG
    };

    const state = createSettingsDraftState(loaded, 'project');

    expect(applySettingsValue(state, 'backend:search:fallback', 'duckduckgo').backends.search.fallback).toBeUndefined();
    expect(applySettingsValue(state, 'backend:fetch:fallback', 'http').backends.fetch.fallback).toBeUndefined();
  });

  it('excludes a provider when toggled from default (included)', () => {
    const loaded = {
      global: { path: '/global/config.json', exists: false },
      project: {
        path: '/project/config.json',
        exists: true,
        rawConfig: { tools: {} },
        rawBackends: {
          search: { provider: 'duckduckgo' as const, baseUrl: 'http://localhost:8080', fanout: { mode: 'on' as const } }
        }
      },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: {
        search: { provider: 'duckduckgo' as const, baseUrl: 'http://localhost:8080', fanout: { mode: 'on' as const } },
        fetch: { provider: 'http' as const },
        headless: { provider: 'local-browser' as const }
      }
    };

    const state = createSettingsDraftState(loaded, 'project');
    const duckExcludedState = applySettingsValue(state, 'backend:search:fanout:provider:duckduckgo', 'excluded');

    // When we exclude one provider, fanout.providers should be materialized to usable providers except the excluded one
    // With baseUrl set, usable providers are ['duckduckgo', 'searxng'], so excluding duck leaves just ['searxng']
    expect(duckExcludedState.backends.search.fanout).toBeDefined();
    expect(duckExcludedState.backends.search.fanout?.providers).toEqual(['searxng']);
  });

  it('excludes a provider when toggled from explicitly included', () => {
    const loaded = {
      global: { path: '/global/config.json', exists: false },
      project: {
        path: '/project/config.json',
        exists: true,
        rawConfig: { tools: {} },
        rawBackends: {
          search: { provider: 'duckduckgo' as const, baseUrl: 'http://localhost:8080', fanout: { mode: 'on' as const, providers: ['duckduckgo' as const, 'searxng' as const] } }
        }
      },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: {
        search: { provider: 'duckduckgo' as const, baseUrl: 'http://localhost:8080', fanout: { mode: 'on' as const, providers: ['duckduckgo' as const, 'searxng' as const] } },
        fetch: { provider: 'http' as const },
        headless: { provider: 'local-browser' as const }
      }
    };

    const state = createSettingsDraftState(loaded, 'project');
    const searxngExcludedState = applySettingsValue(state, 'backend:search:fanout:provider:searxng', 'excluded');

    // With baseUrl set, usable providers are duckduckgo and searxng. Excluding searxng leaves just duckduckgo
    expect(searxngExcludedState.backends.search.fanout?.providers).toEqual(['duckduckgo']);
  });

  it('includes a previously-excluded provider when toggled back', () => {
    const loaded = {
      global: { path: '/global/config.json', exists: false },
      project: {
        path: '/project/config.json',
        exists: true,
        rawConfig: { tools: {} },
        rawBackends: {
          search: { provider: 'duckduckgo' as const, baseUrl: 'http://localhost:8080', fanout: { mode: 'on' as const, providers: ['duckduckgo' as const] } }
        }
      },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: {
        search: { provider: 'duckduckgo' as const, baseUrl: 'http://localhost:8080', fanout: { mode: 'on' as const, providers: ['duckduckgo' as const] } },
        fetch: { provider: 'http' as const },
        headless: { provider: 'local-browser' as const }
      }
    };

    const state = createSettingsDraftState(loaded, 'project');
    const searxngIncludedState = applySettingsValue(state, 'backend:search:fanout:provider:searxng', 'included');

    // With baseUrl set, usable providers are duckduckgo and searxng. After including searxng, we have both
    expect(searxngIncludedState.backends.search.fanout?.providers).toEqual(['duckduckgo', 'searxng']);
  });

  it('persists explicit off mode across scopes when global has fanout on', () => {
    // Simulates: global config has fanout ON, project override sets it OFF
    const loaded = {
      global: {
        path: '/global/config.json',
        exists: true,
        rawConfig: { tools: {} },
        rawBackends: {
          search: { provider: 'duckduckgo' as const, fanout: { mode: 'on' as const } }
        }
      },
      project: {
        path: '/project/config.json',
        exists: false
      },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: {
        search: { provider: 'duckduckgo' as const, fanout: { mode: 'on' as const } },
        fetch: { provider: 'http' as const },
        headless: { provider: 'local-browser' as const }
      }
    };

    const state = createSettingsDraftState(loaded, 'project');
    const fanoutOffState = applySettingsValue(state, 'backend:search:fanout:mode', 'off');

    // The draft should have explicit off, not undefined
    expect(fanoutOffState.backends.search.fanout).toEqual({ mode: 'off' });

    // When collapsed, the override should include the explicit off
    const inherited: typeof fanoutOffState.backends = { search: { provider: 'duckduckgo', fanout: { mode: 'on' } }, fetch: { provider: 'http' }, headless: { provider: 'local-browser' } };
    const override = collapseBackendConfigToOverride(fanoutOffState.backends, inherited);

    // The override should explicitly contain the off mode so it persists
    expect(override.search?.fanout).toEqual({ mode: 'off' });
  });

  it('prevents excluding the last remaining provider in fanout', () => {
    const loaded = {
      global: { path: '/global/config.json', exists: false },
      project: {
        path: '/project/config.json',
        exists: true,
        rawConfig: { tools: {} },
        rawBackends: {
          search: { provider: 'duckduckgo' as const, fanout: { mode: 'on' as const, providers: ['duckduckgo' as const] } }
        }
      },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: {
        search: { provider: 'duckduckgo' as const, fanout: { mode: 'on' as const, providers: ['duckduckgo' as const] } },
        fetch: { provider: 'http' as const },
        headless: { provider: 'local-browser' as const }
      }
    };

    const state = createSettingsDraftState(loaded, 'project');
    // Try to exclude the last provider
    const excludeState = applySettingsValue(state, 'backend:search:fanout:provider:duckduckgo', 'excluded');

    // The providers list should still contain duckduckgo (not become empty)
    expect(excludeState.backends.search.fanout?.providers).toEqual(['duckduckgo']);
  });

  it('prevents excluding the last remaining provider when starting from all-included', () => {
    const loaded = {
      global: { path: '/global/config.json', exists: false },
      project: { path: '/project/config.json', exists: false },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: {
        search: { provider: 'duckduckgo' as const, fanout: { mode: 'on' as const } },
        fetch: { provider: 'http' as const },
        headless: { provider: 'local-browser' as const }
      }
    };

    const allProviders = ['duckduckgo', 'searxng', 'brave', 'youcom', 'exa', 'tavily'] as const;
    let state = createSettingsDraftState(loaded, 'project');

    // Exclude 5 providers one by one
    for (const provider of allProviders.slice(1)) {
      state = applySettingsValue(state, `backend:search:fanout:provider:${provider}`, 'excluded');
    }

    // At this point, should only have duckduckgo left
    expect(state.backends.search.fanout?.providers).toEqual(['duckduckgo']);

    // Try to exclude the last one (duckduckgo)
    const finalState = applySettingsValue(state, 'backend:search:fanout:provider:duckduckgo', 'excluded');

    // Should still have duckduckgo (can't go to zero)
    expect(finalState.backends.search.fanout?.providers).toEqual(['duckduckgo']);
  });

  it('validates backend urls for interactive prompts', () => {
    expect(validateBackendUrl('localhost:8080')).toEqual({ ok: false, message: 'Invalid URL. Include http:// or https://.' });
    expect(validateBackendUrl('ftp://localhost:8080')).toEqual({ ok: false, message: 'Invalid URL. Include http:// or https://.' });
    expect(validateBackendUrl('http://localhost:8080')).toEqual({ ok: true, value: 'http://localhost:8080' });
  });

  it('supports real cancel and reset shortcuts in the settings UI', () => {
    expect(handleSettingsShortcut('\u001b')).toEqual({ action: 'cancel' });
    expect(handleSettingsShortcut('\u0012')).toEqual({ action: 'reset' });
    expect(handleSettingsShortcut('\u0013')).toEqual({ action: 'save' });
    expect(handleSettingsShortcut('x')).toBeUndefined();
  });
});

describe('web-agent config commands', () => {
  it('registers a single /web-agent command', () => {
    const pi = { registerCommand: vi.fn() };

    registerWebAgentConfigCommands(pi as never);

    expect(pi.registerCommand).toHaveBeenCalledWith(
      'web-agent',
      expect.objectContaining({ handler: expect.any(Function) })
    );
  });

  it('renders doctor output with runtime and detected browser', async () => {
    let handler: any;
    const pi = {
      registerCommand: vi.fn((_name: string, command: any) => {
        handler = command.handler;
      })
    };

    const browser: BrowserResolutionResult = {
      ok: true,
      executablePath: '/usr/bin/chromium',
      browser: 'chromium'
    };

    registerWebAgentConfigCommands(pi as never, {
      resolveBrowser: vi.fn().mockResolvedValue(browser),
      runtime: { nodeVersion: 'v24.0.0', platform: 'linux', arch: 'x64' },
      checkTypebox: vi.fn().mockResolvedValue(true),
      load: vi.fn().mockResolvedValue({
        effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
        effectiveBackends: DEFAULT_BACKEND_CONFIG
      }),
      checkBackends: vi.fn().mockResolvedValue(['headless backend: local-browser (managed Chromium fallback configured)']),
      // Injected so this stays hermetic. The real checkJitiCompat reads this
      // machine's node_modules, which would make the test fail on exactly the
      // trees where #34 has recurred.
      checkJitiCompat: vi.fn().mockReturnValue({ pending: [], patched: [] }),
      checkRepoResearch: vi.fn().mockResolvedValue('repo research: git 2.55.0, no GitHub login (public repos only)')
    });

    const notify = vi.fn();
    await handler('doctor', { ui: { notify } });

    expect(notify).toHaveBeenCalledWith(expect.stringContaining('pi-web-agent: loaded'), 'info');
    expect(notify.mock.calls[0][0]).toContain('runtime: node v24.0.0 linux x64');
    expect(notify.mock.calls[0][0]).toContain('typebox: ok');
    expect(notify.mock.calls[0][0]).toContain('browser: chromium /usr/bin/chromium');
    expect(notify.mock.calls[0][0]).toContain('trust upstream proxy for private addresses: off');
    expect(notify.mock.calls[0][0]).toContain('search: duckduckgo');
    expect(notify.mock.calls[0][0]).toContain('fetch: http');
    expect(notify.mock.calls[0][0]).toContain('headless backend: local-browser (managed Chromium fallback configured)');
    expect(notify.mock.calls[0][0]).not.toContain('search backend: duckduckgo');
    expect(notify.mock.calls[0][0]).not.toContain('fetch backend: http');
    expect(notify.mock.calls[0][0]).toContain('jsdom compat patch: ok');
    expect(notify.mock.calls[0][0]).toContain('network allow list: none');
  });

  it('adds the repo research line to doctor output', async () => {
    let handler: any;
    const pi = {
      registerCommand: vi.fn((_name: string, command: any) => {
        handler = command.handler;
      })
    };
    registerWebAgentConfigCommands(pi as never, {
      resolveBrowser: vi.fn().mockResolvedValue({ ok: true, executablePath: '/usr/bin/chromium', browser: 'chromium' }),
      runtime: { nodeVersion: 'v24.0.0', platform: 'linux', arch: 'x64' },
      checkTypebox: vi.fn().mockResolvedValue(true),
      load: vi.fn().mockResolvedValue({ effectiveConfig: DEFAULT_PRESENTATION_CONFIG, effectiveBackends: DEFAULT_BACKEND_CONFIG }),
      checkBackends: vi.fn().mockResolvedValue([]),
      checkJitiCompat: vi.fn().mockReturnValue({ pending: [], patched: [] }),
      checkRepoResearch: vi.fn().mockResolvedValue('repo research: git 2.55.0, no GitHub login (public repos only)')
    });
    const notify = vi.fn();
    await handler('doctor', { ui: { notify } });
    expect(notify.mock.calls[0][0]).toContain('repo research: git 2.55.0, no GitHub login (public repos only)');
  });

  it('reports a needed jsdom compat patch and the recovery command in doctor output', async () => {
    let handler: any;
    const pi = {
      registerCommand: vi.fn((_name: string, command: any) => {
        handler = command.handler;
      })
    };

    registerWebAgentConfigCommands(pi as never, {
      resolveBrowser: vi.fn().mockResolvedValue({
        ok: true,
        executablePath: '/usr/bin/chromium',
        browser: 'chromium'
      }),
      runtime: { nodeVersion: 'v24.0.0', platform: 'linux', arch: 'x64' },
      checkTypebox: vi.fn().mockResolvedValue(true),
      checkJitiCompat: vi.fn().mockReturnValue({ pending: ['tr46/index.js'] }),
      load: vi.fn().mockResolvedValue({
        effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
        effectiveBackends: DEFAULT_BACKEND_CONFIG
      }),
      checkBackends: vi.fn().mockResolvedValue([]),
      checkRepoResearch: vi.fn().mockResolvedValue('repo research: git 2.55.0, no GitHub login (public repos only)')
    });

    const notify = vi.fn();
    await handler('doctor', { ui: { notify } });

    expect(notify.mock.calls[0][0]).toContain('jsdom compat patch: needed (tr46/index.js)');
    expect(notify.mock.calls[0][0]).toContain(
      'Run: node ~/.pi/agent/npm/node_modules/@demigodmode/pi-web-agent/scripts/patch-jiti-compat.mjs'
    );
    expect(notify.mock.calls[0][0]).toContain('then restart Pi.');
  });

  it('renders backend validation warnings in doctor output', async () => {
    let handler: any;
    const pi = {
      registerCommand: vi.fn((_name: string, command: any) => {
        handler = command.handler;
      })
    };

    registerWebAgentConfigCommands(pi as never, {
      load: vi.fn().mockResolvedValue({
        global: { path: '/global/config.json', exists: false },
        project: { path: '/project/config.json', exists: true },
        effectiveConfig: { defaultMode: 'compact', tools: {} },
        effectiveBackends: {
          search: { provider: 'searxng' },
          fetch: { provider: 'firecrawl' },
          headless: { provider: 'local-browser' }
        }
      }),
      resolveBrowser: vi.fn().mockResolvedValue({ ok: true, executablePath: '/usr/bin/chromium', browser: 'chromium' }),
      runtime: { nodeVersion: 'v24.0.0', platform: 'linux', arch: 'x64' },
      checkTypebox: vi.fn().mockResolvedValue(true),
      checkRepoResearch: vi.fn().mockResolvedValue('repo research: git 2.55.0, no GitHub login (public repos only)')
    });

    const notify = vi.fn();
    await handler('doctor', { ui: { notify } });

    expect(notify.mock.calls[0][0]).toContain('backend config: warning');
    expect(notify.mock.calls[0][0]).toContain('search provider searxng requires backends.search.baseUrl');
    expect(notify.mock.calls[0][0]).toContain('fetch provider firecrawl requires backends.fetch.baseUrl');
  });

  it('renders doctor browser failures without throwing', async () => {
    let handler: any;
    const pi = {
      registerCommand: vi.fn((_name: string, command: any) => {
        handler = command.handler;
      })
    };

    registerWebAgentConfigCommands(pi as never, {
      resolveBrowser: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: 'BROWSER_NOT_FOUND',
          message: 'No compatible local browser was found for headless fetch.'
        }
      }),
      runtime: { nodeVersion: 'v24.0.0', platform: 'darwin', arch: 'arm64' },
      checkTypebox: vi.fn().mockResolvedValue(true),
      checkRepoResearch: vi.fn().mockResolvedValue('repo research: git 2.55.0, no GitHub login (public repos only)')
    });

    const notify = vi.fn();
    await handler('doctor', { ui: { notify } });

    expect(notify.mock.calls[0][0]).toContain('browser: missing');
    expect(notify.mock.calls[0][0]).toContain('Install Chrome, Chromium, Edge, or Brave');
  });

  it('hides credentials from unparseable proxy urls in doctor and show output', async () => {
    let handler: any;
    const pi = {
      registerCommand: vi.fn((_name: string, command: any) => {
        handler = command.handler;
      })
    };

    registerWebAgentConfigCommands(pi as never, {
      load: vi.fn().mockResolvedValue({
        global: {
          path: '/global/config.json',
          exists: true,
          rawConfig: { tools: {} }
        },
        project: {
          path: '/project/config.json',
          exists: false
        },
        effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
        effectiveBackends: {
          search: { provider: 'duckduckgo' },
          fetch: { provider: 'http' },
          headless: { provider: 'local-browser' },
          proxy: { url: 'http://u:secretpw@[broken' }
        }
      }),
      resolveBrowser: vi.fn().mockResolvedValue({ ok: true, executablePath: '/usr/bin/chromium', browser: 'chromium' }),
      runtime: { nodeVersion: 'v24.0.0', platform: 'linux', arch: 'x64' },
      checkTypebox: vi.fn().mockResolvedValue(true),
      checkBackends: vi.fn().mockResolvedValue([]),
      checkJitiCompat: vi.fn().mockReturnValue({ pending: [], patched: [] }),
      checkRepoResearch: vi.fn().mockResolvedValue('repo research: ok'),
      reset: vi.fn()
    });

    const notify = vi.fn();
    await handler('doctor', { ui: { notify } });

    const doctorOutput = notify.mock.calls[0][0];
    expect(doctorOutput).not.toContain('secretpw');
    expect(doctorOutput).toContain('proxy: (invalid URL)');

    notify.mockClear();
    await handler('show', { ui: { notify } });

    const showOutput = notify.mock.calls[0][0];
    expect(showOutput).not.toContain('secretpw');
    expect(showOutput).toContain('proxy: (invalid URL)');
  });

  it('renders effective config from the store for show', async () => {
    let handler: any;
    const pi = {
      registerCommand: vi.fn((_name: string, command: any) => {
        handler = command.handler;
      })
    };

    registerWebAgentConfigCommands(pi as never, {
      load: vi.fn().mockResolvedValue({
        global: {
          path: '/global/config.json',
          exists: true,
          rawConfig: { defaultMode: 'preview', tools: {} }
        },
        project: {
          path: '/project/config.json',
          exists: true,
          rawConfig: { defaultMode: 'preview', tools: { web_explore: { mode: 'verbose' } } }
        },
        effectiveConfig: {
          defaultMode: 'preview',
          tools: { web_explore: { mode: 'verbose' } }
        },
        effectiveBackends: {
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
        }
      }),
      reset: vi.fn()
    });

    const notify = vi.fn();
    await handler('show', { ui: { notify } });

    expect(notify).toHaveBeenCalledWith(expect.stringContaining('defaultMode: preview'), 'info');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('web_explore: verbose'), 'info');
    expect(notify.mock.calls[0][0]).toContain('search: searxng (http://localhost:8080) fallback duckduckgo categories general,it language en safesearch 1');
    expect(notify.mock.calls[0][0]).toContain('fetch: firecrawl (http://localhost:3002) fallback http formats markdown onlyMainContent true');
    expect(notify.mock.calls[0][0]).toContain('headless: local-browser');
    expect(notify.mock.calls[0][0]).not.toContain('web_search:');
    expect(notify.mock.calls[0][0]).not.toContain('web_fetch:');
  });

  it('renders search fanout in show command', async () => {
    let handler: any;
    const pi = {
      registerCommand: vi.fn((_name: string, command: any) => {
        handler = command.handler;
      })
    };

    registerWebAgentConfigCommands(pi as never, {
      load: vi.fn().mockResolvedValue({
        global: { path: '/global/config.json', exists: false },
        project: { path: '/project/config.json', exists: true },
        effectiveConfig: { defaultMode: 'compact', tools: {} },
        effectiveBackends: {
          search: {
            provider: 'duckduckgo',
            fanout: { mode: 'on', providers: ['brave', 'exa'] }
          },
          fetch: { provider: 'http' },
          headless: { provider: 'local-browser' }
        }
      }),
      reset: vi.fn()
    });

    const notify = vi.fn();
    await handler('show', { ui: { notify } });

    expect(notify.mock.calls[0][0]).toContain('search: duckduckgo fanout on (brave, exa)');
  });

  it('shows the latest changelog entry on request', async () => {
    let handler: any;
    const pi = {
      registerCommand: vi.fn((_name: string, command: any) => {
        handler = command.handler;
      })
    };

    registerWebAgentConfigCommands(pi as never, {
      getChangelog: vi.fn().mockResolvedValue('## [1.0.0]\n- Requires Pi 0.74+.')
    });

    const notify = vi.fn();
    await handler('changelog', { ui: { notify } });

    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Requires Pi 0.74+'), 'info');
  });

  it('resets project scope when explicitly requested', async () => {
    let handler: any;
    const reset = vi.fn();
    const pi = {
      registerCommand: vi.fn((_name: string, command: any) => {
        handler = command.handler;
      })
    };

    registerWebAgentConfigCommands(pi as never, {
      load: vi.fn(),
      reset
    });

    const notify = vi.fn();
    await handler('reset project', { ui: { notify } });

    expect(reset).toHaveBeenCalledWith('project');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Reset project config'), 'info');
  });

  it('opens an action menu before settings when invoked with no args', async () => {
    let handler: any;
    const pi = {
      registerCommand: vi.fn((_name: string, command: any) => {
        handler = command.handler;
      })
    };

    registerWebAgentConfigCommands(pi as never, {
      load: vi.fn().mockResolvedValue({
        global: { path: '/global/config.json', exists: false },
        project: { path: '/project/config.json', exists: false },
        effectiveConfig: { defaultMode: 'compact', tools: {} }
      }),
      save: vi.fn(),
      reset: vi.fn()
    });

    const custom = vi
      .fn()
      .mockResolvedValueOnce('settings')
      .mockResolvedValueOnce('presentation')
      .mockResolvedValueOnce({
        scope: 'project',
        config: {
          defaultMode: 'preview',
          tools: { web_explore: { mode: 'verbose' } }
        },
        backends: DEFAULT_BACKEND_CONFIG,
        action: 'save'
      });

    await handler('', { ui: { custom, notify: vi.fn() } });

    expect(custom).toHaveBeenCalledTimes(3);
  });

  it('runs doctor from the action menu', async () => {
    let handler: any;
    const pi = {
      registerCommand: vi.fn((_name: string, command: any) => {
        handler = command.handler;
      })
    };

    registerWebAgentConfigCommands(pi as never, {
      resolveBrowser: vi.fn().mockResolvedValue({
        ok: true,
        executablePath: '/usr/bin/chromium',
        browser: 'chromium'
      }),
      runtime: { nodeVersion: 'v24.0.0', platform: 'linux', arch: 'x64' },
      checkTypebox: vi.fn().mockResolvedValue(true),
      checkRepoResearch: vi.fn().mockResolvedValue('repo research: git 2.55.0, no GitHub login (public repos only)')
    });

    const notify = vi.fn();
    await handler('', { ui: { custom: vi.fn().mockResolvedValue('doctor'), notify } });

    expect(notify.mock.calls[0][0]).toContain('pi-web-agent: loaded');
    expect(notify.mock.calls[0][0]).toContain('browser: chromium /usr/bin/chromium');
  });

  it('opens a custom settings UI when invoked with settings', async () => {
    let handler: any;
    const pi = {
      registerCommand: vi.fn((_name: string, command: any) => {
        handler = command.handler;
      })
    };

    registerWebAgentConfigCommands(pi as never, {
      load: vi.fn().mockResolvedValue({
        global: { path: '/global/config.json', exists: false },
        project: { path: '/project/config.json', exists: false },
        effectiveConfig: { defaultMode: 'compact', tools: {} }
      }),
      save: vi.fn(),
      reset: vi.fn()
    });

    const custom = vi
      .fn()
      .mockResolvedValueOnce('presentation')
      .mockResolvedValueOnce({
        scope: 'project',
        config: {
          defaultMode: 'preview',
          tools: { web_explore: { mode: 'verbose' } }
        },
        backends: DEFAULT_BACKEND_CONFIG,
        action: 'save'
      });

    await handler('settings', { ui: { custom, notify: vi.fn() } });

    expect(custom).toHaveBeenCalledTimes(2);
  });

  it('saves only presentation overrides from the presentation settings section', async () => {
    let handler: any;
    const save = vi.fn();
    const saveBackends = vi.fn();
    const notify = vi.fn();
    const pi = {
      registerCommand: vi.fn((_name: string, command: any) => {
        handler = command.handler;
      })
    };

    registerWebAgentConfigCommands(pi as never, {
      load: vi.fn().mockResolvedValue({
        global: { path: '/global/config.json', exists: false },
        project: { path: '/project/config.json', exists: false },
        effectiveConfig: { defaultMode: 'compact', tools: {} },
        effectiveBackends: {
          search: { provider: 'searxng', baseUrl: 'http://localhost:8080', fallback: 'duckduckgo' },
          fetch: { provider: 'firecrawl', baseUrl: 'http://localhost:3002', fallback: 'http' },
          headless: { provider: 'local-browser' }
        }
      }),
      save,
      saveBackends,
      reset: vi.fn()
    });

    await handler('settings', {
      ui: {
        custom: vi
          .fn()
          .mockResolvedValueOnce('presentation')
          .mockResolvedValueOnce({
            action: 'save',
            scope: 'project',
            config: { defaultMode: 'preview', tools: {} },
            backends: DEFAULT_BACKEND_CONFIG
          }),
        notify
      }
    });

    expect(save).toHaveBeenCalledWith('project', { defaultMode: 'preview', tools: {} });
    expect(saveBackends).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Saved project presentation config'), 'info');
  });

  it('saves brave as a search backend without writing API keys', async () => {
    let handler: any;
    const save = vi.fn();
    const saveBackends = vi.fn();
    const pi = {
      registerCommand: vi.fn((_name: string, command: any) => {
        handler = command.handler;
      })
    };

    registerWebAgentConfigCommands(pi as never, {
      load: vi.fn().mockResolvedValue({
        global: { path: '/global/config.json', exists: false },
        project: { path: '/project/config.json', exists: false },
        effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
        effectiveBackends: DEFAULT_BACKEND_CONFIG
      }),
      save,
      saveBackends,
      reset: vi.fn()
    });

    await handler('settings', {
      ui: {
        custom: vi
          .fn()
          .mockResolvedValueOnce('backends')
          .mockResolvedValueOnce({
            action: 'save',
            scope: 'project',
            config: DEFAULT_PRESENTATION_CONFIG,
            backends: {
              search: { provider: 'brave', fallback: 'duckduckgo' },
              fetch: { provider: 'http' },
              headless: { provider: 'local-browser' }
            }
          }),
        notify: vi.fn()
      }
    });

    expect(save).not.toHaveBeenCalled();
    expect(saveBackends).toHaveBeenCalledWith('project', {
      search: { provider: 'brave', fallback: 'duckduckgo' }
    });
  });

  it('saves only backend overrides from the backend settings section', async () => {
    let handler: any;
    const save = vi.fn();
    const saveBackends = vi.fn();
    const pi = {
      registerCommand: vi.fn((_name: string, command: any) => {
        handler = command.handler;
      })
    };

    registerWebAgentConfigCommands(pi as never, {
      load: vi.fn().mockResolvedValue({
        global: { path: '/global/config.json', exists: false },
        project: { path: '/project/config.json', exists: false },
        effectiveConfig: { defaultMode: 'compact', tools: {} },
        effectiveBackends: DEFAULT_BACKEND_CONFIG
      }),
      save,
      saveBackends,
      reset: vi.fn()
    });

    await handler('settings', {
      ui: {
        custom: vi
          .fn()
          .mockResolvedValueOnce('backends')
          .mockResolvedValueOnce({
            action: 'save',
            scope: 'project',
            config: { defaultMode: 'compact', tools: {} },
            backends: {
              search: { provider: 'searxng', baseUrl: 'http://localhost:8080', fallback: 'duckduckgo' },
              fetch: { provider: 'firecrawl', baseUrl: 'http://localhost:3002', fallback: 'http' },
              headless: { provider: 'local-browser' }
            }
          }),
        notify: vi.fn()
      }
    });

    expect(save).not.toHaveBeenCalled();
    expect(saveBackends).toHaveBeenCalledWith('project', {
      search: { provider: 'searxng', baseUrl: 'http://localhost:8080', fallback: 'duckduckgo' },
      fetch: { provider: 'firecrawl', baseUrl: 'http://localhost:3002', fallback: 'http' }
    });
  });

  it('saves sparse project overrides from settings instead of copying inherited defaults', async () => {
    let handler: any;
    const save = vi.fn();
    const notify = vi.fn();
    const pi = {
      registerCommand: vi.fn((_name: string, command: any) => {
        handler = command.handler;
      })
    };

    registerWebAgentConfigCommands(pi as never, {
      load: vi.fn().mockResolvedValue({
        global: {
          path: '/global/config.json',
          exists: true,
          rawConfig: { defaultMode: 'preview', tools: {} }
        },
        project: { path: '/project/config.json', exists: false },
        effectiveConfig: { defaultMode: 'preview', tools: {} },
        effectiveBackends: DEFAULT_BACKEND_CONFIG
      }),
      save,
      saveBackends: vi.fn(),
      reset: vi.fn()
    });

    await handler('settings', {
      ui: {
        custom: vi
          .fn()
          .mockResolvedValueOnce('presentation')
          .mockResolvedValueOnce({
            action: 'save',
            scope: 'project',
            config: {
              defaultMode: 'preview',
              tools: { web_explore: { mode: 'verbose' } }
            },
            backends: DEFAULT_BACKEND_CONFIG
          }),
        notify
      }
    });

    expect(save).toHaveBeenCalledWith('project', {
      tools: { web_explore: { mode: 'verbose' } }
    });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Saved project presentation config'), 'info');
  });

  it('resets the selected scope when the settings ui returns reset', async () => {
    let handler: any;
    const reset = vi.fn();
    const pi = {
      registerCommand: vi.fn((_name: string, command: any) => {
        handler = command.handler;
      })
    };

    registerWebAgentConfigCommands(pi as never, {
      load: vi.fn().mockResolvedValue({
        global: { path: '/global/config.json', exists: true },
        project: { path: '/project/config.json', exists: true },
        effectiveConfig: { defaultMode: 'compact', tools: {} }
      }),
      save: vi.fn(),
      reset
    });

    await handler('settings', {
      ui: {
        custom: vi.fn().mockResolvedValue({
          action: 'reset',
          scope: 'project'
        }),
        notify: vi.fn()
      }
    });

    expect(reset).toHaveBeenCalledWith('project');
  });

  it('sets the default mode in project scope without pinning the inherited global default', async () => {
    let handler: any;
    const save = vi.fn();
    const pi = {
      registerCommand: vi.fn((_name: string, command: any) => {
        handler = command.handler;
      })
    };

    registerWebAgentConfigCommands(pi as never, {
      load: vi.fn().mockResolvedValue({
        global: {
          path: '/global/config.json',
          exists: true,
          rawConfig: { defaultMode: 'preview', tools: {} }
        },
        project: {
          path: '/project/config.json',
          exists: false
        },
        effectiveConfig: { defaultMode: 'preview', tools: {} }
      }),
      save,
      reset: vi.fn()
    });

    await handler('mode preview', { ui: { notify: vi.fn() } });

    expect(save).toHaveBeenCalledWith('project', {
      tools: {}
    });
  });

  it('sets a per-tool override when given tool name plus mode', async () => {
    let handler: any;
    const save = vi.fn();
    const pi = {
      registerCommand: vi.fn((_name: string, command: any) => {
        handler = command.handler;
      })
    };

    registerWebAgentConfigCommands(pi as never, {
      load: vi.fn().mockResolvedValue({
        global: { path: '/global/config.json', exists: false },
        project: {
          path: '/project/config.json',
          exists: true,
          rawConfig: { defaultMode: 'compact', tools: {} }
        },
        effectiveConfig: { defaultMode: 'compact', tools: {} }
      }),
      save,
      reset: vi.fn()
    });

    await handler('mode web_explore verbose', { ui: { notify: vi.fn() } });

    expect(save).toHaveBeenCalledWith('project', {
      tools: { web_explore: { mode: 'verbose' } }
    });
  });

  it('rejects removed low-level tool names in mode command', async () => {
    let handler: any;
    const save = vi.fn();
    const notify = vi.fn();
    const pi = {
      registerCommand: vi.fn((_name: string, command: any) => {
        handler = command.handler;
      })
    };

    registerWebAgentConfigCommands(pi as never, {
      load: vi.fn().mockResolvedValue({
        global: { path: '/global/config.json', exists: false },
        project: { path: '/project/config.json', exists: false },
        effectiveConfig: { defaultMode: 'compact', tools: {} }
      }),
      save,
      reset: vi.fn()
    });

    await handler('mode web_search verbose', { ui: { notify } });

    expect(save).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Usage:'), 'info');
  });

  it('clears a per-tool override when inherit is requested', async () => {
    let handler: any;
    const save = vi.fn();
    const pi = {
      registerCommand: vi.fn((_name: string, command: any) => {
        handler = command.handler;
      })
    };

    registerWebAgentConfigCommands(pi as never, {
      load: vi.fn().mockResolvedValue({
        global: { path: '/global/config.json', exists: false },
        project: {
          path: '/project/config.json',
          exists: true,
          rawConfig: { defaultMode: 'compact', tools: { web_explore: { mode: 'preview' } } }
        },
        effectiveConfig: {
          defaultMode: 'compact',
          tools: { web_explore: { mode: 'preview' } }
        }
      }),
      save,
      reset: vi.fn()
    });

    await handler('mode web_explore inherit', { ui: { notify: vi.fn() } });

    expect(save).toHaveBeenCalledWith('project', {
      tools: {}
    });
  });
});

describe('network allow list settings', () => {
  const base = {
    search: { provider: 'duckduckgo' as const },
    fetch: { provider: 'http' as const },
    headless: { provider: 'local-browser' as const }
  };

  it('validates comma separated CIDR ranges', () => {
    expect(validateAllowRanges('198.18.0.0/15, fd00::/8')).toEqual({ ok: true, value: '198.18.0.0/15, fd00::/8' });
    expect(validateAllowRanges('nonsense')).toEqual({ ok: false, message: 'Not a valid CIDR range: nonsense' });
    expect(validateAllowRanges('0.0.0.0/0')).toEqual({
      ok: false,
      message: '0.0.0.0/0 allows every address. List specific ranges instead.'
    });
  });

  it('applies and clears the allow list', () => {
    const loaded = {
      global: { path: '/global/config.json', exists: false },
      project: { path: '/project/config.json', exists: false },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: DEFAULT_BACKEND_CONFIG
    };
    const state = createSettingsDraftState(loaded, 'project');

    const set = applySettingsValue(state, 'backend:network:allowRanges', '198.18.0.0/15, 10.0.0.0/8');
    expect(set.backends.network).toEqual({ allowRanges: ['198.18.0.0/15', '10.0.0.0/8'] });

    const cleared = applySettingsValue(set, 'backend:network:allowRanges', '');
    expect(cleared.backends.network).toBeUndefined();
  });

  it('records an explicit empty list when clearing one inherited from the parent scope', () => {
    expect(
      collapseBackendConfigToOverride(base, { ...base, network: { allowRanges: ['198.18.0.0/15'] } })
    ).toEqual({ network: { allowRanges: [] } });
  });

  it('writes the allow list when it differs from the parent', () => {
    expect(collapseBackendConfigToOverride({ ...base, network: { allowRanges: ['10.0.0.0/8'] } }, base)).toEqual({
      network: { allowRanges: ['10.0.0.0/8'] }
    });
  });

  it('toggles trusting the upstream proxy without touching the allow list', () => {
    const loaded = {
      global: { path: '/global/config.json', exists: false },
      project: { path: '/project/config.json', exists: false },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: DEFAULT_BACKEND_CONFIG
    };
    const state = createSettingsDraftState(loaded, 'project');

    const withRanges = applySettingsValue(state, 'backend:network:allowRanges', '10.0.0.0/8');
    const trusted = applySettingsValue(withRanges, 'backend:network:trustProxyDns', 'on');
    expect(trusted.backends.network).toEqual({ allowRanges: ['10.0.0.0/8'], trustProxyDns: true });

    const untrusted = applySettingsValue(trusted, 'backend:network:trustProxyDns', 'off');
    expect(untrusted.backends.network).toEqual({ allowRanges: ['10.0.0.0/8'], trustProxyDns: false });

    const rangesCleared = applySettingsValue(untrusted, 'backend:network:allowRanges', '');
    expect(rangesCleared.backends.network).toEqual({ trustProxyDns: false });
  });


  it('keeps keyHeader when switching the selected provider away from google-serp if keyHeader is set', () => {
    const loaded = {
      global: { path: '/global/config.json', exists: false },
      project: {
        path: '/project/config.json',
        exists: true,
        rawConfig: { tools: {} },
        rawBackends: {
          search: {
            provider: 'google-serp' as const,
            baseUrl: 'https://google.example/search',
            keyHeader: 'Authorization'
          }
        }
      },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: {
        search: {
          provider: 'google-serp' as const,
          baseUrl: 'https://google.example/search',
          keyHeader: 'Authorization'
        },
        fetch: { provider: 'http' as const },
        headless: { provider: 'local-browser' as const }
      }
    };

    const state = createSettingsDraftState(loaded, 'project');
    const switched = applySettingsValue(state, 'backend:search:provider', 'searxng');

    expect(switched.backends.search.provider).toBe('searxng');
    expect(switched.backends.search.baseUrl).toBeUndefined();
    expect(switched.backends.search.keyHeader).toBe('Authorization');
  });
});

describe('search provider switching', () => {
  it('never sends the google serp key to the old searxng url after switching providers in settings', async () => {
    const loaded = {
      global: { path: '/global/config.json', exists: false },
      project: {
        path: '/project/config.json',
        exists: true,
        rawConfig: { tools: {} },
        rawBackends: { search: { provider: 'searxng' as const, baseUrl: 'https://searx.invalid/sub/' } }
      },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: {
        search: { provider: 'searxng' as const, baseUrl: 'https://searx.invalid/sub/' },
        fetch: { provider: 'http' as const },
        headless: { provider: 'local-browser' as const }
      }
    };
    const switched = applySettingsValue(createSettingsDraftState(loaded, 'project'), 'backend:search:provider', 'google-serp');

    const requests: Array<{ url: string; headers: Headers }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      requests.push({ url, headers: new Headers(init?.headers) });
      return new Response(JSON.stringify({ organic: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    vi.stubEnv('PI_WEB_AGENT_GOOGLE_SERP_API_KEY', 'google-secret');
    try {
      const backends = createBackendSet(switched.backends, {
        networkGuard: createNetworkGuard({}, { lookup: async () => [{ address: '93.184.216.34', family: 4 }] }),
        createGuardProxy: vi.fn(async () => {
          throw new Error('tests must not start a real guard proxy');
        }),
        policy: { sleep: async () => undefined, random: () => 0 }
      });
      const result = await backends.search({ query: 'q' });
      await backends.close();

      // Google SERP has no endpoint of its own yet, so it must not borrow SearXNG's.
      expect(requests.filter((request) => request.url.startsWith('https://searx.invalid/'))).toEqual([]);
      expect(requests.some((request) => request.headers.get('x-api-key') === 'google-secret')).toBe(false);
      expect(result.status).toBe('error');
      expect(switched.backends.search.baseUrls).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it('switching searxng -> google-serp drops the old endpoint', () => {
    const loaded = {
      global: { path: '/global/config.json', exists: false },
      project: {
        path: '/project/config.json',
        exists: true,
        rawConfig: { tools: {} },
        rawBackends: {
          search: { provider: 'searxng' as const, baseUrl: 'http://localhost:8080' }
        }
      },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: {
        search: {
          provider: 'searxng' as const,
          baseUrl: 'http://localhost:8080'
        },
        fetch: { provider: 'http' as const },
        headless: { provider: 'local-browser' as const }
      }
    };

    const state = createSettingsDraftState(loaded, 'project');
    const switched = applySettingsValue(state, 'backend:search:provider', 'google-serp');

    expect(switched.backends.search.provider).toBe('google-serp');
    expect(switched.backends.search.baseUrls).toBeUndefined();
    expect(switched.backends.search.baseUrl).toBeUndefined();
  });

  it('switching google-serp -> searxng drops the old endpoint', () => {
    const loaded = {
      global: { path: '/global/config.json', exists: false },
      project: {
        path: '/project/config.json',
        exists: true,
        rawConfig: { tools: {} },
        rawBackends: {
          search: { provider: 'google-serp' as const, baseUrl: 'https://google.example/search' }
        }
      },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: {
        search: {
          provider: 'google-serp' as const,
          baseUrl: 'https://google.example/search'
        },
        fetch: { provider: 'http' as const },
        headless: { provider: 'local-browser' as const }
      }
    };

    const state = createSettingsDraftState(loaded, 'project');
    const switched = applySettingsValue(state, 'backend:search:provider', 'searxng');

    expect(switched.backends.search.provider).toBe('searxng');
    expect(switched.backends.search.baseUrls).toBeUndefined();
    expect(switched.backends.search.baseUrl).toBeUndefined();
  });

  it('does not overwrite existing baseUrls entries when switching providers', () => {
    const loaded = {
      global: { path: '/global/config.json', exists: false },
      project: {
        path: '/project/config.json',
        exists: true,
        rawConfig: { tools: {} },
        rawBackends: {
          search: {
            provider: 'searxng' as const,
            baseUrl: 'http://localhost:8080',
            baseUrls: { 'google-serp': 'https://google.example/search', 'searxng': 'http://preserved' }
          }
        }
      },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: {
        search: {
          provider: 'searxng' as const,
          baseUrl: 'http://localhost:8080',
          baseUrls: { 'google-serp': 'https://google.example/search', 'searxng': 'http://preserved' }
        },
        fetch: { provider: 'http' as const },
        headless: { provider: 'local-browser' as const }
      }
    };

    const state = createSettingsDraftState(loaded, 'project');
    const switched = applySettingsValue(state, 'backend:search:provider', 'google-serp');

    expect(switched.backends.search.provider).toBe('google-serp');
    // baseUrl is dropped but baseUrls is left untouched
    expect(switched.backends.search.baseUrl).toBeUndefined();
    expect(switched.backends.search.baseUrls).toEqual({ 'searxng': 'http://preserved', 'google-serp': 'https://google.example/search' });
  });
  it('settings edits affect endpoint resolver when switching between providers', async () => {
    // Start with SearXNG at URL1
    const loaded = {
      global: { path: '/global/config.json', exists: false },
      project: {
        path: '/project/config.json',
        exists: true,
        rawConfig: { tools: {} },
        rawBackends: {
          search: { provider: 'searxng' as const, baseUrl: 'https://searx.invalid/sub/' }
        }
      },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: {
        search: { provider: 'searxng' as const, baseUrl: 'https://searx.invalid/sub/' },
        fetch: { provider: 'http' as const },
        headless: { provider: 'local-browser' as const }
      }
    };

    let state = createSettingsDraftState(loaded, 'project');

    // Switch to Google SERP
    state = applySettingsValue(state, 'backend:search:provider', 'google-serp');
    expect(state.backends.search.baseUrl).toBeUndefined();

    // Set Google SERP endpoint to URL2
    state = applySettingsValue(state, 'backend:search:baseUrl', 'https://serp.invalid/search');
    expect(state.backends.search.baseUrl).toBe('https://serp.invalid/search');

    // Switch back to SearXNG
    state = applySettingsValue(state, 'backend:search:provider', 'searxng');
    expect(state.backends.search.provider).toBe('searxng');
    // baseUrl is not restored; user must re-enter it
    expect(state.backends.search.baseUrl).toBeUndefined();

    // Set SearXNG endpoint to URL3
    state = applySettingsValue(state, 'backend:search:baseUrl', 'https://searx-new.invalid/sub/');
    expect(state.backends.search.baseUrl).toBe('https://searx-new.invalid/sub/');

    // Verify request goes to the new URL (URL3)
    const requests: Array<{ url: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      requests.push({ url });
      return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    try {
      const backends = createBackendSet(state.backends, {
        networkGuard: createNetworkGuard({}, { lookup: async () => [{ address: '127.0.0.1', family: 4 }] }),
        createGuardProxy: vi.fn(async () => {
          throw new Error('tests must not start a real guard proxy');
        }),
        policy: { sleep: async () => undefined, random: () => 0 }
      });

      const result = await backends.search({ query: 'test' });
      await backends.close();

      // Request should go to URL3, not the old URL1
      expect(requests.some((r) => r.url.startsWith('https://searx-new.invalid/'))).toBe(true);
      expect(requests.some((r) => r.url.startsWith('https://searx.invalid/sub/'))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not move whitespace-only baseUrl when switching providers', () => {
    const loaded = {
      global: { path: '/global/config.json', exists: false },
      project: {
        path: '/project/config.json',
        exists: true,
        rawConfig: { tools: {} },
        rawBackends: {
          search: { provider: 'searxng' as const, baseUrl: '   ' }
        }
      },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: {
        search: {
          provider: 'searxng' as const,
          baseUrl: '   '
        },
        fetch: { provider: 'http' as const },
        headless: { provider: 'local-browser' as const }
      }
    };

    const state = createSettingsDraftState(loaded, 'project');
    const switched = applySettingsValue(state, 'backend:search:provider', 'google-serp');

    expect(switched.backends.search.provider).toBe('google-serp');
    expect(switched.backends.search.baseUrls).toBeUndefined();
  });
});

describe('settings endpoints after switching providers', () => {
  const theme = new Proxy({}, { get: () => (...args: unknown[]) => args[args.length - 1] });
  type Search = { provider: 'searxng' | 'google-serp'; baseUrl?: string };

  function draftFor(search: Search) {
    const backends = { search, fetch: { provider: 'http' as const }, headless: { provider: 'local-browser' as const } };
    return createSettingsDraftState(
      {
        global: { path: '/global/config.json', exists: false },
        project: { path: '/project/config.json', exists: true, rawConfig: { tools: {} }, rawBackends: { search } },
        effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
        effectiveBackends: backends
      } as never,
      'project'
    );
  }

  function endpointRow(state: ReturnType<typeof draftFor>) {
    return buildBackendSettingsItems('project', state.backends, theme).find((item) => item.id === 'backend:search:baseUrl')?.currentValue;
  }

  // Save the draft, then load it back the way the extension does.
  function saveAndReload(state: ReturnType<typeof draftFor>) {
    const saved = JSON.parse(JSON.stringify(collapseBackendConfigToOverride(state.backends, DEFAULT_BACKEND_CONFIG)));
    return mergeBackendConfigLayers(DEFAULT_BACKEND_CONFIG, extractBackendConfigOverride({ backends: saved }));
  }

  async function searchRequests(config: ReturnType<typeof saveAndReload>) {
    const requests: Array<{ url: string; headers: Headers }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      requests.push({ url, headers: new Headers(init?.headers) });
      const body = url.includes('serp') ? { organic: [] } : { results: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    vi.stubEnv('PI_WEB_AGENT_GOOGLE_SERP_API_KEY', 'google-secret');
    try {
      const backends = createBackendSet(config, {
        networkGuard: createNetworkGuard({}, { lookup: async () => [{ address: '93.184.216.34', family: 4 }] }),
        createGuardProxy: vi.fn(async () => {
          throw new Error('tests must not start a real guard proxy');
        }),
        policy: { sleep: async () => undefined, random: () => 0 }
      });
      await backends.search({ query: 'q' });
      await backends.close();
      return requests;
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  }

  const cases = [
    { a: 'searxng' as const, b: 'google-serp' as const, url1: 'https://searx-one.invalid/sub/', url2: 'https://serp-two.invalid/search', url3: 'https://searx-three.invalid/sub/' },
    { a: 'google-serp' as const, b: 'searxng' as const, url1: 'https://serp-one.invalid/search', url2: 'https://searx-two.invalid/sub/', url3: 'https://serp-three.invalid/search' }
  ];

  for (const { a, b, url1, url2, url3 } of cases) {
    it(`uses the endpoint you just entered after switching ${a} -> ${b} -> ${a}`, async () => {
      let state = draftFor({ provider: a, baseUrl: url1 });
      state = applySettingsValue(state, 'backend:search:provider', b);
      state = applySettingsValue(state, 'backend:search:baseUrl', url2);
      state = applySettingsValue(state, 'backend:search:provider', a);
      expect(endpointRow(state)).toBe('not set');

      state = applySettingsValue(state, 'backend:search:baseUrl', url3);
      expect(endpointRow(state)).toBe(url3);

      const requests = await searchRequests(saveAndReload(state));
      expect(requests.some((request) => request.url.startsWith(url3))).toBe(true);
      expect(requests.filter((request) => request.url.startsWith(url1))).toEqual([]);
      // The google key only ever goes to a google endpoint.
      for (const request of requests.filter((r) => r.headers.get('x-api-key'))) {
        expect(request.url.includes('serp')).toBe(true);
      }
    });

    it(`clearing the endpoint after switching ${a} -> ${b} -> ${a} really clears it`, async () => {
      let state = draftFor({ provider: a, baseUrl: url1 });
      state = applySettingsValue(state, 'backend:search:provider', b);
      state = applySettingsValue(state, 'backend:search:provider', a);
      state = applySettingsValue(state, 'backend:search:baseUrl', '');
      expect(endpointRow(state)).toBe('not set');

      const requests = await searchRequests(saveAndReload(state));
      expect(requests.filter((request) => request.url.startsWith(url1))).toEqual([]);
    });
  }

  for (const provider of ['searxng' as const, 'google-serp' as const]) {
    it(`the endpoint row and the actual request agree with a global endpoint (${provider})`, async () => {
      const globalUrl = `https://global-${provider}.invalid/x`;
      const globalBackends = {
        search: { baseUrls: { [provider]: globalUrl } },
        fetch: { provider: 'http' as const },
        headless: { provider: 'local-browser' as const }
      };
      const projectBackends = { search: { provider } };
      const loaded = {
        global: {
          path: '/global/config.json',
          exists: true,
          rawConfig: { tools: {} },
          rawBackends: globalBackends
        },
        project: {
          path: '/project/config.json',
          exists: true,
          rawConfig: { tools: {} },
          rawBackends: projectBackends
        },
        effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
        effectiveBackends: mergeBackendConfigLayers(
          DEFAULT_BACKEND_CONFIG,
          extractBackendConfigOverride({ backends: globalBackends }),
          extractBackendConfigOverride({ backends: projectBackends })
        )
      } as never;

      const state = createSettingsDraftState(loaded, 'project');
      expect(endpointRow(state)).toBe(globalUrl);

      const requests = await searchRequests(saveAndReload(state));
      expect(requests.some((request) => request.url.startsWith(globalUrl))).toBe(true);
    });
  }

  it('the proxy row never shows credentials from a url that cannot be parsed', () => {
    for (const url of ['http://u:secretpw@[broken', 'http://u:secret/pw@[broken', 'http://u:secret?pw@[broken']) {
      const state = draftFor({ provider: 'searxng', baseUrl: 'https://searx.invalid/' });
      const row = buildBackendSettingsItems('project', { ...state.backends, proxy: { url } }, theme).find((item) => item.id === 'backend:proxy:url');
      expect(row?.currentValue).toBe('(invalid URL)');
      expect(String(row?.currentValue)).not.toContain('secret');
    }
  });

  it('doctor and show never print credentials from a broken proxy url, even with / or ? in the password', async () => {
    for (const url of ['http://u:secret/pw@[broken', 'http://u:secret?pw@[broken']) {
      let handler: any;
      registerWebAgentConfigCommands({ registerCommand: vi.fn((_name: string, command: any) => { handler = command.handler; }) } as never, {
        load: vi.fn().mockResolvedValue({
          global: { path: '/global/config.json', exists: true, rawConfig: { tools: {} } },
          project: { path: '/project/config.json', exists: false },
          effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
          effectiveBackends: { search: { provider: 'duckduckgo' }, fetch: { provider: 'http' }, headless: { provider: 'local-browser' }, proxy: { url } }
        }),
        resolveBrowser: vi.fn().mockResolvedValue({ ok: true, executablePath: '/usr/bin/chromium', browser: 'chromium' }),
        runtime: { nodeVersion: 'v24.0.0', platform: 'linux', arch: 'x64' },
        checkTypebox: vi.fn().mockResolvedValue(true),
        checkBackends: vi.fn().mockResolvedValue([]),
        checkJitiCompat: vi.fn().mockReturnValue({ pending: [], patched: [] }),
        checkRepoResearch: vi.fn().mockResolvedValue('repo research: ok'),
        reset: vi.fn()
      } as never);
      const notify = vi.fn();
      await handler('doctor', { ui: { notify } });
      await handler('show', { ui: { notify } });
      for (const [text] of notify.mock.calls) expect(String(text)).not.toContain('secret');
    }
  });
});
