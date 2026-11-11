// Fail a release when the pushed tag and package.json version disagree.
//
//   node scripts/check-release-version.mjs v0.1.0
//   GITHUB_REF_NAME=v0.1.0 node scripts/check-release-version.mjs

import { readFileSync } from "node:fs";

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
if (!tag) {
  console.error("[studio:release] no tag supplied; use an argument or GITHUB_REF_NAME");
  process.exit(1);
}

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);
const expected = `v${manifest.version}`;
if (tag !== expected) {
  console.error(
    `[studio:release] tag ${tag} does not match package.json version ${manifest.version} (expected ${expected})`
  );
  process.exit(1);
}

console.log(`[studio:release] tag ${tag} matches ${manifest.name}@${manifest.version}`);
