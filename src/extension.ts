import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from 'typebox';
import { registerWebAgentConfigCommands } from './commands/web-agent-config.js';
import { DEFAULT_PRESENTATION_CONFIG, resolvePresentationMode } from './presentation/config.js';
import { loadPresentationConfigLayers } from './presentation/config-store.js';
import { selectPresentationView } from './presentation/select-view.js';
import type {
  PresentationConfig,
  PresentationEnvelope,
  PresentationToolName
} from './presentation/types.js';
import { createWebExploreTool } from './tools/web-explore.js';
import type { WebExploreResponse } from './types.js';

type ToolResultWithPresentation = {
  presentation?: PresentationEnvelope;
};

async function getEffectivePresentationConfig(pi: ExtensionAPI): Promise<PresentationConfig> {
  const store = (
    pi as ExtensionAPI & {
      __presentationConfigStore?: {
        load?: typeof loadPresentationConfigLayers;
      };
    }
  ).__presentationConfigStore;

  try {
    const loaded = await (store?.load?.() ?? loadPresentationConfigLayers());
    return loaded.effectiveConfig;
  } catch {
    return DEFAULT_PRESENTATION_CONFIG;
  }
}

async function renderToolText(
  pi: ExtensionAPI,
  toolName: PresentationToolName,
  details: ToolResultWithPresentation
): Promise<string> {
  const config = await getEffectivePresentationConfig(pi);
  const mode = resolvePresentationMode(toolName, config);
  return selectPresentationView(details.presentation, mode) ?? JSON.stringify(details, null, 2);
}

export default function extension(pi: ExtensionAPI) {
  registerWebAgentConfigCommands(pi);

  const webExplore =
    (pi as ExtensionAPI & { __webExploreTool?: ReturnType<typeof createWebExploreTool> }).__webExploreTool ??
    createWebExploreTool();

  pi.on('before_agent_start', async (event) => ({
    systemPrompt:
      `${event.systemPrompt}\n\n` +
      'For web research questions that require finding and comparing sources, use web_explore. ' +
      'web_explore handles search, fetch, source ranking, and headless escalation internally. ' +
      'If more web evidence is needed after web_explore, call web_explore again with a narrower query; do not use shell/network commands such as curl, Invoke-WebRequest, npm view/search/pack, or direct HTTP URLs for web research.'
  }));

  pi.registerTool({
    name: 'web_explore',
    label: 'Web Explore',
    description:
      'Research a web question using bounded search/fetch passes, source ranking, and targeted headless escalation. Use this for web research, current docs/discussion lookups, and recommendation summaries.',
    parameters: Type.Object({
      query: Type.String({ description: 'Web research question to explore.' })
    }),
    async execute(_toolCallId, params) {
      const result: WebExploreResponse = await webExplore({ query: params.query });
      return {
        content: [
          {
            type: 'text',
            text: await renderToolText(pi, 'web_explore', result)
          }
        ],
        details: result,
        isError: result.status === 'error'
      };
    }
  });
}
