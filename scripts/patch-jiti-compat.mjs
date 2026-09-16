#!/usr/bin/env node
// Works around two incompatibilities between pi's extension loader (a patched
// jiti) and jsdom's dependency tree:
//   1. jiti can't resolve the trailing-slash bare specifier require("punycode/")
//      used by tr46.
//   2. jiti wraps `module.exports = new Set(...)` (cssstyle) in a Proxy, which
//      breaks native Set methods on the exported value.
//
// Runs as a postinstall step so it self-heals after every install, including
// when this package is installed as a pi extension via `pi install npm:...`.
// Safe to run multiple times and safe to no-op if the target files or
// patterns are missing (e.g. a future dependency bump changes the shape).
//
// src/jiti-compat.ts does the same two patches at extension load time, because
// the shared ~/.pi/agent/npm tree means another extension's install can revert
// them long after this hook ran (#34). The logic is deliberately duplicated
// rather than shared: postinstall runs before `npm run build` in CI and in a
// fresh clone, so this file cannot depend on dist/. Keep the two in sync.
import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";

const requireFromHere = createRequire(import.meta.url);
const resolveFromHere = requireFromHere.resolve;

// Resolve the copies jsdom actually loads. The shared ~/.pi/agent/npm tree
// often holds a second, nested copy of a package when extensions disagree on
// versions, and patching a hoisted copy jsdom never requires would fix
// nothing. Mirrors resolveFromJsdom in src/jiti-compat.ts.
function resolveFromJsdom(specifier, via) {
  try {
    const jsdomEntry = resolveFromHere("jsdom");
    const importer = via ? createRequire(jsdomEntry).resolve(via) : jsdomEntry;
    return createRequire(importer).resolve(specifier);
  } catch {
    return resolveFromHere(specifier);
  }
}

// Temp file + rename, not an in-place write. `writeFileSync` truncates first,
// so an interrupted write would leave a half-patched file that still contains
// the marker comment and would be skipped as "already patched" forever.
// Mirrors writeFileAtomic in src/jiti-compat.ts.
function writeFileAtomic(path, contents) {
  const temp = `${path}.pi-web-agent-${process.pid}.tmp`;
  try {
    writeFileSync(temp, contents);
    renameSync(temp, path);
  } catch (err) {
    try {
      if (existsSync(temp)) unlinkSync(temp);
    } catch {
      // Best effort.
    }
    throw err;
  }
}

function findPackageRoot(entryFile, packageName) {
  let directory = dirname(entryFile);
  while (true) {
    const manifestFile = join(directory, "package.json");
    if (existsSync(manifestFile)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
        if (manifest.name === packageName) return directory;
      } catch {
        // Malformed package.json on the way up. Keep walking.
      }
    }

    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`could not find the ${packageName} package root from ${entryFile}`);
    }
    directory = parent;
  }
}

function patchTr46() {
  const file = resolveFromJsdom("tr46", "whatwg-url");
  if (!existsSync(file)) {
    console.debug("patch-jiti-compat: tr46/index.js not found, skipping");
    return;
  }
  const contents = readFileSync(file, "utf8");
  if (!contents.includes('require("punycode/")')) {
    console.debug("patch-jiti-compat: tr46/index.js does not match expected pattern, skipping");
    return;
  }
  writeFileAtomic(
    file,
    contents.replaceAll('require("punycode/")', 'require("punycode/punycode.js")'),
  );
  console.log("patch-jiti-compat: patched tr46/index.js");
}

const SET_SHIM = `
// pi/jiti workaround: expose bound native Set methods as own properties so a
// Proxy wrapper around this export does not break Set brand checks.
for (const k of ["has", "add", "delete", "forEach", "keys", "values", "entries"]) {
  module.exports[k] = Set.prototype[k].bind(module.exports);
}
module.exports[Symbol.iterator] = Set.prototype[Symbol.iterator].bind(module.exports);
`;

function patchCssstyleSetExports() {
  const packageRoot = findPackageRoot(resolveFromJsdom("cssstyle"), "cssstyle");
  const files = [
    join(packageRoot, "lib", "allExtraProperties.js"),
    join(packageRoot, "lib", "generated", "allProperties.js"),
    join(packageRoot, "lib", "generated", "implementedProperties.js"),
  ];
  for (const file of files) {
    const label = `cssstyle/${relative(packageRoot, file).split(sep).join("/")}`;
    if (!existsSync(file)) {
      console.debug(`patch-jiti-compat: ${label} not found, skipping`);
      continue;
    }
    const contents = readFileSync(file, "utf8");
    if (contents.includes("pi/jiti workaround")) continue;
    if (!contents.includes("module.exports = new Set(")) {
      console.debug(`patch-jiti-compat: ${label} does not match expected pattern, skipping`);
      continue;
    }
    writeFileAtomic(file, contents + SET_SHIM);
    console.log(`patch-jiti-compat: patched ${label}`);
  }
}

function runBestEffort(label, patch) {
  try {
    patch();
  } catch (err) {
    // Never fail the install over a best-effort compat patch.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`patch-jiti-compat: ${label} skipped, non-fatal error: ${message}`);
  }
}

runBestEffort("tr46", patchTr46);
runBestEffort("cssstyle", patchCssstyleSetExports);
