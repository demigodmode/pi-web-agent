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

  it('shows fetch fallback in compact output', () => {
    const presentation = buildFetchPresentation({
      status: 'ok',
      url: 'https://example.com',
      content: { text: 'Fallback content' },
      metadata: { method: 'http', cacheHit: false, fallbackFrom: 'firecrawl', fallbackReason: 'weak' }
    });

    expect(presentation.views.compact).toBe('firecrawl failed; used http fallback. Fetched page · article extracted · 2 words');
  });
});

describe('fetch presentation blocked subresources', () => {
  const base = {
    status: 'ok' as const,
    url: 'https://example.com/',
    content: { title: 'Example', text: 'Readable content' },
    metadata: { method: 'headless' as const, cacheHit: false }
  };

  it('shows the blocked request count in the verbose view only', () => {
    const presentation = buildFetchPresentation({ ...base, metadata: { ...base.metadata, blockedSubresources: 2 } });

    expect(presentation.views.verbose).toContain('Blocked private-address requests: 2');
    expect(presentation.views.compact).not.toContain('Blocked');
    expect(presentation.views.preview ?? '').not.toContain('Blocked');
  });

  it('omits the line when nothing was blocked', () => {
    expect(buildFetchPresentation(base).views.verbose).not.toContain('Blocked');
  });
});
