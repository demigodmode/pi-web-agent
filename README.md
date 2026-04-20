# pi-web-agent

`@demigodmode/pi-web-agent` is a Pi package for reliable web access.

It is built around a simple rule: searching for a page is not the same thing as reading it. This package keeps those steps separate, prefers plain HTTP by default, and is designed to say "I couldn't read this reliably" instead of making something up.

## What it does

The package is built around three tools:

- `web_search` finds relevant pages and returns titles, URLs, and snippets
- `web_fetch` fetches a specific page over plain HTTP and tries to extract readable content
- `web_fetch_headless` is the explicit browser-based path for pages that need rendering

The boundary between those tools is intentional.

`web_search` is for discovery. It should not imply that a page was fetched.

`web_fetch` is for reading a page over HTTP. If the result looks weak, incomplete, blocked, or too script-heavy, it should return `needs_headless` instead of bluffing.

`web_fetch_headless` exists for the cases where a browser really is required. It is opt-in only.

## Why this exists

A lot of web tooling in coding agents gets fuzzy in exactly the wrong places. Search results get treated like page reads. Browser fallback happens behind the scenes. Failures get softened into fake confidence.

This package is trying to do the opposite.

The rules are straightforward:

- no hidden browser launch
- no automatic HTTP-to-headless fallback
- no claiming a page was read when only snippets were available
- explicit structured failure when the result is incomplete or blocked

## What makes it different

The main thing is the contract.

`web_search` discovers sources.

`web_fetch` reads over HTTP only.

`web_fetch_headless` is the explicit browser path.

That separation is the whole point. It makes failures easier to reason about and avoids the weird behavior where a tool quietly changes execution mode behind your back.

## Install

Install it through Pi:

```bash
pi install npm:@demigodmode/pi-web-agent
```

Update installed packages later with:

```bash
pi update
```

If you just want to inspect the package from npm directly, the package name is:

```bash
npm view @demigodmode/pi-web-agent
```

## Current status

This repo is in early MVP shape, but it is no longer just a design doc.

Right now it has:

- a TypeScript project scaffold
- shared result and status contracts
- a DuckDuckGo HTML parser for `web_search`
- an HTTP fetch path with readability-based extraction and conservative escalation to `needs_headless`
- a real browser-backed `web_fetch_headless` implementation with local browser resolution
- repo-local Pi extension wiring for development
- a test suite around parser behavior, contracts, extraction, caching, and tool adapters
- optional smoke coverage for local installed browsers

So the project is real and usable, but still early.

## Example behavior

These are conceptual examples of the contract the package is aiming to expose.

### Search

`web_search("pi coding agent")`

Returns discovery results like:

- title
- URL
- snippet

It does not imply the page was fetched.

### HTTP fetch

`web_fetch("https://example.com/article")`

If the page is readable over plain HTTP, it should return extracted content.

If the page looks too script-heavy, too thin, blocked, or otherwise unreliable, it should return `needs_headless` instead of pretending the extraction is good enough.

### Explicit headless fetch

`web_fetch_headless("https://example.com/app")`

This is the browser-based path for pages that really need rendering.

This path now launches a local browser explicitly, waits for the rendered page to settle, and then extracts readable content from the rendered HTML.

## Local development

Install dependencies:

```bash
npm install
```

Run tests with coverage:

```bash
npm test
```

Run the typecheck used as lint:

```bash
npm run lint
```

Build the project:

```bash
npm run build
```

To run the optional real-browser smoke test for headless fetch, set `PI_HEADLESS_SMOKE=1` before running Vitest. It stays skipped by default so local browser install differences do not make the normal test suite flaky.

Coverage is now part of the normal `npm test` flow. Vitest prints a text summary in the terminal and writes the full HTML report to `coverage/`.

### Trying it in Pi locally

This repo includes a project-local Pi extension entrypoint at `.pi/extensions/pi-web-agent.ts` for development and hot reload.

For the published npm package, Pi loads the compiled runtime from `dist/extension.js` via the `pi.extensions` entry in `package.json`.

After starting Pi in this project, use `/reload` if you change the extension code and want Pi to pick up the latest version.

## Project layout

The code is split into small modules on purpose.

- `src/extension.ts` - package entry surface
- `src/tools/` - thin tool adapters
- `src/search/` - search backend logic
- `src/fetch/` - HTTP and headless fetch logic
- `src/extract/` - readable-content extraction
- `src/cache/` - small cache utilities
- `src/types.ts` - shared contracts
- `tests/` - parser, contract, extraction, fetch, and adapter tests

## Near-term next steps

The next chunk of work is pretty clear:

- keep tightening weak-content escalation on tricky HTTP targets
- improve cleanup of noisy rendered-page extraction on busy sites
- expand fixtures and end-to-end coverage
- add alternate search backends behind a first-class provider abstraction

