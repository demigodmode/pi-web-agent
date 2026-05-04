# Self-hosted backends

`pi-web-agent` can use existing self-hosted services for search and page reading:

- SearXNG for search
- Firecrawl for page fetch/extraction

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

To use SearXNG for search, set `backends.search.provider` to `searxng` and provide `baseUrl`:

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

## Firecrawl fetch

To use Firecrawl for page reading, set `backends.fetch.provider` to `firecrawl` and provide `baseUrl`:

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

You can also set an API key in config for local-only setups:

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

## Full self-hosted example

```json
{
  "backends": {
    "search": {
      "provider": "searxng",
      "baseUrl": "http://localhost:8080"
    },
    "fetch": {
      "provider": "firecrawl",
      "baseUrl": "http://localhost:3002"
    },
    "headless": {
      "provider": "local-browser"
    }
  }
}
```

You can combine this with presentation settings in the same file:

```json
{
  "presentation": {
    "defaultMode": "preview"
  },
  "backends": {
    "search": {
      "provider": "searxng",
      "baseUrl": "http://localhost:8080"
    },
    "fetch": {
      "provider": "firecrawl",
      "baseUrl": "http://localhost:3002"
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
search: searxng (http://localhost:8080)
fetch: firecrawl (http://localhost:3002)
backend config: ok
search backend: searxng ok
fetch backend: firecrawl ok
```

Then try a normal research prompt:

```text
Find current docs for configuring Vitest coverage with the v8 provider.
```

The model should still use `web_explore`; it should not need separate SearXNG or Firecrawl tool calls.

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

`pi-web-agent` does not silently fall back from SearXNG to DuckDuckGo or from Firecrawl to plain HTTP when you choose self-hosted providers. Fallback policy needs to be explicit because some users choose self-hosted backends specifically to avoid external services.
