import {
  getSettingsListTheme,
  type ExtensionAPI
} from '@mariozechner/pi-coding-agent';
import { Container, SettingsList, Text, type SettingItem } from '@mariozechner/pi-tui';
import {
  DEFAULT_PRESENTATION_CONFIG,
  mergePresentationConfigLayers,
  resolvePresentationMode
} from '../presentation/config.js';
import {
  loadPresentationConfigLayers,
  resetPresentationConfigScope,
  savePresentationConfigScope,
  type LoadedPresentationConfig
} from '../presentation/config-store.js';
import type {
  PresentationConfig,
  PresentationConfigOverride,
  PresentationScope,
  PresentationToolName
} from '../presentation/types.js';

type CommandDeps = {
  load?: () => ReturnType<typeof loadPresentationConfigLayers>;
  save?: (scope: PresentationScope, config: PresentationConfigOverride) => Promise<void>;
  reset?: (scope: PresentationScope) => Promise<void>;
};

type SettingsUiResult =
  | { action: 'cancel' }
  | { action: 'reset'; scope: PresentationScope }
  | { action: 'save'; scope: PresentationScope; config: PresentationConfig };

export type SettingsDraftState = {
  scope: PresentationScope;
  drafts: Record<PresentationScope, PresentationConfig>;
  config: PresentationConfig;
};

const PRESENTATION_TOOL_NAMES: PresentationToolName[] = ['web_explore'];

function parseScopeToken(token: string | undefined): PresentationScope | undefined {
  return token === 'global' || token === 'project' ? token : undefined;
}

function clonePresentationConfig(config: PresentationConfig): PresentationConfig {
  return {
    defaultMode: config.defaultMode,
    tools: { ...config.tools }
  };
}

function formatConfigSummary(config: PresentationConfig) {
  const lines = [`defaultMode: ${config.defaultMode}`];

  for (const toolName of PRESENTATION_TOOL_NAMES) {
    lines.push(`${toolName}: ${config.tools[toolName]?.mode ?? 'inherit'}`);
  }

  return lines.join('\n');
}

function buildSettingsItems(scope: PresentationScope, config: PresentationConfig): SettingItem[] {
  return [
    {
      id: 'scope',
      label: 'Write scope',
      currentValue: scope,
      values: ['project', 'global']
    },
    {
      id: 'defaultMode',
      label: 'Default mode',
      currentValue: config.defaultMode,
      values: ['compact', 'preview', 'verbose']
    },
    ...PRESENTATION_TOOL_NAMES.map((toolName) => ({
      id: `tool:${toolName}`,
      label: toolName,
      currentValue: config.tools[toolName]?.mode ?? 'inherit',
      values: ['inherit', 'compact', 'preview', 'verbose']
    }))
  ];
}

function isToolName(value: string): value is PresentationToolName {
  return PRESENTATION_TOOL_NAMES.includes(value as PresentationToolName);
}

function isModeOrInherit(value: string): value is 'inherit' | 'compact' | 'preview' | 'verbose' {
  return ['inherit', 'compact', 'preview', 'verbose'].includes(value);
}

export function getInheritedConfigForScope(
  loaded: Awaited<LoadedPresentationConfig>,
  scope: PresentationScope
): PresentationConfig {
  if (scope === 'global') {
    return DEFAULT_PRESENTATION_CONFIG;
  }

  return mergePresentationConfigLayers(DEFAULT_PRESENTATION_CONFIG, loaded.global.rawConfig);
}

export function getScopeDisplayConfig(
  loaded: Awaited<LoadedPresentationConfig>,
  scope: PresentationScope
): PresentationConfig {
  if (scope === 'global') {
    return mergePresentationConfigLayers(DEFAULT_PRESENTATION_CONFIG, loaded.global.rawConfig);
  }

  return mergePresentationConfigLayers(
    DEFAULT_PRESENTATION_CONFIG,
    loaded.global.rawConfig,
    loaded.project.rawConfig
  );
}

export function createSettingsDraftState(
  loaded: Awaited<LoadedPresentationConfig>,
  initialScope: PresentationScope
): SettingsDraftState {
  const drafts = {
    global: getScopeDisplayConfig(loaded, 'global'),
    project: getScopeDisplayConfig(loaded, 'project')
  };

  return {
    scope: initialScope,
    drafts,
    config: clonePresentationConfig(drafts[initialScope])
  };
}

export function applySettingsValue(
  state: SettingsDraftState,
  id: string,
  newValue: string
): SettingsDraftState {
  const nextDrafts = {
    global: clonePresentationConfig(state.drafts.global),
    project: clonePresentationConfig(state.drafts.project)
  };

  let nextScope = state.scope;

  if (id === 'scope' && (newValue === 'project' || newValue === 'global')) {
    nextScope = newValue;
    return {
      scope: nextScope,
      drafts: nextDrafts,
      config: clonePresentationConfig(nextDrafts[nextScope])
    };
  }

  const currentDraft = clonePresentationConfig(nextDrafts[nextScope]);

  if (id === 'defaultMode' && (newValue === 'compact' || newValue === 'preview' || newValue === 'verbose')) {
    currentDraft.defaultMode = newValue;
  }

  if (id.startsWith('tool:')) {
    const toolName = id.slice('tool:'.length) as PresentationToolName;
    const nextTools = { ...currentDraft.tools };

    if (newValue === 'inherit') {
      delete nextTools[toolName];
    } else if (
      newValue === 'compact' ||
      newValue === 'preview' ||
      newValue === 'verbose'
    ) {
      nextTools[toolName] = { mode: newValue };
    }

    currentDraft.tools = nextTools;
  }

  nextDrafts[nextScope] = currentDraft;

  return {
    scope: nextScope,
    drafts: nextDrafts,
    config: clonePresentationConfig(nextDrafts[nextScope])
  };
}

export function collapsePresentationConfigToOverride(
  config: PresentationConfig,
  inheritedConfig: PresentationConfig
): PresentationConfigOverride {
  const tools = Object.fromEntries(
    PRESENTATION_TOOL_NAMES.flatMap((toolName) => {
      const configuredMode = config.tools[toolName]?.mode;
      if (!configuredMode) {
        return [];
      }

      const inheritedMode = resolvePresentationMode(toolName, inheritedConfig);
      if (configuredMode === inheritedMode) {
        return [];
      }

      return [[toolName, { mode: configuredMode }]];
    })
  ) as PresentationConfigOverride['tools'];

  return {
    defaultMode:
      config.defaultMode === inheritedConfig.defaultMode ? undefined : config.defaultMode,
    tools
  };
}

export function handleSettingsShortcut(data: string): { action: 'cancel' | 'reset' | 'save' } | undefined {
  if (data === '\u001b') {
    return { action: 'cancel' };
  }

  if (data === '\u0012') {
    return { action: 'reset' };
  }

  if (data === '\u0013') {
    return { action: 'save' };
  }

  return undefined;
}

async function openSettingsUi(
  ctx: any,
  loaded: Awaited<LoadedPresentationConfig>,
  initialScope: PresentationScope
): Promise<SettingsUiResult | undefined> {
  return ctx.ui.custom((_tui: unknown, theme: any, _kb: unknown, done: (value: SettingsUiResult) => void) => {
    let state = createSettingsDraftState(loaded, initialScope);
    let settingsList: SettingsList;

    const container = new Container();
    container.addChild(new Text(theme.fg('accent', theme.bold('pi-web-agent settings')), 1, 1));
    container.addChild(
      new Text(
        theme.fg('muted', 'Ctrl+S save · Ctrl+R reset scope · Esc cancel'),
        1,
        2
      )
    );

    const rebuildSettingsList = () => {
      if (settingsList) {
        container.removeChild(settingsList);
      }

      settingsList = new SettingsList(
        buildSettingsItems(state.scope, state.config),
        Math.min(PRESENTATION_TOOL_NAMES.length + 8, 18),
        getSettingsListTheme(),
        (id, newValue) => {
          state = applySettingsValue(state, id, newValue);
          rebuildSettingsList();
          container.invalidate();
        },
        () => done({ action: 'save', scope: state.scope, config: state.config }),
        { enableSearch: true }
      );

      container.addChild(settingsList);
    };

    rebuildSettingsList();

    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        const shortcut = handleSettingsShortcut(JSON.stringify(data).slice(1, -1));

        if (shortcut?.action === 'cancel') {
          done({ action: 'cancel' });
          return;
        }

        if (shortcut?.action === 'reset') {
          done({ action: 'reset', scope: state.scope });
          return;
        }

        if (shortcut?.action === 'save') {
          done({ action: 'save', scope: state.scope, config: state.config });
          return;
        }

        settingsList.handleInput?.(data);
      }
    };
  });
}

export function registerWebAgentConfigCommands(pi: ExtensionAPI, deps: CommandDeps = {}) {
  const load = deps.load ?? (() => loadPresentationConfigLayers());
  const save = deps.save ?? ((scope, config) => savePresentationConfigScope({}, scope, config));
  const reset = deps.reset ?? ((scope) => resetPresentationConfigScope({}, scope));

  pi.registerCommand('web-agent', {
    description: 'Open settings or manage pi-web-agent presentation config',
    handler: async (args, ctx) => {
      const [action, maybeScope] = (args ?? '').trim().split(/\s+/).filter(Boolean);

      if (action === 'show') {
        const loaded = await load();
        ctx.ui.notify(
          [
            formatConfigSummary(loaded.effectiveConfig),
            `global: ${loaded.global.path}${loaded.global.exists ? '' : ' (missing)'}`,
            `project: ${loaded.project.path}${loaded.project.exists ? '' : ' (missing)'}`
          ].join('\n'),
          'info'
        );
        return;
      }

      if (action === 'reset') {
        const scope = parseScopeToken(maybeScope) ?? 'project';
        await reset(scope);
        ctx.ui.notify(`Reset ${scope} config`, 'info');
        return;
      }

      if (action === 'mode') {
        const [, first, second] = (args ?? '').trim().split(/\s+/).filter(Boolean);
        const loaded = await load();
        const scope: PresentationScope = 'project';
        const baseConfig = getScopeDisplayConfig(loaded, scope);
        const inheritedConfig = getInheritedConfigForScope(loaded, scope);

        if (first && isModeOrInherit(first) && first !== 'inherit') {
          await save(scope, collapsePresentationConfigToOverride({ ...baseConfig, defaultMode: first }, inheritedConfig));
          ctx.ui.notify(`Saved project default mode = ${first}`, 'info');
          return;
        }

        if (first && second && isToolName(first) && isModeOrInherit(second)) {
          const nextTools = { ...baseConfig.tools };

          if (second === 'inherit') {
            delete nextTools[first];
          } else {
            nextTools[first] = { mode: second };
          }

          await save(
            scope,
            collapsePresentationConfigToOverride({ ...baseConfig, tools: nextTools }, inheritedConfig)
          );
          ctx.ui.notify(`Saved project ${first} = ${second}`, 'info');
          return;
        }

        ctx.ui.notify(
          'Usage: /web-agent mode <compact|preview|verbose> or /web-agent mode <tool> <inherit|compact|preview|verbose>',
          'info'
        );
        return;
      }

      if (!action || action === 'settings') {
        const loaded = await load();
        const initialScope: PresentationScope = 'project';
        const result = await openSettingsUi(ctx, loaded, initialScope);

        if (!result || result.action === 'cancel') {
          return;
        }

        if (result.action === 'reset') {
          await reset(result.scope);
          ctx.ui.notify(`Reset ${result.scope} config`, 'info');
          return;
        }

        await save(
          result.scope,
          collapsePresentationConfigToOverride(
            result.config,
            getInheritedConfigForScope(loaded, result.scope)
          )
        );
        ctx.ui.notify(`Saved ${result.scope} config`, 'info');
        return;
      }

      ctx.ui.notify(
        'Use /web-agent, /web-agent show, /web-agent reset project, or /web-agent settings',
        'info'
      );
    }
  });
}
