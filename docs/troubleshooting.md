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

## `/web-agent doctor` says Google SERP is missing its endpoint or key

`google-serp` needs both an endpoint and a key. Set `PI_WEB_AGENT_GOOGLE_SERP_API_KEY` in the environment where Pi runs, and set `backends.search.baseUrl` (or **Search endpoint URL** in settings) to your vendor's search URL. Reload/restart Pi and run doctor again.

If the key is sent in a header other than `X-API-Key`, set `backends.search.keyHeader`. If the vendor wants `Authorization: Bearer <key>`, include `Bearer ` in the key itself. A bad key or an empty balance reported inside a 200 response shows up as an auth or quota failure rather than "no results". See [Backends](/self-hosted-backends#google-serp-endpoint) for the full shape.

## Asking about a GitHub repo gets a refusal

Repo questions stop with a reason instead of falling back to the README. The common ones:

- `git isn't installed, so repo code can't be searched.` Install `git` and make sure it is on the PATH of the process running Pi.
- `git 2.32 or newer is needed to search repo code.` Update git. `/web-agent doctor` shows the version it found on its `repo research:` line.
- `... is NNN MB, over the 300MB limit; ask about a specific file URL instead.` Ask about a file URL, or a smaller repo.
- `Cloning owner/repo timed out after 60s.` Usually a slow connection or a big repo. Try again, or paste a `/tree/` folder link. The clone is still capped at 60 seconds.
- `owner/repo wasn't found, or the token doesn't have access to it.` Check the spelling. For a private repo, run `gh auth login` or set `GITHUB_TOKEN` in the environment where Pi runs.
- `GitHub rate limit hit; set GITHUB_TOKEN or sign in with gh for a higher limit.` Unauthenticated GitHub calls have a low hourly limit. A token raises it.
- `GitHub rejected the token` means `GITHUB_TOKEN` is wrong or expired.

You can only put two repo links in one question. A third is ignored.

## The repo cache folder is refused

You may see `the repo cache folder ... is a symlink`, `is not a directory`, `is owned by another user`, or `is readable by other users (expected 0700)`. Clones go in `pi-web-agent-repos-<your-user-id>` in your temp directory, and pi-web-agent won't use that folder if it can't confirm it is private to you. If it is yours and only holds old clones, delete it and ask again. If it is owned by someone else, leave it alone and check why it is there.

## A repo answer says it searched only the first files

Big repos hit the search limits (20,000 files, 64MB, or 10 seconds) and the answer says it searched only the first N files. Paste a `/tree/` folder link to the part you care about, for example `https://github.com/owner/repo/tree/main/src/auth`.

## Esc stopped `web_explore` but I wanted it to finish

A cancel stops everything underneath and nothing continues in the background. Ask again. Reads that hang on their own give up by themselves: 15 seconds for a page, 60 for a PDF, 45 for Firecrawl. A page that times out or drops the connection is reported as a failed read and the run uses the other sources.

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
- **Backends**: search/fetch providers, SearXNG and Firecrawl URLs, fallback toggles, and env-var reminders for the hosted search and Firecrawl API keys

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

Then restart Pi.

`/web-agent doctor` reports the current state. A healthy install prints `jsdom compat patch: ok`. If the patch could not be applied it prints `jsdom compat patch: needed (...)` along with the command above.

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

You may instead see `Blocked example.internal: could not verify its address before connecting.` That means the address could not be looked up from this machine, so pi-web-agent refused rather than let something else resolve it. It usually points to a DNS problem on the machine running Pi.

This does not affect search backends or the SearXNG, Firecrawl, and proxy addresses you configured yourself. Those are always allowed.

The check applies to connections that go through pi-web-agent's local guard proxy, which is how it handles page fetches and everything the headless browser loads. It is not a full network sandbox for the browser. If you need that guarantee, restrict outbound traffic at the OS or container level.

## Fetches fail with an upstream proxy refused error

With `backends.proxy` set, pi-web-agent looks up each address itself and asks your proxy to connect to that IP, so the proxy can't quietly send the request somewhere else. Some proxies only accept hostnames and reject that:

```
Upstream proxy refused 93.184.216.34:443 for example.com (HTTP 403). If it only accepts hostnames, set backends.network.trustProxyDns to trust it to enforce private-address restrictions.
```

If you trust that proxy to keep requests away from private addresses itself, turn on Settings → Backends → Trust the upstream proxy to enforce private-address restrictions, or set:

```json
{
  "backends": {
    "network": { "trustProxyDns": true }
  }
}
```

That hands the address decision to your proxy. pi-web-agent still refuses literal private addresses, localhost, and any private address it can see locally. The same setting helps when names only resolve inside the proxy's network. Even with this turned on, a name that resolves on your machine to a private address is still refused before it reaches the proxy.

## Search says no backend is available

When a search backend fails, pi-web-agent looks at why before moving on. A rate limit makes it skip that backend for a while (the time the provider asked for, capped at 15 minutes, or a minute if it didn't say). An exhausted quota, a rejected API key, or a missing key makes it skip that backend until the settings change or Pi restarts. A timeout or server error gets one quick retry first.

If every configured backend is being skipped, searches fail with a message like:

```
No search backend is available: brave rate_limited (available again at 2026-09-16T12:05:00.000Z), exa quota_exhausted.
```

A rate limit clears on its own. For a quota or key problem, fix the key or plan. A change to your pi-web-agent settings resets it right away; an API key set as an environment variable takes effect after you restart Pi. The verbose search output shows each backend that was tried, retried, or skipped and why.

When some backends failed but another one answered, the answer notes that results may be incomplete.

## The model used shell commands for web research

That is not the intended path.

For web research, the model should use `web_explore`. If the first result is thin, it should call `web_explore` again with a narrower query rather than using shell network commands like `curl`, `Invoke-WebRequest`, or `npm view`.

The live eval tracks this as a quality issue because shell networking bypasses the package's source ranking, provenance, and caveat behavior.
