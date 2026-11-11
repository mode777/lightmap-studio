import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const STUDIO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE_ROOT = join(STUDIO_ROOT, "src");

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (path.endsWith(".ts")) files.push(path);
  }
  return files;
}

function importSpecifiers(source) {
  return [...source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g)].map(
    (match) => match[1]
  );
}

function forbiddenImports(specifiers) {
  return specifiers.filter(
    (specifier) =>
      specifier === "three" ||
      specifier.startsWith("three/") ||
      specifier === "site" ||
      specifier.startsWith("site/") ||
      specifier.includes("/site/") ||
      specifier.startsWith("../site") ||
      specifier.startsWith("../../site") ||
      specifier.includes("/demos/") ||
      specifier.startsWith("./demos/")
  );
}

test("studio sources do not import three, site or demo modules", () => {
  for (const file of sourceFiles(SOURCE_ROOT)) {
    const source = readFileSync(file, "utf8");
    assert.deepEqual(forbiddenImports(importSpecifiers(source)), [], file);
  }
});

test("the bake harness does not import xatlas", () => {
  for (const file of sourceFiles(join(SOURCE_ROOT, "bake"))) {
    const source = readFileSync(file, "utf8");
    assert.equal(importSpecifiers(source).includes("xatlas-wasm"), false, file);
  }
});

test("the import audit fails when a forbidden import is added", () => {
  const mutated = `import * as THREE from "three";\nimport createXAtlas from "xatlas-wasm";\n`;
  assert.deepEqual(forbiddenImports(importSpecifiers(mutated)), ["three"]);
});

test("the package graph has no three dependency", () => {
  const pkg = JSON.parse(readFileSync(join(STUDIO_ROOT, "package.json"), "utf8"));
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    assert.equal(
      Object.keys(pkg[field] ?? {}).some((name) => name === "three" || name.startsWith("three/")),
      false,
      field
    );
  }
});
