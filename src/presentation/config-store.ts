import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_BACKEND_CONFIG,
  extractBackendConfigOverride,
  mergeBackendConfigLayers,
  type BackendConfig,
  type BackendConfigFile,
  type BackendConfigOverride
} from '../backends/config.js';
import {
  DEFAULT_PRESENTATION_CONFIG,
  extractPresentationConfigOverride,
  mergePresentationConfigLayers
} from './config.js';
import type {
  PresentationConfig,
  PresentationConfigFile,
  PresentationConfigOverride,
  PresentationScope
} from './types.js';

export type PresentationConfigStoreOptions = {
  homeDir?: string;
  projectDir?: string;
};

export type PresentationConfigLayer = {
  path: string;
  exists: boolean;
  rawConfig?: PresentationConfigOverride;
  rawBackends?: BackendConfigOverride;
  error?: string;
};

export type LoadedPresentationConfig = {
  global: PresentationConfigLayer;
  project: PresentationConfigLayer;
  effectiveConfig: PresentationConfig;
  effectiveBackends: BackendConfig;
};

export function getPresentationConfigPaths(options: PresentationConfigStoreOptions = {}) {
  const homeDir = options.homeDir ?? process.env.USERPROFILE ?? process.env.HOME ?? '';
  const projectDir = options.projectDir ?? process.cwd();

  return {
    globalPath: path.join(homeDir, '.pi', 'agent', 'extensions', 'pi-web-agent', 'config.json'),
    projectPath: path.join(projectDir, '.pi', 'extensions', 'pi-web-agent', 'config.json')
  };
}

type AgentConfigFile = PresentationConfigFile & BackendConfigFile;

type LegacyPresentationConfigFile = NonNullable<PresentationConfigFile['presentation']>;

function hasPresentationRoot(parsed: AgentConfigFile) {
  return parsed.presentation !== undefined;
}

async function readPresentationConfigFile(filePath: string): Promise<PresentationConfigLayer> {
  try {
    const rawText = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(rawText) as AgentConfigFile;
    const presentationFile: PresentationConfigFile = hasPresentationRoot(parsed)
      ? parsed
      : { presentation: parsed as LegacyPresentationConfigFile };

    return {
      path: filePath,
      exists: true,
      rawConfig: extractPresentationConfigOverride(presentationFile),
      rawBackends: extractBackendConfigOverride(parsed)
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      return { path: filePath, exists: false };
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      path: filePath,
      exists: true,
      error: message
    };
  }
}

function serializePresentationConfigOverride(config: PresentationConfigOverride): PresentationConfigFile {
  const presentation: NonNullable<PresentationConfigFile['presentation']> = {};

  if (config.defaultMode) {
    presentation.defaultMode = config.defaultMode;
  }

  if (Object.keys(config.tools).length > 0) {
    presentation.tools = config.tools;
  }

  return { presentation };
}

export async function loadPresentationConfigLayers(
  options: PresentationConfigStoreOptions = {}
): Promise<LoadedPresentationConfig> {
  const { globalPath, projectPath } = getPresentationConfigPaths(options);
  const global = await readPresentationConfigFile(globalPath);
  const project = await readPresentationConfigFile(projectPath);

  return {
    global,
    project,
    effectiveConfig: mergePresentationConfigLayers(
      DEFAULT_PRESENTATION_CONFIG,
      global.rawConfig,
      project.rawConfig
    ),
    effectiveBackends: mergeBackendConfigLayers(
      DEFAULT_BACKEND_CONFIG,
      global.rawBackends,
      project.rawBackends
    )
  };
}

export async function savePresentationConfigScope(
  options: PresentationConfigStoreOptions,
  scope: PresentationScope,
  config: PresentationConfigOverride
) {
  const { globalPath, projectPath } = getPresentationConfigPaths(options);
  const filePath = scope === 'global' ? globalPath : projectPath;

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify(serializePresentationConfigOverride(config), null, 2) + '\n',
    'utf8'
  );
}

export async function resetPresentationConfigScope(
  options: PresentationConfigStoreOptions,
  scope: PresentationScope
) {
  const { globalPath, projectPath } = getPresentationConfigPaths(options);
  const filePath = scope === 'global' ? globalPath : projectPath;

  await rm(filePath, { force: true });
}
