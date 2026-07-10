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
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const nodeModules = join(__dirname, "..", "node_modules");

function patchTr46() {
  const file = join(nodeModules, "tr46", "index.js");
  if (!existsSync(file)) {
    console.debug("patch-jiti-compat: tr46/index.js not found, skipping");
    return;
  }
  const contents = readFileSync(file, "utf8");
  if (!contents.includes('require("punycode/")')) {
    console.debug("patch-jiti-compat: tr46/index.js does not match expected pattern, skipping");
    return;
  }
  writeFileSync(
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
  const files = [
    join(nodeModules, "cssstyle", "lib", "allExtraProperties.js"),
    join(nodeModules, "cssstyle", "lib", "generated", "allProperties.js"),
    join(nodeModules, "cssstyle", "lib", "generated", "implementedProperties.js"),
  ];
  for (const file of files) {
    const label = `cssstyle/${file.slice(nodeModules.length + 1)}`;
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
    writeFileSync(file, contents + SET_SHIM);
    console.log(`patch-jiti-compat: patched ${label}`);
  }
}

try {
  patchTr46();
  patchCssstyleSetExports();
} catch (err) {
  // Never fail the install over a best-effort compat patch.
  console.warn("patch-jiti-compat: skipped, non-fatal error:", err.message);
}
