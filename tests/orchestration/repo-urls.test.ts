import { describe, expect, it, vi } from 'vitest';
import { createResearchOrchestrator } from '../../src/orchestration/research-orchestrator.js';
import type { RepoResearchResult } from '../../src/repo/repo-research.js';

const worker = () => ({
  run: vi.fn(async () => ({ searchQueries: [], evidence: [], gaps: [], lowValueOutcomes: [], exhaustedBudget: false }))
});
const okPage = async ({ url }: { url: string }) => ({
  status: 'ok' as const,
  url,
  content: { title: 'Page', text: 'Page with enough readable evidence for the research result here.' },
  metadata: { method: 'http' as const, cacheHit: false }
});
const repoOk = (url: string): RepoResearchResult => ({
  ok: true,
  response: {
    status: 'ok',
    url: `${url}/tree/${'a'.repeat(40)}`,
    content: { title: 'acme/widget', text: 'Repository acme/widget at main. README says it makes widgets.' },
    metadata: { method: 'github', cacheHit: false }
  }
});

describe('typed repo URLs', () => {
  it.each([
    ['not_configured', 'GIT_MISSING', "git isn't installed, so repo code can't be searched."],
    ['bad_request', 'REPO_TOO_LARGE', 'acme/widget is 1.2GB, over the 300MB limit; ask about a specific file URL instead.'],
    ['transient', 'REPO_CLONE_TIMEOUT', 'Cloning acme/widget timed out after 60s.']
  ] as const)('records a %s repo failure without reading the README', async (kind, code, message) => {
    const w = worker();
    const fetchDirect = vi.fn(okPage);
    const researchRepo = vi.fn(async (): Promise<RepoResearchResult> => ({ ok: false, error: { code, message, failure: { kind } } }));
    const orchestrator = createResearchOrchestrator({ worker: w, fetchDirect, headlessFetch: vi.fn(), researchRepo });
    const result = await orchestrator.run({ query: 'where is auth in https://github.com/acme/widget' });
    expect(result.requiredSourceFailures).toEqual([expect.objectContaining({ code, message, reason: 'read-failed' })]);
    expect(fetchDirect).not.toHaveBeenCalled();
  });

  it('researches a repo URL typed after three ordinary URLs', async () => {
    const fetchDirect = vi.fn(okPage);
    const researchRepo = vi.fn(async ({ url }: { url: string }) => repoOk(url));
    const orchestrator = createResearchOrchestrator({ worker: worker(), fetchDirect, headlessFetch: vi.fn(), researchRepo });
    await orchestrator.run({
      query: 'compare https://a.example/1 https://b.example/2 https://c.example/3 with https://github.com/acme/widget'
    });
    expect(researchRepo).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://github.com/acme/widget', query: expect.any(String), signal: expect.any(AbortSignal) }));
    expect(fetchDirect).toHaveBeenCalledTimes(3);
  });

  it('allows three typed repo URLs', async () => {
    const researchRepo = vi.fn(async ({ url }: { url: string }) => repoOk(url));
    const orchestrator = createResearchOrchestrator({ worker: worker(), fetchDirect: vi.fn(okPage), headlessFetch: vi.fn(), researchRepo });
    const result = await orchestrator.run({
      query: 'https://github.com/acme/one https://github.com/acme/two https://github.com/acme/three'
    });
    expect(result.terminalFailure).toBeUndefined();
    expect(researchRepo).toHaveBeenCalledTimes(3);
  });

  it('records a fourth repo limit but still reads a later page', async () => {
    const researchRepo = vi.fn(async ({ url }: { url: string }) => repoOk(url));
    const fetchDirect = vi.fn(okPage);
    const orchestrator = createResearchOrchestrator({ worker: worker(), fetchDirect, headlessFetch: vi.fn(), researchRepo });
    const result = await orchestrator.run({ query: 'https://github.com/a/one https://github.com/a/two https://github.com/a/three https://github.com/a/four https://example.com/later' });
    expect(researchRepo).toHaveBeenCalledTimes(3);
    expect(fetchDirect).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com/later' }));
    expect(result.requiredSourceFailures).toEqual([expect.objectContaining({ url: 'https://github.com/a/four', code: 'DIRECT_SOURCE_LIMIT', reason: 'limit' })]);
  });

  it('reserves eight mixed direct slots across three repos and reports the overflow', async () => {
    const researchRepo = vi.fn(async ({ url }: { url: string }) => repoOk(url));
    const fetchDirect = vi.fn(okPage);
    const urls = ['https://github.com/a/one', 'https://github.com/b/two', 'https://github.com/c/three', ...Array.from({ length: 6 }, (_, i) => `https://pages.example/${i + 1}`)];
    const result = await createResearchOrchestrator({ worker: worker(), fetchDirect, headlessFetch: vi.fn(), researchRepo }).run({ query: urls.join(' ') });
    expect(researchRepo).toHaveBeenCalledTimes(3);
    expect(fetchDirect.mock.calls.map(([input]) => input.url)).toEqual(urls.slice(3, 8));
    expect(result.requiredSourceFailures).toContainEqual(expect.objectContaining({ url: urls[8], reason: 'limit' }));
  });

  it('continues to a later page when a repo reader fails without substituting a README', async () => {
    const researchRepo = vi.fn(async (): Promise<RepoResearchResult> => ({ ok: false, error: { code: 'REPO_CLONE_TIMEOUT', message: 'timeout', failure: { kind: 'transient' } } }));
    const fetchDirect = vi.fn(okPage);
    const result = await createResearchOrchestrator({ worker: worker(), fetchDirect, headlessFetch: vi.fn(), researchRepo }).run({ query: 'https://github.com/acme/bad https://pages.example/good' });
    expect(fetchDirect).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://pages.example/good' }));
    expect(result.requiredSourceEvidence).toEqual([expect.objectContaining({ requestedUrl: 'https://pages.example/good' })]);
    expect(result.requiredSourceFailures).toContainEqual(expect.objectContaining({ url: 'https://github.com/acme/bad', code: 'REPO_CLONE_TIMEOUT' }));
  });

  it('reads eight direct pages and records the ninth in query order', async () => {
    const fetchDirect = vi.fn(okPage);
    const orchestrator = createResearchOrchestrator({ worker: worker(), fetchDirect, headlessFetch: vi.fn() });
    const urls = Array.from({ length: 9 }, (_, index) => `https://example.com/${index + 1}`);
    const result = await orchestrator.run({ query: `Read ${urls.join(' ')}` });
    expect(fetchDirect.mock.calls.map(([input]) => input.url)).toEqual(urls.slice(0, 8));
    expect(result.requiredSourceEvidence.map((item) => item.requestedUrl)).toEqual(urls.slice(0, 8));
    expect(result.requiredSourceFailures).toEqual([expect.objectContaining({ url: urls[8], code: 'DIRECT_SOURCE_LIMIT', reason: 'limit' })]);
  });

  it('records a direct source failure when fetchDirect is unavailable', async () => {
    const orchestrator = createResearchOrchestrator({ worker: worker(), headlessFetch: vi.fn() });
    const result = await orchestrator.run({ query: 'Read https://example.com/missing-reader' });
    expect(result.requiredSourceFailures).toEqual([expect.objectContaining({ url: 'https://example.com/missing-reader', reason: 'read-failed' })]);
  });

  it('researches root, .git, trailing slash, and owner case aliases once', async () => {
    const researchRepo = vi.fn(async ({ url }: { url: string }) => repoOk(url));
    const fetchDirect = vi.fn(okPage);
    const orchestrator = createResearchOrchestrator({ worker: worker(), fetchDirect, headlessFetch: vi.fn(), researchRepo });
    await orchestrator.run({
      query: 'https://github.com/Acme/Widget https://github.com/acme/widget.git https://github.com/acme/widget/'
    });
    expect(researchRepo).toHaveBeenCalledTimes(1);
    expect(researchRepo).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://github.com/Acme/Widget' }));
    expect(fetchDirect).not.toHaveBeenCalled();
  });

  it('researches an alias group and a second repo without spending page fetches on aliases', async () => {
    const researchRepo = vi.fn(async ({ url }: { url: string }): Promise<RepoResearchResult> => {
      const result = repoOk(url);
      if (!result.ok) throw new Error('repo fixture must succeed');
      return { ...result, response: { ...result.response, content: { title: 'acme/widget', text: '' } } };
    });
    const fetchDirect = vi.fn(okPage);
    const orchestrator = createResearchOrchestrator({ worker: worker(), fetchDirect, headlessFetch: vi.fn(), researchRepo });
    await orchestrator.run({
      query: 'https://github.com/acme/widget https://github.com/acme/widget.git https://github.com/other/tool https://a.example/1 https://b.example/2 https://c.example/3'
    });
    expect(researchRepo).toHaveBeenCalledTimes(2);
    expect(researchRepo.mock.calls.map(([input]) => input.url)).toEqual(['https://github.com/acme/widget', 'https://github.com/other/tool']);
    expect(fetchDirect.mock.calls.map(([input]) => input.url)).toEqual(['https://a.example/1', 'https://b.example/2', 'https://c.example/3']);
  });

  it('allows three distinct repo refs and folders', async () => {
    const researchRepo = vi.fn(async ({ url }: { url: string }) => repoOk(url));
    const orchestrator = createResearchOrchestrator({ worker: worker(), fetchDirect: vi.fn(okPage), headlessFetch: vi.fn(), researchRepo });
    const result = await orchestrator.run({
      query: 'https://github.com/acme/widget/tree/main/src https://github.com/acme/widget/tree/main/docs https://github.com/acme/widget/tree/release/src'
    });
    expect(result.terminalFailure).toBeUndefined();
    expect(researchRepo).toHaveBeenCalledTimes(3);
  });

  it('answers from the repo without searching', async () => {
    const w = worker();
    const researchRepo = vi.fn(async ({ url }: { url: string }) => repoOk(url));
    const orchestrator = createResearchOrchestrator({ worker: w, fetchDirect: vi.fn(okPage), headlessFetch: vi.fn(), researchRepo });
    const result = await orchestrator.run({ query: 'what is https://github.com/acme/widget' });
    expect(result.terminalFailure).toBeUndefined();
    expect(result.evidence[0]).toMatchObject({ url: `https://github.com/acme/widget/tree/${'a'.repeat(40)}`, method: 'github' });
    expect(w.run).not.toHaveBeenCalled();
  });

  it('searches for external user opinion evidence after reading a typed repo', async () => {
    const w = {
      run: vi.fn(async () => ({
        searchQueries: ['What do users think about https://github.com/acme/widget?'],
        evidence: [{
          title: 'Widget user discussion',
          url: 'https://reddit.com/r/widgets/comments/123',
          sourceKind: 'community' as const,
          method: 'http' as const,
          summary: 'Users describe their experience with Widget.',
          supports: ['Users describe their experience with Widget.']
        }],
        gaps: [],
        lowValueOutcomes: [],
        exhaustedBudget: false
      }))
    };
    const researchRepo = vi.fn(async ({ url }: { url: string }) => repoOk(url));
    const orchestrator = createResearchOrchestrator({ worker: w, fetchDirect: vi.fn(okPage), headlessFetch: vi.fn(), researchRepo });

    const result = await orchestrator.run({ query: 'What do users think about https://github.com/acme/widget?' });

    expect(researchRepo).toHaveBeenCalledTimes(1);
    expect(w.run).toHaveBeenCalledWith(expect.objectContaining({
      query: 'What do users think about https://github.com/acme/widget?'
    }));
    expect(result.evidence.some((item) => item.url === 'https://reddit.com/r/widgets/comments/123')).toBe(true);
  });

  it('keeps trusted cloned README evidence that mentions bot-like phrases', async () => {
    const w = worker();
    const readme = 'The security service verifies every request. If verification fails, it may say verify you are not a bot before continuing.';
    const researchRepo = vi.fn(async ({ url }: { url: string }): Promise<RepoResearchResult> => {
      const base = repoOk(url);
      if (!base.ok) throw new Error('repo fixture must succeed');
      return {
        ...base,
        response: {
          ...base.response,
          content: { title: 'acme/widget', text: readme }
        }
      };
    });
    const fetchDirect = vi.fn(okPage);
    const orchestrator = createResearchOrchestrator({ worker: w, fetchDirect, headlessFetch: vi.fn(), researchRepo });
    const result = await orchestrator.run({ query: 'what is https://github.com/acme/widget' });
    expect(result.evidence[0]).toMatchObject({
      url: `https://github.com/acme/widget/tree/${'a'.repeat(40)}`,
      method: 'github',
      sourceKind: 'unknown',
      summary: readme,
      supports: [readme]
    });
    expect(w.run).not.toHaveBeenCalled();
    expect(fetchDirect).not.toHaveBeenCalled();
  });

  it('leaves repo URLs to fetchDirect when there is no researchRepo', async () => {
    const fetchDirect = vi.fn(okPage);
    const orchestrator = createResearchOrchestrator({ worker: worker(), fetchDirect, headlessFetch: vi.fn() });
    await orchestrator.run({ query: 'what is https://github.com/acme/widget' });
    expect(fetchDirect).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://github.com/acme/widget' }));
  });

  it('limits syntactic repo URLs even when the repo reader is unavailable', async () => {
    const fetchDirect = vi.fn(okPage);
    const orchestrator = createResearchOrchestrator({ worker: worker(), fetchDirect, headlessFetch: vi.fn() });
    const result = await orchestrator.run({ query: [
      'https://github.com/a/one', 'https://github.com/b/two', 'https://github.com/c/three', 'https://github.com/d/four'
    ].join(' ') });
    expect(fetchDirect).toHaveBeenCalledTimes(3);
    expect(result.requiredSourceFailures).toContainEqual(expect.objectContaining({ url: 'https://github.com/d/four', reason: 'limit', code: 'DIRECT_SOURCE_LIMIT' }));
  });

  it('stops on cancel between repo and page work', async () => {
    const controller = new AbortController();
    const fetchDirect = vi.fn(okPage);
    const researchRepo = vi.fn(async ({ url }: { url: string }) => {
      controller.abort();
      return repoOk(url);
    });
    const orchestrator = createResearchOrchestrator({ worker: worker(), fetchDirect, headlessFetch: vi.fn(), researchRepo });
    await expect(
      orchestrator.run({ query: 'https://github.com/acme/widget and https://a.example/1', signal: controller.signal })
    ).rejects.toThrow('Operation aborted');
    expect(fetchDirect).not.toHaveBeenCalled();
  });
});
