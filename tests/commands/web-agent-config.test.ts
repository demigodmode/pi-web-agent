import { describe, expect, it, vi } from 'vitest';
import {
  applySettingsValue,
  collapseBackendConfigToOverride,
  collapsePresentationConfigToOverride,
  createSettingsDraftState,
  handleSettingsShortcut,
  registerWebAgentConfigCommands,
  validateBackendUrl
} from '../../src/commands/web-agent-config.js';
import { DEFAULT_PRESENTATION_CONFIG, mergePresentationConfigLayers } from '../../src/presentation/config.js';
import { DEFAULT_BACKEND_CONFIG } from '../../src/backends/config.js';
import type { BrowserResolutionResult } from '../../src/fetch/browser-resolution.js';

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
    expect(applySettingsValue(state, 'backend:search:baseUrl', 'http://localhost:8080').backends.search.baseUrl).toBe('http://localhost:8080');
    expect(applySettingsValue(state, 'backend:fetch:baseUrl', 'http://localhost:3002').backends.fetch.baseUrl).toBe('http://localhost:3002');
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
      checkBackends: vi.fn().mockResolvedValue(['search backend: duckduckgo', 'fetch backend: http'])
    });

    const notify = vi.fn();
    await handler('doctor', { ui: { notify } });

    expect(notify).toHaveBeenCalledWith(expect.stringContaining('pi-web-agent: loaded'), 'info');
    expect(notify.mock.calls[0][0]).toContain('runtime: node v24.0.0 linux x64');
    expect(notify.mock.calls[0][0]).toContain('typebox: ok');
    expect(notify.mock.calls[0][0]).toContain('browser: chromium /usr/bin/chromium');
    expect(notify.mock.calls[0][0]).toContain('search: duckduckgo');
    expect(notify.mock.calls[0][0]).toContain('fetch: http');
    expect(notify.mock.calls[0][0]).toContain('headless: local-browser');
    expect(notify.mock.calls[0][0]).toContain('search backend: duckduckgo');
    expect(notify.mock.calls[0][0]).toContain('fetch backend: http');
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
      checkTypebox: vi.fn().mockResolvedValue(true)
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
      checkTypebox: vi.fn().mockResolvedValue(true)
    });

    const notify = vi.fn();
    await handler('doctor', { ui: { notify } });

    expect(notify.mock.calls[0][0]).toContain('browser: missing');
    expect(notify.mock.calls[0][0]).toContain('Install Chrome, Chromium, Edge, or Brave');
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
      checkTypebox: vi.fn().mockResolvedValue(true)
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
