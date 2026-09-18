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

With no configuration, search uses DuckDuckGo. We send normal browser headers, so it holds up better than a raw scrape. If DuckDuckGo walls the request (common on datacenter IPs), search falls back to Tavily's keyless endpoint (no account, no API key) straight away, without retrying the blocked page. Only the query that failed is sent, and only on failure. If DuckDuckGo answers but simply found nothing, that empty result is returned as is and Tavily is not asked.

Don't want the Tavily fallback? Set `PI_WEB_AGENT_DISABLE_KEYLESS_FALLBACK=1` and a blocked DuckDuckGo request will just return an error instead.

## Easiest setup path

Open:

```text
/web-agent settings
```

Choose **Backends**. From there you can:

- switch search between DuckDuckGo, SearXNG, Brave, You.com, Exa, Tavily, and Google SERP
- edit the search endpoint URL (SearXNG or Google SERP)
- enable a hosted/SearXNG → DuckDuckGo fallback
- switch fetch between plain HTTP and Firecrawl
- edit the Firecrawl base URL
- enable Firecrawl → HTTP fallback
- set the outbound proxy URL

Hosted search and Firecrawl API keys are intentionally not edited in the settings UI. Prefer environment variables for secrets: `PI_WEB_AGENT_BRAVE_API_KEY`, `YDC_API_KEY`, `EXA_API_KEY`, `TAVILY_API_KEY`, `PI_WEB_AGENT_GOOGLE_SERP_API_KEY`, and `PI_WEB_AGENT_FIRECRAWL_API_KEY`.

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

## Google SERP endpoint

`google-serp` is a vendor-neutral wrapper around any hosted service that front-ends Google results (Serper, SerpBase, and similar). Nothing in it is tied to one vendor: you set the endpoint and the key, and switching vendors is a base-URL change rather than a config migration.

Set the key:

```text
PI_WEB_AGENT_GOOGLE_SERP_API_KEY=...
```

Then pick **Settings → Backends → Search backend → google-serp** and enter the endpoint under **Search endpoint URL**, or write it directly:

```json
{
  "backends": {
    "search": {
      "provider": "google-serp",
      "baseUrl": "https://google.serper.dev/search"
    }
  }
}
```

`pi-web-agent` POSTs this body to that URL:

```json
{ "q": "example", "num": 10 }
```

with the key in a header (`X-API-Key` by default) and expects the common `organic[]` shape back:

```json
{
  "organic": [
    { "title": "Example", "link": "https://example.com", "snippet": "..." }
  ]
}
```

If your vendor spells the header differently, set `keyHeader`:

```json
{
  "backends": {
    "search": {
      "provider": "google-serp",
      "baseUrl": "https://api.example.com/search",
      "keyHeader": "Authorization"
    }
  }
}
```

Two things worth knowing:

- Vendors in this space often answer **HTTP 200 with a non-zero `status` in the body** when the key is bad or the balance is empty. That envelope is checked, so a bad key shows up as an auth or quota failure instead of "no results".
- SerpApi needs the key as a query parameter and returns `organic_results`, so it is a separate profile rather than part of this one.

Run `/web-agent doctor` after editing config: it sends the same one-result probe and reports `search backend: google-serp ok`, a warning with the reason, or the missing base URL/key.

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

pi-web-agent checks the page URL before sending it to Firecrawl and refuses private addresses. What a Firecrawl server fetches on its own side, such as redirects it follows, is outside that check.

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

Fallback also looks at why a backend failed before moving on:

- A rate limit falls back and skips that backend for a while: as long as the provider asked, capped at 15 minutes, or a minute if it didn't say.
- An exhausted quota, a rejected API key, or a missing key or base URL falls back and skips that backend until your settings change.
- A timeout, server error, or dropped connection gets one retry first.
- A blocked or garbled response falls back without a retry.
- An empty result is a real answer, so it does not fall back. Neither does a bad request (like an empty query).
- A private-address refusal or an invalid shared proxy setting never falls back to another backend.

Verbose output lists every backend that was tried, retried, or skipped and why. When some backends failed but another one answered, the answer notes that results may be incomplete. If every backend is being skipped, see "Search says no backend is available" in the troubleshooting guide.

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

- `url` is required and must be an `http://` or `https://` proxy URL. It must not embed credentials (`http://user:pass@host:port`); pi-web-agent strips any `user:pass@` from the URL and never sends it. Put credentials in `username`/`password` or the environment variables below instead.
- `username` and `password` are optional. When present, credentials are sent to the proxy as a `Proxy-Authorization` header (never to the target site).
- Credentials can instead come from the environment variables `PI_WEB_AGENT_PROXY_USERNAME` and `PI_WEB_AGENT_PROXY_PASSWORD`. Config values win when both are set. If you set credentials in the URL, `/web-agent doctor` and config validation tell you to move them to these variables.

When a proxy is configured it applies to every outbound request: search backends, plain HTTP fetches, Firecrawl, the GitHub and YouTube readers, PDF downloads, the headless browser, and `/web-agent doctor` health checks. HTTPS targets are tunneled with `CONNECT`, so the proxy never sees the request contents.

The proxy URL is editable from **Settings → Backends**. The settings UI does not edit proxy credentials; like other secrets, keep credentials in environment variables rather than committed config files.

A proxy that is unreachable makes requests fail with a clear proxy error instead of silently bypassing the proxy.

Page fetches, the readers, and the headless browser don't talk to your proxy directly. They go through a small local guard proxy that looks up each address, refuses private ones, and then asks your proxy to connect to the IP it checked. So for those requests your proxy sees an IP address rather than the hostname; search backends and Firecrawl still reach it by hostname. If your proxy only accepts hostnames, see `trustProxyDns` below and "Fetches fail with an upstream proxy refused error" in the troubleshooting guide.

## Private addresses, allow list, and proxy trust

`web_explore` refuses to connect to private, loopback, and link-local addresses (your LAN, `localhost`, cloud metadata like `169.254.169.254`) when the link came from the model or from a page it read. It checks every address a name resolves to, including redirects and everything a headless page loads, and connects to the address it checked so a DNS change can't move the request. Addresses you configured yourself are not affected: search backends, SearXNG, Firecrawl, and the proxy.

Two settings adjust this, both under **Settings → Backends**:

```json
{
  "backends": {
    "network": {
      "allowRanges": ["10.0.0.0/24"],
      "trustProxyDns": false
    }
  }
}
```

- `allowRanges` lists CIDR ranges `web_explore` may reach anyway, for example an internal docs site. Invalid entries and ranges that allow everything (`0.0.0.0/0`, `::/0`) are rejected. If you run a proxy app in fake-IP mode, every site resolves inside `198.18.0.0/15`; add that range or every fetch will be refused.
- `trustProxyDns` hands hostnames to your upstream proxy instead of checked IPs. Turn it on for proxies that only accept hostnames, or networks where names only resolve inside the proxy. It trusts your proxy to keep requests away from private addresses, so it is off by default, and localhost, private IPs written into a link, and names your own machine resolves to a private address are still refused. It has no effect without `backends.proxy`.

A project config's allow list replaces the global one rather than adding to it. `/web-agent doctor` shows both settings.

The protection covers connections that go through the guard proxy. It is not a full network sandbox for the browser; if you need that, restrict outbound traffic at the OS or container level.

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
