import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { createWebExploreTool } from './tools/web-explore.js';
import { createWebFetchTool } from './tools/web-fetch.js';
import { createWebFetchHeadlessTool } from './tools/web-fetch-headless.js';
import { createWebSearchTool } from './tools/web-search.js';

export default function extension(pi: ExtensionAPI) {
  const webSearch = createWebSearchTool();
  const webFetch = createWebFetchTool();
  const webFetchHeadless = createWebFetchHeadlessTool();
  const webExplore = createWebExploreTool();

  pi.registerTool({
    name: 'web_search',
    label: 'Web Search',
    description: 'Find relevant pages and return titles, URLs, and snippets only.',
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
    description: 'Fetch a URL over plain HTTP and extract readable content.',
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
    description: 'Fetch a URL with an explicitly requested headless browser path.',
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
      'Research a web question using bounded search/fetch passes, source ranking, and targeted headless escalation. Returns concise findings, supporting sources, and a caveat when evidence is incomplete.',
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
