import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSearchUrl, parseDuckDuckGoResults } from '../../src/search/duckduckgo.js';

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
});
