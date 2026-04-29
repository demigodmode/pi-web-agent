# Presentation and settings

`pi-web-agent` keeps web research output compact by default.

That is deliberate. Research output gets noisy fast, especially when a tool is doing multiple search and fetch passes internally. The goal is to keep the transcript readable first, while still letting you ask for more detail when you want it.

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

`web_explore` can be shown in one visible mode at a time:

- `compact` — the shortest useful summary
- `preview` — findings with internal provenance
- `verbose` — findings, sources, caveats, and internal provenance

The important part is that these are not stacked on top of each other.

If a result is shown in `preview`, you get the preview body instead of a compact summary plus extra text under it.

## Default behavior

Out of the box, `web_explore` uses `compact`.

Example compact output:

```text
Reviewed 3 sources · synthesized answer with 3 findings
```

If no useful evidence was found, compact output says that plainly:

```text
No usable evidence found
```

## Preview and verbose provenance

Preview and verbose modes show the internal reader that produced each finding:

```text
- [web_fetch] Official docs say ...
- [web_fetch_headless] Rendered page says ...

Internal research: web_search ×2, web_fetch ×5, web_fetch_headless ×1
```

Those labels are internal provenance. They do not mean `web_search`, `web_fetch`, or `web_fetch_headless` are public tools in normal use.

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
/web-agent mode web_explore verbose
/web-agent mode web_explore inherit
```

## What `/web-agent` does

`/web-agent` and `/web-agent settings` both open the interactive settings UI.

From there you can:

- choose whether you are editing global or project settings
- change the default mode
- change the `web_explore` override
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

The `web_explore` override inherits from the current default mode unless you set it explicitly.

So if your default mode is `preview` and `web_explore` is set to `verbose`, then `web_explore` uses `verbose`.

When you switch `web_explore` back to `inherit`, the package removes that override instead of writing extra noise into the config file.

## Example config

```json
{
  "presentation": {
    "defaultMode": "compact",
    "tools": {
      "web_explore": { "mode": "verbose" }
    }
  }
}
```

## When to use each mode

A good practical rule:

- use `compact` if you mostly want clean transcripts
- use `preview` if you want findings plus internal provenance
- use `verbose` if you want sources and caveats inline too

For most people, `compact` as the default is probably right. Use `preview` or `verbose` when you are debugging research behavior or want to inspect what happened under the hood.
