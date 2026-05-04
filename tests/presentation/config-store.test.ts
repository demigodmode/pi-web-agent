import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  getPresentationConfigPaths,
  loadPresentationConfigLayers,
  resetPresentationConfigScope,
  savePresentationConfigScope
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

  it('loads root presentation and backend config sections', async () => {
    const { globalPath } = getPresentationConfigPaths({ homeDir, projectDir });
    mkdirSync(path.dirname(globalPath), { recursive: true });
    writeFileSync(
      globalPath,
      JSON.stringify({
        presentation: { defaultMode: 'verbose' },
        backends: { search: { provider: 'duckduckgo' } }
      }),
      'utf8'
    );

    const loaded = await loadPresentationConfigLayers({ homeDir, projectDir });

    expect(loaded.effectiveConfig.defaultMode).toBe('verbose');
    expect(loaded.effectiveBackends).toEqual({
      search: { provider: 'duckduckgo' },
      fetch: { provider: 'http' },
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
});
