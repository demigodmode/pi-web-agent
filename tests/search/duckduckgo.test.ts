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
    const results = parseDuckDuckGoResults(html);

    expect(results).toEqual([
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
    ]);
  });

  it('decodes DuckDuckGo redirect urls into destination urls', () => {
    const html = `
      <div class="result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fpi.dev%2F&rut=abc">pi.dev</a>
        <a class="result__snippet">Pi docs</a>
      </div>
    `;

    const results = parseDuckDuckGoResults(html);

    expect(results).toEqual([
      {
        title: 'pi.dev',
        url: 'https://pi.dev/',
        snippet: 'Pi docs'
      }
    ]);
  });

  it('falls back to the original url when redirect decoding fails', () => {
    const html = `
      <div class="result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=%E0%A4%A&rut=abc">broken</a>
        <a class="result__snippet">Broken redirect</a>
      </div>
    `;

    const results = parseDuckDuckGoResults(html);

    expect(results).toEqual([
      {
        title: 'broken',
        url: '//duckduckgo.com/l/?uddg=%E0%A4%A&rut=abc',
        snippet: 'Broken redirect'
      }
    ]);
  });
});
