# Changelog

All notable changes to this project will be documented in this file.

The format is intentionally simple and release-oriented.

## Unreleased

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
