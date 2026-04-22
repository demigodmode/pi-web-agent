import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

export function registerWebAgentConfigCommands(pi: ExtensionAPI) {
  pi.registerCommand('web-agent', {
    description: 'Open settings or manage pi-web-agent presentation config',
    handler: async (_args, ctx) => {
      ctx.ui.notify('web-agent settings are not wired up yet', 'info');
    }
  });
}
