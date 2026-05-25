import { describe, expect, it } from 'vitest';
import { createFirecrawlFetcher } from '../../src/fetch/firecrawl-fetch.js';
import { createSearxngSearchTool } from '../../src/search/searxng.js';

const searxngUrl = process.env.SEARXNG_TEST_URL;
const firecrawlUrl = process.env.FIRECRAWL_TEST_URL;

const describeSearxng = searxngUrl ? describe : describe.skip;
const describeFirecrawl = firecrawlUrl ? describe : describe.skip;

describeSearxng('live SearXNG backend', () => {
  it('returns at least one normalized JSON result for a stable query', async () => {
    const search = createSearxngSearchTool({ baseUrl: searxngUrl! });
    const result = await search({ query: 'example domain' });

    expect(result.status).toBe('ok');
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0]).toEqual(expect.objectContaining({
      title: expect.any(String),
      url: expect.stringMatching(/^https?:\/\//),
      snippet: expect.any(String)
    }));
  });
});

describeFirecrawl('live Firecrawl backend', () => {
  it('scrapes example.com without asserting exact formatting', async () => {
    const fetcher = createFirecrawlFetcher({
      baseUrl: firecrawlUrl!,
      apiKey: process.env.PI_WEB_AGENT_FIRECRAWL_API_KEY
    });
    const result = await fetcher('https://example.com');

    expect(result.status).toBe('ok');
    expect(result.content?.text.toLowerCase()).toContain('example');
  });
});
