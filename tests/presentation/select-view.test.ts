import { describe, expect, it } from 'vitest';
import { selectPresentationView } from '../../src/presentation/select-view.js';

describe('selectPresentationView', () => {
  const envelope = {
    mode: 'compact' as const,
    views: {
      compact: 'compact body',
      preview: 'preview body',
      verbose: 'verbose body'
    }
  };

  it('returns compact only for compact mode', () => {
    expect(selectPresentationView(envelope, 'compact')).toBe('compact body');
  });

  it('returns preview only for preview mode', () => {
    expect(selectPresentationView(envelope, 'preview')).toBe('preview body');
  });

  it('falls back to compact when a richer view is missing', () => {
    expect(
      selectPresentationView({ mode: 'compact', views: { compact: 'compact only' } }, 'verbose')
    ).toBe('compact only');
  });
});
