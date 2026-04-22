import { describe, expect, it } from 'vitest';
import { buildFetchPresentation } from '../../src/presentation/fetch-presentation.js';

describe('buildFetchPresentation', () => {
  it('builds a compact fetch summary and bounded richer views', () => {
    const presentation = buildFetchPresentation({
      status: 'ok',
      url: 'https://example.com',
      content: { title: 'Example title', text: 'First paragraph. Second paragraph.' },
      metadata: { method: 'http', cacheHit: false }
    });

    expect(presentation.views.compact).toBe('Fetched page · article extracted · 4 words');
    expect(presentation.views.preview).toContain('Example title');
    expect(presentation.views.verbose).toContain('https://example.com');
  });

  it('keeps unsupported responses concise', () => {
    const presentation = buildFetchPresentation({
      status: 'unsupported',
      url: 'file:///tmp/test.html',
      metadata: { method: 'http', cacheHit: false },
      error: { code: 'UNSUPPORTED_URL', message: 'Only http and https URLs are supported.' }
    });

    expect(presentation.views.compact).toBe('Fetch failed: Only http and https URLs are supported.');
  });

  it('renders needs_headless as an escalation instead of a failure', () => {
    const presentation = buildFetchPresentation({
      status: 'needs_headless',
      url: 'https://example.com',
      metadata: { method: 'http', cacheHit: false },
      error: { code: 'WEAK_EXTRACTION', message: 'not enough content' }
    });

    expect(presentation.views.compact).toBe(
      'Needs headless rendering: not enough content'
    );
  });
});
