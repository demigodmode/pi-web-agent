import type { LengthLimit, ResultsConfig, ResultsConfigFile, ResultsOverride } from './types.js';

export const DEFAULT_RESULTS_CONFIG: ResultsConfig = { lengthLimit: 'auto' };

export function normalizeLengthLimit(value: unknown): LengthLimit {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1000, Math.floor(value));
  }

  return value === 'short' || value === 'medium' || value === 'standard' ? value : 'auto';
}

export function extractResultsOverride(file: ResultsConfigFile | null | undefined): ResultsOverride {
  const raw = file?.results;
  const cleared = Array.isArray(raw?.cleared) && raw.cleared.includes('lengthLimit');

  return {
    ...(raw?.lengthLimit !== undefined ? { lengthLimit: normalizeLengthLimit(raw.lengthLimit) } : {}),
    ...(cleared ? { cleared: ['lengthLimit'] as Array<'lengthLimit'> } : {})
  };
}

export function mergeResultsConfig(...layers: Array<ResultsOverride | undefined>): ResultsConfig {
  let lengthLimit: LengthLimit = DEFAULT_RESULTS_CONFIG.lengthLimit;

  for (const layer of layers) {
    if (layer?.cleared?.includes('lengthLimit')) lengthLimit = DEFAULT_RESULTS_CONFIG.lengthLimit;
    if (layer?.lengthLimit !== undefined) lengthLimit = normalizeLengthLimit(layer.lengthLimit);
  }

  return { lengthLimit };
}
