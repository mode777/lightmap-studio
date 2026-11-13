// Copy the Codicon stylesheet and font into the app's public directory.
// vscode-elements custom elements reuse the stylesheet through the
// `vscode-codicon-stylesheet` link in index.html; without it, icons render
// as blank squares. Runs on npm install / npm ci.
import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(appRoot, "node_modules", "@vscode", "codicons", "dist");
const target = path.join(appRoot, "public", "codicons");

mkdirSync(target, { recursive: true });
for (const file of ["codicon.css", "codicon.ttf"]) {
  cpSync(path.join(source, file), path.join(target, file));
}
console.log("[showcase] codicons copied to public/codicons");
