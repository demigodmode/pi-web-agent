# Presentation and settings

`pi-web-agent` keeps web tool output compact by default.

That is deliberate. Search results, fetches, and research summaries can get noisy fast, especially when the package is doing exactly what you asked and returning a lot of useful detail. The goal here is to keep the transcript readable first, while still letting you ask for more when you want it.

## Before and after

Compact output is the default now, so normal research flows stay readable instead of turning into a wall of raw tool output.

<table>
  <tr>
    <td align="center"><strong>Before</strong></td>
    <td align="center"><strong>After</strong></td>
  </tr>
  <tr>
    <td><img src="/images/presentation/before-0.3.0.png" alt="Before 0.3.0 transcript output" width="100%" /></td>
    <td><img src="/images/presentation/after-0.3.0.png" alt="After 0.3.0 transcript output" width="100%" /></td>
  </tr>
</table>

If you want more detail inline, switch modes in `/web-agent` settings instead of living with the noisy default.

## The three presentation modes

Every web tool result is shaped into one visible mode at a time:

- `compact` — the shortest useful summary
- `preview` — a little more context, still bounded
- `verbose` — the fullest bounded view

The important part is that these are not stacked on top of each other.

If a tool result is shown in `preview`, you get the preview body instead of a compact summary plus extra text under it.

## Default behavior

Out of the box, all tools use `compact`:

- `web_search`
- `web_fetch`
- `web_fetch_headless`
- `web_explore`

That keeps normal usage calm instead of turning every search or fetch into a transcript dump.

## The fastest way to change it

Open the settings UI:

```text
/web-agent
```

That is the shorthand. The explicit form is:

```text
/web-agent settings
```

These also work:

```text
/web-agent settings
/web-agent show
/web-agent reset project
/web-agent reset global
/web-agent mode preview
/web-agent mode web_search verbose
/web-agent mode web_search inherit
```

## What `/web-agent` does

`/web-agent` and `/web-agent settings` both open the interactive settings UI.

From there you can:

- choose whether you are editing global or project settings
- change the default mode
- change per-tool overrides
- save, reset the current scope, or cancel

Keyboard shortcuts in the settings UI:

- `Ctrl+S` save
- `Ctrl+R` reset current scope
- `Esc` cancel

## Config files

Settings are stored in real JSON files.

Global config:

```text
~/.pi/agent/extensions/pi-web-agent/config.json
```

Project config:

```text
.pi/extensions/pi-web-agent/config.json
```

## Precedence

Effective behavior is resolved in this order:

1. built-in defaults
2. global config
3. project config

Project config overrides global config.

That means you can keep a personal default and then override it inside one repo when you want different transcript behavior there.

## How inheritance works

Per-tool overrides inherit from the current default mode unless you set them explicitly.

So if your default mode is `preview` and only `web_explore` is set to `verbose`, then:

- `web_search` uses `preview`
- `web_fetch` uses `preview`
- `web_fetch_headless` uses `preview`
- `web_explore` uses `verbose`

When you switch a tool back to `inherit`, the package removes that override instead of writing extra noise into the config file.

## Example config

```json
{
  "presentation": {
    "defaultMode": "compact",
    "tools": {
      "web_search": { "mode": "preview" },
      "web_explore": { "mode": "verbose" }
    }
  }
}
```

## When to use each mode

A good practical rule:

- use `compact` if you mostly want clean transcripts
- use `preview` if you want a little more inline context for discovery and fetches
- use `verbose` if you are actively inspecting tool output and do not mind a larger transcript

For most people, `compact` as the default plus a couple of per-tool overrides is probably the sweet spot.
