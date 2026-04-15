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

  it('returns needs_headless for weak content on a js-heavy shell page', async () => {
    const fetcher = createHttpFetcher({
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        url: 'https://www.airbnb.com/',
        headers: new Headers({ 'content-type': 'text/html;charset=utf-8' }),
        text: async () =>
          '<html><head><title>Airbnb | Vacation rentals, cabins, beach houses, & more</title></head><body><div id="root"></div><noscript>Enable JavaScript</noscript><main><p>Become a host</p><p>It\'s easy to start hosting and earn extra income.</p></main></body></html>'
      } as Response)
    });

    const result = await fetcher('https://www.airbnb.com/');
    expect(result.status).toBe('needs_headless');
    expect(result.metadata.method).toBe('http');
  });

  it('returns ok for a short but legitimate simple page', async () => {
    const fetcher = createHttpFetcher({
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        url: 'https://example.com/',
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () =>
          '<html><head><title>Example Domain</title></head><body><main><p>This domain is for use in documentation examples without needing permission.</p><p>Avoid use in operations.</p><a href="https://iana.org">Learn more</a></main></body></html>'
      } as Response)
    });

    const result = await fetcher('https://example.com/');
    expect(result.status).toBe('ok');
    expect(result.metadata.method).toBe('http');
  });

  it('falls back to simple extraction and returns ok when content is still readable', async () => {
    const fetcher = createHttpFetcher({
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        url: 'https://example.com/broken-css',
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        text: async () =>
          `<html>
            <head>
              <title>Broken CSS Page</title>
              <style>
                .btn {
                  color: red;
                  &:hover {
                    color: blue;
                  }
                }
              </style>
            </head>
            <body>
              <main>
                <h1>Broken CSS Page</h1>
                <p>This page should still produce useful readable text through the fallback path.</p>
                <p>It contains enough content to count as a legitimate HTTP success.</p>
              </main>
            </body>
          </html>`
      } as Response)
    });

    const result = await fetcher('https://example.com/broken-css');
    expect(result.status).toBe('ok');
    expect(result.content?.title).toBe('Broken CSS Page');
    expect(result.content?.text).toContain('useful readable text through the fallback path');
  });

  it('returns needs_headless instead of crashing when fallback content is still weak', async () => {
    const fetcher = createHttpFetcher({
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        url: 'https://example.com/broken-shell',
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        text: async () =>
          `<html>
            <head>
              <title>Broken Shell</title>
              <style>
                .card {
                  &:hover {
                    opacity: 1;
                  }
                }
              </style>
            </head>
            <body>
              <div id="app"></div>
              <noscript>Enable JavaScript</noscript>
              <main><p>Hi</p></main>
            </body>
          </html>`
      } as Response)
    });

    const result = await fetcher('https://example.com/broken-shell');
    expect(result.status).toBe('needs_headless');
    expect(result.error?.code).toBe('WEAK_EXTRACTION');
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
