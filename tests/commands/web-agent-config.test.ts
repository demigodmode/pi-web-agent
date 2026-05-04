import { describe, expect, it, vi } from 'vitest';
import {
  applySettingsValue,
  collapsePresentationConfigToOverride,
  createSettingsDraftState,
  handleSettingsShortcut,
  registerWebAgentConfigCommands
} from '../../src/commands/web-agent-config.js';
import { DEFAULT_PRESENTATION_CONFIG, mergePresentationConfigLayers } from '../../src/presentation/config.js';
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
      )
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
      checkTypebox: vi.fn().mockResolvedValue(true)
    });

    const notify = vi.fn();
    await handler('doctor', { ui: { notify } });

    expect(notify).toHaveBeenCalledWith(expect.stringContaining('pi-web-agent: loaded'), 'info');
    expect(notify.mock.calls[0][0]).toContain('runtime: node v24.0.0 linux x64');
    expect(notify.mock.calls[0][0]).toContain('typebox: ok');
    expect(notify.mock.calls[0][0]).toContain('browser: chromium /usr/bin/chromium');
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
        }
      }),
      reset: vi.fn()
    });

    const notify = vi.fn();
    await handler('show', { ui: { notify } });

    expect(notify).toHaveBeenCalledWith(expect.stringContaining('defaultMode: preview'), 'info');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('web_explore: verbose'), 'info');
    expect(notify.mock.calls[0][0]).not.toContain('web_search:');
    expect(notify.mock.calls[0][0]).not.toContain('web_fetch:');
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
      .mockResolvedValueOnce({
        scope: 'project',
        config: {
          defaultMode: 'preview',
          tools: { web_explore: { mode: 'verbose' } }
        },
        action: 'save'
      });

    await handler('', { ui: { custom, notify: vi.fn() } });

    expect(custom).toHaveBeenCalledTimes(2);
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

    const custom = vi.fn().mockResolvedValue({
      scope: 'project',
      config: {
        defaultMode: 'preview',
        tools: { web_explore: { mode: 'verbose' } }
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
