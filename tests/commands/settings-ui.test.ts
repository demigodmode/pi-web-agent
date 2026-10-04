import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initTheme } from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
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
