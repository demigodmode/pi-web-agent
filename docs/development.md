# Development

## Install dependencies

```bash
npm install
```

## Build the package

```bash
npm run build
```

## Run the tests

```bash
npm test
```

## Run the typecheck

```bash
npm run lint
```

## Work on the docs

```bash
npm run docs:dev
```

That starts the VitePress docs site locally.

## Local Pi development

This repo includes `.pi/extensions/pi-web-agent.ts` for local development.

If Pi is already running, use `/reload` after code changes.

If something looks stale, double-check whether Pi is loading the local repo copy or the installed package copy.

## Optional browser smoke test

Set `PI_HEADLESS_SMOKE=1` before running Vitest if you want the real-browser smoke coverage.

It stays skipped by default so normal test runs do not depend on local browser installs.
