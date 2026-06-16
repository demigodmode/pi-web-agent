# Getting started

If you just want to try the package in Pi, this is the short version.

## Install it

```bash
pi install npm:@demigodmode/pi-web-agent
```

If Pi is already running, reload or restart it so the package gets picked up.

Then run:

```text
/web-agent doctor
```

That checks the extension, runtime dependency, and browser detection status.

## What you get

The package exposes one public web research tool:

- `web_explore`

Use it when you want Pi to find and compare current web sources.

`web_explore` handles the annoying parts internally: search, HTTP reads, targeted headless rendering, source ranking, source-quality checks, and caveats when the evidence is not strong enough.

## Try a prompt

> Find current docs and discussions about configuring Vitest coverage in TypeScript projects.

Pi should call `web_explore` and return a compact research result. If you need more detail inline, switch presentation mode to `preview` or `verbose`.

Another example:

> Find two or three current sources on DuckDuckGo HTML scraping in Node.js and tell me what the common parsing pitfalls are.

That should still go through `web_explore`. If the first pass is thin, Pi can call `web_explore` again with a narrower query instead of dropping into shell commands or raw HTTP calls.

You can also include direct links in the prompt. `web_explore` reads HTTP/HTTPS links first, strips common tracking params, and then searches if it still needs more evidence.

## Presentation defaults

The package renders web research output in `compact` mode by default.

If you want to change that, open the action menu with:

```text
/web-agent
```

From there you can open settings, show config, run doctor, or reset config. Settings lets you change presentation modes and backend providers without editing JSON by hand.

If you want the full details, see [Presentation and settings](/presentation).

## Optional backends

By default, `web_explore` uses DuckDuckGo HTML search, plain HTTP page reads, and local-browser headless rendering with managed Chromium fallback when needed.

If you want hosted Brave Search, SearXNG, or Firecrawl, open:

```text
/web-agent settings
```

Choose **Backends** to point search at Brave or SearXNG, and page reading at Firecrawl. The settings UI can edit providers, base URLs where relevant, and fallback behavior.

If you have a Brave Search API key, set `PI_WEB_AGENT_BRAVE_API_KEY` in the environment, then choose Brave under **Backends**. Brave is hosted, so it does not need a `baseUrl`, and it only handles source discovery; `web_explore` still fetches pages, ranks evidence, and writes caveats itself.

Use `/web-agent show` to confirm the effective backend config. Use `/web-agent doctor` to check configured backend health.

Backend config also supports explicit fallback and a small set of provider options. See [Backends](/self-hosted-backends) for the full shape.

If your Firecrawl instance requires an API key, prefer an environment variable instead of committing secrets into project config:

```text
PI_WEB_AGENT_FIRECRAWL_API_KEY=...
```

The settings UI does not write API keys. You can still set `backends.fetch.apiKey` manually for local-only setups, but env vars are the safer default.

This project only connects to existing SearXNG/Firecrawl services; it does not manage or document how to run those services.

## Browser rendering requirement

Headless rendering first tries a detectable Chromium-family browser: Chrome, Chromium, Edge, or Brave.

If none is found, it falls back to Playwright-managed Chromium and still runs headless. Firefox/Safari-only systems can still use search and plain HTTP reads; browser-rendered fallback uses Chromium.

## One thing to keep in mind

If the package says no usable evidence was found, or adds a caveat, that is intentional. It is better to admit the research pass was thin, narrow, blocked, or cautionary than to turn weak pages or bot-check screens into fake confidence.
