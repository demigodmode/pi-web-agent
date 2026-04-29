import { describe, expect, it } from 'vitest';
// @ts-expect-error importing local .mjs helper exports for tests
import { extractReleaseNotes } from '../scripts/release-notes.mjs';

describe('release notes helper', () => {
  it('extracts only the requested changelog version section', () => {
    const changelog = `# Changelog

## Unreleased

### Added
- Future work.

## [0.4.0] - 2026-04-29
### Added
- New web_explore flow.

### Fixed
- CI builds.

## [0.3.1] - 2026-04-22
### Fixed
- Old release fix.
`;

    expect(extractReleaseNotes(changelog, 'v0.4.0')).toBe(`### Added
- New web_explore flow.

### Fixed
- CI builds.`);
  });
});
