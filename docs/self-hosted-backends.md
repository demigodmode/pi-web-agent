# Backends

`pi-web-agent` can use alternate search and fetch backends without changing the public `web_explore` tool.

Self-hosted options:

- SearXNG for search
- Firecrawl for page fetch/extraction

Hosted options:

- Brave Search for API-backed source discovery
- You.com Search for API-backed source discovery
- Exa for API-backed source discovery
- Tavily for API-backed source discovery

These are all hosted, so they use an API key instead of a `baseUrl`.

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

## Keyless default

With no configuration, search uses DuckDuckGo. We send normal browser headers and retry once if a request looks blocked, so it holds up better than a raw scrape. If DuckDuckGo still walls the request (common on datacenter IPs), search quietly falls back to Tavily's keyless endpoint (no account, no API key). Only the query that failed is sent, and only on failure.

Don't want the Tavily fallback? Set `PI_WEB_AGENT_DISABLE_KEYLESS_FALLBACK=1` and a blocked DuckDuckGo request will just return an error instead.

## Easiest setup path

Open:

```text
/web-agent settings
```

Choose **Backends**. From there you can:

- switch search between DuckDuckGo, SearXNG, Brave, You.com, Exa, and Tavily
- edit the SearXNG base URL
- enable a hosted/SearXNG → DuckDuckGo fallback
- switch fetch between plain HTTP and Firecrawl
- edit the Firecrawl base URL
- enable Firecrawl → HTTP fallback
- set the outbound proxy URL

Hosted search and Firecrawl API keys are intentionally not edited in the settings UI. Prefer environment variables for secrets: `PI_WEB_AGENT_BRAVE_API_KEY`, `YDC_API_KEY`, `EXA_API_KEY`, `TAVILY_API_KEY`, and `PI_WEB_AGENT_FIRECRAWL_API_KEY`.

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

## You.com Search

To use You.com Search, set:

```text
YDC_API_KEY=...
```

Then choose **Settings → Backends → Search backend → youcom**.

Equivalent config:

```json
{
  "backends": {
    "search": {
      "provider": "youcom",
      "fallback": "duckduckgo"
    }
  }
}
```

You.com only improves source discovery. `web_explore` still fetches pages, ranks evidence, handles headless fallback, and writes caveats itself.

## Exa

To use Exa, set:

```text
EXA_API_KEY=...
```

Then choose **Settings → Backends → Search backend → exa**.

Equivalent config:

```json
{
  "backends": {
    "search": {
      "provider": "exa",
      "fallback": "duckduckgo"
    }
  }
}
```

Exa only improves source discovery. `web_explore` still fetches pages, ranks evidence, handles headless fallback, and writes caveats itself.

## Tavily

To use Tavily, set:

```text
TAVILY_API_KEY=...
```

Then choose **Settings → Backends → Search backend → tavily**.

Equivalent config:

```json
{
  "backends": {
    "search": {
      "provider": "tavily",
      "fallback": "duckduckgo"
    }
  }
}
```

Tavily only improves source discovery. `web_explore` still fetches pages, ranks evidence, handles headless fallback, and writes caveats itself.

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

## Search fanout

Search fanout queries several configured search providers at once, dedupes the merged results by URL, and reranks so URLs multiple providers agree on rank higher. Then the normal research loop continues.

Fanout has three modes:

- `off`: Default. Search uses a single provider (configured via **Settings → Backends → Search backend**).
- `on`: Every search queries all configured providers and merges the results.
- `auto`: Runs the primary provider first. If its results look thin (too few, or all from one host), fans out to configured providers for better coverage.

When fanout runs, the provider set defaults to the providers you have actually configured: DuckDuckGo (always, keyless), SearXNG if you gave it a baseUrl, and each hosted provider only when its API key is set. Providers you have not set up are not offered or queried.

To select which providers fan out, set the fanout mode from **Settings → Backends**, then toggle individual providers on or off. Only usable providers appear in that list. You can also edit `backends.search.fanout.providers` directly in the config file.

Each provider gets a short timeout during fanout, so one slow or unreachable backend (for example a self-hosted SearXNG that is down) is skipped instead of stalling the whole research pass.

The equivalent config is:

```json
{
  "backends": {
    "search": {
      "provider": "brave",
      "fanout": { "mode": "auto", "providers": ["duckduckgo", "brave", "exa"] }
    }
  }
}
```

In preview and verbose modes, fanout visibility shows which providers were queried, for example:

```text
web_search ×2 (fanout: duckduckgo, brave, exa)
```

Trade-off: fanout costs extra latency and API calls, which is why it is off by default and `auto` exists. Use `on` when you want maximum source diversity at the cost of longer research times. Use `auto` when you want a safety net without paying the latency cost most of the time.

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

When fallback happens, output indicates which backend failed and which fallback was used. This keeps self-hosted privacy expectations explicit: if you do not configure fallback, SearXNG, Brave, You.com, Exa, Tavily, and Firecrawl failures stay visible instead of silently switching to external/default backends.

## Proxy

Route all outbound `web_explore` traffic through an HTTP proxy:

```json
{
  "backends": {
    "proxy": {
      "url": "http://127.0.0.1:7890",
      "username": "user",
      "password": "pass"
    }
  }
}
```

- `url` is required and must be an `http://` or `https://` proxy URL.
- `username` and `password` are optional. When present, credentials are sent to the proxy as a `Proxy-Authorization` header (never to the target site).
- Credentials can instead come from the environment variables `PI_WEB_AGENT_PROXY_USERNAME` and `PI_WEB_AGENT_PROXY_PASSWORD`. Config values win when both are set.

When a proxy is configured it applies to every outbound request: search backends, plain HTTP fetches, Firecrawl, the GitHub and YouTube readers, PDF downloads, and `/web-agent doctor` health checks. HTTPS targets are tunneled with `CONNECT`, so the proxy sees the target hostname but not the request contents. The headless browser is also launched with the proxy configured.

The proxy URL is editable from **Settings → Backends**. The settings UI does not edit proxy credentials; like other secrets, keep credentials in environment variables rather than committed config files.

A proxy that is unreachable makes requests fail with a clear proxy error instead of silently bypassing the proxy.

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

The model should still use `web_explore`; it should not need separate SearXNG, Brave, You.com, Exa, Tavily, or Firecrawl tool calls. If your prompt includes an HTTP/HTTPS URL, `web_explore` reads that URL before spending search passes.

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

`pi-web-agent` does not silently fall back from SearXNG, Brave, You.com, Exa, or Tavily to DuckDuckGo, or from Firecrawl to plain HTTP, when you choose those providers. Fallback only happens when `fallback` is configured because some users choose specific backends to control where requests go.
