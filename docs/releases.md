# Releases

## Normal release flow

1. update `CHANGELOG.md` under `## Unreleased`
2. run `npm run release:dry-run`
3. run `npm run release`
4. push the branch and tag
5. let GitHub Actions publish the tagged release to npm

## Trusted publishing

This repo uses npm Trusted Publishing from GitHub Actions.

That replaced the older `NPM_TOKEN` secret flow.

## Docs publishing

The docs site publishes through GitHub Pages.

With Pages enabled for the repo, pushes to `main` should rebuild and redeploy the docs automatically through the docs workflow.
