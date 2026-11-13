# AGENTS.md

## Project

- Published ESM library (`lightmap-studio`), not an app. `src/index.ts` is the public API and also re-exports internal bake/environment/gl helpers; changing exports is a breaking change.
- `bake()` composes two isolated layers: `src/unwrap/` is xatlas-only and runs in Node; `src/bake/` is WebGL2 + lightmapper only. `test/import-boundary.test.mjs` enforces no `three`/site/demo imports and no `xatlas-wasm` under `src/bake/`.
- TypeScript uses `module: NodeNext`: relative imports in `src/` need `.js` extensions even though the files are `.ts`.
- `dist/` is generated and gitignored. Never edit it.
- `README.md` is the public contract; tests pin documented values (quality presets, point-light radiance). Update both together.

## Commands

- Build before testing: `npm test`, `test:consumer`, `test:pack` and `test:headless` all load or pack `dist/`. There is no pretest/prepack build, so after changing `src/` run `npm run build` or you are testing stale output.
- Fast gate, same order as CI: `npm ci`, `npm run build`, `npm run typecheck`, `npm test`. No lint or formatter is configured.
- `npm test` is Node-only and lists its four test files explicitly; a new test file will not run until it is added to the script. Bake/WebGL coverage is only in `test:headless`.
- Single Node test: `node --test test/unwrap.test.mjs` (after build); add `--test-name-pattern "..."` to narrow.
- `npm test` prints a scary wasm `ENOENT`/`Aborted` message from the missing-asset test; the suite still passes.
- Browser suites require `chrome-headless-shell` 131 (CI installs it). Set `CHROME_SHELL_PATH` if the script's default probes miss. `test:consumer` packs and installs into a temp app; `test:headless` bakes through SwiftShader. Both are slow; run them for loader/bake/packaging changes.
- CI runs Node 24: build -> typecheck -> test -> consumer -> pack -> headless.

## Showcase app (`apps/showcase`)

- Self-contained npm project with its own lockfile — never add its dependencies to the root `package.json` or make it an npm workspace; `test:pack` relies on the root manifest staying clean.
- It consumes the library via a `file:../../` symlink and resolves the wasm deps upward from the repo root, so **always run the root `npm ci && npm run build` before any app command** (dev, build, or smoke).
- App commands (inside `apps/showcase`): `npm install` (also copies codicons), `npm run typecheck`, `npm test` (node --test with native TS stripping, needs Node >= 22.18), `npm run build` (vite, base `/lightmap-studio/`), `npm run test:smoke` (headless bake + export gate; needs chrome-headless-shell, which this musl container cannot run — execute the smoke on the verification server or in CI).
- Relative imports inside the app use explicit `.ts` extensions (allowImportingTsExtensions + verbatimModuleSyntax so node's TS stripping works).
- The Pages workflow (`.github/workflows/pages.yml`) runs library gates -> showcase build -> smoke -> deploy; never deploy the app without the library gates.

## Invariants

- `bake()` must check WebGL2 and `EXT_color_buffer_float` before requesting `lightmapper.wasm`; the headless suite asserts no lightmapper fetch when float support is missing.
- Bakes must stay deterministic: call `lmSeed(0)` before each bake and zero the post-process ping-pong buffer; repeated-bake checks require <1e-6 drift.
- Lightmap UVs are finite and in `[0, 1)`. `normalizeAtlasUv` clamps the atlas edge to `UV_MAX` because the lightmapper's positive-mod maps 1.0 to 0.0; out-of-range and degenerate UV triangles are rejected.
- There is no directional light. Sky light is linear RGBA equirectangular data in bottom-up rows; point lights become emissive sphere proxies (see README).
- `lightmapper-wasm` must stay >= 0.2.0: `lmSeed`/`_srand` are required for deterministic bakes.

## Packaging and releases

- Default branch is `Main` (capital M); CI triggers there.
- Published files are only `dist/`, `README.md` and `LICENSE`; `test:pack` fails if `src/`, `test/`, `scripts/`, `.github/`, tsconfig or the lockfile leaks into the tarball.
- A `v<version>` tag triggers the release workflow and must equal `package.json` (`scripts/check-release-version.mjs`). Do not tag or publish unless asked.
- On a version bump, update the hardcoded `0.1.0`/`0.2.0` expectations in `scripts/consumer-test.mjs` and `StudioImpl.version` in `src/studio.ts`.

## OpenSpec

- The repo is spec-driven: main specs in `openspec/specs/`, proposals in `openspec/changes/`, workflows in `.agents/skills/openspec-*` (`/openspec-propose`, `/openspec-apply-change`, ...). Use them for non-trivial changes instead of ad-hoc edits.
- If a shell cannot find `openspec`, invoke `~/.local/bin/openspec` or prepend `~/.local/bin` to `PATH` (this environment's npm global prefix).
