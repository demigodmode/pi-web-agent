# Changelog

All notable changes to this project will be documented in this file.

The format is intentionally simple and release-oriented.

## Unreleased

### Added
- Added one-time `pi-web-agent` changelog notices after package updates and `/web-agent changelog` for manual viewing.

### Changed
- Migrated Pi package imports to `@earendil-works/*` after the upstream Pi scope move.

### Fixed
- Nothing yet.

### Breaking
- This release requires Pi 0.74+. Users on older Pi versions should stay on `@demigodmode/pi-web-agent@0.6.x` until they update Pi.

## [0.6.0] - 2026-05-04
### Added
- Added configurable web backends for `web_explore`, including SearXNG search and Firecrawl fetch support.
- Added backend diagnostics to `/web-agent doctor`, including config validation and self-hosted endpoint checks.
- Added dedicated self-hosted backend docs for connecting existing SearXNG and Firecrawl services.

### Changed
- `/web-agent show` now includes the effective backend configuration.
- `web_explore` now loads the effective backend config while preserving the default DuckDuckGo, HTTP, and local-browser behavior.

### Fixed
- Fixed backend config merging so provider-specific fields do not leak when a higher-precedence config changes providers.
- Kept the configured `web_explore` workflow reusable while backend config is unchanged, avoiding unnecessary backend/cache recreation.

### Breaking
- None.

## [0.5.1] - 2026-05-04
### Added
- Nothing yet.

### Changed
- Nothing yet.

### Fixed
- Fixed the Windows browser-resolution test so it is deterministic on Linux CI.

### Breaking
- None.

## [0.5.0] - 2026-05-04
### Added
- Added `/web-agent doctor` to report extension, runtime dependency, and browser detection status.
- Added a `/web-agent` action menu for settings, config display, doctor, and reset actions.

### Changed
- Migrated runtime schema imports from `@sinclair/typebox` to `typebox` for Pi 0.69 compatibility.
- Documented the current headless rendering browser requirement and doctor command.

### Fixed
- Fixed headless browser detection so Chrome, Chromium, Edge, and Brave can be found across Windows, macOS, and Linux instead of only checking Windows Chrome/Edge paths.

### Breaking
- None.

## [0.4.0] - 2026-04-29
### Added
- Made `web_explore` the single public web research tool, with search, fetch, source ranking, and headless escalation handled internally.
- Added adaptive research helpers for query planning, candidate selection, evidence ranking, stop decisions, and answer synthesis.
- Added preview/verbose provenance for `web_explore` showing which internal reader produced each finding.

### Changed
- Simplified `/web-agent` presentation settings to `defaultMode` and `web_explore` only.
- Updated live web evals to treat shell/network fallbacks after `web_explore` as a quality issue.
- Updated the release script to use `npm version --no-git-tag-version` before tagging so package metadata is changed through npm instead of regex replacement.

### Fixed
- Turned successful headless reads into usable `web_explore` evidence instead of returning empty results for dynamic docs pages.
- Filtered headless bot-check/security-verification pages out of research evidence.
- Made empty research results display as “No usable evidence found” instead of looking like a successful synthesis.
- Added the Linux Rollup optional package to the lockfile so GitHub Actions can build from `npm ci` without patch-installing Rollup.

### Breaking
- None.

## [0.3.1] - 2026-04-22
### Added
- Nothing yet.

### Changed
- Stopped self-upgrading npm inside the publish workflow before install and publish steps.
- Added GitHub release creation to the tag publish workflow.

### Fixed
- Fixed the tag publish workflow so npm publishing no longer fails before `npm ci`.

### Breaking
- None.

## [0.3.0] - 2026-04-22
### Added
- Added compact, preview, and verbose presentation modes for web tool output.
- Added a user-facing `/web-agent` settings UI plus helper commands for showing, resetting, and changing presentation config.
- Added global and project-local presentation config files with project-overrides-global precedence.
- Added docs for presentation settings, config paths, and command usage.

### Changed
- Made compact output the default presentation mode for all web tools.
- Made bare `/web-agent` open the settings UI directly.

### Fixed
- Fixed settings scope switching so global and project drafts do not leak into each other.
- Fixed config persistence so inherited values are not unnecessarily written into lower-precedence config files.
- Fixed command notifications to use supported Pi UI notify levels.

### Breaking
- None.

## [0.2.2] - 2026-04-21
### Added
- Expanded the live web eval so it covers deterministic search failure cases and reports when follow-up web calls were blocked after `web_explore`.

### Changed
- Tightened post-`web_explore` discipline by blocking same-flow low-level web tool churn instead of relying on prompt wording alone.

### Fixed
- Split `web_search` failures into more useful states like no results, parse failures, blocked pages, and fetch failures.
- Catch DuckDuckGo challenge pages that still return HTTP 200 so blocked searches stop looking like vague parser bugs.
- Stopped the model from spiraling into extra `web_search` / `web_fetch` calls after a successful `web_explore` in the live-eval cases.

### Breaking
- None.

## [0.2.1] - 2026-04-20
### Added
- Nothing yet.

### Changed
- Nothing yet.

### Fixed
- Added the missing npm `--provenance` flag to the publish workflow so Trusted Publishing can exchange the GitHub OIDC token correctly.

### Breaking
- None.

## [0.2.0] - 2026-04-20
### Added
- Added AGPL licensing, a release foundation test, and changelog-driven release tooling.
- Added GitHub Actions workflows for CI and tag-based npm publishing.
- Added maintainer docs for releases, self-hosted runners, and main branch protection.

### Changed
- Documented the release process in the README.
- Switched npm publishing guidance from `NPM_TOKEN` secrets to npm Trusted Publishing.

### Fixed
- Stopped injecting post-`web_explore` reminder text through a context hook so it no longer leaks into normal sessions.
- Worked around Rollup's missing Linux native package in GitHub Actions so CI and publish jobs run reliably on Ubuntu.

### Breaking
- None.

## [0.1.0] - 2026-04-20

### Added
- Published `@demigodmode/pi-web-agent` as a Pi package.
- Added explicit web research tools for search, HTTP fetch, headless fetch, and bounded exploration.
- Added headless fetch implementation and package install validation.

### Changed
- Tightened follow-up tool discipline after `web_explore`.
- Split package build output from repo-local development tooling.

### Fixed
- Fixed post-`web_explore` reminder handling so it is derived from context instead of shared mutable state.

### Breaking
- None.
