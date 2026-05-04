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

`web_explore` handles the annoying parts internally: search, HTTP reads, targeted headless rendering, source ranking, and caveats when the evidence is not strong enough.

## Try a prompt

> Find current docs and discussions about configuring Vitest coverage in TypeScript projects.

Pi should call `web_explore` and return a compact research result. If you need more detail inline, switch presentation mode to `preview` or `verbose`.

Another example:

> Find two or three current sources on DuckDuckGo HTML scraping in Node.js and tell me what the common parsing pitfalls are.

That should still go through `web_explore`. If the first pass is thin, Pi can call `web_explore` again with a narrower query instead of dropping into shell commands or raw HTTP calls.

## Presentation defaults

The package renders web research output in `compact` mode by default.

If you want to change that, open the action menu with:

```text
/web-agent
```

From there you can open settings, show config, run doctor, or reset config. Settings lets you change the default presentation mode and the `web_explore` override without editing JSON by hand.

If you want the full details, see [Presentation and settings](/presentation).

## Optional self-hosted backends

By default, `web_explore` uses DuckDuckGo HTML search, plain HTTP page reads, and local browser fallback when needed.

If you run your own services, you can point search at SearXNG and page reading at Firecrawl by editing either config file:

```json
{
  "backends": {
    "search": { "provider": "searxng", "baseUrl": "http://localhost:8080" },
    "fetch": { "provider": "firecrawl", "baseUrl": "http://localhost:3002" },
    "headless": { "provider": "local-browser" }
  }
}
```

Use `/web-agent show` to confirm the effective backend config. Use `/web-agent doctor` to check whether configured self-hosted endpoints respond.

For the full setup guide, see [Self-hosted backends](/self-hosted-backends).

If your Firecrawl instance requires an API key, prefer an environment variable instead of committing secrets into project config:

```text
PI_WEB_AGENT_FIRECRAWL_API_KEY=...
```

You can still set `backends.fetch.apiKey` in config for local-only setups.

This project only connects to existing SearXNG/Firecrawl services; it does not manage or document how to run those services.

## Browser rendering requirement

Headless rendering currently requires a detectable Chromium-family browser: Chrome, Chromium, Edge, or Brave.

Firefox/Safari-only systems can still use search and plain HTTP reads, but pages that require browser rendering will not work until Playwright-managed browser fallback is added.

## One thing to keep in mind

If the package says no usable evidence was found, or adds a caveat, that is intentional. It is better to admit the research pass was thin than to turn weak pages or bot-check screens into fake confidence.
