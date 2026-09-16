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

## `/web-agent doctor` says You.com is missing an API key

Set `YDC_API_KEY` in the environment where Pi runs, then reload/restart Pi and run `/web-agent doctor` again. The settings UI does not write You.com API keys to config files.

If You.com still reports an HTTP warning, check that the key is valid and that the Pi process can reach the You.com Search API.

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

- **Presentation**: `defaultMode` and `web_explore`
- **Backends**: search/fetch providers, SearXNG and Firecrawl URLs, fallback toggles, and env-var reminders for Brave/Firecrawl API keys

Older config files may still contain keys for older low-level tools. They are ignored by the current UI.

## Pi seems to be loading the wrong copy

If you use both the published package and the local repo-based extension, double-check which one Pi actually loaded.

This is an easy way to waste time debugging the wrong thing.

A quick sanity check is to make a tiny local change, reload Pi, and see whether the behavior changes with it.

## Pi fails to start with a module or Set error

You might see an error like:

```
Error: Failed to load extension "/home/user/.pi/agent/npm/node_modules/@demigodmode/pi-web-agent/dist/extension.js": Failed to load extension: ResolveMessage: Cannot find module 'punycode/' from '/home/user/.pi/agent/npm/node_modules/tr46/index.js'
Hint: Start without extensions using "pi -ne".
```

Or a variant that says `Failed to load extension: Set operation called on non-Set object`.

Both come from pi's extension loader, which cannot handle two patterns in jsdom's dependency tree. pi-web-agent patches those files on install and again every time the extension loads.

The patch can still come undone in between. Every pi extension shares one `~/.pi/agent/npm/node_modules` tree, so installing or updating any other extension re-extracts the files and reverts it.

To reapply it by hand:

```
node ~/.pi/agent/npm/node_modules/@demigodmode/pi-web-agent/scripts/patch-jiti-compat.mjs
```

## Fetches fail with a private address error

web_explore refuses to fetch pages on private, loopback, or link-local addresses when the link came from the model or from a page it read. That stops a web page from steering it at things like cloud metadata endpoints, services on localhost, or devices on your network.

The error names the host and the address it resolved to:

```
Blocked example.internal: resolves to private address 10.0.0.12. Add it to backends.network.allowRanges if this is intended.
```

If you meant to reach that address, add its range under Settings → Backends → Network allow list, or in your config:

```json
{
  "backends": {
    "network": { "allowRanges": ["10.0.0.0/24"] }
  }
}
```

If every fetch fails this way, check whether you run a proxy app in fake-IP (TUN) mode. Those make every website resolve to an address in `198.18.0.0/15`. Add `198.18.0.0/15` to the allow list.

On headless pages you may instead see `Blocked example.internal: could not verify its address before loading it in the browser.` That shows up when there is no proxy configured and the host just will not resolve, and it usually points to a DNS problem on the machine running Pi.

This does not affect search backends or the SearXNG, Firecrawl, and proxy addresses you configured yourself. Those are always allowed.

Then restart Pi.

`/web-agent doctor` reports the current state. A healthy install prints `jsdom compat patch: ok`. If the patch could not be applied it prints `jsdom compat patch: needed (...)` along with the command above.

## The model used shell commands for web research

That is not the intended path.

For web research, the model should use `web_explore`. If the first result is thin, it should call `web_explore` again with a narrower query rather than using shell network commands like `curl`, `Invoke-WebRequest`, or `npm view`.

The live eval tracks this as a quality issue because shell networking bypasses the package's source ranking, provenance, and caveat behavior.
