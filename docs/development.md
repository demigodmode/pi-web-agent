# Development

## Install dependencies

CI uses Node 22. The locked runtime dependency `undici@8.10.2` declares Node `>=22.19.0`; see [Requirements](/install#requirements).

Use the lockfile to reproduce CI's dependency graph:

```bash
npm ci
```

## Build the package

```bash
npm run build
```

## Run the tests

```bash
npm test
```

This runs Vitest with coverage. On Linux, the guard-proxy browser acceptance tests run when a detectable local browser or managed Chromium is available. They skip when no browser is available. CI installs Chromium and sets `PI_WEB_AGENT_REQUIRE_BROWSER_TESTS=1` so a missing browser fails the run instead of skipping that coverage.

For the same browser requirement locally, install the browser through the repo's Playwright CLI as described under [Browser rendering](/install#browser-rendering), then run:

```bash
PI_WEB_AGENT_REQUIRE_BROWSER_TESTS=1 npm test -- --maxWorkers=1 --no-file-parallelism --maxConcurrency=1
```

The single-worker flags limit concurrent test work. Live backend tests are separate: `SEARXNG_TEST_URL` and `FIRECRAWL_TEST_URL` opt into calls to those services; Firecrawl also reads `PI_WEB_AGENT_FIRECRAWL_API_KEY` when needed. Leave those URLs unset for ordinary local and CI runs.

## Run lint/typecheck

```bash
npm run lint
```

This is the TypeScript no-emit check for the package.

## Work on the docs

```bash
npm run docs:dev
```

That starts the VitePress docs site locally.

Check the production docs build with `npm run docs:build` before opening a docs PR.

## Local Pi development

This repo includes `.pi/extensions/pi-web-agent.ts` for local development.

If Pi is already running, use `/reload` after code changes.

If something looks stale, double-check whether Pi is loading the local repo copy or the installed package copy.

## Branches

Day-to-day work happens on `develop`. Branch off it for features and fixes, and open PRs against `develop`. CI runs on pull requests and on pushes to `develop` and `main`. `main` only moves when a release is merged in. See [Releases](/releases).

## Optional browser smoke test

Set `PI_HEADLESS_SMOKE=1` before running Vitest if you want the real-browser smoke coverage.

It stays skipped by default so normal test runs do not depend on local browser installs.
