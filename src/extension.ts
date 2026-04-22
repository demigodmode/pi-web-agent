import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
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
import { createWebFetchTool } from './tools/web-fetch.js';
import { createWebFetchHeadlessTool } from './tools/web-fetch-headless.js';
import { createWebSearchTool } from './tools/web-search.js';
import type {
  WebExploreResponse,
  WebFetchHeadlessResponse,
  WebFetchResponse,
  WebSearchResponse
} from './types.js';

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

  const webSearch = createWebSearchTool();
  const webFetch = createWebFetchTool();
  const webFetchHeadless = createWebFetchHeadlessTool();
  const webExplore = createWebExploreTool();
  let webExploreUsedInCurrentFlow = false;
  const postWebExploreGuardError = {
    code: 'POST_WEB_EXPLORE_GUARD',
    message:
      'web_explore already ran for this research task. Only use low-level web tools if there is a specific unresolved gap.'
  };

  async function guardSearchResponse() {
    const result: WebSearchResponse = {
      status: 'error',
      results: [],
      metadata: {
        backend: 'duckduckgo',
        cacheHit: false
      },
      error: postWebExploreGuardError,
      presentation: {
        mode: 'compact',
        views: {
          compact: `Search failed: ${postWebExploreGuardError.message}`
        }
      }
    };

    return {
      content: [{ type: 'text' as const, text: await renderToolText(pi, 'web_search', result) }],
      details: result,
      isError: true as const
    };
  }

  async function guardFetchResponse(url: string) {
    const result: WebFetchResponse = {
      status: 'error',
      url,
      metadata: {
        method: 'http',
        cacheHit: false
      },
      error: postWebExploreGuardError,
      presentation: {
        mode: 'compact',
        views: {
          compact: `Fetch failed: ${postWebExploreGuardError.message}`
        }
      }
    };

    return {
      content: [{ type: 'text' as const, text: await renderToolText(pi, 'web_fetch', result) }],
      details: result,
      isError: true as const
    };
  }

  async function guardHeadlessResponse(url: string) {
    const result: WebFetchHeadlessResponse = {
      status: 'error',
      url,
      metadata: {
        method: 'headless',
        cacheHit: false
      },
      error: postWebExploreGuardError,
      presentation: {
        mode: 'compact',
        views: {
          compact: `Fetch failed: ${postWebExploreGuardError.message}`
        }
      }
    };

    return {
      content: [
        {
          type: 'text' as const,
          text: await renderToolText(pi, 'web_fetch_headless', result)
        }
      ],
      details: result,
      isError: true as const
    };
  }

  pi.on('before_agent_start', async (event) => {
    webExploreUsedInCurrentFlow = false;

    return {
      systemPrompt:
        `${event.systemPrompt}\n\n` +
        'For web research questions that require finding and comparing multiple sources, prefer web_explore. ' +
        'Use web_search, web_fetch, and web_fetch_headless for direct/manual operations like explicit search calls, specific URL reads, or debugging. ' +
        'After using web_explore, only call low-level web tools if there is a specific unresolved gap. ' +
        'Do not keep searching or fetching just for extra confirmation.'
    };
  });

  pi.registerTool({
    name: 'web_search',
    label: 'Web Search',
    description:
      'Direct search tool for manual discovery of links and snippets. Use for explicit search requests or when the user wants raw search results. Prefer web_explore for broader research questions.',
    parameters: Type.Object({
      query: Type.String({ description: 'Search query.' })
    }),
    async execute(_toolCallId, params) {
      if (webExploreUsedInCurrentFlow) {
        return guardSearchResponse();
      }

      const result = await webSearch({ query: params.query });
      return {
        content: [{ type: 'text', text: await renderToolText(pi, 'web_search', result) }],
        details: result,
        isError: result.status === 'error'
      };
    }
  });

  pi.registerTool({
    name: 'web_fetch',
    label: 'Web Fetch',
    description:
      'Direct HTTP page fetch for a specific URL. Use when the user wants one page read directly. Prefer web_explore for broader research across multiple sources.',
    parameters: Type.Object({
      url: Type.String({ description: 'HTTP or HTTPS URL to fetch.' })
    }),
    async execute(_toolCallId, params) {
      if (webExploreUsedInCurrentFlow) {
        return guardFetchResponse(params.url);
      }

      const result = await webFetch({ url: params.url });
      return {
        content: [{ type: 'text', text: await renderToolText(pi, 'web_fetch', result) }],
        details: result,
        isError: result.status === 'error'
      };
    }
  });

  pi.registerTool({
    name: 'web_fetch_headless',
    label: 'Web Fetch Headless',
    description:
      'Direct headless page fetch for a specific URL when browser rendering is explicitly needed. Prefer web_explore for research tasks; it decides headless escalation internally.',
    parameters: Type.Object({
      url: Type.String({ description: 'HTTP or HTTPS URL to fetch in headless mode.' })
    }),
    async execute(_toolCallId, params) {
      if (webExploreUsedInCurrentFlow) {
        return guardHeadlessResponse(params.url);
      }

      const result = await webFetchHeadless({ url: params.url });
      return {
        content: [{ type: 'text', text: await renderToolText(pi, 'web_fetch_headless', result) }],
        details: result,
        isError: result.status === 'error'
      };
    }
  });

  pi.registerTool({
    name: 'web_explore',
    label: 'Web Explore',
    description:
      'Research a web question using bounded search/fetch passes, source ranking, and targeted headless escalation. Prefer this for multi-source web research, current docs/discussion lookups, and recommendation summaries. Use this instead of chaining low-level web tools for the same research task.',
    parameters: Type.Object({
      query: Type.String({ description: 'Web research question to explore.' })
    }),
    async execute(_toolCallId, params) {
      const result: WebExploreResponse = await webExplore({ query: params.query });
      if (result.status === 'ok') {
        webExploreUsedInCurrentFlow = true;
      }

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
