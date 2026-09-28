import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { createHttpFetcher } from '../../src/fetch/http-fetch.js';
import { createResearchWorkflow } from '../../src/orchestration/index.js';
import { createWebFetchTool } from '../../src/tools/web-fetch.js';

describe('cancelling a research run (#59)', () => {
  it('stops fetching, drops the open connection and never escalates to headless', async () => {
    const seen = { requests: 0, closed: 0 };
    const server = createServer((request) => {
      seen.requests += 1;
      request.socket.once('close', () => (seen.closed += 1));
      // Never answers, like a stalled site.
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
      const httpFetcher = createHttpFetcher();
      const headlessFetch = vi.fn();
      const workflow = createResearchWorkflow({
        search: vi.fn(async () => ({
          status: 'ok' as const,
          results: ['a', 'b', 'c'].map((name) => ({ title: name, url: `${base}/${name}`, snippet: '' })),
          metadata: { backend: 'duckduckgo' as const, cacheHit: false }
        })),
        fetchPage: createWebFetchTool({ fetchPage: ({ url, query, signal }) => httpFetcher(url, query, signal) }),
        headlessFetch
      });

      const controller = new AbortController();
      const run = workflow.run({ query: 'stalled pages', signal: controller.signal });
      await vi.waitFor(() => expect(seen.requests).toBe(1));
      controller.abort();

      await expect(run).rejects.toThrow('Operation aborted');
      await vi.waitFor(() => expect(seen.closed).toBe(1));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(seen.requests).toBe(1);
      expect(headlessFetch).not.toHaveBeenCalled();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
