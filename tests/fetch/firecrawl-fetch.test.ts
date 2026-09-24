import { describe, expect, it, vi } from 'vitest';
import { createFirecrawlFetcher } from '../../src/fetch/firecrawl-fetch.js';

describe('firecrawl fetch backend', () => {
  it('selects a late relevant markdown section with one scrape', async () => {
    const markdown = `# Guide\n\n${'General documentation background. '.repeat(220)}\n\n## Cancellation deadline\n\nThe cancellation deadline is 48 hours before departure.`;
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { markdown, metadata: { title: 'Guide' } }
    })));

    const result = await createFirecrawlFetcher({ baseUrl: 'http://localhost:3002', fetchImpl })(
      'https://example.com/guide',
      'cancellation deadline'
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'ok', metadata: { truncated: true } });
    expect(result.content?.text).toContain('48 hours before departure');
    expect(result.content?.text.length).toBeLessThanOrEqual(4000);
  });

  it('selects HTML without markup or scripts when markdown is unavailable', async () => {
    const html = `<html><body><article><p>${'General documentation background. '.repeat(220)}</p><script>ignored malicious script text</script><h2 id="cancellation">Cancellation deadline</h2><p>The cancellation deadline is 48 hours before departure.</p></article></body></html>`;
    const result = await createFirecrawlFetcher({
      baseUrl: 'http://localhost:3002',
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { html, metadata: {} } })))
    })('https://example.com/guide', 'cancellation deadline');

    expect(result).toMatchObject({ status: 'ok', content: { sectionAnchor: 'cancellation' } });
    expect(result.content?.text).toContain('48 hours before departure');
    expect(result.content?.text).not.toContain('<h2');
    expect(result.content?.text).not.toContain('ignored malicious script text');
  });

  it('treats a body that fails mid-read as a transient FETCH_FAILED', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"success": tr'));
        controller.error(new Error('connection reset'));
      }
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    const result = await createFirecrawlFetcher({ baseUrl: 'http://localhost:3002', fetchImpl })('https://example.com/');
    expect(result).toMatchObject({ status: 'error', error: { code: 'FETCH_FAILED', failure: { kind: 'transient' } } });
  });

  it('scrapes a URL through Firecrawl and returns extracted markdown', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        success: true,
        data: {
          markdown: '# Example Docs\n\nUseful Firecrawl extracted content.',
          metadata: {
            title: 'Example Docs',
            sourceURL: 'https://example.com/docs'
          }
        }
      })));

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

  it('passes supported Firecrawl scrape options', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { markdown: 'Useful content', metadata: {} } })));

    const fetcher = createFirecrawlFetcher({
      baseUrl: 'http://localhost:3002',
      options: { formats: ['markdown', 'html'], onlyMainContent: true },
      fetchImpl
    });

    await fetcher('https://example.com/docs');

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3002/v1/scrape',
      expect.objectContaining({
        body: JSON.stringify({
          url: 'https://example.com/docs',
          formats: ['markdown', 'html'],
          onlyMainContent: true
        })
      })
    );
  });

  it('returns needs_headless when Firecrawl succeeds without useful text', async () => {
    const fetcher = createFirecrawlFetcher({
      baseUrl: 'http://localhost:3002',
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { markdown: '   ', metadata: {} } })))
    });

    await expect(fetcher('https://example.com/app')).resolves.toMatchObject({
      status: 'needs_headless',
      metadata: { method: 'firecrawl', cacheHit: false },
      error: { code: 'WEAK_EXTRACTION' }
    });
  });
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function fetcher(response: Response | (() => never)) {
  return createFirecrawlFetcher({
    baseUrl: 'http://firecrawl.test',
    fetchImpl: vi.fn(async () => (typeof response === 'function' ? response() : response)) as any
  });
}

describe('firecrawl classification (#55)', () => {
  it.each([
    [402, 'quota_exhausted'],
    [401, 'auth_failed'],
    [429, 'rate_limited'],
    [400, 'bad_request'],
    [408, 'transient'],
    [502, 'transient']
  ])('HTTP %s -> %s', async (status, kind) => {
    const result = await fetcher(json({ success: false, error: 'x' }, status))('https://page.test/');
    expect(result).toMatchObject({ status: 'error', error: { code: 'FETCH_FAILED', failure: { kind, httpStatus: status } } });
  });

  it('treats SCRAPE_ALL_ENGINES_FAILED as no extractable content, not a failure', async () => {
    const result = await fetcher(json({ success: false, code: 'SCRAPE_ALL_ENGINES_FAILED' }, 500))('https://page.test/');
    expect(result.status).toBe('needs_headless');
    expect(result.error?.failure).toBeUndefined();
  });

  it('treats a malformed 200 or success:false on 200 as bad_response', async () => {
    for (const response of [json('not json'), json({ success: false, error: 'x' })]) {
      const result = await fetcher(response)('https://page.test/');
      expect(result.error?.failure?.kind).toBe('bad_response');
    }
  });

  it('treats a network error as transient', async () => {
    const result = await fetcher(() => {
      throw new TypeError('fetch failed');
    })('https://page.test/');
    expect(result.error?.failure?.kind).toBe('transient');
  });
});
