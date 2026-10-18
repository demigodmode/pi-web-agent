import { describe, expect, it } from 'vitest';
import { buildExplorePresentation } from '../../src/presentation/explore-presentation.js';

describe('buildExplorePresentation', () => {
  it('builds compact, preview, and verbose views from measured run facts', () => {
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
      caveat: 'Evidence is partial because one candidate could not be read.',
      durationMs: 8_400,
      metadata: {
        searchPasses: 2,
        fetchedPages: 5,
        headlessAttempts: 1,
        exhaustedBudget: false,
        presentationStats: {
          searches: 3,
          executedQueries: ['playwright browser channel', 'site:playwright.dev executablePath'],
          pagesRead: 4,
          failedReads: 1,
          methods: { http: 2, headless: 1, github: 1 }
        }
      }
    });

    expect(presentation.views.compact).toContain('3 searches · 4 pages read · 8s');
    expect(presentation.views.compact).toContain('Evidence is partial');
    expect(presentation.views.compact).not.toContain('Use channel');
    expect(presentation.views.preview).toContain('3 searches · 4 pages read · 8s');
    expect(presentation.views.preview).toContain('Findings');
    expect(presentation.views.preview).toContain('Use channel');
    expect(presentation.views.preview).not.toContain('[web_fetch]');
    expect(presentation.views.preview).not.toContain('Internal research');
    expect(presentation.views.verbose).toContain('Sources');
    expect(presentation.views.verbose).toContain('[S2] Treat executablePath as fallback');
    expect(presentation.views.verbose).toContain('The executable path is risky.');
    expect(presentation.views.verbose).toContain('- [web_fetch_headless] BrowserType | Playwright: https://playwright.dev/docs/api/class-browsertype');
    expect(presentation.views.verbose).toContain('Queries');
    expect(presentation.views.verbose).toContain('site:playwright.dev executablePath');
    expect(presentation.views.verbose).toContain('Retrieval');
    expect(presentation.views.verbose).toContain('HTTP: 2');
    expect(presentation.views.verbose).toContain('Browser: 1');
    expect(presentation.views.verbose).toContain('GitHub: 1');
    expect(presentation.views.verbose).toContain('Failed reads: 1');
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

  it('shows every required source failure before no evidence in every mode', () => {
    const failures = Array.from({ length: 22 }, (_, index) => ({
      url: `https://example.com/source-${index}`,
      code: 'LIMIT',
      message: 'Source limit reached.',
      reason: 'limit' as const
    }));
    const presentation = buildExplorePresentation({
      status: 'ok',
      durationMs: 500,
      findings: [],
      sources: [],
      requiredSourceFailures: failures,
      metadata: {
        searchPasses: 0,
        fetchedPages: 0,
        headlessAttempts: 0,
        exhaustedBudget: true,
        presentationStats: { searches: 0, executedQueries: [], pagesRead: 0, failedReads: 22, methods: {} }
      }
    });

    const views = [presentation.views.compact, presentation.views.preview, presentation.views.verbose]
      .filter((view): view is string => view !== undefined);
    expect(views).toHaveLength(3);
    for (const view of views) {
      expect(view).toContain('0 searches · 0 pages read · <1s');
      expect(view).toContain('https://example.com/source-0');
      expect(view).toContain('https://example.com/source-21');
      expect(view).toContain('requirements');
      expect(view).toContain('not checked');
      expect(view.indexOf('source-0')).toBeLessThan(view.indexOf('No usable evidence found'));
    }
  });

  it('does not group required source failures with different reasons', () => {
    const presentation = buildExplorePresentation({
      status: 'ok',
      durationMs: 1_000,
      findings: [],
      sources: [],
      requiredSourceFailures: [
        { url: 'https://example.com/read-failed', code: 'READ_FAILED', message: 'Source was not read.', reason: 'read-failed' },
        { url: 'https://example.com/limited', code: 'LIMIT', message: 'Source was not read.', reason: 'limit' }
      ],
      metadata: {
        searchPasses: 0,
        fetchedPages: 0,
        headlessAttempts: 0,
        exhaustedBudget: true,
        presentationStats: { searches: 0, executedQueries: [], pagesRead: 0, failedReads: 2, methods: {} }
      }
    });

    const compactLines = presentation.views.compact.split('\n').filter((line) => line.startsWith('Required sources not read:'));
    expect(compactLines).toHaveLength(2);
    expect(compactLines[0]).toContain('https://example.com/read-failed');
    expect(compactLines[1]).toContain('https://example.com/limited');
  });

  it('redacts embedded URL credentials and query tokens from verbose queries', () => {
    const query = 'read https://alice:secret@example.test/doc?token=secret#private';
    const presentation = buildExplorePresentation({
      status: 'ok',
      durationMs: 1_000,
      findings: ['A finding'],
      sources: [{ title: 'Source', url: 'https://example.test/doc', method: 'http' }],
      metadata: {
        searchPasses: 1,
        fetchedPages: 1,
        headlessAttempts: 0,
        exhaustedBudget: false,
        presentationStats: { searches: 1, executedQueries: [query], pagesRead: 1, failedReads: 0, methods: { http: 1 } }
      }
    });

    expect(presentation.views.verbose).toContain('read https://example.test/doc');
    expect(presentation.views.verbose).not.toContain('alice:secret');
    expect(presentation.views.verbose).not.toContain('token=secret');
    expect(presentation.views.verbose).not.toContain('#private');
    expect(presentation.views.verbose).not.toContain(query);
  });

  it('omits the verbose Queries section when all executed queries sanitize away', () => {
    const presentation = buildExplorePresentation({
      status: 'ok',
      durationMs: 1_000,
      findings: ['A finding'],
      sources: [{ title: 'Source', url: 'https://example.test/doc', method: 'http' }],
      metadata: {
        searchPasses: 1,
        fetchedPages: 1,
        headlessAttempts: 0,
        exhaustedBudget: false,
        presentationStats: { searches: 1, executedQueries: ['\u202e\u2066\u2069'], pagesRead: 1, failedReads: 0, methods: { http: 1 } }
      }
    });

    expect(presentation.views.verbose).not.toContain('Queries');
    expect(presentation.views.verbose).toContain('Findings');
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

  it('removes terminal and bidi formatting controls from source-controlled evidence fields', () => {
    const control = '\u001b[31m';
    const bidi = '\u202d\u202e\u2066\u2069';
    const presentation = buildExplorePresentation({
      status: 'ok',
      findings: [`Finding ${control}from a page`],
      sources: [{ title: `Title ${control}${bidi} café`, url: `https://example.com/${control}${bidi}path`, method: 'http' }],
      findingSourceIds: [[`S${control}1`]],
      evidence: [{
        id: `S${control}1`,
        title: `Evidence title ${control}${bidi}`,
        url: `https://evidence.example/${control}${bidi}`,
        method: 'http',
        excerpts: [{ text: `First excerpt line\nSecond excerpt\tline\r${control}${bidi}text`, anchor: `section${control}one` }],
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
      expect(view).not.toMatch(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u061C\u200E-\u200F\u202A-\u202E\u2066-\u2069]/);
      expect(view).not.toContain('\u001b');
    }
    expect(presentation.views.verbose).toContain('First excerpt line\nSecond excerpt    line[31mtext');
    expect(presentation.views.verbose).toContain('Title [31m café: https://example.com/[31mpath');
    expect(presentation.sources).not.toContainEqual(expect.objectContaining({ title: expect.stringContaining('\u001b') }));
    expect(presentation.sources).not.toContainEqual(expect.objectContaining({ url: expect.stringContaining('\u001b') }));
    expect(presentation.sources?.[0]?.title).not.toMatch(/[\u061C\u200E-\u200F\u202A-\u202E\u2066-\u2069]/);
    expect(presentation.sources?.[0]?.url).not.toMatch(/[\u061C\u200E-\u200F\u202A-\u202E\u2066-\u2069]/);
  });
});
