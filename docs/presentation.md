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

- `compact`: the shortest useful summary
- `preview`: up to three plain findings
- `verbose`: findings, sources, evidence, caveats, and retrieval details

These modes control terminal display. The model receives the same full findings, evidence, citations, caveats, and required-source notices in every mode, including `compact`.

The important part is that these are not stacked on top of each other.

If a result is shown in `preview`, you get the preview body instead of a compact summary plus extra text under it.

## Default behavior

Out of the box, `web_explore` uses `compact`.

Each call has a stable heading. Pi owns the outer shell and `⎿` marker; they
are shown here as terminal context, rather than text emitted by the extension:

```text
web_explore ("Vitest coverage configuration")
  ⎿ 3 searches · 4 pages read · 8s
```

While research runs, Pi replaces one activity line with the latest meaningful
step. It does not append a growing event log or show page text:

```text
web_explore ("Vitest coverage configuration")
  ⎿ Reading: vitest.dev/guide/coverage · 2 reads started
```

`searches` counts logical search requests that actually started. `pages read`
counts distinct readable documents that completed successfully, including a
direct URL or repository read where applicable. A fallback does not turn one
logical search into several searches, and retries or redirects do not turn one
document into several pages. The elapsed time is measured for this call.

If no useful evidence was found, compact output says that plainly:

```text
No usable evidence found
```

When a direct source the user supplied cannot be read, every mode preserves that failure instead of presenting unrelated findings as a review of that source:

```text
Required source not read: https://github.com/owner/repo/issues/42. GitHub resource was not found or may require access. The requirements of this source were not checked.
```

Use a follow-up after fixing access or narrowing the source. A failed required source is never represented as reviewed.

Required-source notices appear before findings in compact, preview, and verbose
views. They name the requested URL, explain the failure, and say that its
requirements were not checked. Other partial evidence gets a short limitation
in compact and preview; verbose retains the fuller caveat and diagnostics.

## Preview and verbose detail

Preview keeps the result short by showing at most three plain findings. This is
an intentional reduction: it omits reader labels, remaining findings, source
lists, and internal retrieval detail.

```text
web_explore ("Vitest coverage configuration")
  ⎿ 3 searches · 4 pages read · 8s

    Findings
      • Vitest supports V8 and Istanbul coverage providers.
      • Coverage thresholds can be set in the test configuration.
      • Provider behavior differs for some source transforms.
```

Verbose keeps the full terminal detail: executed queries, all findings, sources,
evidence, caveats, backend attempts, and a successful-read breakdown. Its
method labels include HTTP, Browser, Firecrawl, GitHub, PDF, YouTube, and
Repository. `Repository` means local repository research; it is distinct from
the GitHub reader. The Queries section is absent when the run only read direct
sources.

Expanding a result in Pi opens its verbose view regardless of the inline mode.
Saved results retain the presentation mode selected when they ran. Results from
older sessions use the available legacy presentation as a fallback.

## The fastest way to change it

Open the action menu and choose **Settings**:

```text
/web-agent
```

To open the settings section menu directly:

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

`/web-agent` opens the action menu. Choose **Settings** to pick between:

- **Presentation**: default output mode and the `web_explore` override
- **Backends**: search/fetch providers, base URLs where relevant, fallback behavior, and env-var reminders for Brave/Firecrawl API keys

From either settings screen you can:

- choose whether you are editing global or project settings
- save, reset the current scope, or cancel

Keyboard shortcuts in the settings UI:

- `Ctrl+S` saves edits to the selected scope
- `Ctrl+R` immediately deletes the selected scope's entire config file, including both presentation and backend settings, without confirmation
- `Esc` discards unsaved edits and closes settings

The reset menu entries and `/web-agent reset project` or `/web-agent reset global` also delete the whole scope file. Reset confirmation is deferred to a release after 1.14.1 in [issue #98](https://github.com/demigodmode/pi-web-agent/issues/98).

While an inline backend URL editor is open, its keys take precedence: Enter accepts the field edit and Esc cancels that edit. Return to the settings screen before using Ctrl+S to save the scope.

## Config files

Settings are stored in real JSON files. The UI writes presentation and backend sections separately so changing one does not wipe the other.

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

When you switch `web_explore` back to `inherit`, it uses the current default mode. Project settings save a `presentation.cleared` marker when removing a tool override, so a global tool override does not reappear after reload:

```json
{
  "presentation": {
    "cleared": ["tools.web_explore"]
  }
}
```

Omitting a project setting inherits the global setting. A clear marker removes the lower layer's tool override before this layer's values are applied. Changing the default mode then changes the inherited tool mode too. Selecting an explicit tool mode replaces the clear; removing the marker or resetting project config restores the global tool setting.

An explicit mode stays pinned even when it matches the global mode or current default. Saving other settings preserves existing tool and default-mode pins. Untouched inherited settings remain omitted from the saved layer.

## Example config

```json
{
  "presentation": {
    "defaultMode": "compact",
    "tools": {
      "web_explore": { "mode": "verbose" }
    }
  },
  "backends": {
    "search": { "provider": "duckduckgo" },
    "fetch": { "provider": "http" },
    "headless": { "provider": "local-browser" }
  }
}
```

Backend provider, URL, and fallback settings are usually easier to edit through **Settings → Backends** than by hand.

## When to use each mode

A good practical rule:

- use `compact` if you mostly want clean transcripts
- use `preview` if you want up to three plain findings
- use `verbose` if you want sources and caveats inline too

For most people, `compact` as the default is probably right. Use `preview` or `verbose` when you are debugging research behavior or want to inspect what happened under the hood.
