import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
  loadPresentationConfigLayers,
  resetPresentationConfigScope,
  savePresentationConfigScope
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

function parseScopeToken(token: string | undefined): PresentationScope | undefined {
  return token === 'global' || token === 'project' ? token : undefined;
}

function formatConfigSummary(config: PresentationConfig) {
  const lines = [`defaultMode: ${config.defaultMode}`];

  for (const toolName of [
    'web_search',
    'web_fetch',
    'web_fetch_headless',
    'web_explore'
  ] as PresentationToolName[]) {
    lines.push(`${toolName}: ${config.tools[toolName]?.mode ?? 'inherit'}`);
  }

  return lines.join('\n');
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
        ctx.ui.notify('settings UI not implemented yet in this task', 'info');
        return;
      }

      void save;
      ctx.ui.notify(
        'Use /web-agent, /web-agent show, /web-agent reset project, or /web-agent settings',
        'info'
      );
    }
  });
}
