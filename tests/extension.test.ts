import { describe, expect, it, vi } from 'vitest';
import extension from '../src/extension.js';

describe('Pi extension entrypoint', () => {
  it('registers three tools with Pi', () => {
    const registerTool = vi.fn();
    const pi = { registerTool };

    extension(pi as never);

    expect(registerTool).toHaveBeenCalledTimes(3);
    expect(registerTool.mock.calls.map((call) => call[0].name)).toEqual([
      'web_search',
      'web_fetch',
      'web_fetch_headless'
    ]);
  });
});
