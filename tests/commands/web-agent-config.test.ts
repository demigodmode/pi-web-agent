import { describe, expect, it, vi } from 'vitest';
import {
  applySettingsValue,
  collapsePresentationConfigToOverride,
  createSettingsDraftState,
  handleSettingsShortcut,
  registerWebAgentConfigCommands
} from '../../src/commands/web-agent-config.js';
import { DEFAULT_PRESENTATION_CONFIG, mergePresentationConfigLayers } from '../../src/presentation/config.js';

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
          tools: { web_search: { mode: 'compact' as const } }
        }
      },
      effectiveConfig: mergePresentationConfigLayers(
        DEFAULT_PRESENTATION_CONFIG,
        {
          defaultMode: 'preview',
          tools: { web_explore: { mode: 'verbose' } }
        },
        {
          tools: { web_search: { mode: 'compact' } }
        }
      )
    };

    const initialState = createSettingsDraftState(loaded, 'project');
    const switchedState = applySettingsValue(initialState, 'scope', 'global');

    expect(initialState.scope).toBe('project');
    expect(initialState.config).toEqual({
      defaultMode: 'preview',
      tools: { web_explore: { mode: 'verbose' }, web_search: { mode: 'compact' } }
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
          tools: { web_search: { mode: 'verbose' } }
        },
        {
          defaultMode: 'preview',
          tools: {}
        }
      )
    ).toEqual({
      tools: { web_search: { mode: 'verbose' } }
    });
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
          rawConfig: { defaultMode: 'preview', tools: { web_search: { mode: 'verbose' } } }
        },
        effectiveConfig: {
          defaultMode: 'preview',
          tools: { web_search: { mode: 'verbose' } }
        }
      }),
      reset: vi.fn()
    });

    const notify = vi.fn();
    await handler('show', { ui: { notify } });

    expect(notify).toHaveBeenCalledWith(expect.stringContaining('defaultMode: preview'), 'info');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('web_search: verbose'), 'info');
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

    const custom = vi.fn().mockResolvedValue({
      scope: 'project',
      config: {
        defaultMode: 'preview',
        tools: { web_search: { mode: 'verbose' } }
      },
      action: 'save'
    });

    await handler('settings', { ui: { custom, notify: vi.fn() } });

    expect(custom).toHaveBeenCalledOnce();
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
        effectiveConfig: { defaultMode: 'preview', tools: {} }
      }),
      save,
      reset: vi.fn()
    });

    await handler('settings', {
      ui: {
        custom: vi.fn().mockResolvedValue({
          action: 'save',
          scope: 'project',
          config: {
            defaultMode: 'preview',
            tools: { web_explore: { mode: 'verbose' } }
          }
        }),
        notify
      }
    });

    expect(save).toHaveBeenCalledWith('project', {
      tools: { web_explore: { mode: 'verbose' } }
    });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Saved project config'), 'info');
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

    await handler('mode web_search verbose', { ui: { notify: vi.fn() } });

    expect(save).toHaveBeenCalledWith('project', {
      tools: { web_search: { mode: 'verbose' } }
    });
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
          rawConfig: { defaultMode: 'compact', tools: { web_search: { mode: 'preview' } } }
        },
        effectiveConfig: {
          defaultMode: 'compact',
          tools: { web_search: { mode: 'preview' } }
        }
      }),
      save,
      reset: vi.fn()
    });

    await handler('mode web_search inherit', { ui: { notify: vi.fn() } });

    expect(save).toHaveBeenCalledWith('project', {
      tools: {}
    });
  });
});
