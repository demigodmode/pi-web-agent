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

  it('does not register a context hook that injects reminder text into the visible session', () => {
    const handlers = new Map<string, Function>();
    const pi = {
      registerTool: vi.fn(),
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
      on: vi.fn()
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

  it('returns compact output for web_search by default instead of raw json', async () => {
    const tools: any[] = [];
    const pi = {
      registerTool: (tool: any) => tools.push(tool),
      on: vi.fn()
    };

    extension(pi as never);

    const webSearch = tools.find((tool) => tool.name === 'web_search');
    const result = await webSearch.execute('tool-call-1', { query: 'plain search' });

    expect(result.content[0].text).toContain('Found');
    expect(result.content[0].text).not.toContain('{\n');
  }, 15000);

  it('can render preview mode when web_search is configured for preview', async () => {
    const tools: any[] = [];
    const pi = {
      registerTool: (tool: any) => tools.push(tool),
      on: vi.fn(),
      getConfig: () => ({
        presentation: {
          defaultMode: 'compact',
          tools: { web_search: { mode: 'preview' } }
        }
      })
    };

    extension(pi as never);

    const webSearch = tools.find((tool) => tool.name === 'web_search');
    const result = await webSearch.execute('tool-call-1', { query: 'plain search' });

    expect(result.content[0].text).toContain('1.');
    expect(result.content[0].text).not.toContain('Found 1 result');
  }, 15000);

  it('blocks low-level web_search after a successful web_explore in the same tool flow', async () => {
    const tools: any[] = [];
    const pi = {
      registerTool: (tool: any) => tools.push(tool),
      on: vi.fn()
    };

    extension(pi as never);

    const webExplore = tools.find((tool) => tool.name === 'web_explore');
    const webSearch = tools.find((tool) => tool.name === 'web_search');

    await webExplore.execute('tool-call-1', { query: 'example query' });
    const result = await webSearch.execute('tool-call-2', { query: 'follow-up search' });

    expect(result.isError).toBe(true);
    expect(result.details).toMatchObject({
      status: 'error',
      error: {
        code: 'POST_WEB_EXPLORE_GUARD',
        message:
          'web_explore already ran for this research task. Only use low-level web tools if there is a specific unresolved gap.'
      }
    });
  }, 15000);

  it('still allows low-level tools before web_explore runs', async () => {
    const tools: any[] = [];
    const pi = {
      registerTool: (tool: any) => tools.push(tool),
      on: vi.fn()
    };

    extension(pi as never);

    const webSearch = tools.find((tool) => tool.name === 'web_search');
    const result = await webSearch.execute('tool-call-1', { query: 'plain search' });

    expect(result.details.status).not.toBe('error');
    expect(result.details.error?.code).not.toBe('POST_WEB_EXPLORE_GUARD');
  }, 15000);
});
