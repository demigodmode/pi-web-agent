import type { PresentationConfig, PresentationMode, PresentationToolName } from './types.js';

export const DEFAULT_PRESENTATION_CONFIG: PresentationConfig = {
  defaultMode: 'compact',
  tools: {}
};

export function resolvePresentationMode(
  toolName: PresentationToolName,
  config: PresentationConfig = DEFAULT_PRESENTATION_CONFIG
): PresentationMode {
  return config.tools[toolName]?.mode ?? config.defaultMode;
}
