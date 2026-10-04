import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initTheme } from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
import { PRESENTATION_MODES, type PresentationMode } from '../../src/presentation/types.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applySettingsValue, createSettingsDraftState, registerWebAgentConfigCommands
} from '../../src/commands/web-agent-config.js';
import {
  DEFAULT_PRESENTATION_CONFIG, extractPresentationConfigOverride, mergePresentationConfigLayers, resolvePresentationMode
} from '../../src/presentation/config.js';
import {
  getPresentationConfigPaths, loadPresentationConfigLayers, resetPresentationConfigScope,
  saveBackendConfigScope, savePresentationConfigScope
} from '../../src/presentation/config-store.js';

const theme = { fg: (_role: string, text: string) => text, bold: (text: string) => text };
type UiFactory = (tui: { requestRender(): void }, colors: typeof theme, keys: object, done: (value: unknown) => void) => Component;

function selectToolMode(current: 'inherit' | PresentationMode, target: 'inherit' | PresentationMode): string[] {
  const modes = ['inherit', ...PRESENTATION_MODES];
  const cycles = (modes.indexOf(target) - modes.indexOf(current) + modes.length) % modes.length || modes.length;
  return Array.from({ length: cycles }, () => ['\x1b[B', '\x1b[B', '\r']).flat();
}

function commandHarness(options: { homeDir: string; projectDir: string }) {
  let handler: (args: string, ctx: unknown) => Promise<void> = async () => { throw new Error('command missing'); };
  const save = vi.fn((scope, config) => savePresentationConfigScope(options, scope, config));
  const saveBackends = vi.fn((scope, config) => saveBackendConfigScope(options, scope, config));
  const reset = vi.fn((scope) => resetPresentationConfigScope(options, scope));
  registerWebAgentConfigCommands({ registerCommand: (_name: string, command: { handler: typeof handler }) => { handler = command.handler; } } as never, {
    load: () => loadPresentationConfigLayers(options), save, saveBackends, reset
  });
  const notify = vi.fn();
  const runUi = async (section: 'presentation' | 'backends', inputs: string[]) => {
    const completions: unknown[][] = [];
    const screens: string[] = [];
    const custom = vi.fn(async (factory: UiFactory) => {
      const values: unknown[] = [];
      completions.push(values);
      const component = factory({ requestRender() {} }, theme, {}, (value) => values.push(value));
      if (completions.length === 1) {
        if (section === 'backends') component.handleInput?.('\x1b[B');
        component.handleInput?.('\r');
      } else {
        for (const input of inputs) component.handleInput?.(input);
        screens.push(component.render(100).join('\n').replace(/\x1b\[[0-9;]*m/g, ''));
      }
      return values[0];
    });
    await handler('settings', { ui: { custom, notify } });
    expect(custom).toHaveBeenCalledTimes(2);
    expect(completions[1]).toHaveLength(1);
    return { result: completions[1][0], screen: screens[0] };
  };
  return { handler, save, saveBackends, reset, notify, runUi };
}

describe('settings input and persisted presentation inheritance', () => {
  let root: string;
  let options: { homeDir: string; projectDir: string };
  beforeAll(() => initTheme('dark', false));
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'pi-settings-ui-'));
    options = { homeDir: path.join(root, 'home'), projectDir: path.join(root, 'project') };
    await savePresentationConfigScope(options, 'global', {
      defaultMode: 'compact', tools: { web_explore: { mode: 'verbose' } }
    });
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('persists a project inherit choice through the command save and reload', async () => {
    const loaded = await loadPresentationConfigLayers(options);
    const draft = applySettingsValue(createSettingsDraftState(loaded, 'project'), 'tool:web_explore', 'inherit');
    const custom = vi.fn().mockResolvedValueOnce('presentation').mockResolvedValueOnce({
      action: 'save', scope: 'project', config: draft.config, backends: draft.backends
    });
    await commandHarness(options).handler('settings', { ui: { custom, notify: vi.fn() } });
    expect(resolvePresentationMode('web_explore', (await loadPresentationConfigLayers(options)).effectiveConfig)).toBe('compact');
  });

  for (const section of ['presentation', 'backends'] as const) {
    it.each([['native', '\x13'], ['CSIu', '\x1b[115;5u']] as const)(`saves the real ${section} screen with %s Ctrl+S`, async (_encoding, input) => {
      const command = commandHarness(options);
      const { result } = await command.runUi(section, [input]);
      expect(result).toMatchObject({ action: 'save', scope: 'project' });
      expect(section === 'presentation' ? command.save : command.saveBackends).toHaveBeenCalledOnce();
      expect(command.reset).not.toHaveBeenCalled();
    });

    it.each([['native', '\x1b'], ['CSIu', '\x1b[27u']] as const)(`cancels edits in the real ${section} screen with %s Escape`, async (_encoding, input) => {
      await savePresentationConfigScope(options, 'project', { defaultMode: 'preview', tools: {} });
      const file = getPresentationConfigPaths(options).projectPath;
      const before = await readFile(file, 'utf8');
      const command = commandHarness(options);
      const { result } = await command.runUi(section, ['\x1b[B', '\r', input]);
      expect(result).toEqual({ action: 'cancel' });
      expect(command.save).not.toHaveBeenCalled();
      expect(command.saveBackends).not.toHaveBeenCalled();
      expect(command.reset).not.toHaveBeenCalled();
      expect(await readFile(file, 'utf8')).toBe(before);
    });

    it.each([['native', '\x12'], ['CSIu', '\x1b[114;5u']] as const)(`resets the project from the real ${section} screen with %s Ctrl+R`, async (_encoding, input) => {
      await savePresentationConfigScope(options, 'project', { defaultMode: 'preview', tools: {} });
      const command = commandHarness(options);
      const { result } = await command.runUi(section, [input]);
      expect(result).toEqual({ action: 'reset', scope: 'project' });
      expect(command.reset).toHaveBeenCalledWith('project');
      expect(command.save).not.toHaveBeenCalled();
      expect(command.saveBackends).not.toHaveBeenCalled();
      expect((await loadPresentationConfigLayers(options)).project.exists).toBe(false);
    });
  }

  it('saves inherit selected in the real presentation screen and reloads the current default', async () => {
    const command = commandHarness(options);
    const { result, screen } = await command.runUi('presentation', ['\x1b[B', '\x1b[B', '\r', '\x13']);
    expect(screen).toMatch(/web_explore\s+inherit/);
    expect(result).toMatchObject({ action: 'save', scope: 'project', config: { defaultMode: 'compact', tools: {} } });
    expect(resolvePresentationMode('web_explore', (await loadPresentationConfigLayers(options)).effectiveConfig)).toBe('compact');
  });

  it('keeps presentation inheritance through default changes, absent global overrides, restore and reset', async () => {
    const command = commandHarness(options);
    await command.runUi('presentation', ['\x1b[B', '\x1b[B', '\r', '\x13']);
    expect((await loadPresentationConfigLayers(options)).project.rawConfig?.cleared).toEqual(['tools.web_explore']);
    await savePresentationConfigScope(options, 'global', { defaultMode: 'preview', tools: {} });
    await command.handler('mode compact', { ui: { notify: vi.fn() } });
    await command.runUi('presentation', ['\x13']);
    await savePresentationConfigScope(options, 'global', {
      defaultMode: 'preview', tools: { web_explore: { mode: 'verbose' }, web_fetch: { mode: 'preview' } }
    });
    let loaded = await loadPresentationConfigLayers(options);
    expect(resolvePresentationMode('web_explore', loaded.effectiveConfig)).toBe('compact');
    expect(loaded.effectiveConfig.tools.web_fetch).toEqual({ mode: 'preview' });
    await command.handler('mode preview', { ui: { notify: vi.fn() } });
    expect(resolvePresentationMode('web_explore', (await loadPresentationConfigLayers(options)).effectiveConfig)).toBe('preview');
    await command.handler('mode web_explore verbose', { ui: { notify: vi.fn() } });
    loaded = await loadPresentationConfigLayers(options);
    expect(loaded.project.rawConfig?.cleared).toBeUndefined();
    expect(resolvePresentationMode('web_explore', loaded.effectiveConfig)).toBe('verbose');
    await command.handler('mode web_explore inherit', { ui: { notify: vi.fn() } });
    expect(resolvePresentationMode('web_explore', (await loadPresentationConfigLayers(options)).effectiveConfig)).toBe('preview');
    await command.handler('reset project', { ui: { notify: vi.fn() } });
    expect(resolvePresentationMode('web_explore', (await loadPresentationConfigLayers(options)).effectiveConfig)).toBe('verbose');
  });

  it('lets Escape cancel the inline URL edit before Ctrl+S saves the backend screen', async () => {
    await saveBackendConfigScope(options, 'global', { search: { provider: 'searxng', baseUrl: 'https://old.invalid' } });
    const command = commandHarness(options);
    const { result } = await command.runUi('backends', ['\x1b[B', '\x1b[B', '\r', '/changed', '\x1b', '\x13']);
    expect(result).toMatchObject({ action: 'save', backends: { search: { baseUrl: 'https://old.invalid' } } });
    expect(command.saveBackends).toHaveBeenCalledOnce();
    expect((await loadPresentationConfigLayers(options)).effectiveBackends.search.baseUrl).toBe('https://old.invalid');
  });

  const defaultPairs = PRESENTATION_MODES.flatMap((globalDefault) =>
    PRESENTATION_MODES.map((projectDefault) => ({ globalDefault, projectDefault }))
  );
  const selections = defaultPairs.flatMap((defaults) => PRESENTATION_MODES.map((mode) => ({ ...defaults, mode })));
  it.each(selections)('keeps edited $mode with global $globalDefault and project $projectDefault defaults', async ({ globalDefault, projectDefault, mode }) => {
    await savePresentationConfigScope(options, 'global', { defaultMode: globalDefault, tools: {} });
    await savePresentationConfigScope(options, 'project', { defaultMode: projectDefault, tools: {} });
    const saveKey = mode === 'preview' ? '\x1b[115;5u' : '\x13';
    const command = commandHarness(options);
    await command.runUi('presentation', [...selectToolMode('inherit', mode), saveKey]);
    let loaded = await loadPresentationConfigLayers(options);
    expect(loaded.project.rawConfig?.tools.web_explore).toEqual({ mode });
    expect(resolvePresentationMode('web_explore', loaded.effectiveConfig)).toBe(mode);
    await command.runUi('presentation', ['\x13']);
    loaded = await loadPresentationConfigLayers(options);
    expect(loaded.project.rawConfig?.tools.web_explore).toEqual({ mode });
    expect(loaded.project.rawConfig?.defaultMode).toBe(projectDefault);
  });

  it.each(defaultPairs)('preserves saved pins while defaults change from $globalDefault/$projectDefault', async ({ globalDefault, projectDefault }) => {
    await savePresentationConfigScope(options, 'global', { defaultMode: globalDefault, tools: {} });
    await savePresentationConfigScope(options, 'project', {
      defaultMode: projectDefault, tools: { web_explore: { mode: globalDefault }, web_fetch: { mode: globalDefault } }
    });
    const command = commandHarness(options);
    await command.runUi('presentation', ['\x13']);
    const futureMode = PRESENTATION_MODES[(PRESENTATION_MODES.indexOf(globalDefault) + 1) % 3];
    await savePresentationConfigScope(options, 'global', {
      defaultMode: projectDefault, tools: { web_explore: { mode: futureMode }, web_fetch: { mode: futureMode } }
    });
    await command.runUi('presentation', ['\x1b[115;5u']);
    const loaded = await loadPresentationConfigLayers(options);
    expect(loaded.project.rawConfig?.defaultMode).toBe(projectDefault);
    expect(loaded.project.rawConfig?.tools).toEqual({ web_explore: { mode: globalDefault }, web_fetch: { mode: globalDefault } });
    expect(resolvePresentationMode('web_explore', loaded.effectiveConfig)).toBe(globalDefault);
  });

  it.each(PRESENTATION_MODES.flatMap((defaultMode) => PRESENTATION_MODES.map((mode) => ({ defaultMode, mode }))))(
    'keeps global edited $mode under default $defaultMode across saves', async ({ defaultMode, mode }) => {
      await savePresentationConfigScope(options, 'global', { defaultMode, tools: {} });
      const command = commandHarness(options);
      await command.runUi('presentation', ['\r', ...selectToolMode('inherit', mode), '\x13']);
      await command.runUi('presentation', ['\r', '\x1b[115;5u']);
      const loaded = await loadPresentationConfigLayers(options);
      expect(loaded.global.rawConfig?.tools.web_explore).toEqual({ mode });
      expect(loaded.global.rawConfig?.defaultMode).toBe(defaultMode);
      expect(loaded.project.exists).toBe(false);
    }
  );

  it.each([undefined, 'verbose'] as const)('keeps untouched inherited entries omitted with project default %s', async (projectDefault) => {
    await savePresentationConfigScope(options, 'global', {
      defaultMode: 'preview', tools: { web_explore: { mode: 'preview' }, web_fetch: { mode: 'compact' } }
    });
    if (projectDefault) await savePresentationConfigScope(options, 'project', { defaultMode: projectDefault, tools: {} });
    const command = commandHarness(options);
    await command.runUi('presentation', ['\x13']);
    expect((await loadPresentationConfigLayers(options)).project.rawConfig).toMatchObject({ tools: {} });
    expect((await loadPresentationConfigLayers(options)).project.rawConfig?.defaultMode).toBe(projectDefault);
    await savePresentationConfigScope(options, 'global', {
      defaultMode: 'verbose', tools: { web_explore: { mode: 'compact' }, web_fetch: { mode: 'verbose' } }
    });
    await command.runUi('presentation', ['\x13']);
    const loaded = await loadPresentationConfigLayers(options);
    expect(loaded.project.rawConfig?.tools).toEqual({});
    expect(loaded.project.rawConfig?.defaultMode).toBe(projectDefault);
    expect(resolvePresentationMode('web_explore', loaded.effectiveConfig)).toBe('compact');
    expect(loaded.effectiveConfig.tools.web_fetch).toEqual({ mode: 'verbose' });
  });

  it.each(['global', 'project'] as const)('keeps clear, explicit-equal-parent and inherit intent in %s scope', async (scope) => {
    await savePresentationConfigScope(options, 'global', { defaultMode: 'compact', tools: { web_explore: { mode: 'compact' } } });
    if (scope === 'project') await savePresentationConfigScope(options, 'project', { defaultMode: 'verbose', tools: {} });
    const prefix = scope === 'global' ? ['\r'] : [];
    const command = commandHarness(options);
    await command.runUi('presentation', [...prefix, ...selectToolMode('compact', 'inherit'), '\x13']);
    expect((await loadPresentationConfigLayers(options))[scope].rawConfig?.cleared).toEqual(['tools.web_explore']);
    await command.runUi('presentation', [...prefix, ...selectToolMode('inherit', 'compact'), '\x1b[115;5u']);
    let loaded = await loadPresentationConfigLayers(options);
    expect(loaded[scope].rawConfig?.cleared).toBeUndefined();
    expect(loaded[scope].rawConfig?.tools.web_explore).toEqual({ mode: 'compact' });
    await command.runUi('presentation', [...prefix, ...selectToolMode('compact', 'inherit'), '\x13']);
    loaded = await loadPresentationConfigLayers(options);
    expect(loaded[scope].rawConfig?.cleared).toEqual(['tools.web_explore']);
    expect(resolvePresentationMode('web_explore', loaded.effectiveConfig)).toBe(scope === 'project' ? 'verbose' : 'compact');
  });

  it('pins a CLI choice equal to the parent and preserves it during unrelated default changes', async () => {
    await savePresentationConfigScope(options, 'global', { defaultMode: 'preview', tools: {} });
    await savePresentationConfigScope(options, 'project', { defaultMode: 'verbose', tools: {} });
    const command = commandHarness(options);
    await command.handler('mode web_explore preview', { ui: { notify: vi.fn() } });
    await command.handler('mode preview', { ui: { notify: vi.fn() } });
    await savePresentationConfigScope(options, 'global', { defaultMode: 'compact', tools: {} });
    await command.runUi('presentation', ['\x13']);
    const loaded = await loadPresentationConfigLayers(options);
    expect(loaded.project.rawConfig?.defaultMode).toBe('preview');
    expect(loaded.project.rawConfig?.tools.web_explore).toEqual({ mode: 'preview' });
  });

  it.each(['\x13', '\x1b[115;5u'])('keeps the exact preview/verbose counterexample with save bytes %j', async (saveKey) => {
    await savePresentationConfigScope(options, 'global', { defaultMode: 'preview', tools: {} });
    await savePresentationConfigScope(options, 'project', { defaultMode: 'verbose', tools: {} });
    const command = commandHarness(options);
    await command.runUi('presentation', [...selectToolMode('inherit', 'preview'), saveKey]);
    const loaded = await loadPresentationConfigLayers(options);
    expect(loaded.project.rawConfig?.tools.web_explore).toEqual({ mode: 'preview' });
    expect(resolvePresentationMode('web_explore', loaded.effectiveConfig)).toBe('preview');
  });

  it.each(['global', 'project'] as const)('pins a default row edited back to its inherited value in %s scope', async (scope) => {
    await savePresentationConfigScope(options, 'global', { tools: {} });
    const command = commandHarness(options);
    const prefix = scope === 'global' ? ['\r'] : [];
    const editBackToCompact = Array.from({ length: 3 }, () => ['\x1b[B', '\r']).flat();
    await command.runUi('presentation', [...prefix, ...editBackToCompact, '\x13']);
    expect((await loadPresentationConfigLayers(options))[scope].rawConfig?.defaultMode).toBe('compact');
    if (scope === 'project') await savePresentationConfigScope(options, 'global', { defaultMode: 'verbose', tools: {} });
    await command.runUi('presentation', [...prefix, '\x1b[115;5u']);
    expect((await loadPresentationConfigLayers(options))[scope].rawConfig?.defaultMode).toBe('compact');
  });

  it('keeps per-scope edits separate and saves only the selected scope', async () => {
    await savePresentationConfigScope(options, 'global', { defaultMode: 'preview', tools: {} });
    await savePresentationConfigScope(options, 'project', { defaultMode: 'verbose', tools: {} });
    const command = commandHarness(options);
    await command.runUi('presentation', [
      ...selectToolMode('inherit', 'preview'), '\r', ...selectToolMode('inherit', 'compact'), '\r', '\x13'
    ]);
    const loaded = await loadPresentationConfigLayers(options);
    expect(loaded.project.rawConfig?.tools.web_explore).toEqual({ mode: 'preview' });
    expect(loaded.global.rawConfig?.tools).toEqual({});
  });

  it('does not copy global draft edits into an untouched project draft', async () => {
    await savePresentationConfigScope(options, 'global', { defaultMode: 'preview', tools: {} });
    const command = commandHarness(options);
    await command.runUi('presentation', ['\r', ...selectToolMode('inherit', 'compact'), '\r', '\x13']);
    const loaded = await loadPresentationConfigLayers(options);
    expect(loaded.project.rawConfig?.tools).toEqual({});
    expect(loaded.project.rawConfig?.defaultMode).toBeUndefined();
    expect(loaded.global.rawConfig?.tools).toEqual({});
  });

  it('applies validated presentation clears before explicit values without mutating lower layers', () => {
    const lower = { defaultMode: 'preview' as const, tools: { web_explore: { mode: 'verbose' as const }, web_fetch: { mode: 'compact' as const } } };
    const override = extractPresentationConfigOverride({ presentation: {
      cleared: ['tools.web_explore', 'tools.web_explore', 'defaultMode', 'tools', '__proto__.polluted'], tools: {}
    } });
    expect(override.cleared).toEqual(['tools.web_explore']);
    const merged = mergePresentationConfigLayers(DEFAULT_PRESENTATION_CONFIG, lower, override);
    expect(resolvePresentationMode('web_explore', merged)).toBe('preview');
    expect(merged.tools.web_fetch).toEqual({ mode: 'compact' });
    expect(lower.tools.web_explore.mode).toBe('verbose');
    expect(merged).not.toHaveProperty('cleared');
    expect({}).not.toHaveProperty('polluted');
    expect(resolvePresentationMode('web_explore', mergePresentationConfigLayers(DEFAULT_PRESENTATION_CONFIG, lower, {
      ...override, tools: { web_explore: { mode: 'compact' } }
    }))).toBe('compact');
    expect(resolvePresentationMode('web_explore', mergePresentationConfigLayers(DEFAULT_PRESENTATION_CONFIG, {
      ...lower, cleared: ['tools.web_explore']
    }, { tools: { web_explore: { mode: 'compact' } } }))).toBe('compact');
  });
});
