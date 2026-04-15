import { describe, expect, it, vi } from 'vitest';
import extension from '../src/extension.js';

describe('Pi extension entrypoint', () => {
  it('registers four tools with Pi', () => {
    const registerTool = vi.fn();
    const pi = { registerTool };

    extension(pi as never);

    expect(registerTool).toHaveBeenCalledTimes(4);
    expect(registerTool.mock.calls.map((call) => call[0].name)).toEqual([
      'web_search',
      'web_fetch',
      'web_fetch_headless',
      'web_explore'
    ]);
  });

  it('registers web_explore with a simple query-only schema', () => {
    const registerTool = vi.fn();
    const pi = { registerTool };

    extension(pi as never);

    const webExplore = registerTool.mock.calls
      .map((call) => call[0])
      .find((tool) => tool.name === 'web_explore');

    expect(webExplore).toBeDefined();
    expect(webExplore.description).toContain('Research a web question');
    expect(webExplore.parameters.properties).toHaveProperty('query');
    expect(Object.keys(webExplore.parameters.properties)).toEqual(['query']);
  });

  it('returns human-readable content for web_explore instead of only raw json', async () => {
    const tools: any[] = [];
    const pi = {
      registerTool: (tool: any) => tools.push(tool)
    };

    extension(pi as never);

    const webExplore = tools.find((tool) => tool.name === 'web_explore');
    const result = await webExplore.execute('tool-call-1', {
      query: 'example query'
    });

    expect(result.content[0].text).toContain('Findings');
    expect(result.content[0].text).toContain('Sources');
  });
});
