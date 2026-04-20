import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { createWebExploreTool } from './tools/web-explore.js';
import { createWebFetchTool } from './tools/web-fetch.js';
import { createWebFetchHeadlessTool } from './tools/web-fetch-headless.js';
import { createWebSearchTool } from './tools/web-search.js';

const WEB_EXPLORE_REMINDER_TYPE = 'pi-web-agent-web-explore-reminder';
const WEB_EXPLORE_REMINDER =
  'web_explore has already been used for this research task. Only call low-level web tools if there is a specific unresolved gap. Do not keep searching or fetching just for extra confirmation.';

type ContextMessage = {
  role: string;
  toolName?: string;
  isError?: boolean;
  customType?: string;
  content?: unknown;
  timestamp?: number;
};

function hasSuccessfulWebExplore(messages: ContextMessage[]) {
  return messages.some((message) => message.role === 'toolResult' && message.toolName === 'web_explore' && !message.isError);
}

function hasWebExploreReminder(messages: ContextMessage[]) {
  return messages.some(
    (message) => message.role === 'custom' && message.customType === WEB_EXPLORE_REMINDER_TYPE
  );
}

export default function extension(pi: ExtensionAPI) {
  const webSearch = createWebSearchTool();
  const webFetch = createWebFetchTool();
  const webFetchHeadless = createWebFetchHeadlessTool();
  const webExplore = createWebExploreTool();

  pi.on('before_agent_start', async (event) => {
    return {
      systemPrompt:
        `${event.systemPrompt}\n\n` +
        'For web research questions that require finding and comparing multiple sources, prefer web_explore. ' +
        'Use web_search, web_fetch, and web_fetch_headless for direct/manual operations like explicit search calls, specific URL reads, or debugging. ' +
        'After using web_explore, only call low-level web tools if there is a specific unresolved gap. ' +
        'Do not keep searching or fetching just for extra confirmation.'
    };
  });

  (pi as any).on('context', async (event: { messages: ContextMessage[] }) => {
    if (!hasSuccessfulWebExplore(event.messages) || hasWebExploreReminder(event.messages)) {
      return { messages: event.messages };
    }

    return {
      messages: [
        ...event.messages,
        {
          role: 'custom',
          customType: WEB_EXPLORE_REMINDER_TYPE,
          content: WEB_EXPLORE_REMINDER,
          display: false,
          timestamp: Date.now()
        }
      ]
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
      const result = await webSearch({ query: params.query });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
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
      const result = await webFetch({ url: params.url });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
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
      const result = await webFetchHeadless({ url: params.url });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
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
      const result = await webExplore({ query: params.query });
      return {
        content: [
          {
            type: 'text',
            text: result.status === 'ok' ? result.text : JSON.stringify(result, null, 2)
          }
        ],
        details: result,
        isError: result.status === 'error'
      };
    }
  });
}
