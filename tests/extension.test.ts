import { describe, expect, it, vi } from 'vitest';
import extension from '../src/extension.js';

describe('Pi extension entrypoint', () => {
  it('registers four tools with Pi', () => {
    const registerTool = vi.fn();
    const pi = { registerTool, on: vi.fn() };

    extension(pi as never);

    expect(registerTool).toHaveBeenCalledTimes(4);
    expect(registerTool.mock.calls.map((call) => call[0].name)).toEqual([
      'web_search',
      'web_fetch',
      'web_fetch_headless',
      'web_explore'
    ]);
  });

  it('describes web_explore as the preferred tool for research-style web questions', () => {
    const registerTool = vi.fn();
    const pi = { registerTool, on: vi.fn() };

    extension(pi as never);

    const tools = registerTool.mock.calls.map((call) => call[0]);
    const webExplore = tools.find((tool) => tool.name === 'web_explore');

    expect(webExplore).toBeDefined();
    expect(webExplore.description).toContain('Prefer this for multi-source web research');
    expect(webExplore.description).toContain('current docs/discussion lookups');
    expect(webExplore.description).toContain('Use this instead of chaining low-level web tools');
    expect(webExplore.parameters.properties).toHaveProperty('query');
    expect(Object.keys(webExplore.parameters.properties)).toEqual(['query']);
  });

  it('describes low-level tools as direct/manual tools and points research prompts to web_explore', () => {
    const registerTool = vi.fn();
    const pi = { registerTool, on: vi.fn() };

    extension(pi as never);

    const tools = registerTool.mock.calls.map((call) => call[0]);
    const webSearch = tools.find((tool) => tool.name === 'web_search');
    const webFetch = tools.find((tool) => tool.name === 'web_fetch');
    const webFetchHeadless = tools.find((tool) => tool.name === 'web_fetch_headless');

    expect(webSearch.description).toContain('Direct search tool for manual discovery');
    expect(webSearch.description).toContain('Prefer web_explore for broader research questions');

    expect(webFetch.description).toContain('Direct HTTP page fetch for a specific URL');
    expect(webFetch.description).toContain('Prefer web_explore for broader research across multiple sources');

    expect(webFetchHeadless.description).toContain('Direct headless page fetch for a specific URL');
    expect(webFetchHeadless.description).toContain('Prefer web_explore for research tasks');
  });

  it('adds a short research hint that prefers web_explore for multi-source web questions', async () => {
    const handlers = new Map<string, Function>();
    const pi = {
      registerTool: vi.fn(),
      on: vi.fn((eventName: string, handler: Function) => {
        handlers.set(eventName, handler);
      })
    };

    extension(pi as never);

    const beforeAgentStart = handlers.get('before_agent_start');
    expect(beforeAgentStart).toBeDefined();

    const result = await beforeAgentStart!(
      {
        prompt:
          'Find current docs or discussions about Playwright launching an installed Chrome or Edge executable instead of a bundled browser, then summarize the recommended approach.',
        images: [],
        systemPrompt: 'Base system prompt'
      },
      {}
    );

    expect(result.systemPrompt).toContain('prefer web_explore');
    expect(result.systemPrompt).toContain('finding and comparing multiple sources');
    expect(result.systemPrompt).toContain(
      'Use web_search, web_fetch, and web_fetch_headless for direct/manual operations'
    );
    expect(result.systemPrompt).toContain('After using web_explore, only call low-level web tools if there is a specific unresolved gap');
    expect(result.systemPrompt).toContain('Do not keep searching or fetching just for extra confirmation');
  });

  it('adds a post-web_explore context hint for later turns in the same prompt', async () => {
    const handlers = new Map<string, Function>();
    const pi = {
      registerTool: vi.fn(),
      on: vi.fn((eventName: string, handler: Function) => {
        handlers.set(eventName, handler);
      })
    };

    extension(pi as never);

    const beforeAgentStart = handlers.get('before_agent_start');
    const toolExecutionEnd = handlers.get('tool_execution_end');
    const context = handlers.get('context');

    expect(beforeAgentStart).toBeDefined();
    expect(toolExecutionEnd).toBeDefined();
    expect(context).toBeDefined();

    await beforeAgentStart!(
      {
        prompt: 'Research something on the web',
        images: [],
        systemPrompt: 'Base system prompt'
      },
      {}
    );

    await toolExecutionEnd!(
      {
        toolName: 'web_explore',
        result: { details: { status: 'ok' } },
        isError: false
      },
      {}
    );

    const result = await context!(
      {
        messages: [{ role: 'user', content: 'Original research prompt' }]
      },
      {}
    );

    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].content).toContain('web_explore has already been used for this research task');
    expect(result.messages[1].content).toContain('specific unresolved gap');
    expect(result.messages[1].content).toContain('Do not keep searching or fetching just for extra confirmation');
  });

  it('returns human-readable content for web_explore instead of only raw json', async () => {
    const tools: any[] = [];
    const pi = {
      registerTool: (tool: any) => tools.push(tool),
      on: vi.fn()
    };

    extension(pi as never);

    const webExplore = tools.find((tool) => tool.name === 'web_explore');
    const result = await webExplore.execute('tool-call-1', {
      query: 'example query'
    });

    expect(result.content[0].text).toContain('Findings');
    expect(result.content[0].text).toContain('Sources');
  }, 15000);
});
