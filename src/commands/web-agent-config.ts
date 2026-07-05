import {
  DEFAULT_BACKEND_CONFIG,
  mergeBackendConfigLayers,
  validateBackendConfig,
  type BackendConfig,
  type BackendConfigOverride
} from '../backends/config.js';
import { checkBackendHealth } from '../backends/doctor.js';
import {
  DynamicBorder,
  getSettingsListTheme,
  type ExtensionAPI
} from '@earendil-works/pi-coding-agent';
import {
  Container,
  Input,
  SelectList,
  SettingsList,
  Text,
  type Component,
  type SelectItem,
  type SettingItem
} from '@earendil-works/pi-tui';
import {
  DEFAULT_PRESENTATION_CONFIG,
  mergePresentationConfigLayers,
  resolvePresentationMode
} from '../presentation/config.js';
import {
  loadPresentationConfigLayers,
  resetPresentationConfigScope,
  saveBackendConfigScope,
  savePresentationConfigScope,
  type LoadedPresentationConfig
} from '../presentation/config-store.js';
import { resolveBrowserExecutable, type BrowserResolutionResult } from '../fetch/browser-resolution.js';
import { getLatestChangelogEntry } from '../changelog-notice.js';
import type {
  PresentationConfig,
  PresentationConfigOverride,
  PresentationScope,
  PresentationToolName
} from '../presentation/types.js';

type CommandDeps = {
  load?: () => ReturnType<typeof loadPresentationConfigLayers>;
  save?: (scope: PresentationScope, config: PresentationConfigOverride) => Promise<void>;
  saveBackends?: (scope: PresentationScope, config: BackendConfigOverride) => Promise<void>;
  reset?: (scope: PresentationScope) => Promise<void>;
  resolveBrowser?: () => Promise<BrowserResolutionResult>;
  runtime?: { nodeVersion: string; platform: string; arch: string };
  checkTypebox?: () => Promise<boolean>;
  checkBackends?: (config: BackendConfig) => Promise<string[]>;
  getChangelog?: () => Promise<string | undefined>;
};

type SettingsUiResult =
  | { action: 'cancel' }
  | { action: 'reset'; scope: PresentationScope }
  | { action: 'save'; scope: PresentationScope; config: PresentationConfig; backends: BackendConfig };

type WebAgentAction = 'settings' | 'show' | 'doctor' | 'changelog' | 'reset-project' | 'reset-global';
type SettingsSection = 'presentation' | 'backends';

export type SettingsDraftState = {
  scope: PresentationScope;
  drafts: Record<PresentationScope, PresentationConfig>;
  backendDrafts: Record<PresentationScope, BackendConfig>;
  config: PresentationConfig;
  backends: BackendConfig;
};

const PRESENTATION_TOOL_NAMES: PresentationToolName[] = ['web_explore'];

function parseScopeToken(token: string | undefined): PresentationScope | undefined {
  return token === 'global' || token === 'project' ? token : undefined;
}

function clonePresentationConfig(config: PresentationConfig): PresentationConfig {
  return {
    defaultMode: config.defaultMode,
    tools: { ...config.tools }
  };
}

function cloneBackendConfig(config: BackendConfig): BackendConfig {
  return {
    search: {
      ...config.search,
      options: config.search.options ? { ...config.search.options } : undefined
    },
    fetch: {
      ...config.fetch,
      options: config.fetch.options ? { ...config.fetch.options } : undefined
    },
    headless: { ...config.headless }
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateBackendUrl(value: string): { ok: true; value: string } | { ok: false; message: string } {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, message: 'Invalid URL. Include http:// or https://.' };
    }

    return { ok: true, value: url.toString().replace(/\/$/, '') };
  } catch {
    return { ok: false, message: 'Invalid URL. Include http:// or https://.' };
  }
}

async function defaultCheckTypebox(): Promise<boolean> {
  try {
    await import('typebox');
    return true;
  } catch {
    return false;
  }
}

function formatSearchOptions(config: BackendConfig['search']) {
  return [
    config.fallback ? `fallback ${config.fallback}` : undefined,
    config.options?.categories?.length ? `categories ${config.options.categories.join(',')}` : undefined,
    config.options?.language ? `language ${config.options.language}` : undefined,
    config.options?.safesearch !== undefined ? `safesearch ${config.options.safesearch}` : undefined
  ].filter(Boolean).join(' ');
}

function formatFetchOptions(config: BackendConfig['fetch']) {
  return [
    config.fallback ? `fallback ${config.fallback}` : undefined,
    config.options?.formats?.length ? `formats ${config.options.formats.join(',')}` : undefined,
    config.options?.onlyMainContent !== undefined ? `onlyMainContent ${config.options.onlyMainContent}` : undefined
  ].filter(Boolean).join(' ');
}

function formatBackendSummary(config: BackendConfig = DEFAULT_BACKEND_CONFIG) {
  const searchSuffix = formatSearchOptions(config.search);
  const fetchSuffix = formatFetchOptions(config.fetch);
  const searchBase = config.search.baseUrl
    ? `search: ${config.search.provider} (${config.search.baseUrl})`
    : `search: ${config.search.provider}`;
  const fetchBase = config.fetch.baseUrl
    ? `fetch: ${config.fetch.provider} (${config.fetch.baseUrl})`
    : `fetch: ${config.fetch.provider}`;

  return [
    searchSuffix ? `${searchBase} ${searchSuffix}` : searchBase,
    fetchSuffix ? `${fetchBase} ${fetchSuffix}` : fetchBase,
    `headless: ${config.headless.provider}`
  ].join('\n');
}

function formatConfigSummary(config: PresentationConfig) {
  const lines = [`defaultMode: ${config.defaultMode}`];

  for (const toolName of PRESENTATION_TOOL_NAMES) {
    lines.push(`${toolName}: ${config.tools[toolName]?.mode ?? 'inherit'}`);
  }

  return lines.join('\n');
}

function buildPresentationSettingsItems(scope: PresentationScope, config: PresentationConfig): SettingItem[] {
  return [
    {
      id: 'scope',
      label: 'Write scope',
      currentValue: scope,
      values: ['project', 'global']
    },
    {
      id: 'defaultMode',
      label: 'Default mode',
      currentValue: config.defaultMode,
      values: ['compact', 'preview', 'verbose']
    },
    ...PRESENTATION_TOOL_NAMES.map((toolName) => ({
      id: `tool:${toolName}`,
      label: toolName,
      currentValue: config.tools[toolName]?.mode ?? 'inherit',
      values: ['inherit', 'compact', 'preview', 'verbose']
    }))
  ];
}

export function createBackendUrlEditor(theme: any, label: string, placeholderUrl: string) {
  return (currentValue: string, done: (selectedValue?: string) => void): Component => {
    const initialValue = currentValue && currentValue !== 'not set' ? currentValue : placeholderUrl;
    const container = new Container();
    const hint = new Text(theme.fg('muted', `${label} · enter to save · empty clears · esc cancels`), 1, 0);
    const input = new Input();
    input.setValue(initialValue);
    input.focused = true;

    let errorText: Text | undefined;

    const showError = (message: string) => {
      if (errorText) {
        container.removeChild(errorText);
      }
      errorText = new Text(theme.fg('warning', message), 1, 0);
      container.addChild(errorText);
      container.invalidate();
    };

    input.onSubmit = (value: string) => {
      if (!value.trim()) {
        done('');
        return;
      }

      const validated = validateBackendUrl(value);
      if (!validated.ok) {
        showError(validated.message);
        return;
      }

      done(validated.value);
    };

    input.onEscape = () => done(undefined);

    container.addChild(hint);
    container.addChild(input);

    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => input.handleInput(data)
    };
  };
}

function buildBackendSettingsItems(scope: PresentationScope, backends: BackendConfig, theme: any): SettingItem[] {
  return [
    {
      id: 'scope',
      label: 'Write scope',
      currentValue: scope,
      values: ['project', 'global']
    },
    {
      id: 'backend:search:provider',
      label: 'Search backend',
      currentValue: backends.search.provider,
      values: ['duckduckgo', 'searxng', 'brave', 'youcom']
    },
    {
      id: 'backend:search:baseUrl',
      label: 'SearXNG URL',
      currentValue: backends.search.baseUrl ?? 'not set',
      submenu: createBackendUrlEditor(theme, 'SearXNG base URL', 'http://localhost:8080')
    },
    {
      id: 'backend:search:fallback',
      label: 'Search fallback',
      currentValue: backends.search.provider === 'searxng' || backends.search.provider === 'brave' || backends.search.provider === 'youcom' ? backends.search.fallback ?? 'off' : 'off',
      values: backends.search.provider === 'searxng' || backends.search.provider === 'brave' || backends.search.provider === 'youcom' ? ['off', 'duckduckgo'] : ['off']
    },
    {
      id: 'backend:secret:brave',
      label: 'Brave API key',
      currentValue: 'env var',
      values: ['env var']
    },
    {
      id: 'backend:secret:youcom',
      label: 'You.com API key',
      currentValue: 'env var',
      values: ['env var']
    },
    {
      id: 'backend:fetch:provider',
      label: 'Fetch backend',
      currentValue: backends.fetch.provider,
      values: ['http', 'firecrawl']
    },
    {
      id: 'backend:fetch:baseUrl',
      label: 'Firecrawl URL',
      currentValue: backends.fetch.baseUrl ?? 'not set',
      submenu: createBackendUrlEditor(theme, 'Firecrawl base URL', 'http://localhost:3002')
    },
    {
      id: 'backend:fetch:fallback',
      label: 'Firecrawl fallback',
      currentValue: backends.fetch.provider === 'firecrawl' ? backends.fetch.fallback ?? 'off' : 'off',
      values: backends.fetch.provider === 'firecrawl' ? ['off', 'http'] : ['off']
    },
    {
      id: 'backend:secret:firecrawl',
      label: 'Firecrawl API key',
      currentValue: 'env var',
      values: ['env var']
    }
  ];
}

function isToolName(value: string): value is PresentationToolName {
  return PRESENTATION_TOOL_NAMES.includes(value as PresentationToolName);
}

function isModeOrInherit(value: string): value is 'inherit' | 'compact' | 'preview' | 'verbose' {
  return ['inherit', 'compact', 'preview', 'verbose'].includes(value);
}

export function getInheritedConfigForScope(
  loaded: Awaited<LoadedPresentationConfig>,
  scope: PresentationScope
): PresentationConfig {
  if (scope === 'global') {
    return DEFAULT_PRESENTATION_CONFIG;
  }

  return mergePresentationConfigLayers(DEFAULT_PRESENTATION_CONFIG, loaded.global.rawConfig);
}

export function getScopeDisplayConfig(
  loaded: Awaited<LoadedPresentationConfig>,
  scope: PresentationScope
): PresentationConfig {
  if (scope === 'global') {
    return mergePresentationConfigLayers(DEFAULT_PRESENTATION_CONFIG, loaded.global.rawConfig);
  }

  return mergePresentationConfigLayers(
    DEFAULT_PRESENTATION_CONFIG,
    loaded.global.rawConfig,
    loaded.project.rawConfig
  );
}

export function getInheritedBackendsForScope(
  loaded: Awaited<LoadedPresentationConfig>,
  scope: PresentationScope
): BackendConfig {
  if (scope === 'global') {
    return DEFAULT_BACKEND_CONFIG;
  }

  return mergeBackendConfigLayers(DEFAULT_BACKEND_CONFIG, loaded.global.rawBackends);
}

export function getScopeDisplayBackends(
  loaded: Awaited<LoadedPresentationConfig>,
  scope: PresentationScope
): BackendConfig {
  if (scope === 'global') {
    return mergeBackendConfigLayers(DEFAULT_BACKEND_CONFIG, loaded.global.rawBackends);
  }

  return mergeBackendConfigLayers(
    DEFAULT_BACKEND_CONFIG,
    loaded.global.rawBackends,
    loaded.project.rawBackends
  );
}

export function createSettingsDraftState(
  loaded: Awaited<LoadedPresentationConfig>,
  initialScope: PresentationScope
): SettingsDraftState {
  const drafts = {
    global: getScopeDisplayConfig(loaded, 'global'),
    project: getScopeDisplayConfig(loaded, 'project')
  };
  const backendDrafts = {
    global: getScopeDisplayBackends(loaded, 'global'),
    project: getScopeDisplayBackends(loaded, 'project')
  };

  return {
    scope: initialScope,
    drafts,
    backendDrafts,
    config: clonePresentationConfig(drafts[initialScope]),
    backends: cloneBackendConfig(backendDrafts[initialScope])
  };
}

export function applySettingsValue(
  state: SettingsDraftState,
  id: string,
  newValue: string
): SettingsDraftState {
  const nextDrafts = {
    global: clonePresentationConfig(state.drafts.global),
    project: clonePresentationConfig(state.drafts.project)
  };
  const nextBackendDrafts = {
    global: cloneBackendConfig(state.backendDrafts.global),
    project: cloneBackendConfig(state.backendDrafts.project)
  };

  let nextScope = state.scope;

  if (id === 'scope' && (newValue === 'project' || newValue === 'global')) {
    nextScope = newValue;
    return {
      scope: nextScope,
      drafts: nextDrafts,
      backendDrafts: nextBackendDrafts,
      config: clonePresentationConfig(nextDrafts[nextScope]),
      backends: cloneBackendConfig(nextBackendDrafts[nextScope])
    };
  }

  const currentDraft = clonePresentationConfig(nextDrafts[nextScope]);
  const currentBackends = cloneBackendConfig(nextBackendDrafts[nextScope]);

  if (id === 'defaultMode' && (newValue === 'compact' || newValue === 'preview' || newValue === 'verbose')) {
    currentDraft.defaultMode = newValue;
  }

  if (id.startsWith('tool:')) {
    const toolName = id.slice('tool:'.length) as PresentationToolName;
    const nextTools = { ...currentDraft.tools };

    if (newValue === 'inherit') {
      delete nextTools[toolName];
    } else if (
      newValue === 'compact' ||
      newValue === 'preview' ||
      newValue === 'verbose'
    ) {
      nextTools[toolName] = { mode: newValue };
    }

    currentDraft.tools = nextTools;
  }

  if (id === 'backend:search:provider' && (newValue === 'duckduckgo' || newValue === 'searxng' || newValue === 'brave' || newValue === 'youcom')) {
    currentBackends.search.provider = newValue;
    if (newValue !== 'searxng') {
      delete currentBackends.search.baseUrl;
      delete currentBackends.search.options;
    }
    if (newValue === 'duckduckgo') {
      delete currentBackends.search.fallback;
    }
  }

  if (id === 'backend:search:fallback') {
    if (newValue === 'duckduckgo' && (currentBackends.search.provider === 'searxng' || currentBackends.search.provider === 'brave' || currentBackends.search.provider === 'youcom')) {
      currentBackends.search.fallback = 'duckduckgo';
    } else {
      delete currentBackends.search.fallback;
    }
  }

  if (id === 'backend:search:baseUrl') {
    if (newValue.trim()) {
      currentBackends.search.provider = 'searxng';
      currentBackends.search.baseUrl = newValue.trim();
    } else {
      delete currentBackends.search.baseUrl;
    }
  }

  if (id === 'backend:fetch:provider' && (newValue === 'http' || newValue === 'firecrawl')) {
    currentBackends.fetch.provider = newValue;
    if (newValue === 'http') {
      delete currentBackends.fetch.fallback;
    }
  }

  if (id === 'backend:fetch:fallback') {
    if (newValue === 'http' && currentBackends.fetch.provider === 'firecrawl') {
      currentBackends.fetch.fallback = 'http';
    } else if (newValue === 'off' || currentBackends.fetch.provider !== 'firecrawl') {
      delete currentBackends.fetch.fallback;
    }
  }

  if (id === 'backend:fetch:baseUrl') {
    if (newValue.trim()) {
      currentBackends.fetch.baseUrl = newValue.trim();
    } else {
      delete currentBackends.fetch.baseUrl;
    }
  }

  nextDrafts[nextScope] = currentDraft;
  nextBackendDrafts[nextScope] = currentBackends;

  return {
    scope: nextScope,
    drafts: nextDrafts,
    backendDrafts: nextBackendDrafts,
    config: clonePresentationConfig(nextDrafts[nextScope]),
    backends: cloneBackendConfig(nextBackendDrafts[nextScope])
  };
}

export function collapsePresentationConfigToOverride(
  config: PresentationConfig,
  inheritedConfig: PresentationConfig
): PresentationConfigOverride {
  const tools = Object.fromEntries(
    PRESENTATION_TOOL_NAMES.flatMap((toolName) => {
      const configuredMode = config.tools[toolName]?.mode;
      if (!configuredMode) {
        return [];
      }

      const inheritedMode = resolvePresentationMode(toolName, inheritedConfig);
      if (configuredMode === inheritedMode) {
        return [];
      }

      return [[toolName, { mode: configuredMode }]];
    })
  ) as PresentationConfigOverride['tools'];

  return {
    defaultMode:
      config.defaultMode === inheritedConfig.defaultMode ? undefined : config.defaultMode,
    tools
  };
}

export function collapseBackendConfigToOverride(
  config: BackendConfig,
  inheritedConfig: BackendConfig
): BackendConfigOverride {
  const override: BackendConfigOverride = {};

  if (!sameJson(config.search, inheritedConfig.search)) {
    override.search = config.search.provider !== inheritedConfig.search.provider
      ? { ...config.search }
      : {
          ...(config.search.baseUrl !== inheritedConfig.search.baseUrl ? { baseUrl: config.search.baseUrl } : {}),
          ...(config.search.fallback !== inheritedConfig.search.fallback ? { fallback: config.search.fallback } : {}),
          ...(!sameJson(config.search.options, inheritedConfig.search.options) ? { options: config.search.options } : {})
        };

    if (config.search.provider !== inheritedConfig.search.provider) {
      override.search.provider = config.search.provider;
    } else if (Object.keys(override.search).length === 0) {
      delete override.search;
    }
  }

  if (!sameJson(config.fetch, inheritedConfig.fetch)) {
    override.fetch = config.fetch.provider !== inheritedConfig.fetch.provider
      ? { ...config.fetch, apiKey: undefined }
      : {
          ...(config.fetch.baseUrl !== inheritedConfig.fetch.baseUrl ? { baseUrl: config.fetch.baseUrl } : {}),
          ...(config.fetch.fallback !== inheritedConfig.fetch.fallback ? { fallback: config.fetch.fallback } : {}),
          ...(!sameJson(config.fetch.options, inheritedConfig.fetch.options) ? { options: config.fetch.options } : {})
        };

    delete override.fetch.apiKey;

    if (config.fetch.provider !== inheritedConfig.fetch.provider) {
      override.fetch.provider = config.fetch.provider;
    } else if (Object.keys(override.fetch).length === 0) {
      delete override.fetch;
    }
  }

  if (!sameJson(config.headless, inheritedConfig.headless)) {
    override.headless = { ...config.headless };
  }

  return override;
}

export function handleSettingsShortcut(data: string): { action: 'cancel' | 'reset' | 'save' } | undefined {
  if (data === '\u001b') {
    return { action: 'cancel' };
  }

  if (data === '\u0012') {
    return { action: 'reset' };
  }

  if (data === '\u0013') {
    return { action: 'save' };
  }

  return undefined;
}

async function openActionMenu(ctx: any): Promise<WebAgentAction | undefined> {
  return ctx.ui.custom((tui: any, theme: any, _kb: unknown, done: (value: WebAgentAction | undefined) => void) => {
    const container = new Container();
    const items: SelectItem[] = [
      { value: 'settings', label: 'Settings', description: 'Edit presentation modes and backends' },
      { value: 'show', label: 'Show config', description: 'Print effective config paths and modes' },
      { value: 'doctor', label: 'Doctor', description: 'Check runtime dependencies and browser detection' },
      { value: 'changelog', label: 'Changelog', description: 'Show latest package changelog' },
      { value: 'reset-project', label: 'Reset project config', description: 'Delete project-level overrides' },
      { value: 'reset-global', label: 'Reset global config', description: 'Delete global overrides' }
    ];

    container.addChild(new DynamicBorder((text: string) => theme.fg('accent', text)));
    container.addChild(new Text(theme.fg('accent', theme.bold('pi-web-agent')), 1, 0));

    const list = new SelectList(items, Math.min(items.length, 8), {
      selectedPrefix: (text: string) => theme.fg('accent', text),
      selectedText: (text: string) => theme.fg('accent', text),
      description: (text: string) => theme.fg('muted', text),
      scrollInfo: (text: string) => theme.fg('dim', text),
      noMatch: (text: string) => theme.fg('warning', text)
    });

    list.onSelect = (item) => done(item.value as WebAgentAction);
    list.onCancel = () => done(undefined);
    container.addChild(list);
    container.addChild(new Text(theme.fg('dim', '↑↓ navigate • enter select • esc cancel'), 1, 0));
    container.addChild(new DynamicBorder((text: string) => theme.fg('accent', text)));

    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        list.handleInput?.(data);
        tui.requestRender?.();
      }
    };
  });
}

async function openSettingsSectionMenu(ctx: any): Promise<SettingsSection | undefined> {
  return ctx.ui.custom((tui: any, theme: any, _kb: unknown, done: (value: SettingsSection | undefined) => void) => {
    const container = new Container();
    const items: SelectItem[] = [
      { value: 'presentation', label: 'Presentation', description: 'Compact, preview, and verbose output modes' },
      { value: 'backends', label: 'Backends', description: 'Search/fetch providers, URLs, and fallbacks' }
    ];

    container.addChild(new DynamicBorder((text: string) => theme.fg('accent', text)));
    container.addChild(new Text(theme.fg('accent', theme.bold('pi-web-agent settings')), 1, 0));

    const list = new SelectList(items, items.length, {
      selectedPrefix: (text: string) => theme.fg('accent', text),
      selectedText: (text: string) => theme.fg('accent', text),
      description: (text: string) => theme.fg('muted', text),
      scrollInfo: (text: string) => theme.fg('dim', text),
      noMatch: (text: string) => theme.fg('warning', text)
    });

    list.onSelect = (item) => done(item.value as SettingsSection);
    list.onCancel = () => done(undefined);
    container.addChild(list);
    container.addChild(new Text(theme.fg('dim', '↑↓ navigate • enter select • esc cancel'), 1, 0));
    container.addChild(new DynamicBorder((text: string) => theme.fg('accent', text)));

    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        list.handleInput?.(data);
        tui.requestRender?.();
      }
    };
  });
}

async function openPresentationSettingsUi(
  ctx: any,
  loaded: Awaited<LoadedPresentationConfig>,
  initialScope: PresentationScope
): Promise<SettingsUiResult | undefined> {
  return ctx.ui.custom((_tui: unknown, theme: any, _kb: unknown, done: (value: SettingsUiResult) => void) => {
    let state = createSettingsDraftState(loaded, initialScope);
    let settingsList: SettingsList;

    const container = new Container();
    container.addChild(new Text(theme.fg('accent', theme.bold('pi-web-agent · presentation')), 1, 1));
    container.addChild(
      new Text(
        theme.fg('muted', 'Ctrl+S save · Ctrl+R reset scope · Esc cancel'),
        1,
        2
      )
    );

    const rebuildSettingsList = () => {
      if (settingsList) {
        container.removeChild(settingsList);
      }

      settingsList = new SettingsList(
        buildPresentationSettingsItems(state.scope, state.config),
        Math.min(PRESENTATION_TOOL_NAMES.length + 8, 18),
        getSettingsListTheme(),
        (id, newValue) => {
          state = applySettingsValue(state, id, newValue);
          rebuildSettingsList();
          container.invalidate();
        },
        () => done({ action: 'save', scope: state.scope, config: state.config, backends: state.backends }),
        { enableSearch: true }
      );

      container.addChild(settingsList);
    };

    rebuildSettingsList();

    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        const shortcut = handleSettingsShortcut(JSON.stringify(data).slice(1, -1));

        if (shortcut?.action === 'cancel') {
          done({ action: 'cancel' });
          return;
        }

        if (shortcut?.action === 'reset') {
          done({ action: 'reset', scope: state.scope });
          return;
        }

        if (shortcut?.action === 'save') {
          done({ action: 'save', scope: state.scope, config: state.config, backends: state.backends });
          return;
        }

        settingsList.handleInput?.(data);
      }
    };
  });
}

async function openBackendSettingsUi(
  ctx: any,
  loaded: Awaited<LoadedPresentationConfig>,
  initialScope: PresentationScope
): Promise<SettingsUiResult | undefined> {
  return ctx.ui.custom((_tui: unknown, theme: any, _kb: unknown, done: (value: SettingsUiResult) => void) => {
    let state = createSettingsDraftState(loaded, initialScope);
    let settingsList: SettingsList;

    const container = new Container();
    container.addChild(new Text(theme.fg('accent', theme.bold('pi-web-agent · backends')), 1, 1));
    container.addChild(
      new Text(
        theme.fg('muted', 'Ctrl+S save · Ctrl+R reset scope · Esc cancel · API keys stay in env vars'),
        1,
        2
      )
    );

    const rebuildSettingsList = () => {
      if (settingsList) {
        container.removeChild(settingsList);
      }

      settingsList = new SettingsList(
        buildBackendSettingsItems(state.scope, state.backends, theme),
        12,
        getSettingsListTheme(),
        (id, newValue) => {
          state = applySettingsValue(state, id, newValue);
          rebuildSettingsList();
          container.invalidate();
        },
        () => done({ action: 'save', scope: state.scope, config: state.config, backends: state.backends }),
        { enableSearch: true }
      );

      container.addChild(settingsList);
    };

    rebuildSettingsList();

    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        const shortcut = handleSettingsShortcut(JSON.stringify(data).slice(1, -1));

        if (shortcut?.action === 'cancel') {
          done({ action: 'cancel' });
          return;
        }

        if (shortcut?.action === 'reset') {
          done({ action: 'reset', scope: state.scope });
          return;
        }

        if (shortcut?.action === 'save') {
          done({ action: 'save', scope: state.scope, config: state.config, backends: state.backends });
          return;
        }

        settingsList.handleInput?.(data);
      }
    };
  });
}

export function registerWebAgentConfigCommands(pi: ExtensionAPI, deps: CommandDeps = {}) {
  const load = deps.load ?? (() => loadPresentationConfigLayers());
  const save = deps.save ?? ((scope, config) => savePresentationConfigScope({}, scope, config));
  const saveBackends = deps.saveBackends ?? ((scope, config) => saveBackendConfigScope({}, scope, config));
  const reset = deps.reset ?? ((scope) => resetPresentationConfigScope({}, scope));
  const resolveBrowser = deps.resolveBrowser ?? (() => resolveBrowserExecutable({}));
  const runtime = deps.runtime ?? {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch
  };
  const checkTypebox = deps.checkTypebox ?? defaultCheckTypebox;
  const checkBackends = deps.checkBackends ?? ((config: BackendConfig) => checkBackendHealth(config));
  const getChangelog = deps.getChangelog ?? (() => getLatestChangelogEntry());

  pi.registerCommand('web-agent', {
    description: 'Open settings or manage pi-web-agent presentation config',
    handler: async (args, ctx) => {
      let [action, maybeScope] = (args ?? '').trim().split(/\s+/).filter(Boolean);

      if (!action) {
        const selectedAction = await openActionMenu(ctx);
        if (!selectedAction) return;

        if (selectedAction === 'reset-project') {
          action = 'reset';
          maybeScope = 'project';
        } else if (selectedAction === 'reset-global') {
          action = 'reset';
          maybeScope = 'global';
        } else {
          action = selectedAction;
        }
      }

      if (action === 'doctor') {
        const [typeboxOk, browser, loaded] = await Promise.all([checkTypebox(), resolveBrowser(), load()]);
        const backendConfig = loaded.effectiveBackends ?? DEFAULT_BACKEND_CONFIG;
        const backendIssues = validateBackendConfig(backendConfig);
        const backendHealth = await checkBackends(backendConfig);
        const lines = [
          'pi-web-agent: loaded',
          `runtime: node ${runtime.nodeVersion} ${runtime.platform} ${runtime.arch}`,
          `typebox: ${typeboxOk ? 'ok' : 'missing'}`,
          formatBackendSummary(backendConfig),
          backendIssues.length > 0 ? `backend config: warning\n${backendIssues.join('\n')}` : 'backend config: ok',
          ...backendHealth
        ];

        if (browser.ok) {
          lines.push(`browser: ${browser.browser} ${browser.executablePath}`);
        } else {
          lines.push(`browser: missing (${browser.error.code})`);
          lines.push(browser.error.message);
          lines.push('Install Chrome, Chromium, Edge, or Brave and run /web-agent doctor again.');
        }

        ctx.ui.notify(lines.join('\n'), 'info');
        return;
      }

      if (action === 'show') {
        const loaded = await load();
        ctx.ui.notify(
          [
            formatConfigSummary(loaded.effectiveConfig),
            formatBackendSummary(loaded.effectiveBackends ?? DEFAULT_BACKEND_CONFIG),
            `global: ${loaded.global.path}${loaded.global.exists ? '' : ' (missing)'}`,
            `project: ${loaded.project.path}${loaded.project.exists ? '' : ' (missing)'}`
          ].join('\n'),
          'info'
        );
        return;
      }

      if (action === 'changelog') {
        const changelog = await getChangelog();
        ctx.ui.notify(changelog ?? 'No pi-web-agent changelog entries found.', 'info');
        return;
      }

      if (action === 'reset') {
        const scope = parseScopeToken(maybeScope) ?? 'project';
        await reset(scope);
        ctx.ui.notify(`Reset ${scope} config`, 'info');
        return;
      }

      if (action === 'mode') {
        const [, first, second] = (args ?? '').trim().split(/\s+/).filter(Boolean);
        const loaded = await load();
        const scope: PresentationScope = 'project';
        const baseConfig = getScopeDisplayConfig(loaded, scope);
        const inheritedConfig = getInheritedConfigForScope(loaded, scope);

        if (first && isModeOrInherit(first) && first !== 'inherit') {
          await save(scope, collapsePresentationConfigToOverride({ ...baseConfig, defaultMode: first }, inheritedConfig));
          ctx.ui.notify(`Saved project default mode = ${first}`, 'info');
          return;
        }

        if (first && second && isToolName(first) && isModeOrInherit(second)) {
          const nextTools = { ...baseConfig.tools };

          if (second === 'inherit') {
            delete nextTools[first];
          } else {
            nextTools[first] = { mode: second };
          }

          await save(
            scope,
            collapsePresentationConfigToOverride({ ...baseConfig, tools: nextTools }, inheritedConfig)
          );
          ctx.ui.notify(`Saved project ${first} = ${second}`, 'info');
          return;
        }

        ctx.ui.notify(
          'Usage: /web-agent mode <compact|preview|verbose> or /web-agent mode <tool> <inherit|compact|preview|verbose>',
          'info'
        );
        return;
      }

      if (!action || action === 'settings') {
        const loaded = await load();
        const initialScope: PresentationScope = 'project';
        const section = await openSettingsSectionMenu(ctx);
        if (!section) return;

        const result = section === 'presentation'
          ? await openPresentationSettingsUi(ctx, loaded, initialScope)
          : await openBackendSettingsUi(ctx, loaded, initialScope);

        if (!result || result.action === 'cancel') {
          return;
        }

        if (result.action === 'reset') {
          await reset(result.scope);
          ctx.ui.notify(`Reset ${result.scope} config`, 'info');
          return;
        }

        if (section === 'presentation') {
          await save(
            result.scope,
            collapsePresentationConfigToOverride(
              result.config,
              getInheritedConfigForScope(loaded, result.scope)
            )
          );
          ctx.ui.notify(`Saved ${result.scope} presentation config`, 'info');
          return;
        }

        await saveBackends(
          result.scope,
          collapseBackendConfigToOverride(
            result.backends,
            getInheritedBackendsForScope(loaded, result.scope)
          )
        );
        ctx.ui.notify(`Saved ${result.scope} backend config`, 'info');
        return;
      }

      ctx.ui.notify(
        'Use /web-agent, /web-agent show, /web-agent doctor, /web-agent changelog, /web-agent reset project, or /web-agent settings',
        'info'
      );
    }
  });
}
