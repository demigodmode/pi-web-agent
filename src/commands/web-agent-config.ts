import {
  getSettingsListTheme,
  type ExtensionAPI
} from '@mariozechner/pi-coding-agent';
import { Container, SettingsList, Text, type SettingItem } from '@mariozechner/pi-tui';
import {
  loadPresentationConfigLayers,
  resetPresentationConfigScope,
  savePresentationConfigScope,
  type LoadedPresentationConfig
} from '../presentation/config-store.js';
import type {
  PresentationConfig,
  PresentationScope,
  PresentationToolName
} from '../presentation/types.js';

type CommandDeps = {
  load?: () => ReturnType<typeof loadPresentationConfigLayers>;
  save?: (scope: PresentationScope, config: PresentationConfig) => Promise<void>;
  reset?: (scope: PresentationScope) => Promise<void>;
};

type SettingsUiResult =
  | { action: 'cancel' }
  | { action: 'reset'; scope: PresentationScope }
  | { action: 'save'; scope: PresentationScope; config: PresentationConfig };

const PRESENTATION_TOOL_NAMES: PresentationToolName[] = [
  'web_search',
  'web_fetch',
  'web_fetch_headless',
  'web_explore'
];

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

function getScopeDraft(loaded: Awaited<LoadedPresentationConfig>, scope: PresentationScope) {
  if (scope === 'global') {
    return loaded.global.rawConfig
      ? {
          defaultMode: loaded.global.rawConfig.defaultMode ?? loaded.effectiveConfig.defaultMode,
          tools: { ...loaded.global.rawConfig.tools }
        }
      : clonePresentationConfig(loaded.effectiveConfig);
  }

  return loaded.project.rawConfig
    ? {
        defaultMode: loaded.project.rawConfig.defaultMode ?? loaded.effectiveConfig.defaultMode,
        tools: { ...loaded.project.rawConfig.tools }
      }
    : clonePresentationConfig(loaded.effectiveConfig);
}

async function openSettingsUi(
  ctx: any,
  initialScope: PresentationScope,
  initialConfig: PresentationConfig
): Promise<SettingsUiResult | undefined> {
  return ctx.ui.custom((_tui: unknown, theme: any, _kb: unknown, done: (value: SettingsUiResult) => void) => {
    let draftScope: PresentationScope = initialScope;
    let draftConfig = clonePresentationConfig(initialConfig);
    let settingsList: SettingsList;

    const container = new Container();
    container.addChild(new Text(theme.fg('accent', theme.bold('pi-web-agent settings')), 1, 1));

    const rebuildSettingsList = () => {
      if (settingsList) {
        container.removeChild(settingsList);
      }

      settingsList = new SettingsList(
        buildSettingsItems(draftScope, draftConfig),
        Math.min(PRESENTATION_TOOL_NAMES.length + 6, 18),
        getSettingsListTheme(),
        (id, newValue) => {
          if (id === 'scope' && (newValue === 'project' || newValue === 'global')) {
            draftScope = newValue;
            rebuildSettingsList();
            container.invalidate();
            return;
          }

          if (
            id === 'defaultMode' &&
            (newValue === 'compact' || newValue === 'preview' || newValue === 'verbose')
          ) {
            draftConfig = { ...draftConfig, defaultMode: newValue };
            rebuildSettingsList();
            container.invalidate();
            return;
          }

          if (id.startsWith('tool:')) {
            const toolName = id.slice('tool:'.length) as PresentationToolName;
            const nextTools = { ...draftConfig.tools };

            if (newValue === 'inherit') {
              delete nextTools[toolName];
            } else if (
              newValue === 'compact' ||
              newValue === 'preview' ||
              newValue === 'verbose'
            ) {
              nextTools[toolName] = { mode: newValue };
            }

            draftConfig = { ...draftConfig, tools: nextTools };
            rebuildSettingsList();
            container.invalidate();
          }
        },
        () => done({ action: 'save', scope: draftScope, config: draftConfig }),
        { enableSearch: true }
      );

      container.addChild(settingsList);
    };

    rebuildSettingsList();

    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => settingsList.handleInput?.(data)
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

      if (!action || action === 'show') {
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
        ctx.ui.notify(`Reset ${scope} config`, 'success');
        return;
      }

      if (action === 'mode') {
        ctx.ui.notify('mode command not implemented yet in this task', 'info');
        return;
      }

      if (action === 'settings') {
        const loaded = await load();
        const initialScope: PresentationScope = 'project';
        const result = await openSettingsUi(ctx, initialScope, getScopeDraft(loaded, initialScope));

        if (!result || result.action === 'cancel') {
          return;
        }

        if (result.action === 'reset') {
          await reset(result.scope);
          ctx.ui.notify(`Reset ${result.scope} config`, 'success');
          return;
        }

        await save(result.scope, result.config);
        ctx.ui.notify(`Saved ${result.scope} config`, 'success');
        return;
      }

      ctx.ui.notify(
        'Use /web-agent, /web-agent show, /web-agent reset project, or /web-agent settings',
        'info'
      );
    }
  });
}
