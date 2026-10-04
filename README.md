<p align="center">
  <img src="https://raw.githubusercontent.com/demigodmode/pi-web-agent/main/docs/public/pi-web-agent-banner.png" alt="pi-web-agent: bounded web research for Pi" width="100%">
</p>

# pi-web-agent

<p align="center">
  <a href="https://github.com/demigodmode/pi-web-agent/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/demigodmode/pi-web-agent/ci.yml?branch=main&style=flat-square&logo=github&label=CI" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@demigodmode/pi-web-agent"><img src="https://img.shields.io/npm/v/@demigodmode/pi-web-agent?style=flat-square&logo=npm&logoColor=white&color=CB3837" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@demigodmode/pi-web-agent"><img src="https://img.shields.io/npm/dm/@demigodmode/pi-web-agent?style=flat-square&color=0A7BBB&label=downloads" alt="npm downloads"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-475569?style=flat-square" alt="Platform: macOS, Linux, Windows">
  <a href="https://demigodmode.github.io/pi-web-agent/"><img src="https://img.shields.io/badge/docs-github%20pages-2088FF?style=flat-square&logo=readthedocs&logoColor=white" alt="Docs"></a>
  <a href="https://github.com/demigodmode/pi-web-agent/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@demigodmode/pi-web-agent?style=flat-square&color=6F42C1" alt="License"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/search%20backends-475569?style=flat-square" alt="Search backends">
  <img src="https://img.shields.io/badge/DuckDuckGo-475569?style=flat-square&logo=duckduckgo&logoColor=white" alt="DuckDuckGo">
  <img src="https://img.shields.io/badge/SearXNG-475569?style=flat-square&logo=searxng&logoColor=white" alt="SearXNG">
  <img src="https://img.shields.io/badge/Brave-475569?style=flat-square&logo=brave&logoColor=white" alt="Brave Search">
  <img src="https://img.shields.io/badge/You.com-475569?style=flat-square&logo=data%3Aimage%2Fpng%3Bbase64%2CiVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8%2F9hAAABZElEQVQ4jX2TP0sDQRDF3ywbcROCF8HKQgstUiWFX8BWm4BYaJVGERE89AuYzkY4mxQ2WqUQBBtt%2FQIpEhsbG%2Btg%2FiDehhB2LBLD5TKXBwsD835v2dldgqCS3%2FEWh%2B6cAB8AGAj6Wt0%2BB7lu3EtzQC%2Fm7UpBNA%2Fc2zEAgKdXmxhEh6edIiv3JuyYFDAJIqe2tVPugQQYANZWNULrpBYAeEzuXhNQkLppQ8hv6nEdIrQ8ayIUVRJ8cZRFxhAy4zptSLKCDs6%2BGRidlxlYWVbYKiwgEwN%2BLaPeHKDVnj6Snkqj8ZJ2ivTFgOik0ybE5XEW%2BY1R%2B%2BNziJu7H3EO4gxCyxMgWkvSDDSlmwgto%2F4%2BmNSSGGgq5VSZGT3J0Gq7maFF6C%2FlVFnVqrlGP6XWGagkBU1xjB4DFZtSxVo115A%2Bkw%2BGT4Sl6FNmRg%2BEoK9VMPOZ4ir5Hc8M3dX%2BrjkBgMcXex0H%2F%2FUHatWr2uEU4ZoAAAAASUVORK5CYII%3D" alt="You.com">
  <img src="https://img.shields.io/badge/Exa-475569?style=flat-square&logo=data%3Aimage%2Fpng%3Bbase64%2CiVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAACgUlEQVR42u2XXUiTYRTHf8%2Feuem7V6sbQcFMsgyJQoigizDqIuhDiW6iksBISrGS7MsP3JhWlBUqWnThjX2RBGlSRCREF0UEkURkGWYSUhCpe7e5ue3pQmaY6Eq3hNq5ex8O5%2Flxzvn%2FeR%2BRuu6bZA7DwBxHFCAKYAyVUF%2Bhkb06ZkbFS07pdD4bnR2AGieYFy8YdEhudHhCXmo2wZ5tsSgG0F1y9h0Ixvx4QW%2B%2Fn1v3p4ewH7agGOB6h4fnXb7w7ICU0NPnx3ZIZUmqMmXexrUm8nLNvOnxY2twhW8JpYQim44AGq0acWYxKScp0cCZUgtOl6TYruPxyvCqoLvXT80lF0sXKVQUqhPnqEBDpcaCBMHRs04%2BfPJHRoYtbR7udnrZlWMmZ4Np%2FPxIvsqq5Uaab49w77E3sj5QftFJ%2F0CAmhILKUkG1mTFULAjlldvfZy%2B7Aq%2FD%2Fwaw7rkYLVOa10CjVUayYkGHE5JoVVn1EdkAISAq7XxE850t2RFhhEpYW%2BZg89fAv%2BoFQdluLvUMf6dlWmktS6Brm4fyYkGLpRpbN43NKMu%2FHEHEjRBfYWG2yMpsukU253EWwRNVo0Y418YQXD7g2p4%2BnKUKzdHWLnMyMn9amQB8nLNbF1v4lq7h%2FZHP%2FV%2BvtnFi9c%2B8rfHsinbFBmAjDSF8gMq7z76qW6aqHefH4rtOt%2BHJeeOWVi8UAkvgBDQWKUhgSKrjtsz2ecHvgY4UevEogoaKjXMJhFegPRUhao6F%2B%2F7pvb5B0%2B8tLR5yExXqCpWw%2BuEgw5JWorC8YLpC4%2F6JP4A7Nxi5s7D0P8EIQFcbsmQQyIYK%2Fo7oTvHRqSpoccgoi%2BjKMB%2FD%2FADRpbjdBgK8S0AAAAASUVORK5CYII%3D" alt="Exa">
  <img src="https://img.shields.io/badge/Tavily-475569?style=flat-square&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1NSA1NSIgd2lkdGg9IjU1IiBoZWlnaHQ9IjU1Ij4KPHBhdGggZD0iTTM4LjgwODggMEM0NC40NzYyIDAgNDcuMzEwMSA5LjE4OTVlLTA1IDQ5LjQ3NDggMS4xMDMwNkM1MS4zNzg4IDIuMDczMjYgNTIuOTI3IDMuNjIxMzUgNTMuODk3MSA1LjUyNTQ0QzU1LjAwMDEgNy42OTAxMyA1NSAxMC41MjQgNTUgMTYuMTkxNFYzOC44MDg4QzU1IDQ0LjQ3NjEgNTUuMDAwMSA0Ny4zMDk5IDUzLjg5NzEgNDkuNDc0NkM1Mi45MjcgNTEuMzc4NiA1MS4zNzg4IDUyLjkyNjcgNDkuNDc0OCA1My44OTY5QzQ3LjMxMDEgNTQuOTk5OSA0NC40NzYyIDU1IDM4LjgwODggNTVIMTYuMTkxNEMxMC41MjM5IDU1IDcuNjkwMTQgNTQuOTk5OSA1LjUyNTQ0IDUzLjg5NjlDMy42MjEzMyA1Mi45MjY3IDIuMDczMjUgNTEuMzc4NyAxLjEwMzA2IDQ5LjQ3NDZDMC4wMDAxMDk5NTggNDcuMzA5OSAwIDQ0LjQ3NjIgMCAzOC44MDg4VjE2LjE5MTJDMCAxMC41MjM4IDAuMDAwMTA3NjE0IDcuNjkwMTIgMS4xMDMwNiA1LjUyNTQ0QzIuMDczMjUgMy42MjEzMyAzLjYyMTMzIDIuMDczMjYgNS41MjU0NCAxLjEwMzA2QzcuNjkwMTQgOC44ODQzNmUtMDUgMTAuNTIzOSAwIDE2LjE5MTQgMEgzOC44MDg4WiIgZmlsbD0iIzFGMUUxRSIvPgo8cGF0aCBkPSJNMjMuMzg2MyAzMC40MDVDMjMuMDg4NSAzMC40MDUgMjIuNzkzNCAzMC40NjM4IDIyLjUxODMgMzAuNTc4MkMyMi4yNDMzIDMwLjY5MjYgMjEuOTkzMyAzMC44NjAzIDIxLjc4MjcgMzEuMDcxNkwxNy40NTM0IDM1LjQxODhMMTYuMzAyOSAzNC4yNjM4QzE1LjQ1NzMgMzMuNDE1IDE0LjAwOTkgMzMuODM0NiAxMy43NDcxIDM1LjAwNjRMMTIuMTA3MyA0Mi4zMDIzQzEyLjA0OTggNDIuNTUzMiAxMi4wNTY4IDQyLjgxNDggMTIuMTI4IDQzLjA2MjFDMTIuMTk5IDQzLjMwODUgMTIuMzMxMyA0My41MzI3IDEyLjUxMjMgNDMuNzEzNkwxMi41MTA4IDQzLjcxNTlDMTIuNjkxNSA0My44OTg3IDEyLjkxNTUgNDQuMDMyMSAxMy4xNjE5IDQ0LjEwMzdDMTMuNDA4MyA0NC4xNzUyIDEzLjY2ODggNDQuMTgyNCAxMy45MTg4IDQ0LjEyNDZMMjEuMTg2MiA0Mi40Nzc2QzIyLjM1MjcgNDIuMjEzNyAyMi43NzE1IDQwLjc2MTQgMjEuOTI1OSAzOS45MTI0TDIwLjc3NTQgMzguNzU3NEwyNS4xMDU2IDM0LjQxMUMyNS41MzA2IDMzLjk4NDIgMjUuNzY5NSAzMy40MDQ5IDI1Ljc2OTUgMzIuODAxM0MyNS43Njk1IDMyLjE5NzcgMjUuNTMwNiAzMS42MTg1IDI1LjEwNTYgMzEuMTkxNkwyNS4wNDc2IDMxLjEzMzRMMjUuMDQ5NyAzMS4xMzE5TDI0Ljk4OTYgMzEuMDcxNkMyNC43NzkxIDMwLjg2MDMgMjQuNTI5IDMwLjY5MjYgMjQuMjU0IDMwLjU3ODJDMjMuOTc5IDMwLjQ2MzggMjMuNjg0IDMwLjQwNTEgMjMuMzg2MyAzMC40MDVaIE0zOS4wMDU0IDI3LjY2NjNDMzcuOTk0MSAyNy4wMjQ1IDM2LjY3NjggMjcuNzU0NiAzNi42NzY2IDI4Ljk1NTZWMzAuNTg4NEgyNy4zOTgxQzI3LjcwODEgMzEuMTgzMiAyNy44ODQ3IDMxLjg1OTYgMjcuODg0NyAzMi41Nzc0QzI3Ljg4NDYgMzMuNjE1MiAyNy41MTgxIDM0LjU2NzIgMjYuOTA4IDM1LjMwOTlMMzYuNjc1OCAzNS4zMDk2TDM2LjY3NTIgMzYuOTQyNEMzNi42NzUzIDM4LjE0MzQgMzcuOTk0MSAzOC44NzM2IDM5LjAwNTQgMzguMjMxOUw0NS4zMDQ1IDM0LjIzODdDNDUuNzc1NyAzMy45Mzg0IDQ2LjAxMTQgMzMuNDQzIDQ2LjAxMTUgMzIuOTQ4QzQ2LjAxMDkgMzIuNDUzNiA0NS43NzUyIDMxLjk1OTIgNDUuMzAzIDMxLjY2MDFMMzkuMDA1NCAyNy42NjYzWiBNMjMuNjEwNCAxMC4yMjA2QzIzLjM1MzkgMTAuMjE5NCAyMy4xMDEgMTAuMjgzOSAyMi44NzYzIDEwLjQwODFDMjIuNjUxNCAxMC41MzI1IDIyLjQ2MTQgMTAuNzEzMiAyMi4zMjUzIDEwLjkzMThMMTguMzQ3MiAxNy4yNTQ5SDE4LjM0NThDMTcuNzA2NyAxOC4yNzAxIDE4LjQzNDYgMTkuNTkzMyAxOS42MzA3IDE5LjU5MzZIMjEuMjU3OFYyOC45ODY5QzIxLjkzMjcgMjguNTQwNiAyMi43NDAzIDI4LjI4MDEgMjMuNjA5IDI4LjI4MDFDMjQuNDc4MSAyOC4yODAxIDI1LjI4NjQgMjguNTQwNyAyNS45NjE1IDI4Ljk4NzVWMTkuNTkzNkgyNy41ODg0QzI4Ljc4NDkgMTkuNTkzNiAyOS41MTEyIDE4LjI3MDIgMjguODcyOCAxNy4yNTQxTDI0Ljg5MzkgMTAuOTMxOEMyNC41OTUxIDEwLjQ1ODQgMjQuMTAyOSAxMC4yMjEyIDIzLjYxMDQgMTAuMjIwNloiIGZpbGw9IiNGRkZDRjYiLz4KPC9zdmc%2BCg%3D%3D" alt="Tavily">
  <img src="https://img.shields.io/badge/Google%20SERP-475569?style=flat-square&logo=google&logoColor=white" alt="Google SERP">
</p>

One public tool, `web_explore`, that does bounded web research for Pi: search, fetch, targeted browser rendering, ranking, and honest caveats, all behind a single call.

> Most agent web tooling blurs search, fetch, rendering, and synthesis into one vague thing. `pi-web-agent` keeps that boundary simple, and it is stricter about what it actually did: bot-check pages, narrow source sets, unreadable threads, and conflicting evidence show up as caveats instead of fake confidence.

## What you get

- **One tool.** `web_explore` handles direct links, discovery, HTTP reads, targeted headless rendering, source ranking, source-quality checks, and caveats internally.
- **Reads the real content behind links.** Paste a GitHub, PDF, or YouTube URL and it pulls the actual thing (GitHub files/issues/PRs from the API, PDF text, YouTube transcripts), keyless. So "summarize this PDF" or "what does this repo do" works off the source, not the page shell.
- **Answers questions about a GitHub repo from its code.** Paste a repo or folder link and it clones that exact commit (shallow, over HTTPS), searches the code for your question, and cites excerpts with links pinned to the commit. Needs `git` 2.32+. Private repos work with `gh auth login` or `GITHUB_TOKEN`. If the repo can't be read it says why instead of guessing from the README.
- **Esc stops it.** Cancelling a running `web_explore` stops searches, page reads, and the headless browser. Page reads give up after 15 seconds (PDFs 60, Firecrawl 45), and one page that fails to load doesn't fail the whole run.
- **Seven search backends.** DuckDuckGo (keyless default), SearXNG, Brave, You.com, Exa, Tavily, and any Google SERP endpoint you point it at.
- **Optional search fanout.** Query several backends at once, dedupe, and rank pages that more than one provider agreed on to the top. Off by default; flip it to `on` or `auto`.
- **Honest by default.** Weak, narrow, blocked, or cautionary evidence gets flagged instead of dressed up as confidence.
- **Safe with untrusted pages.** Links the model picks, or finds on a page it read, can't reach localhost, your LAN, or cloud metadata endpoints. That includes redirects and everything a headless page loads. Addresses you configure yourself aren't affected, and an allow list covers the private ranges you do want.
- **Fallback that knows why.** Rate-limited or misconfigured backends get skipped for a while, flaky ones get one retry, and answers say when some search backends were unavailable.
- **Bounded output.** `compact` / `preview` / `verbose` transcript modes.
- **Zero-config to start.** Runs keyless out of the box (DuckDuckGo search, local browser, the built-in readers). Opt into hosted backends, fallback, search fanout, and per-tool output modes through config when you want more control.

## Why pi-web-agent

Compared to other web tooling for agents:

- **Hands-off.** No curator, no browser windows to approve, no step that pops you out of your session. Ask `web_explore` once and the answer comes back cleanly. Nothing to babysit.
- **Keyless by default.** Search, page reads, and the GitHub/PDF/YouTube readers all work with no API keys. Add hosted providers only when you want them.
- **Bounded and honest.** Compact output by default, and it says when a read was not good enough instead of returning fake confidence.

## Install

> `pi-web-agent` requires Pi 0.74+ (Pi packages moved to the `@earendil-works/*` scope). Update Pi before updating this package. On older Pi, stay on `@demigodmode/pi-web-agent@0.6.x`. The extension works on Pi 0.99 and 1.0; `typebox` is a peer dependency that Pi already provides.

CI runs on Node 22. The locked runtime dependency `undici@8.10.2` declares Node `>=22.19.0`; see [installation requirements](https://demigodmode.github.io/pi-web-agent/install#requirements).

```bash
pi install npm:@demigodmode/pi-web-agent
```

Reload or restart Pi after installing, then:

```text
/web-agent doctor   # check it loaded and show configured backends
/web-agent          # action menu
```

Update later with `pi update --extensions`.

**Browser rendering:** headless first tries a detected Chromium-family browser (Chrome, Chromium, Edge, Brave). If none is found, it tries Playwright-managed Chromium, which must already be installed. See [browser setup](https://demigodmode.github.io/pi-web-agent/install#browser-rendering) for the matching install command. Firefox/Safari-only systems still get search and plain HTTP reads.

## Usage

Ask `web_explore` a web question:

> Find current docs and discussions on configuring Vitest coverage with the v8 provider.

Or hand it a link to read:

> Summarize this PDF: https://arxiv.org/pdf/1706.03762

If a pass comes back thin, call `web_explore` again with a narrower query.

## Backends

Defaults are DuckDuckGo search, plain HTTP fetch, and local-browser headless. Switch providers from `/web-agent settings → Backends`. The UI does not write API keys. Manual Firecrawl `apiKey` and proxy `password` config values are supported, but a Backends save removes them from that scope's file. Environment variables survive those saves.

| Backend | Role | Enable with |
| --- | --- | --- |
| DuckDuckGo | search (default) | nothing, keyless |
| SearXNG | search (self-hosted) | base URL |
| Brave | search (hosted) | `PI_WEB_AGENT_BRAVE_API_KEY` |
| You.com | search (hosted) | `YDC_API_KEY` |
| Exa | search (hosted) | `EXA_API_KEY` |
| Tavily | search (hosted) | `TAVILY_API_KEY` |
| Google SERP | search (hosted) | base URL + `PI_WEB_AGENT_GOOGLE_SERP_API_KEY` |
| Firecrawl | fetch (self-hosted) | base URL + `PI_WEB_AGENT_FIRECRAWL_API_KEY` |
| GitHub reader | content | `GITHUB_TOKEN` (optional, raises the rate limit) |
| GitHub repo research | content | `git` 2.32+ on your PATH; `GITHUB_TOKEN` or `gh auth login` for private repos |

Full config shape (fallback, SearXNG/Firecrawl options, fanout): see the [self-hosted backends docs](https://demigodmode.github.io/pi-web-agent/self-hosted-backends).

## Settings

```text
/web-agent settings                    # main UI
/web-agent doctor                      # health check
/web-agent show                        # effective config
/web-agent changelog
/web-agent mode web_explore verbose    # per-tool presentation mode
/web-agent reset project | global
```

Config is JSON, and project config overrides global:

```text
Global:  ~/.pi/agent/extensions/pi-web-agent/config.json
Project: .pi/extensions/pi-web-agent/config.json
```

```json
{
  "presentation": {
    "defaultMode": "compact",
    "tools": { "web_explore": { "mode": "verbose" } }
  }
}
```

Presentation modes:

- `compact`: short summary, the default everywhere
- `preview`: slightly richer bounded view
- `verbose`: fuller bounded view

Modes change the terminal display; the model receives findings, sources, and caveats in every mode. In settings, Ctrl+S saves, Esc discards edits, and Ctrl+R immediately deletes the whole selected scope's config file, including both presentation and backend settings, without confirmation. Confirmation is deferred in [#98](https://github.com/demigodmode/pi-web-agent/issues/98).

## Docs

Full docs: <https://demigodmode.github.io/pi-web-agent/>. Work on them locally with `npm run docs:dev`.

## Development

```bash
npm install
npm test
npm run lint
npm run build
```

Local Pi work uses `.pi/extensions/pi-web-agent.ts`; run `/reload` after changes.

Feature and fix PRs target `develop`; `main` only moves on release. See [Releases](https://demigodmode.github.io/pi-web-agent/releases).

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
