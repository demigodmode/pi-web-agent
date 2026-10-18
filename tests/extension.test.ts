import { describe, expect, it, vi } from 'vitest';
import { Text } from '@earendil-works/pi-tui';
import extension from '../src/extension.js';
import { createWebExploreTool } from '../src/tools/web-explore.js';

describe('Pi extension entrypoint', () => {
  it('renders a call heading with active theme colors', () => {
    const registerTool = vi.fn();
    extension({ registerTool, registerCommand: vi.fn(), on: vi.fn() } as never);

    const webExplore = registerTool.mock.calls.map((call) => call[0]).find((tool) => tool.name === 'web_explore');
    const fg = vi.fn((_color: string, text: string) => text);
    const heading = webExplore.renderCall(
      { query: ' Vitest\ncoverage ' },
      { fg },
      { argsComplete: true }
    ) as Text;

    expect(heading.render(120).join('\n').trimEnd()).toBe('web_explore ("Vitest coverage")');
    expect(fg).toHaveBeenCalledWith('toolTitle', 'web_explore');
    expect(fg).toHaveBeenCalledWith('muted', ' ("Vitest coverage")');
  });

  it('renders a readable fallback call heading while arguments stream', () => {
    const registerTool = vi.fn();
    extension({ registerTool, registerCommand: vi.fn(), on: vi.fn() } as never);

    const webExplore = registerTool.mock.calls.map((call) => call[0]).find((tool) => tool.name === 'web_explore');
    const heading = webExplore.renderCall({}, { fg: (_color: string, text: string) => text }, { argsComplete: false }) as Text;

    expect(heading.render(120).join('\n').trimEnd()).toBe('web_explore (…)');
  });

  it('renders the same call heading without any live workflow state', () => {
    const registerTool = vi.fn();
    extension({ registerTool, registerCommand: vi.fn(), on: vi.fn() } as never);

    const webExplore = registerTool.mock.calls.map((call) => call[0]).find((tool) => tool.name === 'web_explore');
    const heading = webExplore.renderCall(
      { query: 'Review https://alice:secret@example.com/docs?token=secret now' },
      { fg: (_color: string, text: string) => text },
      { argsComplete: true, lastComponent: undefined }
    ) as Text;

    expect(heading.render(120).join('\n').trimEnd()).toBe('web_explore ("Review https://example.com/docs now")');
  });

  it('sends short progress updates through Pi without exposing evidence text', async () => {
    const updates = vi.fn();
    const injected = vi.fn(async ({ onProgress }: { onProgress?: (event: { phase: string; searches: number; fetches: number; headless: number }) => void }) => {
      onProgress?.({ phase: 'search', searches: 1, fetches: 0, headless: 0 });
      onProgress?.({ phase: 'fetch', searches: 1, fetches: 2, headless: 0 });
      return { status: 'ok' as const, findings: ['Secret extracted evidence'], sources: [] };
    });
    const tools: any[] = [];
    extension({ registerTool: (tool: any) => tools.push(tool), registerCommand: vi.fn(), on: vi.fn(), __webExploreTool: injected } as never);

    await tools[0].execute('call-1', { query: 'example' }, undefined, updates);

    expect(updates).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(updates.mock.calls)).toContain('Searching');
    expect(JSON.stringify(updates.mock.calls)).not.toContain('Secret extracted evidence');
  });

  it('keeps researching when the Pi progress callback throws', async () => {
    const injected = vi.fn(async ({ onProgress }: { onProgress?: (event: { phase: string; searches: number; fetches: number; headless: number }) => void }) => {
      onProgress?.({ phase: 'search', searches: 1, fetches: 0, headless: 0 });
      return { status: 'ok' as const, findings: [], sources: [] };
    });
    const tools: any[] = [];
    extension({ registerTool: (tool: any) => tools.push(tool), registerCommand: vi.fn(), on: vi.fn(), __webExploreTool: injected } as never);

    await expect(tools[0].execute('call-1', { query: 'example' }, undefined, () => { throw new Error('display gone'); })).resolves.toMatchObject({ isError: false });
  });
  it('shows the complete prompt once through the normal web_explore tool path', async () => {
    const updates = vi.fn();
    const tools: any[] = [];
    const webExplore = createWebExploreTool({
      explore: vi.fn().mockResolvedValue({ decision: { action: 'answer' }, evidence: [], workerPass: {} })
    });
    extension({ registerTool: (tool: any) => tools.push(tool), registerCommand: vi.fn(), on: vi.fn(), __webExploreTool: webExplore } as never);

    await tools[0].execute('call-1', { query: 'example' }, undefined, updates);

    expect(updates.mock.calls.map(([update]) => update.content[0].text).filter((text: string) => text === 'Research complete.')).toHaveLength(1);
  });
  it('coalesces repeated live activity and ignores worker updates after caller cancellation', async () => {
    let emit: ((event: { phase: 'search'; state: 'started'; target: string; searches: number; fetches: number; headless: number }) => void) | undefined;
    const injected = vi.fn(({ onProgress, signal }: { onProgress?: typeof emit; signal?: AbortSignal }) => new Promise<never>((_resolve, reject) => {
      emit = onProgress;
      signal?.addEventListener('abort', () => reject(new DOMException('Operation aborted', 'AbortError')), { once: true });
    }));
    const tools: any[] = [];
    const controller = new AbortController();
    const updates = vi.fn();
    extension({ registerTool: (tool: any) => tools.push(tool), registerCommand: vi.fn(), on: vi.fn(), __webExploreTool: injected } as never);
    const pending = tools[0].execute('call-1', { query: 'example' }, controller.signal, updates);
    const rejected = expect(pending).rejects.toThrow('Operation aborted');
    await vi.waitFor(() => expect(emit).toBeDefined());
    emit?.({ phase: 'search', state: 'started', target: 'example', searches: 1, fetches: 0, headless: 0 });
    emit?.({ phase: 'search', state: 'started', target: 'example', searches: 1, fetches: 0, headless: 0 });
    controller.abort();
    emit?.({ phase: 'search', state: 'started', target: 'late evidence text', searches: 1, fetches: 0, headless: 0 });
    await rejected;
    const texts = updates.mock.calls.map(([update]) => update.content[0].text);
    expect(texts.filter((text: string) => text === 'Searching: example')).toHaveLength(1);
    expect(texts).toContain('Cancelled');
    expect(texts).not.toContain('Searching: late evidence text');
  });

  it('passes one injected clock start time through to each simultaneous execution', async () => {
    const starts: number[] = [];
    const tools: any[] = [];
    let time = 10;
    extension({
      registerTool: (tool: any) => tools.push(tool), registerCommand: vi.fn(), on: vi.fn(),
      __webExploreNow: () => ++time,
      __webExploreTool: vi.fn(async ({ startedAt }) => {
        starts.push(startedAt);
        return { status: 'ok', findings: [], sources: [] };
      })
    } as never);
    await Promise.all([tools[0].execute('a', { query: 'one' }), tools[0].execute('b', { query: 'two' })]);
    expect(starts).toEqual([11, 12]);
  });
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
      },
      repoCache: expect.objectContaining({ root: expect.any(String) })
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

  it('does not restrict Pi tools', () => {
    const handlers = new Map<string, Function>();
    const registeredTools: any[] = [];
    const pi = {
      registerTool: vi.fn((tool) => {
        registeredTools.push(tool);
      }),
      registerCommand: vi.fn(),
      on: vi.fn((eventName: string, handler: Function) => {
        handlers.set(eventName, handler);
      })
    };

    extension(pi as never);

    expect(handlers.has('before_agent_start')).toBe(false);
    const tool = registeredTools.find((item) => item.name === 'web_explore');
    expect(tool.description).toBe(
      'Research a web question using bounded search/fetch passes, source ranking, and targeted headless escalation. ' +
      'Prefer this for ordinary web research and narrower follow-up searches. ' +
      'Pi can still use git and gh for repository, issue, and pull request work, and tools the user explicitly requests.'
    );
    expect(tool.description).toContain('Prefer this for ordinary web research');
    expect(tool.description).toContain('git and gh');
    expect(tool.description).not.toContain('do not use shell/network commands');
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
        durationMs: 550,
        findings: ['A concise finding.'],
        sources: [{ title: 'Source', url: 'https://example.com', method: 'http' }],
        findingSourceIds: [['S1']],
        evidence: [{ id: 'S1', title: 'Source', url: 'https://example.com', method: 'http', excerpts: [{ text: 'The source passage that supports the finding.', anchor: 'details' }], truncated: false }],
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
    expect(result.content[0].text).toContain('[S1] A concise finding.');
    expect(result.content[0].text).toContain('The source passage that supports the finding.');
    expect(result.content[0].text).toContain('[S1] Source: https://example.com');
    expect(result.content[0].text).not.toContain('Reviewed');
    expect(result.content[0].text).not.toContain('550');
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

  it('keeps successful direct evidence in model content when later research terminates', async () => {
    const tools: any[] = [];
    const pi = {
      registerTool: (tool: any) => tools.push(tool), registerCommand: vi.fn(), on: vi.fn(),
      __webExploreTool: vi.fn().mockResolvedValue({
        status: 'error',
        findings: ['Direct source finding.'],
        sources: [{ title: 'Direct source', url: 'https://final.example/doc', requestedUrl: 'https://input.example/doc', method: 'http' }],
        findingSourceIds: [['S1']],
        evidence: [{ id: 'S1', title: 'Direct source', url: 'https://final.example/doc', method: 'http', excerpts: [{ text: 'Direct supporting passage.' }], truncated: false }],
        requiredSourceFailures: [{ url: 'https://failed.example/issue', reason: 'read-failed', code: 'DIRECT_SOURCE_READ_FAILED', message: 'Could not read issue.' }],
        error: { code: 'WORKER_FAILED', message: 'Later research stopped.' },
        presentation: { mode: 'compact', views: { compact: 'terminal' } }
      })
    };
    extension(pi as never);
    const result = await tools.find((tool) => tool.name === 'web_explore').execute('tool-call-1', { query: 'links' });
    const text = result.content[0].text as string;
    expect(text).toContain('Required source not read: https://failed.example/issue');
    expect(text).toContain('[S1] Direct source finding.');
    expect(text).toContain('[S1] Direct source: https://final.example/doc');
    expect(text).toContain('Direct supporting passage.');
    expect(text).toContain('Research failed: Later research stopped.');
    expect(text.indexOf('Required source not read')).toBeLessThan(text.indexOf('[S1] Direct source finding.'));
    expect(text.indexOf('[S1] Direct source finding.')).toBeLessThan(text.indexOf('Research failed:'));
    expect(text).not.toContain('[S2]');
  });

  it('sends an unreadable direct-source caveat to the model when no evidence was usable', async () => {
    const tools: any[] = [];
    const pi = {
      registerTool: (tool: any) => tools.push(tool),
      registerCommand: vi.fn(),
      on: vi.fn(),
      __webExploreTool: vi.fn().mockResolvedValue({
        status: 'ok',
        findings: [],
        sources: [],
        caveat: 'The direct URL could not be read.'
      })
    };

    extension(pi as never);

    const webExplore = tools.find((tool) => tool.name === 'web_explore');
    const result = await webExplore.execute('tool-call-1', { query: 'https://example.com/unreadable' });

    expect(result.content[0].text).toContain('The direct URL could not be read.');
    expect(result.details.terminalText).toBe('web_explore result');
  });

  it('puts a required-source failure before the empty-result caveat in model content', async () => {
    const tools: any[] = [];
    extension({
      registerTool: (tool: any) => tools.push(tool),
      registerCommand: vi.fn(),
      on: vi.fn(),
      __webExploreTool: vi.fn().mockResolvedValue({
        status: 'ok',
        findings: [],
        sources: [],
        caveat: 'Evidence is partial: one or more linked sources could not be read reliably.',
        requiredSourceFailures: [{
          url: 'https://github.com/acme/private/issues/14',
          reason: 'read-failed',
          code: 'GITHUB_FETCH_FAILED',
          message: 'GitHub resource was not found or is inaccessible.'
        }]
      })
    } as never);

    const result = await tools.find((tool) => tool.name === 'web_explore').execute('tool-call-1', { query: 'Read issue 14' });
    const modelText = result.content[0].text as string;
    expect(modelText).toMatch(/^Required source not read: https:\/\/github\.com\/acme\/private\/issues\/14\./);
    expect(modelText).toContain('The requirements of this source were not checked.');
    expect(modelText).toContain('No usable evidence found.');
    expect(modelText.indexOf('Required source not read')).toBeLessThan(modelText.indexOf('No usable evidence found.'));
  });

  it('sanitizes terminal and bidi formatting controls in persisted legacy presentation views', () => {
    const tools: any[] = [];
    const pi = {
      registerTool: (tool: any) => tools.push(tool),
      registerCommand: vi.fn(),
      on: vi.fn()
    };
    const osc = '\u001b]8;;https://example.com\u0007linked\u001b]8;;\u0007';
    const bidi = '\u202d\u202e\u2066\u2069';

    extension(pi as never);

    const webExplore = tools.find((tool) => tool.name === 'web_explore');
    const persistedResult = {
      details: {
        presentation: {
          views: {
            compact: `Legacy \u001b[31mcompact ${bidi}${osc}`,
            verbose: `Legacy first line\r\nLegacy second line ${bidi}${osc}`
          }
        }
      }
    };
    const compact = webExplore
      .renderResult(persistedResult, { expanded: false, isPartial: false }, {}, {})
      .render(120)
      .join('\n');
    const verboseLines = webExplore
      .renderResult(persistedResult, { expanded: true, isPartial: false }, {}, {})
      .render(120);
    const verbose = verboseLines.join('\n');

    for (const output of [compact, verbose]) {
      expect(output).not.toMatch(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u061C\u200E-\u200F\u202A-\u202E\u2066-\u2069]/);
      expect(output).not.toContain('\u001b');
    }
    expect(verboseLines.map((line: string) => line.trimEnd())).toEqual([
      'Legacy first line',
      'Legacy second line ]8;;https://example.comlinked]8;;'
    ]);
  });

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

  it('hands Pi the abort right away but keeps a cancelled run leased until it settles', async () => {
    vi.resetModules();
    let releaseRun!: () => void;
    let seenSignal: AbortSignal | undefined;
    const first = {
      run: vi.fn(({ signal }: { signal?: AbortSignal }) => {
        seenSignal = signal;
        return new Promise((resolve) => (releaseRun = () => resolve(answer)));
      }),
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

    const controller = new AbortController();
    const cancelled = webExplore.execute('call-1', { query: 'first' }, controller.signal);
    await vi.waitFor(() => expect(first.run).toHaveBeenCalled());
    expect(seenSignal).toBe(controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toThrow('Operation aborted');

    current = 1;
    await webExplore.execute('call-2', { query: 'second' });
    expect(first.close).not.toHaveBeenCalled();

    releaseRun();
    await vi.waitFor(() => expect(first.close).toHaveBeenCalledTimes(1));
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

  it('closes a workflow whose config load completes during session shutdown', async () => {
    vi.resetModules();
    let resolveConfig!: (value: unknown) => void;
    let releaseRun!: () => void;
    const configLoaded = new Promise<unknown>((resolve) => { resolveConfig = resolve; });
    const workflow = {
      run: vi.fn(() => new Promise((resolve) => { releaseRun = () => resolve(answer); })),
      close: vi.fn(async () => undefined)
    };
    const createResearchWorkflow = vi.fn(() => workflow);
    vi.doMock('../src/orchestration/index.js', () => ({ createResearchWorkflow }));
    const { default: dynamicExtension } = await import('../src/extension.js');
    const handlers: Record<string, (event: unknown) => Promise<void>> = {};
    const tools: any[] = [];
    const firstCache = { close: vi.fn(async () => undefined) };
    const secondCache = { close: vi.fn(async () => undefined) };
    const pi = {
      registerTool: (tool: any) => tools.push(tool),
      registerCommand: vi.fn(),
      on: vi.fn((event: string, handler: (event: unknown) => Promise<void>) => { handlers[event] = handler; }),
      __repoCacheFactory: vi.fn().mockReturnValueOnce(firstCache).mockReturnValue(secondCache),
      __presentationConfigStore: {
        load: vi.fn().mockImplementationOnce(() => configLoaded).mockResolvedValue({
          effectiveConfig: { defaultMode: 'compact', tools: {} },
          effectiveBackends: { search: { provider: 'duckduckgo' }, fetch: { provider: 'http' }, headless: { provider: 'local-browser' } }
        })
      }
    };

    dynamicExtension(pi as never);
    const execution = tools.find((tool) => tool.name === 'web_explore').execute('call-1', { query: 'x' });
    await vi.waitFor(() => expect(pi.__presentationConfigStore.load).toHaveBeenCalledTimes(1));
    const shutdown = handlers.session_shutdown({ type: 'session_shutdown', reason: 'new' });
    resolveConfig({
      effectiveConfig: { defaultMode: 'compact', tools: {} },
      effectiveBackends: { search: { provider: 'duckduckgo' }, fetch: { provider: 'http' }, headless: { provider: 'local-browser' } }
    });

    await vi.waitFor(() => expect(workflow.run).toHaveBeenCalledTimes(1));
    expect(workflow.close).not.toHaveBeenCalled();
    releaseRun();
    await execution;
    await shutdown;

    expect(createResearchWorkflow).toHaveBeenCalledWith(expect.objectContaining({ repoCache: firstCache }));
    expect(workflow.close).toHaveBeenCalledTimes(1);
    expect(firstCache.close).toHaveBeenCalledTimes(1);
  });

  it('does not create a workflow after configuration finishes beyond the shutdown grace period', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    let resolveConfig!: (value: unknown) => void;
    const configLoaded = new Promise<unknown>((resolve) => { resolveConfig = resolve; });
    const workflow = { run: vi.fn().mockResolvedValue(answer), close: vi.fn(async () => undefined) };
    const createResearchWorkflow = vi.fn(() => workflow);
    vi.doMock('../src/orchestration/index.js', () => ({ createResearchWorkflow }));
    const { default: dynamicExtension } = await import('../src/extension.js');
    const handlers: Record<string, (event: unknown) => Promise<void>> = {};
    const tools: any[] = [];
    const firstCache = { close: vi.fn(async () => undefined) };
    const secondCache = { close: vi.fn(async () => undefined) };
    const pi = {
      registerTool: (tool: any) => tools.push(tool),
      registerCommand: vi.fn(),
      on: vi.fn((event: string, handler: (event: unknown) => Promise<void>) => { handlers[event] = handler; }),
      __repoCacheFactory: vi.fn().mockReturnValueOnce(firstCache).mockReturnValue(secondCache),
      __presentationConfigStore: { load: vi.fn().mockImplementationOnce(() => configLoaded) }
    };

    try {
      dynamicExtension(pi as never);
      const execution = tools.find((tool) => tool.name === 'web_explore').execute('call-1', { query: 'x' });
      await vi.waitFor(() => expect(pi.__presentationConfigStore.load).toHaveBeenCalledTimes(1));
      const shutdown = handlers.session_shutdown({ type: 'session_shutdown', reason: 'new' });
      await vi.advanceTimersByTimeAsync(5_000);
      await shutdown;

      resolveConfig({ effectiveBackends: { search: { provider: 'duckduckgo' }, fetch: { provider: 'http' }, headless: { provider: 'local-browser' } } });
      await expect(execution).rejects.toThrow('session has ended');
      expect(createResearchWorkflow).not.toHaveBeenCalled();
      expect(firstCache.close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for detached workflow work before closing the session repo cache', async () => {
    vi.resetModules();
    let releaseClose!: () => void;
    const workflow = {
      run: vi.fn().mockResolvedValue(answer),
      close: vi.fn(() => new Promise<void>((resolve) => { releaseClose = resolve; }))
    };
    vi.doMock('../src/orchestration/index.js', () => ({ createResearchWorkflow: vi.fn(() => workflow) }));
    const { default: dynamicExtension } = await import('../src/extension.js');
    const closeCache = vi.fn(async () => undefined);
    const handlers: Record<string, (event: unknown) => Promise<void>> = {};
    const tools: any[] = [];
    dynamicExtension({
      registerTool: (tool: any) => tools.push(tool), registerCommand: vi.fn(),
      on: vi.fn((event: string, handler: (event: unknown) => Promise<void>) => { handlers[event] = handler; }),
      __repoCacheFactory: () => ({ close: closeCache }),
      __presentationConfigStore: configStore(() => ({ search: { provider: 'duckduckgo' }, fetch: { provider: 'http' }, headless: { provider: 'local-browser' } }))
    } as never);
    await tools[0].execute('call-1', { query: 'x' });

    const shutdown = handlers.session_shutdown({ type: 'session_shutdown', reason: 'quit' });
    await vi.waitFor(() => expect(workflow.close).toHaveBeenCalledTimes(1));
    expect(closeCache).not.toHaveBeenCalled();
    releaseClose();
    await shutdown;
    expect(closeCache).toHaveBeenCalledTimes(1);
  });

  it('finishes session shutdown when workflow close never settles', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const close = vi.fn(() => new Promise<void>(() => undefined));
    vi.doMock('../src/orchestration/index.js', () => ({
      createResearchWorkflow: vi.fn(() => ({ run: vi.fn().mockResolvedValue(answer), close }))
    }));
    const { default: dynamicExtension } = await import('../src/extension.js');
    const closeCache = vi.fn(async () => undefined);
    const handlers: Record<string, (event: unknown) => Promise<void>> = {};
    const tools: any[] = [];
    dynamicExtension({
      registerTool: (tool: any) => tools.push(tool), registerCommand: vi.fn(),
      on: vi.fn((event: string, handler: (event: unknown) => Promise<void>) => { handlers[event] = handler; }),
      __repoCacheFactory: () => ({ close: closeCache }),
      __presentationConfigStore: configStore(() => ({ search: { provider: 'duckduckgo' }, fetch: { provider: 'http' }, headless: { provider: 'local-browser' } }))
    } as never);

    try {
      await tools[0].execute('call-1', { query: 'x' });
      const shutdown = handlers.session_shutdown({ type: 'session_shutdown', reason: 'quit' });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(close).toHaveBeenCalledTimes(1);
      expect(closeCache).toHaveBeenCalledTimes(1);
      await shutdown;
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for a replaced workflow before closing its session repo cache', async () => {
    vi.resetModules();
    let releaseRun!: () => void;
    const first = {
      run: vi.fn(() => new Promise((resolve) => { releaseRun = () => resolve(answer); })),
      close: vi.fn(async () => undefined)
    };
    const second = { run: vi.fn().mockResolvedValue(answer), close: vi.fn(async () => undefined) };
    vi.doMock('../src/orchestration/index.js', () => ({
      createResearchWorkflow: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    }));
    const { default: dynamicExtension } = await import('../src/extension.js');
    const closeCache = vi.fn(async () => undefined);
    const handlers: Record<string, (event: unknown) => Promise<void>> = {};
    const tools: any[] = [];
    let backend = 'duckduckgo';
    dynamicExtension({
      registerTool: (tool: any) => tools.push(tool), registerCommand: vi.fn(),
      on: vi.fn((event: string, handler: (event: unknown) => Promise<void>) => { handlers[event] = handler; }),
      __repoCacheFactory: () => ({ close: closeCache }),
      __presentationConfigStore: configStore(() => ({ search: { provider: backend }, fetch: { provider: 'http' }, headless: { provider: 'local-browser' } }))
    } as never);
    const webExplore = tools.find((tool) => tool.name === 'web_explore');
    const inFlight = webExplore.execute('call-1', { query: 'first' });
    await vi.waitFor(() => expect(first.run).toHaveBeenCalledTimes(1));
    backend = 'brave';
    await webExplore.execute('call-2', { query: 'second' });

    const shutdown = handlers.session_shutdown({ type: 'session_shutdown', reason: 'quit' });
    expect(first.close).not.toHaveBeenCalled();
    expect(closeCache).not.toHaveBeenCalled();
    releaseRun();
    await inFlight;
    await shutdown;
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).toHaveBeenCalledTimes(1);
    expect(closeCache).toHaveBeenCalledTimes(1);
  });

  it('owns the repo cache: shutdown awaits its close, and the next session gets a fresh one', async () => {
    vi.resetModules();
    const { mkdtempSync, existsSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { createRepoCache } = await import('../src/repo/repo-cache.js');
    const base = mkdtempSync(join(tmpdir(), 'pwa-ext-cache-'));
    try {
      const seen: any[] = [];
      const workflow = { run: vi.fn().mockResolvedValue(answer), close: vi.fn(async () => undefined) };
      vi.doMock('../src/orchestration/index.js', () => ({
        createResearchWorkflow: vi.fn((options: any) => {
          seen.push(options.repoCache);
          return workflow;
        })
      }));
      const { default: dynamicExtension } = await import('../src/extension.js');
      const handlers: Record<string, (event: unknown) => unknown> = {};
      const tools: any[] = [];
      const pi = {
        registerTool: (tool: any) => tools.push(tool),
        registerCommand: vi.fn(),
        on: vi.fn((event: string, handler: (event: unknown) => unknown) => {
          handlers[event] = handler;
        }),
        __repoCacheFactory: () => createRepoCache({ baseDir: base, bootId: 'testboot' }),
        __presentationConfigStore: configStore(() => ({
          search: { provider: 'duckduckgo' },
          fetch: { provider: 'http' },
          headless: { provider: 'local-browser' }
        }))
      };

      dynamicExtension(pi as never);
      const webExplore = tools.find((tool) => tool.name === 'web_explore');
      await webExplore.execute('call-1', { query: 'x' });
      const firstCache = seen[0];
      const acquired = await firstCache.acquire('acme/widget@a', async (dest: string) => {
        await mkdir(dest, { recursive: true });
        await writeFile(join(dest, 'f'), 'x');
        return { ok: true, sha: 'a'.repeat(40) };
      });
      acquired.lease.release();
      expect(existsSync(firstCache.root)).toBe(true);

      await handlers.session_shutdown({ type: 'session_shutdown', reason: 'new' });
      expect(existsSync(firstCache.root)).toBe(false);
      expect(workflow.close).toHaveBeenCalledTimes(1);

      await webExplore.execute('call-2', { query: 'y' });
      expect(seen[1]).toBeDefined();
      expect(seen[1]).not.toBe(firstCache);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
