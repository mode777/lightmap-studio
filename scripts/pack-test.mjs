// Assert the published tarball contains only the package-facing files.
//
//   npm run test:pack

import { execFileSync } from "node:child_process";
import path from "node:path";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
const REQUIRED = ["dist/index.js", "dist/index.d.ts", "README.md", "LICENSE"];
const FORBIDDEN_PREFIXES = ["src/", "test/", "scripts/", ".github/"];
const FORBIDDEN_FILES = ["tsconfig.json", "package-lock.json"];

function fail(message) {
  console.error(`[studio:pack] FAIL ${message}`);
  process.exitCode = 1;
}

function main() {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8"
  });
  const manifest = JSON.parse(output)[0];
  const files = new Set(manifest.files.map((file) => file.path));

  for (const file of REQUIRED) {
    if (files.has(file)) console.log(`[studio:pack] PASS contains ${file}`);
    else fail(`missing ${file}`);
  }

  for (const file of files) {
    if (FORBIDDEN_PREFIXES.some((prefix) => file.startsWith(prefix))) {
      fail(`contains development path ${file}`);
    }
    if (FORBIDDEN_FILES.includes(file)) fail(`contains development file ${file}`);
  }

  console.log(`[studio:pack] ${manifest.name}@${manifest.version} — ${manifest.files.length} files`);
  if (process.exitCode !== 1) console.log("STUDIO PACK TEST PASS");
  else console.error("STUDIO PACK TEST FAIL");
}

try {
  main();
} catch (error) {
  console.error(`[studio:pack] fatal: ${error.stack || error}`);
  console.error("STUDIO PACK TEST FAIL");
  process.exitCode = 1;
}
