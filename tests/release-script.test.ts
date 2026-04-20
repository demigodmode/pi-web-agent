import { describe, expect, it } from 'vitest';
// Runtime-tested script module; TypeScript doesn't need declarations for this import.
// @ts-expect-error importing local .mjs helper exports for tests
import { inferVersionBump, parseUnreleasedSections, rewritePackageLockVersion } from '../scripts/release.mjs';

describe('release script helpers', () => {
  it('returns major when Breaking has real entries', () => {
    const unreleased = {
      Added: [],
      Changed: [],
      Fixed: [],
      Breaking: ['Removed deprecated install path']
    };

    expect(inferVersionBump(unreleased)).toBe('major');
  });

  it('returns minor when Added has entries and Breaking does not', () => {
    const unreleased = {
      Added: ['Added release automation'],
      Changed: [],
      Fixed: [],
      Breaking: []
    };

    expect(inferVersionBump(unreleased)).toBe('minor');
  });

  it('returns patch when only fixes or changes exist', () => {
    const unreleased = {
      Added: [],
      Changed: ['Adjusted workflow docs'],
      Fixed: ['Fixed package metadata regression'],
      Breaking: []
    };

    expect(inferVersionBump(unreleased)).toBe('patch');
  });

  it('parses the top unreleased sections from changelog text', () => {
    const changelog = `# Changelog\n\n## Unreleased\n\n### Added\n- Added release automation\n\n### Changed\n- Tightened docs\n\n### Fixed\n- Fixed package shape\n\n### Breaking\n- None.\n\n## [0.1.0] - 2026-04-20\n`;

    expect(parseUnreleasedSections(changelog)).toEqual({
      Added: ['Added release automation'],
      Changed: ['Tightened docs'],
      Fixed: ['Fixed package shape'],
      Breaking: []
    });
  });

  it('rewrites the root package-lock version fields', () => {
    const packageLock = {
      name: '@demigodmode/pi-web-agent',
      version: '0.1.0',
      lockfileVersion: 3,
      packages: {
        '': {
          name: '@demigodmode/pi-web-agent',
          version: '0.1.0'
        },
        'node_modules/example': {
          version: '1.2.3'
        }
      }
    };

    expect(JSON.parse(rewritePackageLockVersion(JSON.stringify(packageLock), '0.2.0'))).toEqual({
      name: '@demigodmode/pi-web-agent',
      version: '0.2.0',
      lockfileVersion: 3,
      packages: {
        '': {
          name: '@demigodmode/pi-web-agent',
          version: '0.2.0'
        },
        'node_modules/example': {
          version: '1.2.3'
        }
      }
    });
  });
});
