import { describe, expect, it, vi } from 'vitest';
import { createFirecrawlFetcher } from '../../src/fetch/firecrawl-fetch.js';

describe('firecrawl fetch backend', () => {
  it('scrapes a URL through Firecrawl and returns extracted markdown', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          markdown: '# Example Docs\n\nUseful Firecrawl extracted content.',
          metadata: {
            title: 'Example Docs',
            sourceURL: 'https://example.com/docs'
          }
        }
      })
    } as Response);

    const fetcher = createFirecrawlFetcher({ baseUrl: 'http://localhost:3002', apiKey: 'dev-key', fetchImpl });
    const result = await fetcher('https://example.com/docs');

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3002/v1/scrape',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer dev-key' }),
        body: JSON.stringify({ url: 'https://example.com/docs', formats: ['markdown'] })
      })
    );
    expect(result).toMatchObject({
      status: 'ok',
      url: 'https://example.com/docs',
      content: { title: 'Example Docs', text: '# Example Docs\n\nUseful Firecrawl extracted content.' },
      metadata: { method: 'firecrawl', cacheHit: false }
    });
  });

  it('returns needs_headless when Firecrawl succeeds without useful text', async () => {
    const fetcher = createFirecrawlFetcher({
      baseUrl: 'http://localhost:3002',
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { markdown: '   ', metadata: {} } })
      } as Response)
    });

    await expect(fetcher('https://example.com/app')).resolves.toMatchObject({
      status: 'needs_headless',
      metadata: { method: 'firecrawl', cacheHit: false },
      error: { code: 'WEAK_EXTRACTION' }
    });
  });
});
