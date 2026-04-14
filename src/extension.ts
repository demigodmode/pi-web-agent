import { createWebFetchTool } from './tools/web-fetch.js';
import { createWebFetchHeadlessTool } from './tools/web-fetch-headless.js';
import { createWebSearchTool } from './tools/web-search.js';

export function createExtension() {
  return {
    tools: {
      web_search: createWebSearchTool(),
      web_fetch: createWebFetchTool(),
      web_fetch_headless: createWebFetchHeadlessTool()
    }
  };
}
