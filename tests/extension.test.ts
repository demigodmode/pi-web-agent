import { describe, expect, it, vi } from 'vitest';
import extension from '../src/extension.js';

describe('Pi extension entrypoint', () => {
  it('reuses the configured web_explore workflow while backend config is unchanged', async () => {
    vi.resetModules();
    const createResearchWorkflow = vi.fn().mockReturnValue({
      run: vi.fn().mockResolvedValue({
        decision: { action: 'answer' },
        evidence: [],
        workerPass: {},
        metadata: { searchPasses: 0, fetchedPages: 0, headlessAttempts: 0, exhaustedBudget: false }
      })
    });
    vi.doMock('../src/orchestration/index.js', () => ({ createResearchWorkflow }));

    const { default: dynamicExtension } = await import('../src/extension.js');
    const tools: any[] = [];
    const pi = {
      registerTool: (tool: any) => tools.push(tool),
      registerCommand: vi.fn(),
      on: vi.fn(),
      __presentationConfigStore: {
        load: vi.fn().mockResolvedValue({
          effectiveConfig: { defaultMode: 'compact', tools: {} },
          effectiveBackends: {
            search: { provider: 'duckduckgo' },
            fetch: { provider: 'http' },
            headless: { provider: 'local-browser' }
          }
        })
      }
    };

    dynamicExtension(pi as never);
    const webExplore = tools.find((tool) => tool.name === 'web_explore');
    await webExplore.execute('tool-call-1', { query: 'example' });
    await webExplore.execute('tool-call-2', { query: 'example again' });

    expect(createResearchWorkflow).toHaveBeenCalledTimes(1);
  });

  it('passes configured backends into the default web_explore workflow', async () => {
    vi.resetModules();
    const createResearchWorkflow = vi.fn().mockReturnValue({
      run: vi.fn().mockResolvedValue({
        decision: { action: 'answer' },
        evidence: [],
        workerPass: {},
        metadata: { searchPasses: 0, fetchedPages: 0, headlessAttempts: 0, exhaustedBudget: false }
      })
    });
    vi.doMock('../src/orchestration/index.js', () => ({ createResearchWorkflow }));

    const { default: dynamicExtension } = await import('../src/extension.js');
    const tools: any[] = [];
    const pi = {
      registerTool: (tool: any) => tools.push(tool),
      registerCommand: vi.fn(),
      on: vi.fn(),
      __presentationConfigStore: {
        load: vi.fn().mockResolvedValue({
          effectiveConfig: { defaultMode: 'compact', tools: {} },
          effectiveBackends: {
            search: { provider: 'searxng', baseUrl: 'http://localhost:8080' },
            fetch: { provider: 'firecrawl', baseUrl: 'http://localhost:3002' },
            headless: { provider: 'local-browser' }
          }
        })
      }
    };

    dynamicExtension(pi as never);
    await tools.find((tool) => tool.name === 'web_explore').execute('tool-call-1', { query: 'example' });

    expect(createResearchWorkflow).toHaveBeenCalledWith({
      backendConfig: {
        search: { provider: 'searxng', baseUrl: 'http://localhost:8080' },
        fetch: { provider: 'firecrawl', baseUrl: 'http://localhost:3002' },
        headless: { provider: 'local-browser' }
      }
    });
  });

  it('shows update changelog notice on session start when available', async () => {
    vi.resetModules();
    const getUpdateChangelogNotice = vi.fn().mockResolvedValue('## [1.0.0]\n- Breaking change.');
    vi.doMock('../src/changelog-notice.js', () => ({ getUpdateChangelogNotice, getLatestChangelogEntry: vi.fn() }));

    const { default: dynamicExtension } = await import('../src/extension.js');
    const handlers = new Map<string, Function>();
    const notify = vi.fn();
    const pi = {
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      on: vi.fn((eventName: string, handler: Function) => {
        handlers.set(eventName, handler);
      })
    };

    dynamicExtension(pi as never);
    await handlers.get('session_start')?.({ reason: 'startup' }, { ui: { notify } });

    expect(notify).toHaveBeenCalledWith(expect.stringContaining('pi-web-agent updated'), 'info');
    expect(notify.mock.calls[0][0]).toContain('Breaking change.');
  });

  it('does not fail startup when changelog notice loading fails', async () => {
    vi.resetModules();
    vi.doMock('../src/changelog-notice.js', () => ({
      getUpdateChangelogNotice: vi.fn().mockRejectedValue(new Error('missing changelog')),
      getLatestChangelogEntry: vi.fn()
    }));

    const { default: dynamicExtension } = await import('../src/extension.js');
    const handlers = new Map<string, Function>();
    const notify = vi.fn();
    const pi = {
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      on: vi.fn((eventName: string, handler: Function) => {
        handlers.set(eventName, handler);
      })
    };

    dynamicExtension(pi as never);
    await expect(handlers.get('session_start')?.({ reason: 'startup' }, { ui: { notify } })).resolves.toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });

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

  it('sends the findings to the model as content while the terminal display stays compact', async () => {
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

    // The model receives the actual findings, not the compact count line.
    expect(result.content[0].text).toContain('A concise finding.');
    expect(result.content[0].text).not.toContain('Reviewed');
    // The compact terminal view is carried separately for the renderer.
    expect(result.details.terminalText).toBe('Reviewed 1 sources · synthesized answer with 1 findings');
    // renderResult (terminal) shows the compact view, not the full findings.
    const rendered = webExplore
      .renderResult(result, { expanded: false, isPartial: false }, {}, {})
      .render(80)
      .join('\n');
    expect(rendered).toContain('Reviewed 1 sources');
    expect(rendered).not.toContain('A concise finding.');
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

    // Model still gets the findings; the compact display falls back to default mode.
    expect(result.content[0].text).toContain('A concise finding.');
    expect(result.details.terminalText).toContain('Reviewed');
  }, 15000);

  const answer = {
    decision: { action: 'answer' },
    evidence: [],
    workerPass: {},
    metadata: { searchPasses: 0, fetchedPages: 0, headlessAttempts: 0, exhaustedBudget: false }
  };

  function configStore(getBackends: () => unknown) {
    return {
      load: vi.fn(async () => ({
        effectiveConfig: { defaultMode: 'compact', tools: {} },
        effectiveBackends: getBackends()
      }))
    };
  }

  it('closes a replaced workflow only after its in-flight run finishes', async () => {
    vi.resetModules();
    let releaseRun!: () => void;
    const first = {
      run: vi.fn(() => new Promise((resolve) => (releaseRun = () => resolve(answer)))),
      close: vi.fn(async () => undefined)
    };
    const second = { run: vi.fn().mockResolvedValue(answer), close: vi.fn(async () => undefined) };
    const createResearchWorkflow = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    vi.doMock('../src/orchestration/index.js', () => ({ createResearchWorkflow }));
    const { default: dynamicExtension } = await import('../src/extension.js');

    const configs = [
      { search: { provider: 'duckduckgo' }, fetch: { provider: 'http' }, headless: { provider: 'local-browser' } },
      { search: { provider: 'brave' }, fetch: { provider: 'http' }, headless: { provider: 'local-browser' } }
    ];
    let current = 0;
    const tools: any[] = [];
    const pi = {
      registerTool: (tool: any) => tools.push(tool),
      registerCommand: vi.fn(),
      on: vi.fn(),
      __presentationConfigStore: configStore(() => configs[current])
    };

    dynamicExtension(pi as never);
    const webExplore = tools.find((tool) => tool.name === 'web_explore');

    const inFlight = webExplore.execute('call-1', { query: 'first' });
    await vi.waitFor(() => expect(first.run).toHaveBeenCalled());
    current = 1;
    await webExplore.execute('call-2', { query: 'second' });

    expect(first.close).not.toHaveBeenCalled();
    releaseRun();
    await inFlight;
    await vi.waitFor(() => expect(first.close).toHaveBeenCalledTimes(1));
    expect(second.close).not.toHaveBeenCalled();
  });

  it('closes the current workflow on session shutdown', async () => {
    vi.resetModules();
    const workflow = { run: vi.fn().mockResolvedValue(answer), close: vi.fn(async () => undefined) };
    vi.doMock('../src/orchestration/index.js', () => ({ createResearchWorkflow: vi.fn(() => workflow) }));
    const { default: dynamicExtension } = await import('../src/extension.js');

    const handlers: Record<string, (event: unknown) => unknown> = {};
    const tools: any[] = [];
    const pi = {
      registerTool: (tool: any) => tools.push(tool),
      registerCommand: vi.fn(),
      on: vi.fn((event: string, handler: (event: unknown) => unknown) => {
        handlers[event] = handler;
      }),
      __presentationConfigStore: configStore(() => ({
        search: { provider: 'duckduckgo' },
        fetch: { provider: 'http' },
        headless: { provider: 'local-browser' }
      }))
    };

    dynamicExtension(pi as never);
    await tools.find((tool) => tool.name === 'web_explore').execute('call-1', { query: 'x' });
    await handlers.session_shutdown({ type: 'session_shutdown', reason: 'quit' });

    await vi.waitFor(() => expect(workflow.close).toHaveBeenCalledTimes(1));
  });
});
