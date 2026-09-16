# Changelog

All notable changes to this project will be documented in this file.

The format is intentionally simple and release-oriented.

## Unreleased

### Added
- Optional proxy support. Point web_explore at an HTTP/HTTPS proxy and everything outbound goes through it: search, fetch, Firecrawl, the GitHub/PDF/YouTube readers, doctor health checks, and the headless browser. Off unless you set it, and nothing changes if you don't. Set it in Settings → Backends, and keep credentials in `PI_WEB_AGENT_PROXY_USERNAME` / `PI_WEB_AGENT_PROXY_PASSWORD` rather than in the URL. Thanks to @lo-tp for building this. (#50)

### Changed
- `/web-agent doctor` reports whether the jsdom compat patch is in place, and prints the command to reapply it if it isn't.

### Fixed
- Pi failing to start with `Cannot find module 'punycode/'` or `Set operation called on non-Set object`. The patch for this was only applied at install time, but every pi extension shares one node_modules tree, so installing or updating anything else quietly reverted it. It now reapplies every time the extension loads. Also fixes it picking the wrong copy of the dependency when the shared tree holds more than one. (#34)

### Breaking
- None.

## [1.10.0] - 2026-08-25
### Added
- The zero-config default has a safety net now. When DuckDuckGo blocks a search (which happens fast on VPS and datacenter IPs), web search falls back to Tavily's keyless endpoint, no account or API key needed, so a fresh install still returns results instead of an error. Set `PI_WEB_AGENT_DISABLE_KEYLESS_FALLBACK=1` if you'd rather it just fail. (#42)

### Changed
- The keyless DuckDuckGo default is a lot harder to bot-wall. It sends real browser headers and retries once when a page looks blocked, instead of going out as an obvious script and getting bounced on the first request. (#42)

### Fixed
- Blocked searches are labeled honestly. A bot-wall page comes back as "blocked" (which triggers the fallback) instead of "couldn't parse", including the 200-status pages that mix a no-results message with a bot-wall notice. (#42)

### Breaking
- None.

## [1.9.0] - 2026-08-15
### Added
- Search fanout. Ask a hard question and web_explore can now hit several of your configured search backends at once, dedupe the merged results, and rank the pages that more than one provider agreed on to the top. Off by default. Flip it to on or auto in Settings → Backends (auto only fans out when the first provider comes back thin, so easy queries stay cheap). Preview/verbose shows which providers ran and which got skipped. (#35)

### Changed
- None.

### Fixed
- web_explore can finally summarize a link you hand it. Paste a GitHub file/issue/PR, a PDF, or a YouTube URL and ask for a summary: it now reads the actual content (raw source, extracted PDF text, the video transcript) and gives the model the whole thing. 1.8.0 added these readers but then squeezed everything down to a ~180-char snippet before the model ever saw it, so summaries were basically guesswork. Now they're grounded in the real text (long content still capped around 24k characters). (#40, #41)
- Fanout won't stall on a dead provider anymore. Each one gets an 8s timeout, so an unreachable self-hosted SearXNG can't hang a whole research pass. (#35)
- Fanout only offers and queries the providers you've actually set up (keyless DuckDuckGo, SearXNG when you give it a URL, the hosted ones only when their key is present) instead of acting like all six are on. (#35)

### Breaking
- None.

## [1.8.0] - 2026-08-14
### Added
- Read the content behind GitHub, PDF, and YouTube links directly instead of the page shell. GitHub files, issues and PRs come from the API/raw endpoints (optional `GITHUB_TOKEN` raises the rate limit), PDFs are parsed with unpdf, and YouTube links return the transcript (long content capped around 24k characters). All keyless. Scanned PDFs and caption-less videos are caveated rather than failing. (#39, #40, #41)

### Changed
- None.

### Fixed
- None.

### Breaking
- None.

## [1.7.2] - 2026-08-12
### Added
- None.

### Changed
- None.

### Fixed
- Candidate scoring now matches GitHub sources by parsed hostname instead of a `url.includes('github.com/')` substring check that could also match unrelated hosts like `evil.com/github.com/`.
- `decodeHtmlEntities` now decodes `&amp;` last so an already-encoded entity such as `&amp;lt;` no longer collapses into `<` (double-unescape).
- The CI workflow now sets an explicit read-only default `GITHUB_TOKEN` permission.
- Bumped transitive `postcss`, `undici`, and `brace-expansion` in the lockfile to clear reported advisories.

### Breaking
- None.

## [1.7.1] - 2026-07-31
### Added
- None.

### Changed
- None.

### Fixed
- The issue #34 Pi-loader compatibility patch now resolves hoisted and nested `tr46` and `cssstyle` installations correctly instead of assuming they live inside `pi-web-agent/node_modules`.

### Breaking
- None.

## [1.7.0] - 2026-07-17
### Added
- Exa is now available as a hosted search backend for `web_explore`, aimed at research-quality source discovery. Set `EXA_API_KEY` in the environment and choose `exa` from **Settings → Backends**. Closes #2.
- Tavily is now available as a hosted search backend for `web_explore` alongside Exa, DuckDuckGo, SearXNG, Brave, and You.com. Set `TAVILY_API_KEY` and choose `tavily` from **Settings → Backends**. Closes #2.
- Both new backends support optional fallback to DuckDuckGo, and `/web-agent doctor` reports their setup status and validates configured access when a key is present.

### Changed
- Bumped @earendil-works/pi-coding-agent and pi-tui devDependencies to 0.80.10.

### Fixed
- None.

### Breaking
- None.

## [1.6.2] - 2026-07-10
### Added
- None.

### Changed
- None.

### Fixed
- Extension load failure on install (`Cannot find module 'punycode/'` / `Set operation called on non-Set object`) caused by pi's extension loader mishandling a couple of patterns in jsdom's dependency tree (tr46, cssstyle). Added a postinstall step that patches the affected files. Fixes #34

### Breaking
- None.

## [1.6.1] - 2026-07-05
### Added
- None.

### Changed
- None.

### Fixed
- Setting a SearXNG URL from **Settings → Backends** now actually saves, and switches the search provider to `searxng` if it wasn't already selected. Previously the URL was silently discarded unless SearXNG was already the active provider. Reported by @Josephur in #33.
- Same fix applied on the fetch side: setting a Firecrawl URL now switches the fetch provider to `firecrawl` too, instead of leaving it stuck on `http` until you flip it manually.
- Editing the SearXNG/Firecrawl base URL no longer opens a separate nested input prompt on top of the settings list (which could leave the session unresponsive to further input). It's now an inline field in the same list, and pressing Esc there only cancels the field instead of closing the whole settings screen and discarding unrelated pending changes.
- The inline URL field now starts with the cursor at the end of the pre-filled value, so typing right away appends instead of inserting at the front of the string.

### Breaking
- None.

## [1.6.0] - 2026-07-05
### Added
- You.com is now available as a hosted search backend for `web_explore`, selectable alongside DuckDuckGo, SearXNG, and Brave. Set `YDC_API_KEY` in the environment and choose `youcom` from **Settings → Backends**. You.com handles source discovery only; `web_explore` still fetches pages, ranks evidence, handles caveats, and synthesizes the answer itself. Contributed by @ydc-oss-bot in #32 - first outside PR this project has had.
- `/web-agent settings` now treats You.com as a first-class search backend (with optional DuckDuckGo fallback) while keeping API keys out of config files via `YDC_API_KEY`.
- `/web-agent doctor` now reports You.com setup status, warns when `YDC_API_KEY` is missing, and validates configured You.com access when a key is present.

### Changed
- None.

### Fixed
- None.

### Breaking
- None.

## [1.5.1] - 2026-06-22
### Added
- None.

### Changed
- None.

### Fixed
- Updated vulnerable dependency paths reported by `npm audit`, including Vitest, Pi dev tooling, `undici`, `ws`, `protobufjs`, `postcss`, and the Vite docs toolchain override.

### Breaking
- None.

## [1.5.0] - 2026-06-16
### Added
- Added Brave Search as the first hosted search backend for `web_explore`, giving users a high-quality API-backed discovery option without running their own SearXNG instance.
- Added optional Brave → DuckDuckGo fallback so hosted search can degrade gracefully instead of failing hard when the Brave API is unavailable or misconfigured.
- Added a dedicated Brave search adapter that feeds the existing `web_explore` research pipeline, so Brave improves source discovery while the package still handles fetching, ranking, evidence quality, synthesis, and caveats.

### Changed
- `/web-agent settings` now treats Brave as a first-class search backend while keeping API keys out of config files; users configure `PI_WEB_AGENT_BRAVE_API_KEY` in their environment instead.
- `/web-agent doctor` now reports Brave setup status, warns when `PI_WEB_AGENT_BRAVE_API_KEY` is missing, and validates configured Brave access when a key is present.
- Backend config validation and fallback metadata now understand Brave, including clear `fallbackFrom: 'brave'` reporting when DuckDuckGo fallback is used.

### Fixed
- None.

### Breaking
- None.

## [1.4.0] - 2026-06-09
### Added
- Added evidence quality analysis for `web_explore`, including source diversity, unreadable source, bot-check, and possible conflict signals.

### Changed
- `web_explore` now uses source quality signals before deciding whether to answer, search again, or answer with a caveat.
- Partial research caveats are now more specific when evidence is community-only, low-diversity, blocked, or cautionary.

### Fixed
- None.

### Breaking
- None.

## [1.3.0] - 2026-06-04
### Added
- Added direct URL handling in `web_explore` so linked pages are read before search results.
- Added forum/thread source classification for Reddit-style discussions, forums, Stack Overflow, and GitHub issues/discussions.
- Added Playwright-managed Chromium fallback when no local Chromium-family browser is detected.

### Changed
- Discussion-oriented queries now prefer forum/thread results over generic pages.
- `/web-agent doctor` now reports the local-browser headless backend and managed Chromium fallback.

### Fixed
- Preserved direct/thread fetch gaps in bounded research results so unreadable thread sources get explicit caveats.

### Breaking
- None.

## [1.2.0] - 2026-06-01
### Added
- Added backend provider and fallback editing to `/web-agent settings`.
- Added interactive URL prompts for SearXNG and Firecrawl backend setup.

### Changed
- None.

### Fixed
- None.

### Breaking
- None.

## [1.1.0] - 2026-05-25
### Added
- Added explicit opt-in fallback from SearXNG to DuckDuckGo and Firecrawl to HTTP.
- Added supported SearXNG and Firecrawl backend options in config.
- Added env-gated live tests for local SearXNG and Firecrawl instances.

### Changed
- `/web-agent show` and `/web-agent doctor` now report configured backend fallback/options.

### Fixed
- None.

### Breaking
- None.

## [1.0.0] - 2026-05-08
### Added
- Added one-time `pi-web-agent` changelog notices after package updates and `/web-agent changelog` for manual viewing.

### Changed
- Migrated Pi package imports to `@earendil-works/*` after the upstream Pi scope move.

### Fixed
- None.

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
- None.

### Changed
- None.

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
- None.

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
- None.

### Changed
- None.

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
