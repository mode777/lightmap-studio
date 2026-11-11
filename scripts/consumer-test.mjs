// Build and verify the published package as a consumer:
//   1. npm pack the package
//   2. install the tarball plus Vite into a scratch application
//   3. build a page that imports "lightmap-studio"
//   4. assert both wasm assets are emitted
//   5. load the built page in headless Chrome and run an unwrap
//
//   npm run test:consumer
//   CHROME_SHELL_PATH=/path/to/chrome-headless-shell npm run test:consumer

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { build } from "vite";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
const FIXTURE_ROOT = path.join(PACKAGE_ROOT, "test", "consumer");
const TIMEOUT_MS = 180_000;

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
  ),
  path.join(
    os.homedir(),
    ".cache",
    "chrome",
    "manual",
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

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: "pipe" });
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

function assertManifest(consumerRoot) {
  const modules = path.join(consumerRoot, "node_modules");
  const installedRoot = path.join(modules, "lightmap-studio");
  if (!lstatSync(installedRoot).isDirectory()) {
    throw new Error("lightmap-studio is not a real installed directory");
  }
  const installed = JSON.parse(readFileSync(path.join(installedRoot, "package.json"), "utf8"));
  if (installed.version !== "0.1.0") {
    throw new Error(`unexpected installed version ${installed.version}`);
  }
  for (const [name, range] of Object.entries(installed.dependencies ?? {})) {
    if (/^(file|link|workspace):/.test(range)) {
      throw new Error(`installed manifest still has a local dependency: ${name}=${range}`);
    }
  }
  const lightmapper = JSON.parse(
    readFileSync(path.join(modules, "lightmapper-wasm", "package.json"), "utf8")
  );
  const xatlas = JSON.parse(readFileSync(path.join(modules, "xatlas-wasm", "package.json"), "utf8"));
  if (lightmapper.version !== "0.2.0") {
    throw new Error(`unexpected lightmapper-wasm version ${lightmapper.version}`);
  }
  if (xatlas.version !== "0.2.0") {
    throw new Error(`unexpected xatlas-wasm version ${xatlas.version}`);
  }
  console.log("[studio:consumer] PASS installed tarball resolves registry dependencies");
}

function serveDirectory(root) {
  const server = createServer((request, response) => {
    const url = decodeURIComponent((request.url ?? "/").split("?")[0]);
    let file = path.join(root, url === "/" ? "index.html" : url);
    if (!file.startsWith(root)) {
      response.writeHead(403).end();
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(root, "index.html");
    const extension = path.extname(file);
    const contentType =
      extension === ".wasm"
        ? "application/wasm"
        : extension === ".js"
          ? "text/javascript"
          : extension === ".html"
            ? "text/html"
            : "application/octet-stream";
    response.writeHead(200, { "content-type": contentType });
    response.end(readFileSync(file));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function main() {
  const chrome = chromeShellPath();
  const scratch = mkdtempSync(path.join(os.tmpdir(), "lightmap-studio-consumer-"));
  const packDirectory = path.join(scratch, "pack");
  const consumerRoot = path.join(scratch, "app");
  mkdirSync(packDirectory, { recursive: true });
  mkdirSync(consumerRoot, { recursive: true });

  let browser = null;
  let server = null;
  try {
    run("npm", ["pack", "--pack-destination", packDirectory, "--silent"], PACKAGE_ROOT);
    const tarballName = readdirSync(packDirectory).find((entry) => entry.endsWith(".tgz"));
    if (!tarballName) throw new Error("npm pack produced no tarball");
    const tarball = path.join(packDirectory, tarballName);
    console.log(`[studio:consumer] packed ${tarballName}`);

    for (const file of ["index.html", "main.js"]) {
      cpSync(path.join(FIXTURE_ROOT, file), path.join(consumerRoot, file));
    }
    writeFileSync(
      path.join(consumerRoot, "package.json"),
      JSON.stringify(
        { name: "lightmap-studio-consumer", private: true, type: "module" },
        null,
        2
      )
    );

    run(
      "npm",
      ["install", "--no-audit", "--no-fund", "--silent", tarball, "vite@6.4.5"],
      consumerRoot
    );
    assertManifest(consumerRoot);

    await build({
      root: consumerRoot,
      configFile: false,
      logLevel: "error",
      build: {
        outDir: path.join(consumerRoot, "dist"),
        emptyOutDir: true,
        assetsInlineLimit: 0,
        target: "es2022"
      }
    });

    const outputRoot = path.join(consumerRoot, "dist");
    const names = wasmFiles(outputRoot).map((file) => path.basename(file));
    const hasLightmapper = names.some((name) => name.includes("lightmapper"));
    const hasXatlas = names.some((name) => name.includes("xatlas"));
    for (const name of names) console.log(`[studio:consumer] emitted ${name}`);
    if (!hasLightmapper || !hasXatlas) {
      throw new Error("missing one of lightmapper.wasm / xatlas.wasm");
    }
    console.log("[studio:consumer] PASS bundler emits both wasm assets");

    server = await serveDirectory(outputRoot);
    const { port } = server.address();
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: "shell",
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
      if (message.type() === "error") console.error(`[studio:consumer] console: ${message.text()}`);
    });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load", timeout: 30_000 });
    await page.waitForFunction("window.__consumerResult !== undefined", {
      timeout: TIMEOUT_MS,
      polling: 250
    });
    const result = await page.evaluate(() => window.__consumerResult);
    if (!result?.ok) {
      throw new Error(`consumer page failed: ${result?.error ?? "unknown error"}`);
    }
    if (result.litObjects !== 1) {
      throw new Error(`expected one unwrapped object, received ${result.litObjects}`);
    }
    if (pageErrors.length > 0) throw pageErrors[0];
    console.log(
      `[studio:consumer] PASS installed package unwrapped in the browser (${result.atlas})`
    );
    console.log("STUDIO CONSUMER TEST PASS");
    return true;
  } finally {
    if (browser) {
      await Promise.race([
        browser.close().catch((error) => console.error(`[studio:consumer] close: ${error}`)),
        new Promise((resolve) => setTimeout(resolve, 5_000))
      ]);
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    rmSync(scratch, { recursive: true, force: true });
  }
}

main()
  .then((ok) => {
    process.exitCode = ok ? 0 : 1;
  })
  .catch((error) => {
    console.error(`[studio:consumer] fatal: ${error.stack || error}`);
    console.error("STUDIO CONSUMER TEST FAIL");
    process.exitCode = 1;
  });
