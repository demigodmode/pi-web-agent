import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  getPresentationConfigPaths,
  loadPresentationConfigLayers,
  resetPresentationConfigScope,
  saveBackendConfigScope,
  savePresentationConfigScope,
  resetResultsConfigScope,
  saveResultsConfigScope
} from '../../src/presentation/config-store.js';

describe('presentation config store', () => {
  let tempRoot: string;
  let homeDir: string;
  let projectDir: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'pi-web-agent-config-'));
    homeDir = path.join(tempRoot, 'home');
    projectDir = path.join(tempRoot, 'project');
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('builds the expected global and project file paths', () => {
    expect(getPresentationConfigPaths({ homeDir, projectDir })).toEqual({
      globalPath: path.join(homeDir, '.pi', 'agent', 'extensions', 'pi-web-agent', 'config.json'),
      projectPath: path.join(projectDir, '.pi', 'extensions', 'pi-web-agent', 'config.json')
    });
  });

  it('loads defaults when no files exist', async () => {
    const loaded = await loadPresentationConfigLayers({ homeDir, projectDir });

    expect(loaded.effectiveConfig).toEqual({
      defaultMode: 'compact',
      tools: {}
    });
    expect(loaded.effectiveBackends).toEqual({
      search: { provider: 'duckduckgo' },
      fetch: { provider: 'http' },
      headless: { provider: 'local-browser' }
    });
    expect(loaded.effectiveResults).toEqual({ lengthLimit: 'auto' });
    expect(loaded.global.exists).toBe(false);
    expect(loaded.project.exists).toBe(false);
  });

  it('merges global and project files with project taking precedence', async () => {
    const { globalPath, projectPath } = getPresentationConfigPaths({ homeDir, projectDir });

    mkdirSync(path.dirname(globalPath), { recursive: true });
    mkdirSync(path.dirname(projectPath), { recursive: true });

    writeFileSync(
      globalPath,
      JSON.stringify(
        {
          presentation: {
            defaultMode: 'preview',
            tools: { web_explore: { mode: 'verbose' } }
          }
        },
        null,
        2
      ),
      'utf8'
    );

    writeFileSync(
      projectPath,
      JSON.stringify(
        {
          presentation: {
            tools: { web_search: { mode: 'compact' } }
          }
        },
        null,
        2
      ),
      'utf8'
    );

    const loaded = await loadPresentationConfigLayers({ homeDir, projectDir });

    expect(loaded.effectiveConfig).toEqual({
      defaultMode: 'preview',
      tools: {
        web_explore: { mode: 'verbose' },
        web_search: { mode: 'compact' }
      }
    });
  });

  it('loads legacy presentation-only config files', async () => {
    const { globalPath } = getPresentationConfigPaths({ homeDir, projectDir });
    mkdirSync(path.dirname(globalPath), { recursive: true });
    writeFileSync(
      globalPath,
      JSON.stringify({ defaultMode: 'preview', tools: { web_explore: { mode: 'verbose' } } }),
      'utf8'
    );

    const loaded = await loadPresentationConfigLayers({ homeDir, projectDir });

    expect(loaded.effectiveConfig).toEqual({
      defaultMode: 'preview',
      tools: { web_explore: { mode: 'verbose' } }
    });
  });

  it('reads results at the root beside a legacy presentation file', async () => {
    const { globalPath } = getPresentationConfigPaths({ homeDir, projectDir });
    mkdirSync(path.dirname(globalPath), { recursive: true });
    writeFileSync(globalPath, JSON.stringify({
      defaultMode: 'preview',
      results: { lengthLimit: 'short' }
    }), 'utf8');

    const loaded = await loadPresentationConfigLayers({ homeDir, projectDir });

    expect(loaded.effectiveConfig.defaultMode).toBe('preview');
    expect(loaded.global.rawResults).toEqual({ lengthLimit: 'short' });
    expect(loaded.effectiveResults).toEqual({ lengthLimit: 'short' });
  });

  it.each([
    ['presentation-only project config', { presentation: { defaultMode: 'preview' } }, undefined],
    ['empty results root', { results: {} }, {}]
  ])('keeps global result length inherited with %s', async (_name, project, rawResults) => {
    const { globalPath, projectPath } = getPresentationConfigPaths({ homeDir, projectDir });
    mkdirSync(path.dirname(globalPath), { recursive: true });
    mkdirSync(path.dirname(projectPath), { recursive: true });
    writeFileSync(globalPath, JSON.stringify({ results: { lengthLimit: 'short' } }), 'utf8');
    writeFileSync(projectPath, JSON.stringify(project), 'utf8');

    const loaded = await loadPresentationConfigLayers({ homeDir, projectDir });
    expect(loaded.effectiveResults).toEqual({ lengthLimit: 'short' });
    expect(loaded.project.rawResults).toEqual(rawResults);
  });

  it('layers global Short with project inherit, explicit Auto, and a cleared override', async () => {
    await saveResultsConfigScope({ homeDir, projectDir }, 'global', { lengthLimit: 'short' });
    expect((await loadPresentationConfigLayers({ homeDir, projectDir })).effectiveResults).toEqual({ lengthLimit: 'short' });

    await saveResultsConfigScope({ homeDir, projectDir }, 'project', { lengthLimit: 'auto' });
    expect((await loadPresentationConfigLayers({ homeDir, projectDir })).effectiveResults).toEqual({ lengthLimit: 'auto' });

    await saveResultsConfigScope({ homeDir, projectDir }, 'project', { cleared: ['lengthLimit'] });
    const loaded = await loadPresentationConfigLayers({ homeDir, projectDir });
    expect(loaded.project.rawResults).toEqual({ cleared: ['lengthLimit'] });
    expect(loaded.effectiveResults).toEqual({ lengthLimit: 'auto' });
  });

  it('persists an exact results length and retains sibling sections across save and reset', async () => {
    const { projectPath } = getPresentationConfigPaths({ homeDir, projectDir });
    mkdirSync(path.dirname(projectPath), { recursive: true });
    writeFileSync(projectPath, JSON.stringify({
      backends: { fetch: { provider: 'firecrawl', apiKey: 'persisted-secret' } }
    }), 'utf8');

    await savePresentationConfigScope({ homeDir, projectDir }, 'project', {
      defaultMode: 'preview', tools: { web_explore: { mode: 'verbose' } }
    });
    await saveResultsConfigScope({ homeDir, projectDir }, 'project', { lengthLimit: 1234.9 });

    expect(JSON.parse(readFileSync(projectPath, 'utf8'))).toMatchObject({
      presentation: { defaultMode: 'preview', tools: { web_explore: { mode: 'verbose' } } },
      backends: { fetch: { provider: 'firecrawl', apiKey: 'persisted-secret' } },
      results: { lengthLimit: 1234 }
    });
    expect(JSON.parse(readFileSync(projectPath, 'utf8')).backends.fetch.apiKey).toBe('persisted-secret');
    expect((await loadPresentationConfigLayers({ homeDir, projectDir })).effectiveResults).toEqual({ lengthLimit: 1234 });

    await resetResultsConfigScope({ homeDir, projectDir }, 'project');
    const reset = JSON.parse(readFileSync(projectPath, 'utf8'));
    expect(reset.results).toBeUndefined();
    expect(reset.presentation.defaultMode).toBe('preview');
    expect(reset.backends.fetch.apiKey).toBe('persisted-secret');
  });

  it('does not create a config file when resetting results in a scope with no file', async () => {
    const { projectPath, globalPath } = getPresentationConfigPaths({ homeDir, projectDir });
    await resetResultsConfigScope({ homeDir, projectDir }, 'project');
    await resetResultsConfigScope({ homeDir, projectDir }, 'global');
    expect(existsSync(projectPath)).toBe(false);
    expect(existsSync(globalPath)).toBe(false);
  });

  it('retains results when presentation or backend settings are written', async () => {
    const { projectPath } = getPresentationConfigPaths({ homeDir, projectDir });
    await saveResultsConfigScope({ homeDir, projectDir }, 'project', { lengthLimit: 'medium' });
    await savePresentationConfigScope({ homeDir, projectDir }, 'project', {
      defaultMode: 'preview', tools: {}
    });
    await saveBackendConfigScope({ homeDir, projectDir }, 'project', {
      search: { provider: 'searxng', baseUrl: 'http://localhost:8080', fallback: 'duckduckgo' }
    });

    expect(JSON.parse(readFileSync(projectPath, 'utf8')).results).toEqual({ lengthLimit: 'medium' });
  });

  it('removes only a results override when saved empty', async () => {
    const { projectPath } = getPresentationConfigPaths({ homeDir, projectDir });
    await saveResultsConfigScope({ homeDir, projectDir }, 'project', { lengthLimit: 'medium' });
    await saveResultsConfigScope({ homeDir, projectDir }, 'project', {});

    expect(JSON.parse(readFileSync(projectPath, 'utf8')).results).toBeUndefined();
  });

  it('loads root presentation and backend config sections', async () => {
    const { globalPath } = getPresentationConfigPaths({ homeDir, projectDir });
    mkdirSync(path.dirname(globalPath), { recursive: true });
    writeFileSync(
      globalPath,
      JSON.stringify({
        presentation: { defaultMode: 'verbose' },
        backends: {
          search: {
            provider: 'searxng',
            baseUrl: 'http://localhost:8080',
            fallback: 'duckduckgo',
            options: { categories: ['general'], language: 'en', safesearch: 1 }
          },
          fetch: {
            provider: 'firecrawl',
            baseUrl: 'http://localhost:3002',
            apiKey: 'dev-key',
            fallback: 'http',
            options: { formats: ['markdown'], onlyMainContent: true }
          }
        }
      }),
      'utf8'
    );

    const loaded = await loadPresentationConfigLayers({ homeDir, projectDir });

    expect(loaded.effectiveConfig.defaultMode).toBe('verbose');
    expect(loaded.effectiveBackends).toEqual({
      search: {
        provider: 'searxng',
        baseUrl: 'http://localhost:8080',
        fallback: 'duckduckgo',
        options: { categories: ['general'], language: 'en', safesearch: 1 }
      },
      fetch: {
        provider: 'firecrawl',
        baseUrl: 'http://localhost:3002',
        apiKey: 'dev-key',
        fallback: 'http',
        options: { formats: ['markdown'], onlyMainContent: true }
      },
      headless: { provider: 'local-browser' }
    });
  });

  it('merges backend config layers with project taking precedence', async () => {
    const { globalPath, projectPath } = getPresentationConfigPaths({ homeDir, projectDir });
    mkdirSync(path.dirname(globalPath), { recursive: true });
    mkdirSync(path.dirname(projectPath), { recursive: true });
    writeFileSync(globalPath, JSON.stringify({ backends: { search: { provider: 'duckduckgo' } } }), 'utf8');
    writeFileSync(projectPath, JSON.stringify({ backends: { fetch: { provider: 'http' } } }), 'utf8');

    const loaded = await loadPresentationConfigLayers({ homeDir, projectDir });

    expect(loaded.global.rawBackends).toEqual({ search: { provider: 'duckduckgo' } });
    expect(loaded.project.rawBackends).toEqual({ fetch: { provider: 'http' } });
    expect(loaded.effectiveBackends).toEqual({
      search: { provider: 'duckduckgo' },
      fetch: { provider: 'http' },
      headless: { provider: 'local-browser' }
    });
  });

  it('ignores invalid json instead of throwing', async () => {
    const { globalPath } = getPresentationConfigPaths({ homeDir, projectDir });
    mkdirSync(path.dirname(globalPath), { recursive: true });
    writeFileSync(globalPath, '{ not-json', 'utf8');

    const loaded = await loadPresentationConfigLayers({ homeDir, projectDir });

    expect(loaded.effectiveConfig.defaultMode).toBe('compact');
    expect(loaded.global.error).toContain('JSON');
  });

  it('writes only the selected scope file', async () => {
    await savePresentationConfigScope(
      { homeDir, projectDir },
      'project',
      {
        defaultMode: 'preview',
        tools: { web_search: { mode: 'verbose' } }
      }
    );

    const loaded = await loadPresentationConfigLayers({ homeDir, projectDir });
    expect(loaded.project.exists).toBe(true);
    expect(loaded.global.exists).toBe(false);
    expect(loaded.effectiveConfig.defaultMode).toBe('preview');
  });

  it('writes sparse override json without serializing missing fields', async () => {
    const { projectPath } = getPresentationConfigPaths({ homeDir, projectDir });

    await savePresentationConfigScope(
      { homeDir, projectDir },
      'project',
      {
        tools: { web_search: { mode: 'verbose' } }
      }
    );

    const written = JSON.parse(readFileSync(projectPath, 'utf8'));
    expect(written).toEqual({
      presentation: {
        tools: { web_search: { mode: 'verbose' } }
      }
    });
  });

  it('saves backend overrides without dropping existing presentation config', async () => {
    const { projectPath } = getPresentationConfigPaths({ homeDir, projectDir });

    await savePresentationConfigScope({ homeDir, projectDir }, 'project', {
      defaultMode: 'preview',
      tools: { web_explore: { mode: 'verbose' } }
    });

    await saveBackendConfigScope({ homeDir, projectDir }, 'project', {
      search: { provider: 'searxng', baseUrl: 'http://localhost:8080', fallback: 'duckduckgo' },
      fetch: { provider: 'firecrawl', baseUrl: 'http://localhost:3002', fallback: 'http', apiKey: 'do-not-write' },
      proxy: { url: 'http://127.0.0.1:7890', username: 'user', password: 'do-not-write' }
    });

    const parsed = JSON.parse(readFileSync(projectPath, 'utf8'));

    expect(parsed.presentation).toEqual({
      defaultMode: 'preview',
      tools: { web_explore: { mode: 'verbose' } }
    });
    expect(parsed.backends).toEqual({
      search: { provider: 'searxng', baseUrl: 'http://localhost:8080', fallback: 'duckduckgo' },
      fetch: { provider: 'firecrawl', baseUrl: 'http://localhost:3002', fallback: 'http' },
      proxy: { url: 'http://127.0.0.1:7890', username: 'user' }
    });
  });

  it('lets a project-level proxy clear override a global proxy after reload', async () => {
    const { globalPath, projectPath } = getPresentationConfigPaths({ homeDir, projectDir });

    await saveBackendConfigScope({ homeDir, projectDir }, 'global', {
      proxy: { url: 'http://127.0.0.1:7890' }
    });
    await saveBackendConfigScope({ homeDir, projectDir }, 'project', {
      proxy: { url: '' }
    });

    const loaded = await loadPresentationConfigLayers({ homeDir, projectDir });
    expect(loaded.effectiveBackends.proxy).toBeUndefined();

    // The marker is persisted in the project file, not dropped.
    const projectParsed = JSON.parse(readFileSync(projectPath, 'utf8'));
    expect(projectParsed.backends.proxy).toEqual({ url: '' });
    // And the global proxy is left intact.
    const globalParsed = JSON.parse(readFileSync(globalPath, 'utf8'));
    expect(globalParsed.backends.proxy).toEqual({ url: 'http://127.0.0.1:7890' });
  });

  it('removes the selected scope file on reset', async () => {
    await savePresentationConfigScope(
      { homeDir, projectDir },
      'project',
      { defaultMode: 'preview', tools: {} }
    );

    await resetPresentationConfigScope({ homeDir, projectDir }, 'project');

    const loaded = await loadPresentationConfigLayers({ homeDir, projectDir });
    expect(loaded.project.exists).toBe(false);
  });

  it('persists the network allow list', async () => {
    const { projectPath } = getPresentationConfigPaths({ homeDir, projectDir });

    await saveBackendConfigScope({ homeDir, projectDir }, 'project', {
      network: { allowRanges: ['198.18.0.0/15'] }
    });

    const parsed = JSON.parse(readFileSync(projectPath, 'utf8'));
    expect(parsed.backends).toEqual({ network: { allowRanges: ['198.18.0.0/15'] } });
  });

  it('lets a project-level empty allow list clear a global one after reload', async () => {
    await saveBackendConfigScope({ homeDir, projectDir }, 'global', {
      network: { allowRanges: ['198.18.0.0/15'] }
    });
    await saveBackendConfigScope({ homeDir, projectDir }, 'project', {
      network: { allowRanges: [] }
    });

    const loaded = await loadPresentationConfigLayers({ homeDir, projectDir });
    expect(loaded.effectiveBackends.network).toEqual({ allowRanges: [] });
  });

  it('persists trustProxyDns', async () => {
    const { projectPath } = getPresentationConfigPaths({ homeDir, projectDir });

    await saveBackendConfigScope({ homeDir, projectDir }, 'project', {
      network: { trustProxyDns: true }
    });

    expect(JSON.parse(readFileSync(projectPath, 'utf8')).backends).toEqual({ network: { trustProxyDns: true } });
  });
});
