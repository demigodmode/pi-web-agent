import { describe, expect, it } from 'vitest';
import { buildExplorePresentation } from '../../src/presentation/explore-presentation.js';

describe('buildExplorePresentation', () => {
  it('builds one compact body plus richer optional views', () => {
    const presentation = buildExplorePresentation({
      status: 'ok',
      findings: ['Use channel', 'Treat executablePath as fallback'],
      sources: [
        { title: 'Browsers | Playwright', url: 'https://playwright.dev/docs/browsers', method: 'http' },
        { title: 'BrowserType | Playwright', url: 'https://playwright.dev/docs/api/class-browsertype', method: 'headless' }
      ],
      findingSourceIds: [['S1'], ['S2']],
      evidence: [
        { id: 'S1', title: 'Browsers | Playwright', url: 'https://playwright.dev/docs/browsers', method: 'http', excerpts: [{ text: 'Use the branded browser channel.' }], truncated: false },
        { id: 'S2', title: 'BrowserType | Playwright', url: 'https://playwright.dev/docs/api/class-browsertype', method: 'headless', excerpts: [{ text: 'The executable path is risky.', anchor: 'executablepath' }], truncated: false }
      ],
      caveat: undefined,
      metadata: {
        searchPasses: 2,
        fetchedPages: 5,
        headlessAttempts: 1,
        exhaustedBudget: false
      }
    });

    expect(presentation.views.compact).toBe('Reviewed 2 sources · synthesized answer with 2 findings');
    expect(presentation.views.preview).toContain('- [web_fetch] Use channel');
    expect(presentation.views.preview).toContain('- [web_fetch_headless] Treat executablePath as fallback');
    expect(presentation.views.preview).toContain('Internal research: web_search ×2');
    expect(presentation.views.verbose).toContain('Sources');
    expect(presentation.views.verbose).toContain('[S2] Treat executablePath as fallback');
    expect(presentation.views.verbose).toContain('The executable path is risky.');
    expect(presentation.views.verbose).toContain('- [web_fetch_headless] BrowserType | Playwright: https://playwright.dev/docs/api/class-browsertype');
    expect(presentation.views.verbose).toContain('Internal tools');
  });

  it('says when no usable evidence was found in preview and verbose views', () => {
    const presentation = buildExplorePresentation({
      status: 'ok',
      findings: [],
      sources: [],
      metadata: {
        searchPasses: 2,
        fetchedPages: 4,
        headlessAttempts: 0,
        exhaustedBudget: true
      }
    });

    expect(presentation.views.compact).toBe('No usable evidence found');
    expect(presentation.views.preview).toContain('No usable evidence found.');
    expect(presentation.views.verbose).toContain('No usable evidence found.');
  });

  it('keeps invalid-query errors concise', () => {
    const presentation = buildExplorePresentation({
      status: 'error',
      findings: [],
      sources: [],
      error: { code: 'INVALID_QUERY', message: 'Query must not be empty.' }
    });

    expect(presentation.views.compact).toBe('Research failed: Query must not be empty.');
  });

  it('labels github/pdf/youtube sources with their reader name', () => {
    const presentation = buildExplorePresentation({
      status: 'ok',
      findings: ['a', 'b', 'c'],
      sources: [
        { title: 'x', url: 'https://github.com/a/b', method: 'github' },
        { title: 'y', url: 'https://h/x.pdf', method: 'pdf' },
        { title: 'z', url: 'https://youtu.be/abc', method: 'youtube' }
      ],
      metadata: {
        searchPasses: 1,
        fetchedPages: 3,
        headlessAttempts: 0,
        exhaustedBudget: false
      }
    });

    const preview = presentation.views.preview as string;
    expect(preview).toContain('[github]');
    expect(preview).toContain('[pdf]');
    expect(preview).toContain('[youtube]');
  });

  it('shows the fanout providers on the internal-research summary line', () => {
    const presentation = buildExplorePresentation({
      status: 'ok',
      findings: ['a'],
      sources: [{ title: 't', url: 'https://a.com', method: 'http' }],
      metadata: { searchPasses: 2, fetchedPages: 3, headlessAttempts: 0, exhaustedBudget: false, fanoutProviders: ['duckduckgo', 'brave', 'exa'] }
    });
    const preview = presentation.views.preview as string;
    expect(preview).toContain('fanout: duckduckgo, brave, exa');
  });

  it('shows both fanout providers and skipped providers when both are present', () => {
    const presentation = buildExplorePresentation({
      status: 'ok',
      findings: ['a'],
      sources: [{ title: 't', url: 'https://a.com', method: 'http' }],
      metadata: { searchPasses: 2, fetchedPages: 3, headlessAttempts: 0, exhaustedBudget: false, fanoutProviders: ['duckduckgo', 'brave'], fanoutSkipped: ['exa'] }
    });
    const preview = presentation.views.preview as string;
    expect(preview).toContain('fanout: duckduckgo, brave; skipped: exa');
  });

  it('shows skipped providers even when no fanout provider contributed (all failed)', () => {
    const presentation = buildExplorePresentation({
      status: 'ok',
      findings: ['a'],
      sources: [{ title: 't', url: 'https://a.com', method: 'http' }],
      metadata: { searchPasses: 1, fetchedPages: 0, headlessAttempts: 0, exhaustedBudget: false, fanoutSkipped: ['brave', 'exa'] }
    });
    const preview = presentation.views.preview as string;
    expect(preview).toContain('(fanout; skipped: brave, exa)');
  });

  it('removes terminal control characters from source-controlled evidence fields', () => {
    const control = '\u001b[31m';
    const presentation = buildExplorePresentation({
      status: 'ok',
      findings: [`Finding ${control}from a page`],
      sources: [{ title: `Title ${control}`, url: `https://example.com/${control}`, method: 'http' }],
      findingSourceIds: [[`S${control}1`]],
      evidence: [{
        id: `S${control}1`,
        title: `Evidence title ${control}`,
        url: `https://evidence.example/${control}`,
        method: 'http',
        excerpts: [{ text: `Excerpt ${control}text`, anchor: `section${control}one` }],
        truncated: false
      }],
      caveat: `Caveat ${control}text`,
      metadata: {
        searchPasses: 1,
        fetchedPages: 1,
        headlessAttempts: 0,
        exhaustedBudget: false
      }
    });

    for (const view of [presentation.views.preview, presentation.views.verbose]) {
      expect(view).not.toMatch(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/);
      expect(view).not.toContain('\u001b');
    }
    expect(presentation.sources).not.toContainEqual(expect.objectContaining({ title: expect.stringContaining('\u001b') }));
    expect(presentation.sources).not.toContainEqual(expect.objectContaining({ url: expect.stringContaining('\u001b') }));
  });
});
