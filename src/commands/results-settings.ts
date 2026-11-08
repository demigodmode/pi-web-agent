import { Container, Key, matchesKey, SettingsList, Text, type SettingItem } from '@earendil-works/pi-tui';
import { getSettingsListTheme } from '@earendil-works/pi-coding-agent';
import { resolveLengthLimit } from '../results/length.js';
import type { LengthLimit, ModelContext, ResultsConfig, ResultsOverride } from '../results/types.js';
import type { PresentationScope } from '../presentation/types.js';

export type ResultsDraft = {
  lengthLimit: LengthLimit;
  inheritedLength: LengthLimit;
  initial: ResultsOverride | undefined;
  edited: boolean;
  inherit: boolean;
  clear: boolean;
};

export type ResultsDraftState = {
  scope: PresentationScope;
  drafts: Record<PresentationScope, ResultsDraft>;
  draft: ResultsDraft;
};

export type ResultsUiResult =
  | { action: 'cancel' }
  | { action: 'reset-results'; scope: PresentationScope }
  | { action: 'save-results'; scope: PresentationScope; override: ResultsOverride };

type ResultsLoaded = {
  global: { rawResults?: ResultsOverride; [key: string]: unknown };
  project: { rawResults?: ResultsOverride; [key: string]: unknown };
  effectiveResults?: ResultsConfig;
};

function defaultForScope(loaded: ResultsLoaded, scope: PresentationScope): LengthLimit {
  if (scope === 'global') return 'auto';
  return loaded.global.rawResults?.lengthLimit ?? 'auto';
}

function draftFor(loaded: ResultsLoaded, scope: PresentationScope): ResultsDraft {
  const initial = loaded[scope].rawResults;
  const hasOverride = initial?.lengthLimit !== undefined || Boolean(initial?.cleared?.includes('lengthLimit'));
  const inheritedLength = defaultForScope(loaded, scope);
  return {
    lengthLimit: hasOverride ? initial?.lengthLimit ?? 'auto' : scope === 'project' ? loaded.effectiveResults?.lengthLimit ?? inheritedLength : inheritedLength,
    inheritedLength,
    initial: hasOverride ? initial : undefined,
    edited: false,
    inherit: !hasOverride,
    clear: Boolean(initial?.cleared?.includes('lengthLimit'))
  };
}

export function createResultsDraftState(loaded: ResultsLoaded, scope: PresentationScope): ResultsDraftState {
  const drafts = { global: draftFor(loaded, 'global'), project: draftFor(loaded, 'project') };
  return { scope, drafts, draft: drafts[scope] };
}

export function buildResultsSettingsItems(scope: PresentationScope, draft: ResultsDraft): SettingItem[] {
  const display = draft.inherit ? 'inherit' : typeof draft.lengthLimit === 'number' ? `Custom (${draft.lengthLimit})` : draft.lengthLimit;
  return [
    { id: 'scope', label: 'Write scope', currentValue: scope, values: ['project', 'global'] },
    {
      id: 'lengthLimit', label: 'Result length', currentValue: display, values: ['inherit', 'auto', 'short', 'medium', 'standard'],
      ...(draft.inherit ? { description: `Inherited: ${draft.inheritedLength}` } : {})
    }
  ];
}

export function applyResultsDraftValue(state: ResultsDraftState, id: string, value: string): ResultsDraftState {
  if (id === 'scope' && (value === 'global' || value === 'project')) {
    const project = state.drafts.project.inherit
      ? { ...state.drafts.project, inheritedLength: state.drafts.global.inherit ? 'auto' : state.drafts.global.lengthLimit, lengthLimit: state.drafts.global.inherit ? 'auto' : state.drafts.global.lengthLimit }
      : state.drafts.project;
    const drafts = { ...state.drafts, project };
    return { ...state, scope: value, drafts, draft: drafts[value] };
  }
  if (id !== 'lengthLimit') return state;
  const current = state.drafts[state.scope];
  const inheritedLength = state.scope === 'project'
    ? state.drafts.global.inherit ? 'auto' : state.drafts.global.lengthLimit
    : 'auto';
  const next: ResultsDraft = value === 'inherit'
    ? { ...current, lengthLimit: inheritedLength, inheritedLength, edited: true, inherit: true, clear: false }
    : value === 'auto' || value === 'short' || value === 'medium' || value === 'standard'
        ? { ...current, lengthLimit: value, edited: true, inherit: false, clear: false }
        : current;
  const drafts = { ...state.drafts, [state.scope]: next };
  return { ...state, drafts, draft: next };
}

export function collapseResultsDraft(draft: ResultsDraft): ResultsOverride {
  if (!draft.edited) return draft.initial ?? {};
  if (draft.inherit) return {};
  if (draft.clear) return { cleared: ['lengthLimit'] };
  return { lengthLimit: draft.lengthLimit };
}

function windowLabel(window: number): string {
  return `${window % 1000 === 0 ? window / 1000 : Math.floor(window / 1000)}k context`;
}

export function formatResultLengthLine(config: ResultsConfig, model?: ModelContext): string {
  const setting = config.lengthLimit;
  if (setting === 'standard') return 'Result length: standard, per-source caps; required reader documents up to 24,000 chars each';
  if (setting === 'auto') {
    const resolved = resolveLengthLimit(setting, model?.contextWindow);
    if (resolved.kind === 'standard') return 'Result length: auto, standard caps (context unknown)';
    const modelName = model?.id ?? 'current model';
    const line = `Result length: auto, about ${resolved.chars.toLocaleString('en-US')} chars for ${modelName} (${windowLabel(model!.contextWindow!)})`;
    return model?.contextWindow === 128000
      ? `${line}\nFor custom models, 128k may be Pi's default; set contextWindow in models.json if your model's real context is smaller.`
      : line;
  }
  return `Result length: ${setting}, up to ${typeof setting === 'number' ? setting.toLocaleString('en-US') : setting === 'short' ? '4,000' : '8,000'} chars`;
}

export async function openResultsSettingsUi(ctx: any, loaded: ResultsLoaded, initialScope: PresentationScope): Promise<ResultsUiResult | undefined> {
  return ctx.ui.custom((_tui: unknown, theme: any, _kb: unknown, done: (value: ResultsUiResult) => void) => {
    let state = createResultsDraftState(loaded, initialScope);
    let list: SettingsList;
    let resetPending = false;
    const container = new Container();
    container.addChild(new Text(theme.fg('accent', theme.bold('pi-web-agent · results')), 1, 1));
    const hint = new Text('', 1, 2);
    container.addChild(hint);
    const updateHint = () => {
      hint.setText(resetPending
        ? theme.fg('warning', `Reset ${state.scope} result-length settings? Press Ctrl+R again to confirm, Esc to cancel.`)
        : theme.fg('muted', 'Ctrl+S save · Ctrl+R reset result-length scope (press twice) · Esc cancel'));
      container.invalidate();
    };
    const rebuild = () => {
      if (list) container.removeChild(list);
      list = new SettingsList(buildResultsSettingsItems(state.scope, state.draft), 6, getSettingsListTheme(), (id, value) => {
        state = applyResultsDraftValue(state, id, value);
        rebuild();
        container.invalidate();
      }, () => done({ action: 'cancel' }), { enableSearch: true });
      container.addChild(list);
    };
    updateHint();
    rebuild();
    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        const cancel = matchesKey(data, Key.escape);
        const reset = matchesKey(data, Key.ctrl('r'));
        const save = matchesKey(data, Key.ctrl('s'));
        if (resetPending) {
          resetPending = false;
          updateHint();
          if (reset) done({ action: 'reset-results', scope: state.scope });
          return;
        }
        if (cancel) return done({ action: 'cancel' });
        if (reset) { resetPending = true; updateHint(); return; }
        if (save) return done({ action: 'save-results', scope: state.scope, override: collapseResultsDraft(state.draft) });
        list.handleInput?.(data);
      }
    };
  });
}
