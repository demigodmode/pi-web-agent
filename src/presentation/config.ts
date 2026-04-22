import {
  PRESENTATION_MODES,
  type PresentationConfig,
  type PresentationConfigFile,
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

export function normalizePresentationConfigFile(
  file: PresentationConfigFile | null | undefined
): PresentationConfig {
  const presentation = file?.presentation;
  const defaultMode = isPresentationMode(presentation?.defaultMode)
    ? presentation.defaultMode
    : DEFAULT_PRESENTATION_CONFIG.defaultMode;

  const tools = Object.fromEntries(
    Object.entries(presentation?.tools ?? {}).flatMap(([toolName, value]) => {
      if (!value || !isPresentationMode(value.mode)) {
        return [];
      }

      return [[toolName, { mode: value.mode }]];
    })
  ) as PresentationConfig['tools'];

  return { defaultMode, tools };
}

export function mergePresentationConfigLayers(
  defaults: PresentationConfig,
  globalConfig?: PresentationConfig,
  projectConfig?: PresentationConfig
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
