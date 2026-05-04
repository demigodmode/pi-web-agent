# Install

There are two real ways people end up using this project:

- install the published package in Pi
- work from the repo locally during development

The important thing is not to mix those up without meaning to, because Pi can end up loading a different copy than the one you think you are testing.

## Install from npm in Pi

```bash
pi install npm:@demigodmode/pi-web-agent
```

That installs the published package.

For the published package, Pi loads the compiled runtime from `dist/extension.js` through the `pi.extensions` entry in `package.json`.

After install/reload, run:

```text
/web-agent doctor
```

That checks whether the package loaded and whether headless rendering can find a supported local browser.

## Browser requirement for headless rendering

Headless rendering currently uses a local Chromium-family browser. Supported browsers are Chrome, Chromium, Edge, and Brave when they can be detected on Windows, macOS, or Linux.

Firefox/Safari-only systems can still use search and plain HTTP reads, but browser-rendered fallback pages need one of the supported Chromium-family browsers for now.

## Work from the repo locally

This repo also includes a project-local Pi extension entrypoint at `.pi/extensions/pi-web-agent.ts`.

That path is for local development and reloads while you are working in this repo.

## Config files after install

The package stores presentation settings in real JSON files.

Global config:

```text
~/.pi/agent/extensions/pi-web-agent/config.json
```

Project config:

```text
.pi/extensions/pi-web-agent/config.json
```

Project config overrides global config.

If you change settings through `/web-agent`, those files are what get updated.

## Backend config

The default backend setup is:

```json
{
  "backends": {
    "search": { "provider": "duckduckgo" },
    "fetch": { "provider": "http" },
    "headless": { "provider": "local-browser" }
  }
}
```

For a self-hosted setup, run SearXNG and Firecrawl yourself and add:

```json
{
  "backends": {
    "search": { "provider": "searxng", "baseUrl": "http://localhost:8080" },
    "fetch": { "provider": "firecrawl", "baseUrl": "http://localhost:3002" },
    "headless": { "provider": "local-browser" }
  }
}
```

If your Firecrawl instance requires a key, add `"apiKey": "..."` to the `fetch` config.

## Watch out for mixed setups

If you have both the npm-installed package and the local repo-based extension in play, it gets easy to think you are testing one copy when Pi is actually loading the other.

We already ran into exactly that during development.

If behavior looks stale, missing, or just weird, check what Pi actually loaded before you debug anything else.

## How to sanity-check what Pi loaded

A few practical checks help:

- make a small visible local change and use `/reload`
- restart Pi after install changes
- check whether the behavior matches the local repo or the published package version
- if needed, temporarily remove one install path so there is only one source of truth

It is a boring problem, but it is the kind that wastes a lot of time if you miss it.
