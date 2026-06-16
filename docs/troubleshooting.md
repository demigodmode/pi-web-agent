# Troubleshooting

## `web_explore` found no usable evidence

That means the research pass ran, but none of the fetched pages produced evidence worth showing.

That can happen when:

- search results were off-topic
- pages were blocked or mostly boilerplate
- the readable content was too thin
- headless rendering hit a bot-check page
- several results were duplicates or low-value package pages

A good next move is another `web_explore` call with a narrower query. For example, include the library name, docs site, issue tracker, or exact API you care about.

## `web_explore` says evidence is partial for a specific reason

That usually means the research loop found usable evidence, but also found a quality problem such as mostly community sources, narrow source diversity, unreadable direct/thread links, bot-check pages, or cautionary/conflicting guidance.

You can usually improve the result by asking a narrower follow-up query that names the docs site, issue tracker, forum, or exact API you care about.

## The output has `[web_fetch]` or `[web_fetch_headless]` labels

Those labels show internal provenance.

- `[web_fetch]` means the finding came from a plain HTTP read.
- `[web_fetch_headless]` means it came from a browser-rendered read.
- `[web_explore]` is a fallback label when older or hand-shaped data did not include a reader method.

They are there so preview/verbose mode stays honest about what happened under the hood.

## The page looked thin or partial

That can happen when:

- the page is mostly client-rendered
- the readable content is blocked or minimal over HTTP
- the page shell is easier to fetch than the real content

`web_explore` can escalate selected pages to headless rendering internally, but that still does not guarantee a clean result. Some sites render bot checks, cookie walls, or noisy app shells even in a browser.

For direct links and forum/thread sources, unreadable pages are kept as explicit gaps so the final answer can say when a source could not be read reliably instead of pretending it was reviewed.

## `/web-agent doctor` says Brave is missing an API key

Set `PI_WEB_AGENT_BRAVE_API_KEY` in the environment where Pi runs, then reload/restart Pi and run `/web-agent doctor` again. The settings UI does not write Brave API keys to config files.

If Brave still reports an HTTP warning, check that the key is valid and that the Pi process can reach Brave Search API.

## `/web-agent doctor` mentions managed Chromium fallback

Headless rendering first tries a detectable Chromium-family browser:

- Chrome
- Chromium
- Edge
- Brave

If none is found, `web_explore` can fall back to Playwright-managed Chromium. It still launches with `headless: true`, so it should not pop open browser windows.

If you configured an explicit browser path and it is missing, doctor/fetch will still report that as a configuration problem instead of silently ignoring it.

## `/web-agent` did something unexpected

`/web-agent` opens an action menu with settings, show config, doctor, changelog, and reset options.

If you just want to inspect the currently effective config instead, use:

```text
/web-agent show
```

If the current behavior does not match what you expected, check both config scopes:

- global: `~/.pi/agent/extensions/pi-web-agent/config.json`
- project: `.pi/extensions/pi-web-agent/config.json`

Project config overrides global config.

If you want the diagnostic report directly, use:

```text
/web-agent doctor
```

The settings UI currently has two sections:

- **Presentation** — `defaultMode` and `web_explore`
- **Backends** — search/fetch providers, SearXNG and Firecrawl URLs, fallback toggles, and env-var reminders for Brave/Firecrawl API keys

Older config files may still contain keys for older low-level tools. They are ignored by the current UI.

## Pi seems to be loading the wrong copy

If you use both the published package and the local repo-based extension, double-check which one Pi actually loaded.

This is an easy way to waste time debugging the wrong thing.

A quick sanity check is to make a tiny local change, reload Pi, and see whether the behavior changes with it.

## The model used shell commands for web research

That is not the intended path.

For web research, the model should use `web_explore`. If the first result is thin, it should call `web_explore` again with a narrower query rather than using shell network commands like `curl`, `Invoke-WebRequest`, or `npm view`.

The live eval tracks this as a quality issue because shell networking bypasses the package's source ranking, provenance, and caveat behavior.
