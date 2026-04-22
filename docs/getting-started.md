# Getting started

If you just want to try the package in Pi, this is the short version.

## Install it

```bash
pi install npm:@demigodmode/pi-web-agent
```

If Pi is already running, reload or restart it so the package gets picked up.

## What you get

The package exposes four tools:

- `web_search`
- `web_fetch`
- `web_fetch_headless`
- `web_explore`

The important part is that they do different jobs on purpose.

`web_search` finds sources.

`web_fetch` tries to read one page over plain HTTP.

`web_fetch_headless` is there for pages that really do need a browser.

`web_explore` is the higher-level research path when the job is bigger than one search or one page read.

## Try a few prompts

### Search for sources

> Search for recent docs about Playwright browser installation.

That should push Pi toward `web_search` when the job is discovery.

### Read one page directly

> Fetch and summarize https://example.com/article

That should favor `web_fetch` when the job is reading a specific page over HTTP.

### Use the browser path explicitly

> Use headless fetch to read https://example.com/app

That should favor `web_fetch_headless` when browser rendering is actually the point.

### Let the package do bounded research

> Find current docs and discussions about configuring Vitest coverage in TypeScript projects.

That should favor `web_explore` for the broader research workflow.

## Presentation defaults

The package renders web tool output in `compact` mode by default.

If you want to change that, open the settings UI with:

```text
/web-agent
```

That lets you change the default mode and per-tool overrides without editing code.

If you want the full details, see [Presentation and settings](/presentation).

## One thing to keep in mind

If the package says a page was too weak to trust over HTTP, that is not it being stubborn. That is the whole point of the contract.
