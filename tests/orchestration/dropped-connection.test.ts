import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { createHttpFetcher } from '../../src/fetch/http-fetch.js';
import { createResearchWorkflow } from '../../src/orchestration/index.js';
import { createWebFetchTool } from '../../src/tools/web-fetch.js';

const article = `<!doctype html><html><head><title>Connection pooling guide</title></head><body><article>
<h1>Connection pooling guide</h1>
${Array.from({ length: 8 }, (_, i) => `<p>Paragraph ${i}: connection pooling keeps a small set of open connections around so each request does not pay for a new handshake, and the pool size should match how many requests actually run at once.</p>`).join('\n')}
</article></body></html>`;

describe('a page whose connection drops (#76)', () => {
  it.each([
    ['before any response', '/drop-early'],
    ['in the middle of the body', '/drop-mid-body']
  ])('skips a page that drops %s and still answers from the others', async (_label, dropPath) => {
    const server = createServer((request, response) => {
      if (request.url === '/drop-early') {
        request.socket.destroy();
        return;
      }
      if (request.url === '/drop-mid-body') {
        response.writeHead(200, { 'content-type': 'text/html', 'content-length': '100000' });
        response.write('<!doctype html><html><body><p>partial');
        setTimeout(() => request.socket.destroy(), 20);
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(article);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
      const httpFetcher = createHttpFetcher();
      const workflow = createResearchWorkflow({
        search: vi.fn(async () => ({
          status: 'ok' as const,
          results: [
            { title: 'Flaky page', url: `${base}${dropPath}`, snippet: 'connection pooling' },
            { title: 'Connection pooling guide', url: `${base}/good`, snippet: 'connection pooling' }
          ],
          metadata: { backend: 'duckduckgo' as const, cacheHit: false }
        })),
        fetchPage: createWebFetchTool({ fetchPage: ({ url, query, signal }) => httpFetcher(url, query, signal) }),
        headlessFetch: vi.fn(async ({ url }: { url: string }) => ({
          status: 'error' as const,
          url,
          metadata: { method: 'headless' as const, cacheHit: false },
          error: { code: 'HEADLESS_FAILED', message: 'not in this test' }
        }))
      });

      const result = await workflow.run({ query: 'connection pooling' });
      expect(result.evidence.map((item) => item.url)).toContain(`${base}/good`);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
