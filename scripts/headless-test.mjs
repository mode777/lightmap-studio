// Headless WebGL2 checks for the studio bake path.
//
//   npm run test:headless --prefix studio
//   CHROME_SHELL_PATH=/path/to/chrome-headless-shell npm run test:headless --prefix studio

import { existsSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { createServer } from "vite";

const STUDIO_ROOT = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(STUDIO_ROOT, "..");
const TIMEOUT_MS = 240_000;

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
    throw new Error(`chrome-headless-shell not found; set CHROME_SHELL_PATH (tried ${CHROME_CANDIDATES.join(", ")})`);
  }
  return found;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function main() {
  const port = await freePort();
  const server = await createServer({
    root: STUDIO_ROOT,
    configFile: false,
    logLevel: "error",
    optimizeDeps: {
      exclude: ["lightmap-studio", "lightmapper-wasm", "xatlas-wasm"]
    },
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
      fs: {
        allow: [STUDIO_ROOT, REPO_ROOT]
      }
    }
  });
  await server.listen();

  let browser = null;
  try {
    browser = await puppeteer.launch({
      executablePath: chromeShellPath(),
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
    const requests = [];
    const pageErrors = [];
    page.on("request", (request) => requests.push(request.url()));
    page.on("pageerror", (error) => {
      pageErrors.push(error);
      console.error(`[studio] page error: ${error.message}`);
    });
    page.on("console", (message) => {
      if (message.type() === "error") console.error(`[studio:console] ${message.text()}`);
    });

    await page.goto(`http://127.0.0.1:${port}/test/bake-page.html`, {
      waitUntil: "load",
      timeout: 30_000
    });
    await page.waitForFunction("window.__studioTestResult !== undefined", {
      timeout: TIMEOUT_MS,
      polling: 250
    });
    const result = await page.evaluate(() => window.__studioTestResult);

    let ok = result?.ok ?? false;
    for (const check of result?.checks ?? []) {
      console.log(`[studio] ${check.ok ? "PASS" : "FAIL"} ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
      if (!check.ok) ok = false;
    }
    const fetchedMissingLightmapper = requests.some((url) => url.includes("missing-lightmapper.wasm"));
    console.log(
      `[studio] ${fetchedMissingLightmapper ? "FAIL" : "PASS"} float preflight performs no lightmapper fetch`
    );
    if (fetchedMissingLightmapper) ok = false;
    if (pageErrors.length > 0) ok = false;

    console.log(ok ? "STUDIO HEADLESS TEST PASS" : "STUDIO HEADLESS TEST FAIL");
    return ok;
  } finally {
    if (browser) {
      await Promise.race([
        browser.close().catch((error) => console.error(`[studio] close: ${error}`)),
        new Promise((resolve) => setTimeout(resolve, 5_000))
      ]);
    }
    await Promise.race([
      server.close().catch((error) => console.error(`[studio] server close: ${error}`)),
      new Promise((resolve) => setTimeout(resolve, 5_000))
    ]);
  }
}

main()
  .then((ok) => {
    process.exit(ok ? 0 : 1);
  })
  .catch((error) => {
    console.error(`[studio] fatal: ${error.stack || error}`);
    console.error("STUDIO HEADLESS TEST FAIL");
    process.exit(1);
  });
