# pi-web-agent

pi-web-agent is a Pi package for reliable web access.

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

## Current status

This repo is in early MVP shape, but it is no longer just a design doc.

Right now it has:

- a TypeScript project scaffold
- shared result and status contracts
- a DuckDuckGo HTML parser for `web_search`
- an HTTP fetch path with readability-based extraction
- conservative escalation to `needs_headless`
- a stubbed `web_fetch_headless` contract
- a test suite around parser behavior, contracts, extraction, caching, and tool adapters

What it does not have yet:

- finished Pi package wiring
- a real headless browser implementation
- full browser detection and smoke-test coverage

So the project is real and testable, but still incomplete.

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

At the moment, that path is still stubbed in this repo. The contract exists, but the real browser implementation is still part of the next slice of work.

## Local development

Install dependencies:

```bash
npm install
```

Run tests:

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

### Trying it in Pi locally

This repo includes a project-local Pi extension entrypoint at `.pi/extensions/pi-web-agent.ts`.

That means Pi can discover it from the repo during development. After starting Pi in this project, use `/reload` if you change the extension code and want Pi to pick up the latest version.

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

- wire the package into Pi for real
- replace the headless stub with an actual local-browser implementation
- improve blocked-page detection and escalation heuristics
- expand fixtures and end-to-end coverage

## Development notes

This repo currently ignores `local_docs/`, which is being used for local-only planning and spec files.

The tracked code and tests in the repo are the source of truth for implementation status.
