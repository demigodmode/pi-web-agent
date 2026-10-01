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
  ] as const)('ends the run on a %s failure without searching or reading the README', async (kind, code, message) => {
    const w = worker();
    const fetchDirect = vi.fn(okPage);
    const researchRepo = vi.fn(async (): Promise<RepoResearchResult> => ({ ok: false, error: { code, message, failure: { kind } } }));
    const orchestrator = createResearchOrchestrator({ worker: w, fetchDirect, headlessFetch: vi.fn(), researchRepo });
    const result = await orchestrator.run({ query: 'where is auth in https://github.com/acme/widget' });
    expect(result.terminalFailure).toEqual({ code, message });
    expect(w.run).not.toHaveBeenCalled();
    expect(fetchDirect).not.toHaveBeenCalled();
  });

  it('researches a repo URL typed after three ordinary URLs', async () => {
    const fetchDirect = vi.fn(okPage);
    const researchRepo = vi.fn(async ({ url }: { url: string }) => repoOk(url));
    const orchestrator = createResearchOrchestrator({ worker: worker(), fetchDirect, headlessFetch: vi.fn(), researchRepo });
    await orchestrator.run({
      query: 'compare https://a.example/1 https://b.example/2 https://c.example/3 with https://github.com/acme/widget'
    });
    expect(researchRepo).toHaveBeenCalledWith({ url: 'https://github.com/acme/widget', query: expect.any(String), signal: undefined });
    expect(fetchDirect).toHaveBeenCalledTimes(3);
  });

  it('refuses three typed repo URLs', async () => {
    const researchRepo = vi.fn(async ({ url }: { url: string }) => repoOk(url));
    const orchestrator = createResearchOrchestrator({ worker: worker(), fetchDirect: vi.fn(okPage), headlessFetch: vi.fn(), researchRepo });
    const result = await orchestrator.run({
      query: 'https://github.com/acme/one https://github.com/acme/two https://github.com/acme/three'
    });
    expect(result.terminalFailure).toEqual({
      code: 'REPO_TOO_MANY',
      message: 'Too many repo links in one question; ask about one or two at a time.'
    });
    expect(researchRepo).not.toHaveBeenCalled();
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
      sourceKind: 'primary-content',
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
