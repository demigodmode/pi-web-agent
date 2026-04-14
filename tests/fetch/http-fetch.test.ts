import { describe, expect, it, vi } from 'vitest';
import { createHttpFetcher } from '../../src/fetch/http-fetch.js';

describe('http fetcher', () => {
  it('returns ok for clearly readable HTML', async () => {
    const fetcher = createHttpFetcher({
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        url: 'https://example.com/article',
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => '<html><body><article><p>Readable article text with enough content to look solid.</p></article></body></html>'
      } as Response)
    });

    const result = await fetcher('https://example.com/article');
    expect(result.status).toBe('ok');
    expect(result.metadata.method).toBe('http');
  });

  it('returns needs_headless for weak script-shell pages', async () => {
    const fetcher = createHttpFetcher({
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        url: 'https://example.com/app',
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => '<html><body><div id="app"></div><script src="app.js"></script></body></html>'
      } as Response)
    });

    const result = await fetcher('https://example.com/app');
    expect(result.status).toBe('needs_headless');
  });

  it('returns unsupported for binary content', async () => {
    const fetcher = createHttpFetcher({
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        url: 'https://example.com/file.pdf',
        headers: new Headers({ 'content-type': 'application/pdf' }),
        text: async () => ''
      } as Response)
    });

    const result = await fetcher('https://example.com/file.pdf');
    expect(result.status).toBe('unsupported');
  });
});
