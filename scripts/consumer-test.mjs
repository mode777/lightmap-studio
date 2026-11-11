// Build a tiny consumer page with Vite and confirm both wasm assets are emitted.

import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "vite";

const STUDIO_ROOT = path.resolve(import.meta.dirname, "..");
const CONSUMER_ROOT = path.join(STUDIO_ROOT, "test", "consumer");
const OUTPUT = mkdtempSync(path.join(os.tmpdir(), "lightmap-studio-consumer-"));

function wasmFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const pathname = path.join(directory, entry);
    if (statSync(pathname).isDirectory()) files.push(...wasmFiles(pathname));
    else if (entry.endsWith(".wasm")) files.push(pathname);
  }
  return files;
}

async function main() {
  try {
    await build({
      root: CONSUMER_ROOT,
      configFile: false,
      logLevel: "error",
      build: {
        outDir: OUTPUT,
        emptyOutDir: true,
        assetsInlineLimit: 0,
        target: "es2022"
      }
    });
    const files = wasmFiles(OUTPUT);
    const names = files.map((file) => path.basename(file));
    const hasLightmapper = names.some((name) => name.includes("lightmapper"));
    const hasXatlas = names.some((name) => name.includes("xatlas"));
    for (const name of names) console.log(`[studio:consumer] emitted ${name}`);
    if (!hasLightmapper || !hasXatlas) {
      console.error("[studio:consumer] missing one of lightmapper.wasm / xatlas.wasm");
      return false;
    }
    console.log("STUDIO CONSUMER TEST PASS");
    return true;
  } finally {
    rmSync(OUTPUT, { recursive: true, force: true });
  }
}

main()
  .then((ok) => {
    process.exitCode = ok ? 0 : 1;
  })
  .catch((error) => {
    console.error(`[studio:consumer] fatal: ${error.stack || error}`);
    process.exitCode = 1;
  });
