import { describe, expect, it, vi } from 'vitest';
import {
  applyResultsDraftValue,
  buildResultsSettingsItems,
  collapseResultsDraft,
  createResultsDraftState,
  formatResultLengthLine
} from '../../src/commands/results-settings.js';
import { registerWebAgentConfigCommands } from '../../src/commands/web-agent-config.js';
import { DEFAULT_BACKEND_CONFIG } from '../../src/backends/config.js';
import { DEFAULT_PRESENTATION_CONFIG } from '../../src/presentation/config.js';

describe('results settings helpers', () => {
  const loaded = {
    global: { path: '/global/config.json', exists: true, rawResults: { lengthLimit: 'short' as const } },
    project: { path: '/project/config.json', exists: false },
    effectiveResults: { lengthLimit: 'short' as const }
  };

  it('shows Results choices beside an exact config-only number without changing it', () => {
    const custom = createResultsDraftState({
      ...loaded,
      project: { path: '/project/config.json', exists: true, rawResults: { lengthLimit: 1234 } },
      effectiveResults: { lengthLimit: 1234 }
    }, 'project');
    expect(buildResultsSettingsItems(custom.scope, custom.draft)).toMatchObject([
      { id: 'scope', label: 'Write scope' },
      { id: 'lengthLimit', currentValue: 'Custom (1,234)' }
    ]);
    expect(collapseResultsDraft(custom.draft)).toEqual({ lengthLimit: 1234 });
  });

  it('keeps global and project drafts independent and does not pin untouched inheritance', () => {
    let state = createResultsDraftState(loaded, 'project');
    expect(collapseResultsDraft(state.draft)).toEqual({});
    state = applyResultsDraftValue(state, 'scope', 'global');
    state = applyResultsDraftValue(state, 'lengthLimit', 'medium');
    state = applyResultsDraftValue(state, 'scope', 'project');
    expect(collapseResultsDraft(state.draft)).toEqual({});
    state = applyResultsDraftValue(state, 'scope', 'global');
    expect(collapseResultsDraft(state.draft)).toEqual({ lengthLimit: 'medium' });
  });

  it('treats an empty persisted override as inherit and shows the inherited preset', () => {
    const state = createResultsDraftState({
      ...loaded,
      project: { path: '/project/config.json', exists: true, rawResults: {} },
      effectiveResults: { lengthLimit: 'short' }
    }, 'project');
    expect(state.draft.inherit).toBe(true);
    expect(buildResultsSettingsItems('project', state.draft)[1]).toMatchObject({
      currentValue: 'inherit',
      description: "Inherited: short. Auto fits the model's context. Short 4,000 chars, Medium 8,000, Standard uses per-source caps."
    });
    expect(collapseResultsDraft(state.draft)).toEqual({});
  });

  it('recomputes the inherited display after replacing a custom project value', () => {
    let state = createResultsDraftState({
      global: { rawResults: { lengthLimit: 'short' } },
      project: { rawResults: { lengthLimit: 1234 } },
      effectiveResults: { lengthLimit: 1234 }
    }, 'project');
    state = applyResultsDraftValue(state, 'scope', 'global');
    state = applyResultsDraftValue(state, 'lengthLimit', 'medium');
    state = applyResultsDraftValue(state, 'scope', 'project');
    state = applyResultsDraftValue(state, 'lengthLimit', 'inherit');
    expect(buildResultsSettingsItems('project', state.draft)[1]).toMatchObject({ currentValue: 'inherit', description: expect.stringMatching(/^Inherited: medium\./) });
  });

  it('distinguishes Inherit from an explicit Auto override and preserves a stored clear', () => {
    let state = createResultsDraftState(loaded, 'project');
    state = applyResultsDraftValue(state, 'lengthLimit', 'auto');
    expect(collapseResultsDraft(state.draft)).toEqual({ lengthLimit: 'auto' });
    state = applyResultsDraftValue(state, 'lengthLimit', 'inherit');
    expect(collapseResultsDraft(state.draft)).toEqual({});
    const cleared = createResultsDraftState({
      ...loaded,
      project: { path: '/project/config.json', exists: true, rawResults: { cleared: ['lengthLimit'] } },
      effectiveResults: { lengthLimit: 'auto' }
    }, 'project');
    expect(collapseResultsDraft(cleared.draft)).toEqual({ cleared: ['lengthLimit'] });
  });

  it('formats the Result length row with en-US separators and a plain description', () => {
    const custom = createResultsDraftState({
      ...loaded,
      project: { path: '/project/config.json', exists: true, rawResults: { lengthLimit: 6000 } },
      effectiveResults: { lengthLimit: 6000 }
    }, 'project');
    expect(buildResultsSettingsItems('project', custom.draft)[1]).toMatchObject({ currentValue: 'Custom (6,000)' });
    expect(buildResultsSettingsItems('project', custom.draft)[1]).toMatchObject({
      description: "Auto fits the model's context. Short 4,000 chars, Medium 8,000, Standard uses per-source caps."
    });
    const inheritedNumber = createResultsDraftState({
      global: { rawResults: { lengthLimit: 6000 } },
      project: { path: '/project/config.json', exists: false },
      effectiveResults: { lengthLimit: 6000 }
    }, 'project');
    expect(buildResultsSettingsItems('project', inheritedNumber.draft)[1]).toMatchObject({
      currentValue: 'inherit',
      description: "Inherited: 6,000. Auto fits the model's context. Short 4,000 chars, Medium 8,000, Standard uses per-source caps."
    });
  });

  it('formats Auto per current model and warns conditionally at exactly 128k', () => {
    expect(formatResultLengthLine({ lengthLimit: 'auto' }, { id: 'llama', contextWindow: 32768 })).toBe(
      'Result length: auto, up to about 5,242 chars for llama (32k context)'
    );
    expect(formatResultLengthLine({ lengthLimit: 'auto' }, { id: 'gemini', contextWindow: 1000000 })).toBe(
      'Result length: auto, up to about 160,000 chars for gemini (1M context)'
    );
    expect(formatResultLengthLine({ lengthLimit: 'auto' }, { id: 'big', contextWindow: 2000000 })).toContain('(2M context)');
    expect(formatResultLengthLine({ lengthLimit: 'auto' }, { id: 'mid', contextWindow: 131072 })).toContain('(131k context)');
    expect(formatResultLengthLine({ lengthLimit: 'auto' }, { id: 'custom', contextWindow: 128000 })).toContain(
      "For custom models, 128k may be Pi's default; set contextWindow in models.json if your model's real context is smaller."
    );
    expect(formatResultLengthLine({ lengthLimit: 'auto' }, undefined)).toContain('standard caps (context unknown)');
    expect(formatResultLengthLine({ lengthLimit: 'standard' }, { id: 'x', contextWindow: 1 })).toBe(
      'Result length: standard, per-source caps; required reader documents up to 24,000 chars each'
    );
  });
});

describe('result length command output', () => {
  it('resolves Auto for show and doctor on every context without a model definition lookup', async () => {
    let handler: any;
    const load = vi.fn().mockResolvedValue({
      global: { path: '/global/config.json', exists: false },
      project: { path: '/project/config.json', exists: false },
      effectiveConfig: DEFAULT_PRESENTATION_CONFIG,
      effectiveBackends: DEFAULT_BACKEND_CONFIG,
      effectiveResults: { lengthLimit: 'auto' }
    });
    registerWebAgentConfigCommands({ registerCommand: (_name: string, command: any) => { handler = command.handler; } } as never, {
      load,
      checkBackends: vi.fn().mockResolvedValue([]),
      checkRepoResearch: vi.fn().mockResolvedValue('repo research: ok'),
      checkTypebox: vi.fn().mockResolvedValue(true),
      checkJitiCompat: vi.fn().mockReturnValue({ pending: [] }),
      resolveBrowser: vi.fn().mockResolvedValue({ ok: true, executablePath: '/bin/browser', browser: 'browser', source: 'configured' })
    });
    const notify = vi.fn();
    const guarded = (id: string, contextWindow?: number) => ({
      id,
      ...(contextWindow === undefined ? {} : { contextWindow }),
      get modelRegistry(): never { throw new Error('model registry lookup is forbidden'); },
      get definition(): never { throw new Error('model definition lookup is forbidden'); }
    });
    const small = guarded('small', 8192);
    const custom = guarded('custom', 128000);
    const unknown = guarded('unknown');
    await handler('show', { model: small, ui: { notify } });
    await handler('doctor', { model: small, ui: { notify } });
    await handler('show', { model: custom, ui: { notify } });
    await handler('doctor', { model: custom, ui: { notify } });
    await handler('show', { model: unknown, ui: { notify } });
    await handler('doctor', { model: unknown, ui: { notify } });
    expect(notify.mock.calls[0][0]).toContain('up to about 1,310 chars for small (8k context)');
    expect(notify.mock.calls[1][0]).toContain('up to about 1,310 chars for small (8k context)');
    expect(notify.mock.calls[2][0]).toContain('up to about 20,480 chars for custom (128k context)');
    expect(notify.mock.calls[3][0]).toContain("128k may be Pi's default");
    expect(notify.mock.calls[4][0]).toContain('standard caps (context unknown)');
    expect(notify.mock.calls[5][0]).toContain('standard caps (context unknown)');
    expect(load).toHaveBeenCalledTimes(6);
  });
});
