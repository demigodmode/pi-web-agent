import { describe, expect, it } from 'vitest';
import { normalizeLengthLimit } from '../../src/results/config.js';
import { resolveLengthLimit } from '../../src/results/length.js';

describe('result length resolution', () => {
  it.each([['short', 4000], ['medium', 8000], [500, 1000], [1234.9, 1234]] as const)(
    'resolves %s',
    (setting, expected) => {
      expect(resolveLengthLimit(normalizeLengthLimit(setting), undefined)).toEqual({ kind: 'bounded', chars: expected });
    }
  );

  it('resolves Auto per call and treats unknown windows as Standard', () => {
    expect(resolveLengthLimit('auto', 4096)).toEqual({ kind: 'bounded', chars: 1000 });
    expect(resolveLengthLimit('auto', 8192)).toEqual({ kind: 'bounded', chars: 1310 });
    expect(resolveLengthLimit('auto', 32768)).toEqual({ kind: 'bounded', chars: 5242 });
    expect(resolveLengthLimit('auto', 128000)).toEqual({ kind: 'bounded', chars: 20480 });

    for (const window of [undefined, 0, -1, NaN, Infinity]) {
      expect(resolveLengthLimit('auto', window)).toEqual({ kind: 'standard' });
    }
  });
});
