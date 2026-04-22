# pi-web-agent

[![CI](https://github.com/demigodmode/pi-web-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/demigodmode/pi-web-agent/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@demigodmode/pi-web-agent)](https://www.npmjs.com/package/@demigodmode/pi-web-agent)
[![Docs](https://img.shields.io/badge/docs-github%20pages-blue)](https://demigodmode.github.io/pi-web-agent/)

`@demigodmode/pi-web-agent` is a Pi package for web access.

The whole point is keeping the boundaries straight:

- `web_search` is for discovery
- `web_fetch` is for plain HTTP reads
- `web_fetch_headless` is the explicit browser path
- `web_explore` is the bounded research path

That sounds obvious, but a lot of agent tooling gets fuzzy right there. This package is meant to be stricter about what it actually did and more willing to say when a read was not good enough to trust.

## Install

```bash
pi install npm:@demigodmode/pi-web-agent
```

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

## Settings

Primary UI:

```text
/web-agent settings
```

Helper commands:

```text
/web-agent show
/web-agent reset project
/web-agent reset global
/web-agent mode preview
/web-agent mode web_search verbose
/web-agent mode web_search inherit
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
      "web_search": { "mode": "preview" },
      "web_explore": { "mode": "verbose" }
    }
  }
}
```

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
