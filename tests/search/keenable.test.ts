import { describe, expect, it, vi } from 'vitest';
import { createKeenableSearchTool } from '../../src/search/keenable.js';
import { usableSearchProviders } from '../../src/backends/config.js';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('keenable search', () => {
  it('posts the query with X-API-Key and prefers description over snippet', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      results: [
        { title: 'A', url: 'https://a.example/', description: 'Desc A', snippet: 'ignored' },
        { title: 'B', url: 'https://b.example/', snippet: 'x'.repeat(900) },
        { title: 'No URL', description: 'dropped' }
      ]
    }));

    const result = await createKeenableSearchTool({ apiKey: 'kn-key', fetchImpl })({ query: 'agents' });

    expect(result.status).toBe('ok');
    expect(result.metadata.backend).toBe('keenable');
    expect(result.results).toEqual([
      { title: 'A', url: 'https://a.example/', snippet: 'Desc A' },
      { title: 'B', url: 'https://b.example/', snippet: 'x'.repeat(500) }
    ]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.keenable.ai/v1/search');
    expect(init.method).toBe('POST');
    expect(init.headers['X-API-Key']).toBe('kn-key');
    expect(JSON.parse(init.body)).toEqual({ query: 'agents', max_results: 10 });
  });

  it('reports a missing key without calling the API', async () => {
    const fetchImpl = vi.fn();
    const result = await createKeenableSearchTool({ fetchImpl })({ query: 'agents' });
    expect(result.status).not.toBe('ok');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('keenable opt-in', () => {
  it('is not added to the usable set by the key alone', () => {
    const env = { KEENABLE_API_KEY: 'kn-key' } as NodeJS.ProcessEnv;
    expect(usableSearchProviders({ provider: 'duckduckgo' } as any, env)).not.toContain('keenable');
    expect(usableSearchProviders({ provider: 'keenable' } as any, env)).toContain('keenable');
  });
});
