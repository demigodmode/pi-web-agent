import {
  PRESENTATION_MODES,
  type PresentationConfig,
  type PresentationConfigFile,
  type PresentationConfigOverride,
  type PresentationMode,
  type PresentationToolName
} from './types.js';

const PRESENTATION_MODE_SET = new Set<string>(PRESENTATION_MODES);

export const DEFAULT_PRESENTATION_CONFIG: PresentationConfig = {
  defaultMode: 'compact',
  tools: {}
};

export function isPresentationMode(value: unknown): value is PresentationMode {
  return typeof value === 'string' && PRESENTATION_MODE_SET.has(value);
}

export function extractPresentationConfigOverride(
  file: PresentationConfigFile | null | undefined
): PresentationConfigOverride {
  const presentation = file?.presentation;
  const tools = Object.fromEntries(
    Object.entries(presentation?.tools ?? {}).flatMap(([toolName, value]) => {
      if (!value || !isPresentationMode(value.mode)) {
        return [];
      }

      return [[toolName, { mode: value.mode }]];
    })
  ) as PresentationConfig['tools'];

  return {
    defaultMode: isPresentationMode(presentation?.defaultMode)
      ? presentation.defaultMode
      : undefined,
    tools
  };
}

export function normalizePresentationConfigFile(
  file: PresentationConfigFile | null | undefined
): PresentationConfig {
  const override = extractPresentationConfigOverride(file);

  return {
    defaultMode: override.defaultMode ?? DEFAULT_PRESENTATION_CONFIG.defaultMode,
    tools: override.tools
  };
}

export function mergePresentationConfigLayers(
  defaults: PresentationConfig,
  globalConfig?: PresentationConfigOverride,
  projectConfig?: PresentationConfigOverride
): PresentationConfig {
  return {
    defaultMode:
      projectConfig?.defaultMode ?? globalConfig?.defaultMode ?? defaults.defaultMode,
    tools: {
      ...defaults.tools,
      ...globalConfig?.tools,
      ...projectConfig?.tools
    }
  };
}

export function resolvePresentationMode(
  toolName: PresentationToolName,
  config: PresentationConfig = DEFAULT_PRESENTATION_CONFIG
): PresentationMode {
  return config.tools[toolName]?.mode ?? config.defaultMode;
}
