import {
  CLEARABLE_PRESENTATION_PATHS,
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
  const cleared = Array.isArray(presentation?.cleared)
    ? [...new Set(presentation.cleared.filter((path): path is typeof CLEARABLE_PRESENTATION_PATHS[number] =>
        typeof path === 'string' && (CLEARABLE_PRESENTATION_PATHS as readonly string[]).includes(path)
      ))]
    : [];
  const tools = Object.fromEntries(
    Object.entries(presentation?.tools ?? {}).flatMap(([toolName, value]) => {
      if (!value || !isPresentationMode(value.mode)) {
        return [];
      }

      return [[toolName, { mode: value.mode }]];
    })
  ) as PresentationConfig['tools'];

  return {
    ...(cleared.length ? { cleared } : {}),
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
  return [globalConfig, projectConfig].reduce<PresentationConfig>((current, layer) => {
    const tools = { ...current.tools };
    for (const path of layer?.cleared ?? []) {
      if ((CLEARABLE_PRESENTATION_PATHS as readonly string[]).includes(path)) {
        delete tools[path.slice('tools.'.length) as PresentationToolName];
      }
    }
    return { defaultMode: layer?.defaultMode ?? current.defaultMode, tools: { ...tools, ...layer?.tools } };
  }, { defaultMode: defaults.defaultMode, tools: { ...defaults.tools } });
}

export function resolvePresentationMode(
  toolName: PresentationToolName,
  config: PresentationConfig = DEFAULT_PRESENTATION_CONFIG
): PresentationMode {
  return config.tools[toolName]?.mode ?? config.defaultMode;
}
