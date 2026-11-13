# Tasks

## 1. App scaffold

- [x] 1.1 Create `apps/showcase/` with its own `package.json` (React 19, `react-dom` 19, `vscode-workbench` pinned, `@vscode-elements/elements`, `@vscode/codicons`, `three`, Vite 6, `@vitejs/plugin-react`, TypeScript; `file:../../` dependency on `lightmap-studio`), `vite.config.ts` with `base: '/lightmap-studio/'`, `tsconfig.json`, and `index.html` with the `vscode-codicon-stylesheet` link plus codicon assets copied into `public/codicons/`. Verify from repo root: `npm run build`, then in `apps/showcase`: `npm install && npx tsc --noEmit && npm run build` all succeed.
- [x] 1.2 Render a minimal composition-level `WorkbenchShell` (resizable left `ResizablePane`+`Sidebar`, `StatusBar`, viewport placeholder as children) with per-tag element registrations (`icon`, `tree`, `button`, `collapsible`) and only the stylesheets it renders (`tokens`, `global`, `shell`, `resizable-pane`, `sidebar`, `status-bar`, `icon-button`). Verify: app builds and serves (`npm run dev`), the browser console shows no unknown custom-element or duplicate-definition warnings.

## 2. Document ingestion and tree

- [x] 2.1 Implement the drop pipeline: multi-file and folder drops (`webkitGetAsEntry` traversal), type classification (`.glb`/`.gltf` documents; `.bin`, `.png`, `.jpg`, `.jpeg`, `.webp` parts; others skipped and reported). Extract the pure classification/traversal helpers and cover them with `node --test` unit tests in `apps/showcase/test/`. Verify: `node --test test/` in `apps/showcase` passes.
- [x] 2.2 Implement blob-URL `LoadingManager` resolution of `.bin`/texture references against the dropped set, `extensionsUsed` rejection for `KHR_draco_mesh_compression` / `KHR_texture_basisu` / `EXT_meshopt_compression` (unit-test the extension check), and `GLTFLoader` parsing of the selected document with a load error that names the unresolved file. Verify: unit tests pass; a local `.gltf`+`.bin`+texture drop loads and renders in the viewport (manual check or debug hook).
- [x] 2.3 Populate the sidebar `vscode-tree` from the dropped file set (documents grouping their parts), wire document activation to load/replace the active scene, and show the empty-state viewport with drop invitation when nothing is loaded. Verify: dropping two documents lets you switch scenes from the tree (manual check).

## 3. AO bake

- [x] 3.1 Implement mesh extraction: traverse the loaded scene, emit one `MeshInput` per mesh primitive with `matrixWorld`-transformed positions, normal-matrix-transformed normals, original indices, cloned geometry for shared nodes, skipping non-triangle primitives; keep a `litObjects[i] -> Object3D/geometry` map. Cover the traversal/mapping logic with `node --test` unit tests against synthetic `Object3D` trees. Verify: unit tests pass in `apps/showcase`.
- [x] 3.2 Implement the bake settings panel (`vscode-collapsible` + `vscode-button` groups for atlas size 512/1024/2048 and quality draft/preview/final with defaults), the uniform white sky environment generator, and the `studio.bake` call (single bake in flight; progress events forwarded to the status bar). Verify: dropping a document and pressing Bake completes with visible progress and no console errors; a second click during a bake is refused.
- [x] 3.3 Implement capability surfacing: check WebGL2 + `EXT_color_buffer_float` on first bake attempt, report the missing capability by name, and guarantee no `lightmapper.wasm` request in that path (viewport keeps rendering). Verify: forcing a float failure in the browser shows the message and the network panel shows no lightmapper fetch (manual check or smoke assertion later).

## 4. Preview and export

- [x] 4.1 Implement result application: write atlas UVs to `uv1`, encode the float lightmap into an 8-bit canvas texture (clamp, replicate R to RGB, alpha 255, linear), assign `aoMap` with `channel = 1`, resolve and pin the lightmap row-order flip constant against the library's documented lightmap orientation. Cover the float-to-bytes encoder with `node --test` unit tests (known input -> expected RGBA bytes, clamping included). Verify: unit tests pass and the AO display mode renders sensible occlusion on a sample scene (manual check).
- [x] 4.2 Implement the albedo/AO display toggle without re-baking. Verify: toggling after a bake switches views and the second bake of the same document/settings produces an identical atlas (determinism visible via repeat-bake preview).
- [x] 4.3 Implement export: `GLTFExporter` with binary output for `.glb` input and JSON+data-URI output for `.gltf` input, filename `<basename>.ao.<ext>`, export disabled with an explanatory message until a bake completed. Verify: exporting a baked sample yields a file that a conformant loader opens with `occlusionTexture` on `TEXCOORD_1` and the original base color texture on `TEXCOORD_0` (drag the export back into the app).
- [x] 4.4 Rebuild one baked geometry per source mesh from the per-primitive unwrapped objects: copy per-vertex attributes through `UnwrappedObject.xref`, write baked UVs to `uv1`, recreate material groups, and keep single-material meshes as one primitive. Verify: every baked mesh has one `uv1` per position, all indices are in range, the smoke's UV-integrity check passes, and a multi-primitive built-in box shows AO on the correct faces.
- [x] 4.5 Add the Lightmap Atlas stage tab: draw the baked lightmap with chart outlines in the same UV space, report size/chart count/utilization, and keep the 3D viewport state when switching tabs. Verify: the smoke opens the tab, checks the canvas dimensions against the bake atlas, and captures a screenshot.

## 5. Smoke test

- [x] 5.1 Add `apps/showcase/scripts/smoke.mjs` following the `scripts/consumer-test.mjs` pattern: build the app, assert both wasm assets are emitted, serve `dist/` on a plain static server, launch chrome-headless-shell with SwiftShader flags, and drive a `window.__showcase` debug hook: generate a cube `.glb` via `GLTFExporter` in-page, load it through the ingestion hook, bake, export. Add an npm `test:smoke` script. Verify: `npm run test:smoke` passes locally with `CHROME_SHELL_PATH` set.
- [x] 5.2 Assert in the smoke: bake completes, export bytes parse as GLB, the JSON chunk contains `occlusionTexture` with `texCoord` 1 and the mesh carries a second texture-coordinate attribute, and `TEXCOORD_0`/base color are preserved. Verify: smoke output prints these assertions; deliberately breaking a step makes the smoke fail.

## 6. Pages deployment

- [x] 6.1 Add `.github/workflows/pages.yml`: push to `Main` filtered on `src/**`, `apps/**` and the workflow file plus `workflow_dispatch`; permissions `pages: write`, `id-token: write`, `contents: read`; concurrency group; steps: library `npm ci`/`build`/`typecheck`/`test`, app `npm ci` + `npm run build` + `npm run test:smoke` (with chrome-headless-shell install step), `actions/configure-pages` (enablement), `upload-pages-artifact` from `apps/showcase/dist`, `actions/deploy-pages`. Verify: YAML parses cleanly (a YAML parser check) and the step order matches design D7 gates.
- [x] 6.2 Confirm the library's own packaging guards are untouched: `npm test`, `npm run test:pack` at repo root still pass with `apps/` present. Verify: both commands green.

## 7. Documentation

- [x] 7.1 Add a Showcase section to `README.md` (what it demonstrates, AO-only scope, live URL placeholder resolved after first deploy, how to run `apps/showcase` locally including the root-build-first requirement). Verify: instructions in the section work when followed from a clean checkout state.
- [x] 7.2 Update `AGENTS.md` with the app's build/test commands and the library-before-app ordering rule. Verify: documented commands run as written.

## 8. Final verification

- [x] 8.1 Run the full fast gate end to end: repo root `npm ci && npm run build && npm run typecheck && npm test`, then app `npm ci && npx tsc --noEmit && npm run build && npm run test:smoke`. Verify: all green.
- [x] 8.2 Run `openspec validate add-ao-showcase-app --strict` and reconcile any finding. Verify: validation passes.

## Workflow follow-up

- Merge to `Main` and let the pages workflow run; confirm the deployed app at `https://mode777.github.io/lightmap-studio/` loads, bakes, and exports (first run also enables Pages via `configure-pages`).
- Replace the README URL placeholder with the live URL.
- Archive the change with `openspec-archive-change` after review.
