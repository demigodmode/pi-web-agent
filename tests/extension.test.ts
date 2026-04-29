import { describe, expect, it, vi } from 'vitest';
import extension from '../src/extension.js';

describe('Pi extension entrypoint', () => {
  it('registers the web-agent config commands', () => {
    const pi = {
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      on: vi.fn()
    };

    extension(pi as never);

    expect(pi.registerCommand).toHaveBeenCalledWith(
      'web-agent',
      expect.objectContaining({ description: expect.stringContaining('settings') })
    );
  });

  it('registers only web_explore as a public Pi tool', () => {
    const registerTool = vi.fn();
    const pi = { registerTool, registerCommand: vi.fn(), on: vi.fn() };

    extension(pi as never);

    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(registerTool.mock.calls.map((call) => call[0].name)).toEqual(['web_explore']);
  });

  it('describes web_explore as the public research entrypoint', () => {
    const registerTool = vi.fn();
    const pi = { registerTool, registerCommand: vi.fn(), on: vi.fn() };

    extension(pi as never);

    const webExplore = registerTool.mock.calls.map((call) => call[0]).find((tool) => tool.name === 'web_explore');

    expect(webExplore).toBeDefined();
    expect(webExplore.description).toContain('Research a web question');
    expect(webExplore.description).toContain('bounded search/fetch passes');
    expect(webExplore.parameters.properties).toHaveProperty('query');
    expect(Object.keys(webExplore.parameters.properties)).toEqual(['query']);
  });

  it('adds a short research hint that web_explore handles research internally', async () => {
    const handlers = new Map<string, Function>();
    const pi = {
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      on: vi.fn((eventName: string, handler: Function) => {
        handlers.set(eventName, handler);
      })
    };

    extension(pi as never);

    const beforeAgentStart = handlers.get('before_agent_start');
    expect(beforeAgentStart).toBeDefined();

    const result = await beforeAgentStart!(
      {
        prompt: 'Find current Vitest coverage docs and summarize V8 setup.',
        images: [],
        systemPrompt: 'Base system prompt'
      },
      {}
    );

    expect(result.systemPrompt).toContain('use web_explore');
    expect(result.systemPrompt).toContain('handles search, fetch, source ranking, and headless escalation internally');
    expect(result.systemPrompt).toContain('call web_explore again with a narrower query');
    expect(result.systemPrompt).toContain('do not use shell/network commands');
  });

  it('does not register a context hook that injects reminder text into the visible session', () => {
    const handlers = new Map<string, Function>();
    const pi = {
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      on: vi.fn((eventName: string, handler: Function) => {
        handlers.set(eventName, handler);
      })
    };

    extension(pi as never);

    expect(handlers.has('context')).toBe(false);
  });

  it('returns compact output for web_explore by default instead of the old text block', async () => {
    const tools: any[] = [];
    const pi = {
      registerTool: (tool: any) => tools.push(tool),
      registerCommand: vi.fn(),
      on: vi.fn(),
      __presentationConfigStore: {
        load: vi.fn().mockResolvedValue({ effectiveConfig: { defaultMode: 'compact', tools: {} } })
      },
      __webExploreTool: vi.fn().mockResolvedValue({
        status: 'ok',
        findings: ['A concise finding.'],
        sources: [{ title: 'Source', url: 'https://example.com', method: 'http' }],
        presentation: {
          mode: 'compact',
          views: {
            compact: 'Reviewed 1 sources · synthesized answer with 1 findings',
            verbose: 'Findings\n- A concise finding.'
          }
        }
      })
    };

    extension(pi as never);

    const webExplore = tools.find((tool) => tool.name === 'web_explore');
    const result = await webExplore.execute('tool-call-1', {
      query: 'example query'
    });

    expect(result.content[0].text).toContain('Reviewed');
    expect(result.content[0].text).not.toContain('Findings\n');
    expect(result.content[0].text).not.toContain('{\n');
  }, 15000);

  it('falls back to built-in defaults when the store cannot load config', async () => {
    const tools: any[] = [];
    const pi = {
      registerTool: (tool: any) => tools.push(tool),
      registerCommand: vi.fn(),
      on: vi.fn(),
      __presentationConfigStore: {
        load: vi.fn().mockRejectedValue(new Error('boom'))
      },
      __webExploreTool: vi.fn().mockResolvedValue({
        status: 'ok',
        findings: ['A concise finding.'],
        sources: [{ title: 'Source', url: 'https://example.com', method: 'http' }],
        presentation: {
          mode: 'compact',
          views: {
            compact: 'Reviewed 1 sources · synthesized answer with 1 findings'
          }
        }
      })
    };

    extension(pi as never);

    const webExplore = tools.find((tool) => tool.name === 'web_explore');
    const result = await webExplore.execute('tool-call-1', { query: 'plain search' });

    expect(result.content[0].text).toContain('Reviewed');
  }, 15000);
});
