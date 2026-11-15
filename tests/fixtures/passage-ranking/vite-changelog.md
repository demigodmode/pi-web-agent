## <small>[8.3.8](https://github.com/vitejs/vite/compare/v8.3.7...v8.3.8) (2026-11-11)</small>
### Bug Fixes

* **build:** keep `magicString` and `ast` in transform hook meta ([#24012](https://github.com/vitejs/vite/issues/24012)) ([a3b28e8](https://github.com/vitejs/vite/commit/a3b28e8744ffae9abd018696ad4fc01b27ac71ce))
* **bundled-dev:** emit assets referenced by inline workers during load ([#23103](https://github.com/vitejs/vite/issues/23103)) ([5e50bae](https://github.com/vitejs/vite/commit/5e50bae4bdfa123c25c4f5afcbb27efd96fcf681))
* **config:** skip native loader compat checks for type-only imports ([#24021](https://github.com/vitejs/vite/issues/24021)) ([e554294](https://github.com/vitejs/vite/commit/e5542942715b281ca5803554c43d48448d72d7f2))
* **css:** reject CSS entrypoints when `build.cssCodeSplit: false` ([#23112](https://github.com/vitejs/vite/issues/23112)) ([e4ad62b](https://github.com/vitejs/vite/commit/e4ad62ba6523e889f988b6e882d9d81be7f26711))
* **deps:** update all non-major dependencies ([#24027](https://github.com/vitejs/vite/issues/24027)) ([a13aa04](https://github.com/vitejs/vite/commit/a13aa045d1cf2a28e9a5dd2bcb008236f4eaf19a))
* hide console window when running `yarn config get` on Windows ([#24013](https://github.com/vitejs/vite/issues/24013)) ([3f6c4cd](https://github.com/vitejs/vite/commit/3f6c4cdae3b7984840cc32ff6752a45736025406))

### Performance Improvements

* **css:** import sass once instead of per file ([#24041](https://github.com/vitejs/vite/issues/24041)) ([db8b119](https://github.com/vitejs/vite/commit/db8b1190abbb7e30aad0055f97dde02d7ed504c7))
* defer `net use` until a UNC path is resolved on Windows ([#24014](https://github.com/vitejs/vite/issues/24014)) ([b643046](https://github.com/vitejs/vite/commit/b6430466c57f4783b707fd14a43c237082094081))

### Miscellaneous Chores

* **deps:** update dependency @types/node to v26 ([#24029](https://github.com/vitejs/vite/issues/24029)) ([dd780cd](https://github.com/vitejs/vite/commit/dd780cd761221a0c5fa4810335f0190ecb9c7294))
* enable vitest plugin in Oxlint ([#24052](https://github.com/vitejs/vite/issues/24052)) ([ce979e4](https://github.com/vitejs/vite/commit/ce979e4c4be5f48c5862445ef124d863853e39b1))
* enable vitest style rules in Oxlint ([#24053](https://github.com/vitejs/vite/issues/24053)) ([b8c8270](https://github.com/vitejs/vite/commit/b8c8270f3f01a9dbf02c336e7468bf6f1df0f5ad))
* revert "fix(build): keep `magicString` and `ast` in transform hook meta ([#24012](https://github.com/vitejs/vite/issues/24012))" ([#24065](https://github.com/vitejs/vite/issues/24065)) ([afc44f0](https://github.com/vitejs/vite/commit/afc44f0957f7ef52d27d5026200a289de374c215))

### Code Refactoring

* **optimizer:** use non-capturing group for external types regex ([#24048](https://github.com/vitejs/vite/issues/24048)) ([ef23433](https://github.com/vitejs/vite/commit/ef2343355b29a3f389e4af51147b767331bd7a5b))

### Tests

* avoid joining logs for assertion ([#24057](https://github.com/vitejs/vite/issues/24057)) ([fbb0a4e](https://github.com/vitejs/vite/commit/fbb0a4e719fda240459aa54f872a89dc52473fe2))

## <small>[8.3.7](https://github.com/vitejs/vite/compare/v8.3.6...v8.3.7) (2026-11-09)</small>
### Bug Fixes

* **deps:** update Rolldown to v1.2.18 ([#24038](https://github.com/vitejs/vite/issues/24038)) ([517affb](https://github.com/vitejs/vite/commit/517affb174632db347a6a2426f12eab020277946))

### Miscellaneous Chores

* enable more lint rules ([#24035](https://github.com/vitejs/vite/issues/24035)) ([72f86e5](https://github.com/vitejs/vite/commit/72f86e57dab05e87641599bff041d68821c837f3))

### Tests

* use `onTestFinished` for tear downs ([#24003](https://github.com/vitejs/vite/issues/24003)) ([a579e35](https://github.com/vitejs/vite/commit/a579e352a66fbdce6a51d4e1f67006ccf4f91343))

### Build System

* generate sourcemaps in shim-deps plugin ([#24023](https://github.com/vitejs/vite/issues/24023)) ([c02138c](https://github.com/vitejs/vite/commit/c02138c51193fd892025f0c28524dcb9e128446f))

## <small>[8.3.6](https://github.com/vitejs/vite/compare/v8.3.5...v8.3.6) (2026-11-05)</small>
### Bug Fixes

* await overlapping plugin container close calls ([#23935](https://github.com/vitejs/vite/issues/23935)) ([175bbeb](https://github.com/vitejs/vite/commit/175bbeb231fe8bbf260b0b3866b30080690c4f5e))
* **build:** resolve dynamic imports with queries appended when collecting CSS dependencies ([#23909](https://github.com/vitejs/vite/issues/23909)) ([df36558](https://github.com/vitejs/vite/commit/df365589738866363fff7335ed58948a5c440580))
* **build:** use stable module ids in chunk import map hash signatures (fix [#23975](https://github.com/vitejs/vite/issues/23975)) ([#23976](https://github.com/vitejs/vite/issues/23976)) ([8069835](https://github.com/vitejs/vite/commit/8069835ac32ae7682b34de55fdba6c5d2484bae0))
* **bundled-dev:** allow named imports from Node built-ins ([#23858](https://github.com/vitejs/vite/issues/23858)) ([4260c75](https://github.com/vitejs/vite/commit/4260c756944a430e897f689efcfa4f8648953488))
* **bundled-dev:** reload when hmr cannot run an entry again ([#23849](https://github.com/vitejs/vite/issues/23849)) ([a236886](https://github.com/vitejs/vite/commit/a236886026c3a5de0680ea616de7de830d7a90e7))
* **deps:** update `@rollup/plugin-alias` to v6.0.1 ([#23862](https://github.com/vitejs/vite/issues/23862)) ([67c965b](https://github.com/vitejs/vite/commit/67c965b1df64249bceb747037e87d22f75b3e471))
* **deps:** update all non-major dependencies ([#23896](https://github.com/vitejs/vite/issues/23896)) ([46b91c5](https://github.com/vitejs/vite/commit/46b91c5bf9c2901b8511c893bc3fc38b8bba6e4f))
* **deps:** update all non-major dependencies ([#23966](https://github.com/vitejs/vite/issues/23966)) ([b3cb057](https://github.com/vitejs/vite/commit/b3cb0575aff63004a71301a1ec798aeea2aa05d7))
* **deps:** update rolldown-related dependencies ([#23868](https://github.com/vitejs/vite/issues/23868)) ([a63eb87](https://github.com/vitejs/vite/commit/a63eb8722e7d47d1efb710b6410c8d5e5a04a18f))
* **deps:** update rolldown-related dependencies ([#23967](https://github.com/vitejs/vite/issues/23967)) ([0105733](https://github.com/vitejs/vite/commit/0105733e610dd5b770bb5397e8d9fbc54a9f6312))
* **dev:** escape ANSI escape sequence for `server.forwardConsole` ([#23933](https://github.com/vitejs/vite/issues/23933)) ([4f340fd](https://github.com/vitejs/vite/commit/4f340fdb1b619089bbf8ae5dc56c2c0866224306))
* **html:** remove adjacent module tags on the first line ([#23823](https://github.com/vitejs/vite/issues/23823)) ([eab1dc2](https://github.com/vitejs/vite/commit/eab1dc2752fcccf7f06427afc9915794e256e3bc))
* ignore pnpm's .modules.yaml as a Vite Task input ([#23634](https://github.com/vitejs/vite/issues/23634)) ([95c2daf](https://github.com/vitejs/vite/commit/95c2daf1352b3509ec93e6e08a0eaabe23a61b28))
* **optimizer:** detect cache dir precisely ([#23912](https://github.com/vitejs/vite/issues/23912)) ([cc9bc21](https://github.com/vitejs/vite/commit/cc9bc2131d471bb4d60364614b326ada3ca7d10d))
* **optimizer:** resolve subpath imports (#) with Vite's resolver ([#23959](https://github.com/vitejs/vite/issues/23959)) ([0fdd81e](https://github.com/vitejs/vite/commit/0fdd81e9460dd44806b2b6290603ee2c8366a54e))
* respect `build.sourcemap` from environment ([#23879](https://github.com/vitejs/vite/issues/23879)) ([82e7aa0](https://github.com/vitejs/vite/commit/82e7aa0374a15e1c67594557ab5893c91578f897))
* **server:** escape HTML attributes ([#23995](https://github.com/vitejs/vite/issues/23995)) ([a270391](https://github.com/vitejs/vite/commit/a27039101e3726498063c9662da9c0c097016bd1))
* **server:** preserve `$` patterns in static alias replacements ([#23703](https://github.com/vitejs/vite/issues/23703)) ([1b6ed05](https://github.com/vitejs/vite/commit/1b6ed05397c0670e6114e3e1380188f0313ae590))
* **ssr:** convert external require against built-in modules to import for `ssr.target=webworker` ([#23759](https://github.com/vitejs/vite/issues/23759)) ([a711f1c](https://github.com/vitejs/vite/commit/a711f1c6328ca7f59857ed99e32853cf49b19a15))
* use top-level `input` for SSR build when `build.ssr: true` ([#23898](https://github.com/vitejs/vite/issues/23898)) ([90bc034](https://github.com/vitejs/vite/commit/90bc034a97e7eccd0f3cbc69904fffa625a4c34d))
* **wasm:** reject `.wasm` outside `server.fs` ([#23914](https://github.com/vitejs/vite/issues/23914)) ([64e2467](https://github.com/vitejs/vite/commit/64e24670e49900c33a3d3e3c701a5ec4d76573f2))
* watch files that have a query or hash referenced with `new URL(..., import.meta.url)` ([#23780](https://github.com/vitejs/vite/issues/23780)) ([e954a9c](https://github.com/vitejs/vite/commit/e954a9cda0b5254be495a937333a0be1b8503d8f))
* **worker:** keep chunks conflicted with unused workers that are still used by a live worker ([#23956](https://github.com/vitejs/vite/issues/23956)) ([7139ef3](https://github.com/vitejs/vite/commit/7139ef35cf6c9c0979385a467e8499fc19dfd099))

### Performance Improvements

* **build:** remove preload link listeners on settle (fix [#23920](https://github.com/vitejs/vite/issues/23920)) ([#23922](https://github.com/vitejs/vite/issues/23922)) ([8109efd](https://github.com/vitejs/vite/commit/8109efd30319704224db3b7e3b7090348999effb))
* **css:** index rendered modules once per output for `cssScopeTo` ([#23889](https://github.com/vitejs/vite/issues/23889)) ([1b905e5](https://github.com/vitejs/vite/commit/1b905e562aed9b47c3ab5959149bb1566eb7a9a5))

### Miscellaneous Chores

* align charset case ([#23863](https://github.com/vitejs/vite/issues/23863)) ([a976df3](https://github.com/vitejs/vite/commit/a976df38815d00102bb1d9fa32e0fec7c05d210a))

### Build System

* generate sourcemaps in import-meta-current-dirname plugin ([#23904](https://github.com/vitejs/vite/issues/23904)) ([20d355a](https://github.com/vitejs/vite/commit/20d355a00b036499f4b9fd5aa99ff754ca3d4d06))

## <small>[8.3.5](https://github.com/vitejs/vite/compare/v8.3.4...v8.3.5) (2026-10-21)</small>
### Bug Fixes

* **build:** handle missing chunk import maps ([#23777](https://github.com/vitejs/vite/issues/23777)) ([8d7623d](https://github.com/vitejs/vite/commit/8d7623d9b5647714a5b20cbd787a5401ca846229))
* **build:** include preload dependencies to chunk import map hashing ([#23793](https://github.com/vitejs/vite/issues/23793)) ([4d16e7c](https://github.com/vitejs/vite/commit/4d16e7c14d5e1c361f148238b1e81131238ab8e9))
* **bundled-dev:** apply `server.origin` to asset URLs ([#23683](https://github.com/vitejs/vite/issues/23683)) ([52ba877](https://github.com/vitejs/vite/commit/52ba877693c8633458d163117504a8259beb3cf5))
* **bundled-dev:** declare utf-8 charset in fallback page ([#23846](https://github.com/vitejs/vite/issues/23846)) ([197daf6](https://github.com/vitejs/vite/commit/197daf6c4c7bfdaa005bebcc41dd2ff22fa3a5b6))
* **bundled-dev:** ignore build.chunkImportMap ([#23685](https://github.com/vitejs/vite/issues/23685)) ([cfe917d](https://github.com/vitejs/vite/commit/cfe917d67d279a13f20ae9449e3befa736b64b07))
* **bundled-dev:** include user `import.meta.env.*` defines in the `import.meta.env` object ([#23713](https://github.com/vitejs/vite/issues/23713)) ([6019aa7](https://github.com/vitejs/vite/commit/6019aa79975465516da7c6f532d568422b019a25))
* **bundled-dev:** map forwarded error stacks through the bundle source maps ([#23741](https://github.com/vitejs/vite/issues/23741)) ([11fe1e4](https://github.com/vitejs/vite/commit/11fe1e46ff0c136cb90fbe263ba03993bc94df18))
* **bundled-dev:** normalize served output files ([#23684](https://github.com/vitejs/vite/issues/23684)) ([df4e02c](https://github.com/vitejs/vite/commit/df4e02cc8317a62f21edefc79a9690571ffed1f3))
* **bundled-dev:** stop hmr propagation at modules that are no longer imported ([#23839](https://github.com/vitejs/vite/issues/23839)) ([7471e8c](https://github.com/vitejs/vite/commit/7471e8c3b32d3d55243590bb7713e602c9fb0212))
* **css:** don't fail on a literal `%` in `url()` ([#23676](https://github.com/vitejs/vite/issues/23676)) ([50b382d](https://github.com/vitejs/vite/commit/50b382d31835b8b4bc8b6964738ac03146e44261))
* **deps:** update all non-major dependencies ([#23731](https://github.com/vitejs/vite/issues/23731)) ([cf80aa5](https://github.com/vitejs/vite/commit/cf80aa552cac02eac0293330ccd5fde3c7ae8d29))
* **deps:** update all non-major dependencies ([#23826](https://github.com/vitejs/vite/issues/23826)) ([77d8373](https://github.com/vitejs/vite/commit/77d8373510da1b26ce057eb2248e570b7f63fde9))
* **deps:** update rolldown-related dependencies ([#23733](https://github.com/vitejs/vite/issues/23733)) ([43f0d05](https://github.com/vitejs/vite/commit/43f0d052e514c3ad2dea2f7dc44b0720e1f62f48))
* **deps:** update rolldown-related dependencies ([#23827](https://github.com/vitejs/vite/issues/23827)) ([c2e0418](https://github.com/vitejs/vite/commit/c2e04187e49aab7ab809989f0537b4906653acab))
* **optimizer:** fall back to yarn.lock for lockfile hash ([#23667](https://github.com/vitejs/vite/issues/23667)) ([f206096](https://github.com/vitejs/vite/commit/f20609630faa93026924275115d1426fdc08629e))
* **optimizer:** scan `oxc.jsxInject` imports ([#23758](https://github.com/vitejs/vite/issues/23758)) ([38f3cb4](https://github.com/vitejs/vite/commit/38f3cb45b1490ed24775547ceafa677b91a57714))
* **optimizer:** skip patches dir check for yarn.lock fallback ([#23725](https://github.com/vitejs/vite/issues/23725)) ([8e890e1](https://github.com/vitejs/vite/commit/8e890e1ce438bfbc07ea4931ce332e40589940fa))
* **optimizer:** skip patches dir hash for nub lockfile ([#23761](https://github.com/vitejs/vite/issues/23761)) ([a7d5696](https://github.com/vitejs/vite/commit/a7d56967ef0050a09c0507e63a18164bc7a0d486))
* **resolve:** support subpath imports with multiple `#` ([#23631](https://github.com/vitejs/vite/issues/23631)) ([0d86b34](https://github.com/vitejs/vite/commit/0d86b3485fbbd0fcb9a1f70a14adedfcb7a1fff1))
* **resolve:** update resolve.exports to 2.0.4 ([#23739](https://github.com/vitejs/vite/issues/23739)) ([4ea708a](https://github.com/vitejs/vite/commit/4ea708a3ae9a324c6aabca59fade4082bf72f3e5))
* **server:** handle socket errors on upgrade requests not taken by the HMR server ([#23728](https://github.com/vitejs/vite/issues/23728)) ([c2c9ef4](https://github.com/vitejs/vite/commit/c2c9ef4dcd05b3e4d88844ea3a13dc23819ca2a5))
* **server:** only strip base when path matches a full segment ([#23641](https://github.com/vitejs/vite/issues/23641)) ([3dfde87](https://github.com/vitejs/vite/commit/3dfde87b90a9f80b125d710e3e5d4fc795662db6))

### Performance Improvements

* **ssr:** extract inline source maps without a regexp ([#23775](https://github.com/vitejs/vite/issues/23775)) ([6a02780](https://github.com/vitejs/vite/commit/6a0278055d8501bbaf65b8d34ec094722b4e877a))

### Miscellaneous Chores

* migrate to Oxlint ([#23746](https://github.com/vitejs/vite/issues/23746)) ([5b73935](https://github.com/vitejs/vite/commit/5b73935881424ed5919571036dd89d3868590f92))

### Code Refactoring

* **deps:** replace `@vercel/detect-agent` with `std-env` ([#23744](https://github.com/vitejs/vite/issues/23744)) ([ce4293f](https://github.com/vitejs/vite/commit/ce4293f15cc5cd221c5ed60f5cd64e82ca5cbaf5))
* **dev:** consolidate moduleURL to file path utilities ([#23828](https://github.com/vitejs/vite/issues/23828)) ([df7b40e](https://github.com/vitejs/vite/commit/df7b40ee9d691e9f4e2413244f6665ef5482dce3))
* **dev:** separate import resolution from URL conversion ([#23791](https://github.com/vitejs/vite/issues/23791)) ([6116689](https://github.com/vitejs/vite/commit/611668983d4b717f5e5e66cf9f7125bd94f92bf7))
* **dev:** share ModuleURL and BrowserURL conversions ([#23790](https://github.com/vitejs/vite/issues/23790)) ([446954c](https://github.com/vitejs/vite/commit/446954c69c806795c83fe2f97c28ae8f9ef83731))
* **dev:** use ModuleURLs throughout HTML transforms ([#23815](https://github.com/vitejs/vite/issues/23815)) ([a162990](https://github.com/vitejs/vite/commit/a16299092c0f0f3f90e05d4bb5f0168b293c2b52))

## <small>[8.3.4](https://github.com/vitejs/vite/compare/v8.3.3...v8.3.4) (2026-10-08)</small>
### Features

* **bundled-dev:** support `import.meta.hot.acceptExports` ([#23463](https://github.com/vitejs/vite/issues/23463)) ([bc0f21c](https://github.com/vitejs/vite/commit/bc0f21c56a2e003a4d2dd23ccb9da3ec8c706c4e))

### Bug Fixes

* avoid mutating hmr defaults (fix [#23575](https://github.com/vitejs/vite/issues/23575)) ([#23576](https://github.com/vitejs/vite/issues/23576)) ([574d5e3](https://github.com/vitejs/vite/commit/574d5e351905fe99891364d03c2440531378f7fd))
* **build:** correct preloads when chunkImportMap is enabled with non-root base ([#23698](https://github.com/vitejs/vite/issues/23698)) ([2a8c0f0](https://github.com/vitejs/vite/commit/2a8c0f05c76e35c43ab3560984a5103c8db8dbcd))
* **build:** wait for in-flight stylesheets in preload helper (fix [#23652](https://github.com/vitejs/vite/issues/23652)) ([#23662](https://github.com/vitejs/vite/issues/23662)) ([036b745](https://github.com/vitejs/vite/commit/036b74599b2fe1d8c61475371b856ceb88d26963))
* **bundled-dev:** serve `/@vite/client` and stub `@vite/env` ([#23664](https://github.com/vitejs/vite/issues/23664)) ([5afc5a8](https://github.com/vitejs/vite/commit/5afc5a8876624888fc1e8f43fed1c85c4b0e830b))
* **client:** skip rewriting unchanged adopted styles ([#23697](https://github.com/vitejs/vite/issues/23697)) ([fa71469](https://github.com/vitejs/vite/commit/fa7146938b0ca703653c90c20907191a01c032ba))
* **css:** resolve imported preprocessors from their file path with lightningcss ([#23688](https://github.com/vitejs/vite/issues/23688)) ([cf52011](https://github.com/vitejs/vite/commit/cf52011c46409a4a45f3d74bba631b8f005c4bc9))
* **deps:** update all non-major dependencies ([#23648](https://github.com/vitejs/vite/issues/23648)) ([8a4c19c](https://github.com/vitejs/vite/commit/8a4c19cfc035f2dd203f2fa6d00ab9256a5e77c9))
* **deps:** update rolldown-related dependencies ([#23649](https://github.com/vitejs/vite/issues/23649)) ([794516d](https://github.com/vitejs/vite/commit/794516d50cff80e405bc9b3e5faac1c82987566c))
* **dev:** a restart requested during a restart used to be dropped (fix [#23392](https://github.com/vitejs/vite/issues/23392)) ([#23484](https://github.com/vitejs/vite/issues/23484)) ([70d56ea](https://github.com/vitejs/vite/commit/70d56ea1848909edab416934f3f68ce14343eb73))
* don't treat modules ending with js-like query as js ([#23687](https://github.com/vitejs/vite/issues/23687)) ([fcb6f12](https://github.com/vitejs/vite/commit/fcb6f1252a95857823d935f98554b938888d41a0))
* **html:** avoid adding filesystem root to watcher ([#23689](https://github.com/vitejs/vite/issues/23689)) ([3a7f2ae](https://github.com/vitejs/vite/commit/3a7f2aea757d59bae66ad6edf6b321d26a7e6778))
* **html:** skip caching CSS of chunks in a cycle (fix [#23628](https://github.com/vitejs/vite/issues/23628)) ([#23636](https://github.com/vitejs/vite/issues/23636)) ([15d82f7](https://github.com/vitejs/vite/commit/15d82f7dc679ab9c18d5ce2c3711157c2365ddd1))
* **optimizer:** scan deep imports with custom extensions ([#23678](https://github.com/vitejs/vite/issues/23678)) ([8579189](https://github.com/vitejs/vite/commit/8579189bae8626b6ddab55a09325e209d62e027e))
* remove input option unescaping for now ([#23694](https://github.com/vitejs/vite/issues/23694)) ([facc2fb](https://github.com/vitejs/vite/commit/facc2fb1fffce03d9e2dd7011d0bd0eeddc7d0f6))
* **server:** match static aliases on path boundaries ([#23643](https://github.com/vitejs/vite/issues/23643)) ([b28db28](https://github.com/vitejs/vite/commit/b28db28e9e62d9866a9a0f1b22e74589cc180577))
* **watcher:** normalize file before root check in `ensureWatchedFile` ([#23673](https://github.com/vitejs/vite/issues/23673)) ([12bb28c](https://github.com/vitejs/vite/commit/12bb28c22379c8d2fe90088fa0eefbfa2ab3fb80))

### Performance Improvements

* **module-runner:** skip cloning call sites that have no source map ([#23646](https://github.com/vitejs/vite/issues/23646)) ([3d67486](https://github.com/vitejs/vite/commit/3d674869a50a0bca84a8cc8dc55bd35d57100e37))

### Code Refactoring

* **bundled-dev:** import CSS HMR helpers from `/@vite/client` ([#23674](https://github.com/vitejs/vite/issues/23674)) ([182f5b2](https://github.com/vitejs/vite/commit/182f5b2a65391da5bee05f9c3df1aeb3794e98d9))

## <small>[8.3.3](https://github.com/vitejs/vite/compare/v8.3.2...v8.3.3) (2026-10-06)</small>
### Bug Fixes

* **deps:** update launch-editor to v2.14.2 ([#23654](https://github.com/vitejs/vite/issues/23654)) ([22fd1d5](https://github.com/vitejs/vite/commit/22fd1d5238cce2ee9db0eb4122f9e8feb6b06097))
* **html:** filename passed to transformIndexHtml should not include queries ([#23653](https://github.com/vitejs/vite/issues/23653)) ([7dafd8e](https://github.com/vitejs/vite/commit/7dafd8e56f152403a3230608fa4005273c2e9e17))
* **server:** check `fs.serve` for `?vite-wasm-instance` ([#23655](https://github.com/vitejs/vite/issues/23655)) ([ba8b7ab](https://github.com/vitejs/vite/commit/ba8b7ab43b4afa5d0292ab4b6e3a7b5033cc9c73))
* **server:** store ids to `safeModulePaths` rather than URLs ([#23656](https://github.com/vitejs/vite/issues/23656)) ([c3e06f9](https://github.com/vitejs/vite/commit/c3e06f92e969952466b4e2f5801e85e1e00cd905))

## <small>[8.3.2](https://github.com/vitejs/vite/compare/v8.3.1...v8.3.2) (2026-10-01)</small>
### Bug Fixes

* **build:** preload CSS correctly when `renderBuiltUrl` returns URLs with queries ([#23611](https://github.com/vitejs/vite/issues/23611)) ([64e0a21](https://github.com/vitejs/vite/commit/64e0a215c24f0522b27b91f93cfd93e317b94481))
* **bundled-dev:** serve lazy chunk sourcemaps ([#23026](https://github.com/vitejs/vite/issues/23026)) ([eb7aa9a](https://github.com/vitejs/vite/commit/eb7aa9a8816a1e926d5d9b4cbe7e796b61314ce2))
* **bundled-dev:** serve the rolldown runtime from the installed rolldown ([#23568](https://github.com/vitejs/vite/issues/23568)) ([bc598a6](https://github.com/vitejs/vite/commit/bc598a6a8a6b7d6e157e9f19c16911cff8d2360c))
* **deps:** update all non-major dependencies ([#23601](https://github.com/vitejs/vite/issues/23601)) ([9944fa6](https://github.com/vitejs/vite/commit/9944fa6033873f13ae88f59e023ab642c50fee2b))
* **deps:** update rolldown-related dependencies ([#23602](https://github.com/vitejs/vite/issues/23602)) ([88c1741](https://github.com/vitejs/vite/commit/88c17415af221b3a13e778f4f2c0e907c8287baf))
* **html:** resolve percent-encoded srcset urls ([#23609](https://github.com/vitejs/vite/issues/23609)) ([53f1ce7](https://github.com/vitejs/vite/commit/53f1ce7bfe38426861f6da572ef0e3359f6a80cd))
* limit size of object and array printing via `forwardConsole` ([#23565](https://github.com/vitejs/vite/issues/23565)) ([e64a587](https://github.com/vitejs/vite/commit/e64a5877dd3e552843a545749ccc257568917d28))
* merge `build.rolldownOptions.output.minify` correctly ([#23536](https://github.com/vitejs/vite/issues/23536)) ([bba3bb8](https://github.com/vitejs/vite/commit/bba3bb8beedd185948956e02667d450672632d79))
* **optimize-deps:** avoid "unsupported" warnings for browser:false mappings ([#23590](https://github.com/vitejs/vite/issues/23590)) ([5e4b9ca](https://github.com/vitejs/vite/commit/5e4b9ca3dcb24b51f58a765fd2d852614bbf3574))
* **optimizer:** preserve excluded optional peer require fallbacks ([#23600](https://github.com/vitejs/vite/issues/23600)) ([a2bd6fa](https://github.com/vitejs/vite/commit/a2bd6fa897c35c8a691671a7d70061c1cdd5c688))
* pass queries to `renderBuiltUrl` ([#23586](https://github.com/vitejs/vite/issues/23586)) ([744269e](https://github.com/vitejs/vite/commit/744269e5b2a155074910ddd275aecf2b83938496))
* **server:** handle file watcher errors without crashing ([#23503](https://github.com/vitejs/vite/issues/23503)) ([6894f5c](https://github.com/vitejs/vite/commit/6894f5cbceac589536a0efb476d881a47f5ab1c5))
* **server:** release previous environments after initialization ([#23499](https://github.com/vitejs/vite/issues/23499)) ([5a3a010](https://github.com/vitejs/vite/commit/5a3a010eea4c9ebbdcc080819f93068d4e035bd4))
* **ssr:** encode whitespace in module runner sourceURL ([#23513](https://github.com/vitejs/vite/issues/23513)) ([bbc8812](https://github.com/vitejs/vite/commit/bbc88129c967a8b8eedebd93acc82bee63b86b2a))
* **worker:** align worker urls in client and server when using terser ([#23614](https://github.com/vitejs/vite/issues/23614)) ([24bd331](https://github.com/vitejs/vite/commit/24bd3316f3b2503d04a49361e365532bdb335e19))

### Performance Improvements

* avoid encoding intermediate source maps ([#23461](https://github.com/vitejs/vite/issues/23461)) ([89574f6](https://github.com/vitejs/vite/commit/89574f6d940a7273a53c5122a4477285801a696a))
* **build:** avoid quadratic link scan in the preload helper ([#23510](https://github.com/vitejs/vite/issues/23510)) ([cf5c028](https://github.com/vitejs/vite/commit/cf5c0288d526824aead1b24e977400f13c527927))
* only register time middleware when debug logging is enabled ([#23621](https://github.com/vitejs/vite/issues/23621)) ([94d0080](https://github.com/vitejs/vite/commit/94d0080345e23d63d4cd02df2f7fa2afae775c26))

### Documentation

* fix dead og-image PNG links in vite6/vite7 changelog entries ([#23594](https://github.com/vitejs/vite/issues/23594)) ([1929b4c](https://github.com/vitejs/vite/commit/1929b4cc5f38ad53781e3b07b8bdaa32cf18da07))

### Miscellaneous Chores

