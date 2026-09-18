# Setup modes

This project is simple in one sense and a little messy in another.

The package itself is focused. The broader world around search and research workflows is not.

## Basic use

The simplest path is just installing the package in Pi and using the tools as they exist today.

If all you want is the current package behavior, this is the setup that matters.

If you want to tune how tool output shows up in the transcript, see [Presentation and settings](/presentation).

## Hosted backend setups

Brave, You.com, Exa, and Tavily are available as hosted search backends, and `google-serp` covers hosted Google SERP vendors (that one also needs a `baseUrl`).

Each reads its key from the environment (`PI_WEB_AGENT_BRAVE_API_KEY`, `YDC_API_KEY`, `EXA_API_KEY`, `TAVILY_API_KEY`, `PI_WEB_AGENT_GOOGLE_SERP_API_KEY`), then you pick that provider from **Settings → Backends**. They handle source discovery only; `web_explore` still fetches pages, ranks evidence, handles caveats, and synthesizes the answer itself.

Other hosted research providers may be added later, but do not assume every provider-backed path is already wired in.

## Self-hosted setups

If you already run SearXNG or Firecrawl, `pi-web-agent` can connect to them through backend config.

See [Backends](/self-hosted-backends) for the config shape, verification steps, and troubleshooting notes.
