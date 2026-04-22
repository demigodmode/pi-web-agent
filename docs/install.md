# Install

There are two real ways people end up using this project:

- install the published package in Pi
- work from the repo locally during development

The important thing is not to mix those up without meaning to, because Pi can end up loading a different copy than the one you think you are testing.

## Install from npm in Pi

```bash
pi install npm:@demigodmode/pi-web-agent
```

That installs the published package.

For the published package, Pi loads the compiled runtime from `dist/extension.js` through the `pi.extensions` entry in `package.json`.

## Work from the repo locally

This repo also includes a project-local Pi extension entrypoint at `.pi/extensions/pi-web-agent.ts`.

That path is for local development and reloads while you are working in this repo.

## Config files after install

The package stores presentation settings in real JSON files.

Global config:

```text
~/.pi/agent/extensions/pi-web-agent/config.json
```

Project config:

```text
.pi/extensions/pi-web-agent/config.json
```

Project config overrides global config.

If you change settings through `/web-agent`, those files are what get updated.

## Watch out for mixed setups

If you have both the npm-installed package and the local repo-based extension in play, it gets easy to think you are testing one copy when Pi is actually loading the other.

We already ran into exactly that during development.

If behavior looks stale, missing, or just weird, check what Pi actually loaded before you debug anything else.

## How to sanity-check what Pi loaded

A few practical checks help:

- make a small visible local change and use `/reload`
- restart Pi after install changes
- check whether the behavior matches the local repo or the published package version
- if needed, temporarily remove one install path so there is only one source of truth

It is a boring problem, but it is the kind that wastes a lot of time if you miss it.
