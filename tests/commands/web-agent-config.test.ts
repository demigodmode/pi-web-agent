import { describe, expect, it, vi } from 'vitest';
import { registerWebAgentConfigCommands } from '../../src/commands/web-agent-config.js';

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
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Reset project config'), 'success');
  });
});
