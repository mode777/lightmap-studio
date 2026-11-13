// Build the showcase application and verify it end to end in headless Chrome:
//   1. vite build the app
//   2. assert both wasm assets (lightmapper + xatlas) are emitted
//   3. serve dist/ on a plain static server (no custom headers)
//   4. load the page in chrome-headless-shell with SwiftShader WebGL
//   5. drive window.__showcase: generate a sample .glb, load, bake, export
//   6. assert the export is a valid GLB with occlusionTexture on TEXCOORD_1
//      and preserved TEXCOORD_0 / base color
//   7. exercise the negative paths: missing part names the file, unsupported
//      compression names the extension, unsupported files are skipped
//
//   npm run test:smoke
//   CHROME_SHELL_PATH=/path/to/chrome-headless-shell npm run test:smoke

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { build } from "vite";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ROOT = path.join(APP_ROOT, "dist");
const SCREENSHOT_DIR = process.env.SHOWCASE_SCREENSHOT_DIR || null;

const CHROME_CANDIDATES = [
  process.env.CHROME_SHELL_PATH,
  path.join(
    os.homedir(),
    "browsers",
    "chrome-headless-shell",
    "linux-131.0.6778.264",
    "chrome-headless-shell-linux64",
    "chrome-headless-shell"
  ),
  path.join(
    os.homedir(),
    ".cache",
    "ms-playwright",
    "chromium_headless_shell-1248",
    "chrome-headless-shell-linux64",
    "chrome-headless-shell"
  )
].filter(Boolean);

function chromeShellPath() {
  const found = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `chrome-headless-shell not found; set CHROME_SHELL_PATH (tried ${CHROME_CANDIDATES.join(", ")})`
    );
  }
  return found;
}

function wasmFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const pathname = path.join(directory, entry);
    if (statSync(pathname).isDirectory()) files.push(...wasmFiles(pathname));
    else if (entry.endsWith(".wasm")) files.push(pathname);
  }
  return files;
}

function contentTypeFor(extension) {
  switch (extension) {
    case ".wasm":
      return "application/wasm";
    case ".js":
    case ".mjs":
      return "text/javascript";
    case ".css":
      return "text/css";
    case ".html":
      return "text/html";
    case ".json":
      return "application/json";
    case ".png":
      return "image/png";
    case ".ttf":
      return "font/ttf";
    default:
      return "application/octet-stream";
  }
}

const BASE_PREFIX = "/lightmap-studio";

function serveDirectory(root) {
  const server = createServer((request, response) => {
    let url = decodeURIComponent((request.url ?? "/").split("?")[0]);
    // GitHub Pages serves the artifact under /lightmap-studio/; mirror that.
    if (url === BASE_PREFIX || url.startsWith(`${BASE_PREFIX}/`)) {
      url = url.slice(BASE_PREFIX.length) || "/";
    }
    let file = path.join(root, url === "/" ? "index.html" : url);
    if (!file.startsWith(root)) {
      response.writeHead(403).end();
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      file = path.join(root, "index.html");
    }
    response.writeHead(200, { "content-type": contentTypeFor(path.extname(file)) });
    response.end(readFileSync(file));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

/** Parse a GLB into its JSON chunk for assertions. */
function parseGlbJson(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== 0x46546c67) throw new Error("export is not a GLB container");
  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`export has unsupported GLB version ${version}`);
  const chunk0Length = view.getUint32(12, true);
  const chunk0Type = view.getUint32(16, true);
  if (chunk0Type !== 0x4e4f534a) throw new Error("export GLB has no JSON chunk");
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + chunk0Length)));
}

async function main() {
  const chrome = chromeShellPath();
  console.log("[showcase:smoke] building app...");
  await build({
    root: APP_ROOT,
    configFile: path.join(APP_ROOT, "vite.config.ts"),
    logLevel: "error",
    build: {
      outDir: DIST_ROOT,
      emptyOutDir: true,
      assetsInlineLimit: 0,
      target: "es2022"
    }
  });

  const names = wasmFiles(DIST_ROOT).map((file) => path.basename(file));
  const hasLightmapper = names.some((name) => name.includes("lightmapper"));
  const hasXatlas = names.some((name) => name.includes("xatlas"));
  for (const name of names) console.log(`[showcase:smoke] emitted ${name}`);
  if (!hasLightmapper || !hasXatlas) {
    throw new Error("missing one of lightmapper.wasm / xatlas.wasm in app build");
  }
  console.log("[showcase:smoke] PASS both wasm assets emitted");

  const server = await serveDirectory(DIST_ROOT);
  let browser = null;
  try {
    if (SCREENSHOT_DIR) mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const { port } = server.address();
    const url = `http://127.0.0.1:${port}/lightmap-studio/`;
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: "shell",
      protocolTimeout: 600_000,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--ignore-gpu-blocklist",
        "--mute-audio",
        "--hide-scrollbars"
      ]
    });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    page.on("console", (message) => {
      if (message.type() === "error") console.error(`[showcase:smoke] console: ${message.text()}`);
    });

    await page.goto(url, { waitUntil: "load", timeout: 30_000 });
    await page.setViewport({ width: 1440, height: 900 });
    await page.waitForFunction("window.__showcase !== undefined", { timeout: 30_000, polling: 200 });

    const titleBar = await page.evaluate(() => {
      const actions = Array.from(document.querySelectorAll("[data-titlebar-action]"));
      return {
        title: document.querySelector(".app-brand-title")?.textContent ?? "",
        // vscode-icon exposes `name` as a Lit property (not a reflected attribute).
        icon: document.querySelector(".app-brand-icon vscode-icon")?.name ?? "",
        actions: actions.map((action) => ({
          id: action.dataset.titlebarAction,
          text: action.textContent?.trim() ?? "",
          disabled: action instanceof HTMLButtonElement ? action.disabled : true
        }))
      };
    });
    if (titleBar.title !== "Lightmap Studio" || titleBar.icon === "") {
      throw new Error(`title bar branding is incomplete: ${JSON.stringify(titleBar)}`);
    }
    const importAction = titleBar.actions.find((action) => action.id === "import");
    const exportAction = titleBar.actions.find((action) => action.id === "export");
    if (!importAction || !exportAction) {
      throw new Error(`title bar import/export actions are missing: ${JSON.stringify(titleBar)}`);
    }
    if (!exportAction.disabled) {
      throw new Error("title bar export is enabled before a bake");
    }
    console.log(
      `[showcase:smoke] PASS title bar (${titleBar.title}, import/export actions, export disabled before bake)`
    );

    const shot = async (name) => {
      if (SCREENSHOT_DIR) {
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, name) });
        console.log(`[showcase:smoke] screenshot ${name}`);
      }
    };

    // Empty state: full workbench shell with the settings form.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await shot("01-empty-state.png");

    // 1. Load the generated sample document through the ingestion path.
    const loaded = await page.evaluate(async () => {
      const file = await window.__showcase.generateSampleDocument();
      await window.__showcase.loadFiles([file]);
      return window.__showcase.state();
    });
    if (!loaded.active || !loaded.active.includes("sample-room.glb")) {
      throw new Error(`sample document is not active after load: ${loaded.active}`);
    }
    console.log(`[showcase:smoke] PASS loaded and activated ${loaded.active}`);

    // Drive the bounces dropdown through real UI interaction (same select
    // wiring as all settings dropdowns). Quality stays at the default
    // "preview" so the baked screenshots show realistic smoothing.
    await page.click('vscode-single-select[data-form-control="bounces"]');
    await page.keyboard.press("ArrowDown"); // 1 -> 2
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      "window.__showcase.state().bakeSettings.bounces === 2",
      { timeout: 5_000, polling: 100 }
    );
    await page.click('vscode-single-select[data-form-control="bounces"]');
    await page.keyboard.press("ArrowUp"); // 2 -> 1
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      "window.__showcase.state().bakeSettings.bounces === 1",
      { timeout: 5_000, polling: 100 }
    );
    console.log("[showcase:smoke] PASS bounces dropdown wired (default 1)");

    // Chart padding control: 8 px default, then one step up and back.
    await page.click('vscode-single-select[data-form-control="padding"]');
    await page.keyboard.press("ArrowDown"); // 8 -> 12
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      "window.__showcase.state().bakeSettings.padding === 12",
      { timeout: 5_000, polling: 100 }
    );
    await page.click('vscode-single-select[data-form-control="padding"]');
    await page.keyboard.press("ArrowUp"); // 12 -> 8
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      "window.__showcase.state().bakeSettings.padding === 8",
      { timeout: 5_000, polling: 100 }
    );
    console.log("[showcase:smoke] PASS chart padding dropdown wired (default 8)");

    // 2. Unsupported file types are skipped, never loaded silently.
    console.log("[showcase:smoke] step: skipped-file evaluate");
    const skipped = await page.evaluate(async () => {
      const result = await window.__showcase.loadFiles([
        new File(["not a model"], "notes.txt", { type: "text/plain" })
      ]);
      return { result, state: window.__showcase.state() };
    });
    if (skipped.result.skipped.length !== 1 || !skipped.result.skipped[0].includes("notes.txt")) {
      throw new Error(`unsupported file was not reported as skipped: ${JSON.stringify(skipped.result)}`);
    }
    console.log("[showcase:smoke] PASS unsupported file reported as skipped");

    // 3. Missing document part fails with the file named; previous doc stays active.
    console.log("[showcase:smoke] step: missing-part evaluate");
    await page.evaluate(async () => {
      const gltf = JSON.stringify({
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
        accessors: [
          {
            bufferView: 0,
            componentType: 5126,
            count: 3,
            type: "VEC3",
            min: [0, 0, 0],
            max: [1, 1, 1]
          }
        ],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
        buffers: [{ uri: "definitely-missing.bin", byteLength: 36 }]
      });
      await window.__showcase.loadFiles([
        new File([gltf], "missing-part.gltf", { type: "model/gltf+json" })
      ]);
    });
    const afterMissing = await page.evaluate(() => window.__showcase.state());
    if (!afterMissing.messages.some((message) => message.includes("definitely-missing.bin"))) {
      throw new Error(
        `load failure did not name the missing buffer: ${JSON.stringify(afterMissing.messages)}`
      );
    }
    if (!afterMissing.active.includes("sample-room.glb")) {
      throw new Error(`failed load changed the active document: ${afterMissing.active}`);
    }
    console.log("[showcase:smoke] PASS missing document part rejected with the file named");

    // 4. Unsupported compression extension is rejected by name.
    await page.evaluate(async () => {
      const gltf = JSON.stringify({
        asset: { version: "2.0" },
        extensionsUsed: ["KHR_draco_mesh_compression"]
      });
      await window.__showcase.loadFiles([
        new File([gltf], "draco.gltf", { type: "model/gltf+json" })
      ]);
    });
    const afterDraco = await page.evaluate(() => window.__showcase.state());
    if (!afterDraco.messages.some((message) => message.includes("KHR_draco_mesh_compression"))) {
      throw new Error(
        `compression rejection did not name the extension: ${JSON.stringify(afterDraco.messages)}`
      );
    }
    console.log("[showcase:smoke] PASS unsupported compression rejected with the extension named");

    // 5. Bake the sample scene.
    const baked = await page.evaluate(() => window.__showcase.bake());
    if (baked.error) throw new Error(`bake failed: ${baked.error}`);
    if (baked.bakedMeshes !== 7) {
      throw new Error(`expected 7 baked meshes (floor, 3 walls, 3 boxes), got ${baked.bakedMeshes}`);
    }
    if (!(baked.ao.min < baked.ao.max)) {
      throw new Error(`AO texture has no variation (min ${baked.ao.min}, max ${baked.ao.max})`);
    }
    if (baked.ao.max < 128) {
      throw new Error(`AO texture never reaches lit values (max ${baked.ao.max})`);
    }
    console.log(
      `[showcase:smoke] PASS baked ${baked.bakedMeshes} meshes (AO range ${baked.ao.min}..${baked.ao.max}, mean ${baked.ao.mean.toFixed(1)})`
    );

    // Re-bake the same document: the source entries still point at the
    // original geometry, so the second write-back must be identical.
    const rebaked = await page.evaluate(() => window.__showcase.bake());
    if (rebaked.error) throw new Error(`re-bake failed: ${rebaked.error}`);
    const drift =
      Math.abs(rebaked.ao.min - baked.ao.min) +
      Math.abs(rebaked.ao.max - baked.ao.max) +
      Math.abs(rebaked.ao.mean - baked.ao.mean);
    if (drift > 1e-6) {
      throw new Error(
        `re-bake is not deterministic (drift ${drift}): ${JSON.stringify({ baked, rebaked })}`
      );
    }
    console.log("[showcase:smoke] PASS repeated bake is deterministic");

    const stateAfterBake = await page.evaluate(() => window.__showcase.state());
    if (!stateAfterBake.hasUv1) throw new Error("no uv1 attribute after bake");
    if (stateAfterBake.displayMode !== "both") {
      throw new Error(`default display mode is ${stateAfterBake.displayMode}, expected both`);
    }
    if (!stateAfterBake.materials.every((material) => material.aoMap)) {
      throw new Error(
        `combined display materials are missing aoMap: ${JSON.stringify(stateAfterBake.materials)}`
      );
    }
    const titleBarExportEnabled = await page.evaluate(() => {
      const button = document.querySelector('[data-titlebar-action="export"]');
      return button instanceof HTMLButtonElement && !button.disabled;
    });
    if (!titleBarExportEnabled) throw new Error("title bar export is still disabled after bake");
    console.log(`[showcase:smoke] scene materials: ${JSON.stringify(stateAfterBake.materials)}`);

    // The lightmap UVs must cover every rebuilt vertex and the index buffer
    // must stay inside that range. The old per-primitive write-back left only
    // the last group's UVs on a shared geometry, which mis-placed the AO.
    const uvIntegrity = await page.evaluate(() => window.__showcase.uvIntegrity());
    console.log(`[showcase:smoke] uv integrity: ${JSON.stringify(uvIntegrity)}`);
    if (!uvIntegrity.ok) {
      throw new Error(`baked geometry UV integrity failed: ${JSON.stringify(uvIntegrity.issues)}`);
    }
    for (const mesh of uvIntegrity.meshes) {
      if (mesh.uv1Count !== mesh.vertexCount) {
        throw new Error(
          `mesh ${mesh.name}: uv1 count ${mesh.uv1Count} != position count ${mesh.vertexCount}`
        );
      }
    }
    console.log(
      `[showcase:smoke] PASS uv1 covers all ${uvIntegrity.meshes.length} baked mesh(es)`
    );

    // Capture atlas-anchored UV samples BEFORE export for the round-trip check.
    const uvSamples = await page.evaluate(() => window.__showcase.floorUvAtlasSamples());
    if (!uvSamples || uvSamples.points.length < 4) {
      throw new Error(`not enough floor UV samples: ${JSON.stringify(uvSamples)}`);
    }

    // 5c. Display switch in the main 3D view, without re-baking.
    await shot("02-both-after-bake.png");
    await page.click('[data-view-mode="albedo"]');
    await page.waitForFunction(
      "window.__showcase.state().displayMode === 'albedo'",
      { timeout: 5_000, polling: 100 }
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    await shot("03-albedo-after-bake.png");
    await page.click('[data-view-mode="ao"]');
    await page.waitForFunction(
      "window.__showcase.state().displayMode === 'ao'",
      { timeout: 5_000, polling: 100 }
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    await shot("04-ao-after-bake.png");
    await page.click('[data-view-mode="both"]');
    await page.waitForFunction(
      "window.__showcase.state().displayMode === 'both'",
      { timeout: 5_000, polling: 100 }
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    console.log("[showcase:smoke] PASS albedo/AO/both display switch (both default)");
    // Dump the raw atlas so chart-level artifacts can be diagnosed offline.
    if (SCREENSHOT_DIR) {
      const atlasDataUrl = await page.evaluate(() => window.__showcase.atlasDataUrl());
      if (atlasDataUrl) {
        writeFileSync(
          path.join(SCREENSHOT_DIR, "05-atlas.png"),
          Buffer.from(atlasDataUrl.replace(/^data:image\/png;base64,/, ""), "base64")
        );
        console.log("[showcase:smoke] screenshot 05-atlas.png");
      }
    }

    // Atlas tab: the baked lightmap plus the unwrapped chart overlay. This is
    // where a wrong seam mapping is visible directly.
    await page.click('[data-stage-tab="atlas"]');
    await page.waitForFunction(
      () => {
        const canvas = document.querySelector(".atlas-canvas");
        return canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0;
      },
      { timeout: 5_000, polling: 100 }
    );
    const atlasView = await page.evaluate(() => {
      const canvas = document.querySelector(".atlas-canvas");
      const meta = document.querySelector(".atlas-meta");
      return {
        width: canvas instanceof HTMLCanvasElement ? canvas.width : 0,
        height: canvas instanceof HTMLCanvasElement ? canvas.height : 0,
        meta: meta?.textContent ?? ""
      };
    });
    if (!stateAfterBake.atlas) {
      throw new Error(`bake state has no atlas metadata: ${JSON.stringify(stateAfterBake)}`);
    }
    if (stateAfterBake.atlas.padding !== stateAfterBake.bakeSettings.padding) {
      throw new Error(
        `atlas padding ${stateAfterBake.atlas.padding} != configured ${stateAfterBake.bakeSettings.padding}`
      );
    }
    if (atlasView.width !== stateAfterBake.atlas.width) {
      throw new Error(
        `atlas tab canvas is ${atlasView.width}px wide, expected ${stateAfterBake.atlas.width}`
      );
    }
    if (atlasView.height !== stateAfterBake.atlas.height) {
      throw new Error(
        `atlas tab canvas is ${atlasView.height}px high, expected ${stateAfterBake.atlas.height}`
      );
    }
    if (!atlasView.meta.includes("charts")) {
      throw new Error(`atlas tab is missing chart metadata: ${JSON.stringify(atlasView)}`);
    }
    await shot("05b-atlas-view.png");
    await page.click('[data-stage-tab="viewport"]');
    console.log(
      `[showcase:smoke] PASS atlas tab (${atlasView.width}x${atlasView.height}, ${atlasView.meta})`
    );

    // 6. Export and assert the glTF structure.
    const exported = await page.evaluate(async () => {
      const result = await window.__showcase.exportActiveDocument();
      if (result.error) return result;
      // Uint8Array does not survive evaluate() serialization; ship base64.
      let binary = "";
      for (let i = 0; i < result.bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...result.bytes.subarray(i, i + 0x8000));
      }
      return { name: result.name, base64: btoa(binary) };
    });
    if (exported.error) throw new Error(`export failed: ${exported.error}`);
    if (exported.name !== "sample-room.ao.glb") {
      throw new Error(`unexpected export name ${exported.name}`);
    }
    const bytes = new Uint8Array(Buffer.from(exported.base64, "base64"));
    const json = parseGlbJson(bytes);
    console.log(`[showcase:smoke] PASS exported ${exported.name} (${bytes.length} bytes)`);
    console.log(
      `[showcase:smoke] materials: ${JSON.stringify(
        (json.materials ?? []).map((material) => ({
          name: material.name,
          baseColor: material.pbrMetallicRoughness?.baseColorTexture?.index,
          occlusion: material.occlusionTexture?.index
        }))
      )} textures=${JSON.stringify((json.textures ?? []).length)} images=${JSON.stringify((json.images ?? []).length)}`
    );

    const occlusionMaterials = (json.materials ?? []).filter(
      (material) => material.occlusionTexture != null
    );
    if (occlusionMaterials.length === 0) {
      throw new Error("no material carries occlusionTexture after export");
    }
    for (const material of occlusionMaterials) {
      if (material.occlusionTexture.texCoord !== 1) {
        throw new Error(
          `occlusionTexture texCoord is ${material.occlusionTexture.texCoord}, expected 1`
        );
      }
    }
    console.log(
      `[showcase:smoke] PASS ${occlusionMaterials.length} material(s) carry occlusionTexture on TEXCOORD_1`
    );

    const withUv1 = (json.meshes ?? []).filter((mesh) =>
      mesh.primitives.some((primitive) => primitive.attributes.TEXCOORD_1 != null)
    );
    if (withUv1.length === 0) {
      throw new Error("no exported mesh carries TEXCOORD_1");
    }
    console.log(`[showcase:smoke] PASS ${withUv1.length} mesh(es) carry TEXCOORD_1`);

    const floorMaterial = (json.materials ?? []).find(
      (material) => material.pbrMetallicRoughness?.baseColorTexture != null
    );
    if (!floorMaterial) throw new Error("base color texture was lost during export");
    const baseTexCoord = floorMaterial.pbrMetallicRoughness.baseColorTexture.texCoord ?? 0;
    if (baseTexCoord !== 0) {
      throw new Error("base color texture no longer uses TEXCOORD_0");
    }
    if ((json.images ?? []).length < 2) {
      throw new Error(
        `expected at least 2 embedded images (base color + AO), got ${(json.images ?? []).length}`
      );
    }
    console.log("[showcase:smoke] PASS base color texture preserved on TEXCOORD_0");

    // 6b. Orientation round trip: reimport the exported GLB and compare the
    // AO map brightness at the same atlas UVs. A vertical flip anywhere in
    // the chain makes these diverge.
    const reimported = await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const file = new File([bytes], "roundtrip.glb", { type: "model/gltf-binary" });
      await window.__showcase.loadFiles([file]);
      return window.__showcase.state();
    }, exported.base64);
    if (!reimported.active.includes("roundtrip.glb")) {
      throw new Error(`exported file did not reimport: ${reimported.active}`);
    }
    const roundTrip = await page.evaluate(
      (points) => window.__showcase.sampleFloorAoMap(points),
      uvSamples.points
    );
    if (!roundTrip) {
      const probe = await page.evaluate(
        async (base64, points) => {
          const debug = await window.__showcase.debugLoadGlb(base64);
          return {
            active: window.__showcase.state().active,
            debug,
            sampleResult: window.__showcase.sampleFloorAoMap(points)
          };
        },
        exported.base64,
        uvSamples.points
      );
      throw new Error(
        `reimported floor carries no aoMap to sample: ${JSON.stringify(probe)}`
      );
    }
    let worst = 0;
    for (let i = 0; i < uvSamples.values.length; i += 1) {
      const expected = uvSamples.values[i];
      const actual = roundTrip[i];
      const delta = Math.abs(expected - actual);
      if (delta > worst) worst = delta;
    }
    if (worst > 8) {
      throw new Error(
        `AO round trip mismatch (max delta ${worst}): orientation is wrong - ` +
          `atlas ${JSON.stringify(uvSamples.values)} vs reimported ${JSON.stringify(roundTrip)}`
      );
    }
    console.log(`[showcase:smoke] PASS AO orientation round trip (max delta ${worst} over ${uvSamples.values.length} samples)`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await shot("06-reimported-export.png");

    // 5b. Two valid documents: the tree activation switches the active scene.
    await page.evaluate(async () => {
      const file = await window.__showcase.generateSampleDocument();
      const renamed = new File([await file.arrayBuffer()], "sample-room-two.glb", {
        type: "model/gltf-binary"
      });
      await window.__showcase.loadFiles([renamed]);
    });
    const withTwo = await page.evaluate(() => window.__showcase.state());
    if (!withTwo.active.includes("sample-room-two.glb")) {
      throw new Error(`second document did not become active: ${withTwo.active}`);
    }
    await page.waitForSelector('vscode-tree-item[data-document-path="sample-room.glb"]', {
      visible: true,
      timeout: 15_000
    }).catch(async () => {
      const probe = await page.evaluate(() => ({
        collapsibles: document.querySelectorAll("vscode-collapsible").length,
        trees: document.querySelectorAll("vscode-tree").length,
        items: document.querySelectorAll("vscode-tree-item").length,
        buttons: document.querySelectorAll("vscode-button").length,
        sidebarHtml: document.querySelector(".explorer-body")?.innerHTML.slice(0, 1200) ?? "(no explorer body)"
      }));
      throw new Error(`tree item not found; DOM probe: ${JSON.stringify(probe, null, 2)}`);
    });
    await page.click('vscode-tree-item[data-document-path="sample-room.glb"]');
    // Instrument the event flow while waiting for the activation.
    await page.evaluate(() => {
      window.__treeEvents = [];
      document.addEventListener(
        "vsc-tree-select",
        (event) => {
          const item = event.detail?.selectedItems?.[0];
          window.__treeEvents.push({
            target: event.target?.tagName,
            bubbles: event.bubbles,
            detailKeys: event.detail ? Object.keys(event.detail) : null,
            attr: item?.getAttribute?.("data-document-path"),
            itemAttrs: item?.getAttributeNames?.()
          });
        },
        true
      );
    });
    await page.click('vscode-tree-item[data-document-path="sample-room.glb"]');
    await page.waitForFunction(
      "window.__showcase.state().active.includes('sample-room.glb')",
      { timeout: 15_000, polling: 200 }
    ).catch(async () => {
      const diagnosis = await page.evaluate(() => ({
        events: window.__treeEvents,
        state: window.__showcase.state()
      }));
      throw new Error(`tree activation did not switch scenes: ${JSON.stringify(diagnosis)}`);
    });
    // Switching replaces the active scene; the bake belongs to the active
    // document, so the reloaded document is unbaked until baked again.
    await page.waitForFunction(
      "window.__showcase.state().bakeStatus === 'idle'",
      { timeout: 10_000, polling: 200 }
    ).catch(async () => {
      const diagnosis = await page.evaluate(() => window.__showcase.state());
      throw new Error(`post-switch state not idle: ${JSON.stringify(diagnosis)}`);
    });
    console.log("[showcase:smoke] PASS tree activation switches between documents");

    // Title-bar import: drive the hidden file input through a real change
    // event, exactly like the OS file picker would.
    const titleBarImport = await page.evaluate(async () => {
      const sample = await window.__showcase.generateSampleDocument();
      const file = new File([await sample.arrayBuffer()], "titlebar-import.glb", {
        type: "model/gltf-binary"
      });
      const input = document.querySelector('input[type="file"][data-role="import"]');
      if (!(input instanceof HTMLInputElement)) return { error: "no title-bar file input" };
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return { files: input.files?.length ?? 0 };
    });
    if (titleBarImport.error) throw new Error(titleBarImport.error);
    await page.waitForFunction(
      "window.__showcase.state().active.includes('titlebar-import.glb')",
      { timeout: 15_000, polling: 200 }
    ).catch(async () => {
      const state = await page.evaluate(() => window.__showcase.state());
      throw new Error(`title-bar import did not activate the document: ${JSON.stringify(state)}`);
    });
    console.log("[showcase:smoke] PASS title bar import");

    if (pageErrors.length > 0) throw pageErrors[0];
    console.log("SHOWCASE SMOKE PASS");
    return true;
  } finally {
    if (browser) {
      await Promise.race([
        browser.close().catch((error) => console.error(`[showcase:smoke] close: ${error}`)),
        new Promise((resolve) => setTimeout(resolve, 5_000))
      ]);
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
}

main()
  .then((ok) => {
    process.exitCode = ok ? 0 : 1;
  })
  .catch((error) => {
    console.error(`[showcase:smoke] fatal: ${error.stack || error}`);
    console.error("SHOWCASE SMOKE FAIL");
    process.exitCode = 1;
  });
