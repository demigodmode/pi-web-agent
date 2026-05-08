# pi-web-agent

[![CI](https://github.com/demigodmode/pi-web-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/demigodmode/pi-web-agent/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@demigodmode/pi-web-agent)](https://www.npmjs.com/package/@demigodmode/pi-web-agent)
[![Docs](https://img.shields.io/badge/docs-github%20pages-blue)](https://demigodmode.github.io/pi-web-agent/)

`@demigodmode/pi-web-agent` is a Pi package for web access.

Most agent web tools blur search, fetch, browser rendering, and research into one vague thing. `pi-web-agent` exposes one public research tool, `web_explore`, and keeps search/fetch/headless work inside that bounded workflow.

The point is keeping the model-facing boundary simple: ask `web_explore` to research a question, and it handles discovery, HTTP reads, targeted browser rendering, source ranking, and caveats internally.

That sounds obvious, but a lot of agent tooling gets fuzzy right there. This package is meant to be stricter about what it actually did and more willing to say when a read was not good enough to trust.

## Install

Compatibility notice: current `pi-web-agent` requires Pi 0.74+ because Pi packages moved to the `@earendil-works/*` scope. Update Pi before updating this package. If you are on an older Pi version, stay on `@demigodmode/pi-web-agent@0.6.x` until Pi is updated.

```bash
pi install npm:@demigodmode/pi-web-agent
```

After installing, reload or restart Pi. Run `/web-agent` for the action menu, or `/web-agent doctor` to check whether the package loaded cleanly and whether headless rendering can find a browser.

Headless rendering currently requires a detectable Chromium-family browser: Chrome, Chromium, Edge, or Brave. Firefox/Safari-only systems can still use search and plain HTTP reads, but browser-rendered fallback pages need a supported Chromium-family browser for now.

Later on, update installed packages with:

```bash
pi update
```

## Docs

Docs site:

- https://demigodmode.github.io/pi-web-agent/

Work on the docs locally:

```bash
npm run docs:dev
```

Build the docs:

```bash
npm run docs:build
```

## Presentation modes

`pi-web-agent` renders web tool output in one visible mode at a time:

- `compact` — short summary, default everywhere
- `preview` — slightly richer bounded view
- `verbose` — fuller bounded view

See the `v0.3.0` release notes for a before/after of the transcript cleanup:

- https://github.com/demigodmode/pi-web-agent/releases/tag/v0.3.0

## Settings

Primary UI:

```text
/web-agent settings
```

Helper commands:

```text
/web-agent doctor
/web-agent show
/web-agent changelog
/web-agent reset project
/web-agent reset global
/web-agent mode preview
/web-agent mode web_explore verbose
/web-agent mode web_explore inherit
```

Config files:

```text
Global:  ~/.pi/agent/extensions/pi-web-agent/config.json
Project: .pi/extensions/pi-web-agent/config.json
```

Precedence:

- built-in defaults
- global config
- project config

Project config overrides global config.

Example:

```json
{
  "presentation": {
    "defaultMode": "compact",
    "tools": {
      "web_explore": { "mode": "verbose" }
    }
  }
}
```

Backend config is also supported. Defaults remain DuckDuckGo search, plain HTTP fetch, and local browser headless fallback. If you already run SearXNG or Firecrawl, see the self-hosted backend guide:

- https://demigodmode.github.io/pi-web-agent/self-hosted-backends

## Local development

```bash
npm install
npm test
npm run lint
npm run build
```

For local Pi work, this repo includes `.pi/extensions/pi-web-agent.ts`.

If Pi is already running, use `/reload` after changes.

## License

AGPL-3.0-only. See `LICENSE`.
