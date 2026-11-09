import { describe, expect, it } from 'vitest';
import { extractResultsOverride, mergeResultsConfig, normalizeLengthLimit } from '../../src/results/config.js';

describe('results configuration', () => {
  it('keeps valid result-length presets and finite numeric limits', () => {
    expect(normalizeLengthLimit('short')).toBe('short');
    expect(normalizeLengthLimit('medium')).toBe('medium');
    expect(normalizeLengthLimit('standard')).toBe('standard');
    expect(normalizeLengthLimit(1234.9)).toBe(1234);
    expect(normalizeLengthLimit(500)).toBe(1000);
  });

  it('normalizes invalid values to Auto without creating an unlimited setting', () => {
    for (const value of ['500', 'full', null, {}, NaN, Infinity, -Infinity]) {
      expect(normalizeLengthLimit(value)).toBe('auto');
    }
  });

  it('extracts only recognized result override values and clear markers', () => {
    expect(extractResultsOverride({ results: { lengthLimit: 'short', cleared: ['lengthLimit', 'other'] } }))
      .toEqual({ lengthLimit: 'short', cleared: ['lengthLimit'] });
    expect(extractResultsOverride({ results: { lengthLimit: 'unbounded', cleared: ['other'] } }))
      .toEqual({ lengthLimit: 'auto' });
  });

  it('distinguishes inherit, explicit Auto, and clearing', () => {
    expect(mergeResultsConfig({ lengthLimit: 'short' }, {})).toEqual({ lengthLimit: 'short' });
    expect(mergeResultsConfig({ lengthLimit: 'short' }, { lengthLimit: 'auto' })).toEqual({ lengthLimit: 'auto' });
    expect(mergeResultsConfig({ lengthLimit: 'short' }, { cleared: ['lengthLimit'] })).toEqual({ lengthLimit: 'auto' });
  });
});
