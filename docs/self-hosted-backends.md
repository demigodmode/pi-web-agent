# Backends

`pi-web-agent` can use alternate search and fetch backends without changing the public `web_explore` tool.

Self-hosted options:

- SearXNG for search
- Firecrawl for page fetch/extraction

Hosted option:

- Brave Search for API-backed source discovery

Brave is hosted, so it uses an API key instead of a `baseUrl`.

This keeps the public Pi tool the same: the model still calls `web_explore`. The backend config only changes what `web_explore` uses internally.

## What this page does not cover

This project does not manage SearXNG or Firecrawl deployments.

Use the upstream docs for:

- installing either service
- Docker Compose files
- reverse proxies
- TLS
- auth setup
- service upgrades

The assumption here is that you already have working services and just want `pi-web-agent` to connect to them.

## Default backend config

Without any backend config, `pi-web-agent` uses:

```json
{
  "backends": {
    "search": { "provider": "duckduckgo" },
    "fetch": { "provider": "http" },
    "headless": { "provider": "local-browser" }
  }
}
```

That path does not require SearXNG or Firecrawl.

## Easiest setup path

Open:

```text
/web-agent settings
```

Choose **Backends**. From there you can:

- switch search between DuckDuckGo, SearXNG, and Brave
- edit the SearXNG base URL
- enable SearXNG/Brave → DuckDuckGo fallback
- switch fetch between plain HTTP and Firecrawl
- edit the Firecrawl base URL
- enable Firecrawl → HTTP fallback

Brave and Firecrawl API keys are intentionally not edited in the settings UI. Prefer `PI_WEB_AGENT_BRAVE_API_KEY` and `PI_WEB_AGENT_FIRECRAWL_API_KEY` for secrets.

## Config file locations

Global config:

```text
~/.pi/agent/extensions/pi-web-agent/config.json
```

Project config:

```text
.pi/extensions/pi-web-agent/config.json
```

Project config overrides global config.

## SearXNG search

To use SearXNG for search, choose **Settings → Backends**, set search provider to `searxng`, and enter the base URL. The equivalent config is:

```json
{
  "backends": {
    "search": {
      "provider": "searxng",
      "baseUrl": "http://localhost:8080"
    }
  }
}
```

`pi-web-agent` expects SearXNG JSON search to work at:

```text
/search?q=example&format=json
```

Run this after editing config:

```text
/web-agent doctor
```

Doctor checks that the configured SearXNG endpoint responds with JSON that looks like search results.

Supported SearXNG options can stay in config:

```json
{
  "backends": {
    "search": {
      "provider": "searxng",
      "baseUrl": "http://localhost:8080",
      "options": {
        "categories": ["general", "it"],
        "language": "en",
        "safesearch": 1
      }
    }
  }
}
```

These map to SearXNG search query params. Unsupported or malformed values show up as config warnings in `/web-agent doctor`.

## Brave Search

To use Brave Search, set:

```text
PI_WEB_AGENT_BRAVE_API_KEY=...
```

Then choose **Settings → Backends → Search backend → brave**.

Equivalent config:

```json
{
  "backends": {
    "search": {
      "provider": "brave",
      "fallback": "duckduckgo"
    }
  }
}
```

Brave only improves source discovery. `web_explore` still fetches pages, ranks evidence, handles headless fallback, and writes caveats itself.

## Firecrawl fetch

To use Firecrawl for page reading, choose **Settings → Backends**, set fetch provider to `firecrawl`, and enter the base URL. The equivalent config is:

```json
{
  "backends": {
    "fetch": {
      "provider": "firecrawl",
      "baseUrl": "http://localhost:3002"
    }
  }
}
```

`pi-web-agent` calls Firecrawl's scrape endpoint:

```text
/v1/scrape
```

If your Firecrawl instance requires an API key, prefer an environment variable:

```text
PI_WEB_AGENT_FIRECRAWL_API_KEY=...
```

The settings UI does not write API keys. You can still set an API key in config for local-only setups:

```json
{
  "backends": {
    "fetch": {
      "provider": "firecrawl",
      "baseUrl": "http://localhost:3002",
      "apiKey": "..."
    }
  }
}
```

Avoid committing project config files that contain secrets.

Supported Firecrawl options can stay in config:

```json
{
  "backends": {
    "fetch": {
      "provider": "firecrawl",
      "baseUrl": "http://localhost:3002",
      "options": {
        "formats": ["markdown"],
        "onlyMainContent": true
      }
    }
  }
}
```

These are sent in the Firecrawl scrape request body. The supported set is intentionally small for now.

## Explicit fallback

Fallback is opt-in. `pi-web-agent` does not silently leave a self-hosted backend unless you configure it. You can turn fallback on from **Settings → Backends**. The equivalent config is:

```json
{
  "backends": {
    "search": {
      "provider": "searxng",
      "baseUrl": "http://localhost:8080",
      "fallback": "duckduckgo"
    },
    "fetch": {
      "provider": "firecrawl",
      "baseUrl": "http://localhost:3002",
      "fallback": "http"
    }
  }
}
```

When fallback happens, output indicates which backend failed and which fallback was used. This keeps self-hosted privacy expectations explicit: if you do not configure fallback, SearXNG, Brave, and Firecrawl failures stay visible instead of silently switching to external/default backends.

## Full self-hosted example

```json
{
  "backends": {
    "search": {
      "provider": "searxng",
      "baseUrl": "http://localhost:8080",
      "fallback": "duckduckgo",
      "options": {
        "categories": ["general"],
        "language": "en",
        "safesearch": 1
      }
    },
    "fetch": {
      "provider": "firecrawl",
      "baseUrl": "http://localhost:3002",
      "fallback": "http",
      "options": {
        "formats": ["markdown"],
        "onlyMainContent": true
      }
    },
    "headless": {
      "provider": "local-browser"
    }
  }
}
```

You can combine this with presentation settings in the same file. The settings UI preserves both sections when saving:

```json
{
  "presentation": {
    "defaultMode": "preview"
  },
  "backends": {
    "search": {
      "provider": "searxng",
      "baseUrl": "http://localhost:8080",
      "fallback": "duckduckgo"
    },
    "fetch": {
      "provider": "firecrawl",
      "baseUrl": "http://localhost:3002",
      "fallback": "http"
    },
    "headless": {
      "provider": "local-browser"
    }
  }
}
```

## Verify the setup

Show the effective config:

```text
/web-agent show
```

Run diagnostics:

```text
/web-agent doctor
```

Expected healthy output includes lines like:

```text
search: searxng (http://localhost:8080) fallback duckduckgo
fetch: firecrawl (http://localhost:3002) fallback http
backend config: ok
search backend: searxng ok
search fallback: duckduckgo
fetch backend: firecrawl ok
fetch fallback: http
headless backend: local-browser (managed Chromium fallback configured)
```

Then try a normal research prompt:

```text
Find current docs for configuring Vitest coverage with the v8 provider.
```

The model should still use `web_explore`; it should not need separate SearXNG, Brave, or Firecrawl tool calls. If your prompt includes an HTTP/HTTPS URL, `web_explore` reads that URL before spending search passes.

## Troubleshooting

### `search provider searxng requires backends.search.baseUrl`

You set `provider` to `searxng` but did not include `baseUrl`.

### `fetch provider firecrawl requires backends.fetch.baseUrl`

You set `provider` to `firecrawl` but did not include `baseUrl`.

### `search backend: searxng warning`

Check that:

- SearXNG is running
- the configured URL is reachable from the Pi process
- JSON output works with `format=json`

### `fetch backend: firecrawl warning`

Check that:

- Firecrawl is running
- `/v1/scrape` is available
- the API key is set if your instance requires auth
- the Pi process can reach the configured URL

### Self-hosted privacy expectations

`pi-web-agent` does not silently fall back from SearXNG or Brave to DuckDuckGo, or from Firecrawl to plain HTTP, when you choose those providers. Fallback only happens when `fallback` is configured because some users choose specific backends to control where requests go.
