# Changelog

All notable changes to this project will be documented in this file.

The format is intentionally simple and release-oriented.

## Unreleased

### Added
- Nothing yet.

### Changed
- Nothing yet.

### Fixed
- Nothing yet.

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
