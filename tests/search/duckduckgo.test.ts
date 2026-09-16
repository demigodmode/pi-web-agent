import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildSearchUrl, DuckDuckGoHttpError, fetchDuckDuckGoHtml, parseDuckDuckGoResults } from '../../src/search/duckduckgo.js';

describe('DuckDuckGo search parsing', () => {
  it('builds a deterministic search URL', () => {
    expect(buildSearchUrl('pi web agent')).toBe(
      'https://html.duckduckgo.com/html/?q=pi+web+agent'
    );
  });

  it('parses normalized title, url, and snippet records', () => {
    const html = readFileSync('tests/fixtures/duckduckgo/basic-results.html', 'utf8');
    const parsed = parseDuckDuckGoResults(html);

    expect(parsed).toEqual({
      results: [
        {
          title: 'Example Article',
          url: 'https://example.com/article',
          snippet: 'First example snippet.'
        },
        {
          title: 'Another Result',
          url: 'https://example.org/post',
          snippet: 'Second example snippet.'
        }
      ],
      noResults: false,
      hasResultContainers: true
    });
  });

  it('decodes DuckDuckGo redirect urls into destination urls', () => {
    const html = `
      <div class="result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fpi.dev%2F&rut=abc">pi.dev</a>
        <a class="result__snippet">Pi docs</a>
      </div>
    `;

    const parsed = parseDuckDuckGoResults(html);

    expect(parsed).toEqual({
      results: [
        {
          title: 'pi.dev',
          url: 'https://pi.dev/',
          snippet: 'Pi docs'
        }
      ],
      noResults: false,
      hasResultContainers: true
    });
  });

  it('falls back to the original url when redirect decoding fails', () => {
    const html = `
      <div class="result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=%E0%A4%A&rut=abc">broken</a>
        <a class="result__snippet">Broken redirect</a>
      </div>
    `;

    const parsed = parseDuckDuckGoResults(html);

    expect(parsed).toEqual({
      results: [
        {
          title: 'broken',
          url: '//duckduckgo.com/l/?uddg=%E0%A4%A&rut=abc',
          snippet: 'Broken redirect'
        }
      ],
      noResults: false,
      hasResultContainers: true
    });
  });

  it('detects a no-results page separately from a parse failure', () => {
    const html = `
      <html>
        <body>
          <div class="results">
            <div class="no-results">No results found for your search.</div>
          </div>
        </body>
      </html>
    `;

    const parsed = parseDuckDuckGoResults(html);

    expect(parsed).toEqual({
      results: [],
      noResults: true,
      hasResultContainers: false
    });
  });

  it('reports when the page does not match the expected results format', () => {
    const html = `
      <html>
        <body>
          <main>
            <h1>Unexpected page</h1>
            <p>Nothing here looks like a DuckDuckGo results page.</p>
          </main>
        </body>
      </html>
    `;

    const parsed = parseDuckDuckGoResults(html);

    expect(parsed).toEqual({
      results: [],
      noResults: false,
      hasResultContainers: false
    });
  });

  it('sends browser-like headers so DuckDuckGo does not treat us as a bot', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue('<html></html>')
    } as unknown as Response);

    await fetchDuckDuckGoHtml('playwright', { fetchImpl });

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers['User-Agent']).toMatch(/Mozilla\/5\.0/);
    expect(init.headers.Accept).toMatch(/text\/html/);
    expect(init.headers['Accept-Language']).toMatch(/en/);
  });

  it('does not retry a 429 internally; the fallback policy owns retries (#55)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '9' } }))
      .mockResolvedValueOnce(new Response('<html>ok</html>', { status: 200 }));

    const error = await fetchDuckDuckGoHtml('playwright', { fetchImpl }).catch((e) => e);

    expect(error).toBeInstanceOf(DuckDuckGoHttpError);
    expect(error.message).toMatch(/429/);
    expect(error.status).toBe(429);
    expect(error.headers.get('retry-after')).toBe('9');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fetchDuckDuckGoHtml makes one request and throws DuckDuckGoHttpError on a non-2xx', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 503 }));
    const error = await fetchDuckDuckGoHtml('q', { fetchImpl: fetchImpl as any }).catch((e) => e);
    expect(error).toBeInstanceOf(DuckDuckGoHttpError);
    expect(error.status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
