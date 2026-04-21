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
