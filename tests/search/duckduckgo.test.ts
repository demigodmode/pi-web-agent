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
});
