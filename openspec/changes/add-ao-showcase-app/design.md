# Design

## Context

The library is three-free by contract (`test/import-boundary.test.mjs`): it exposes `createStudio()` with plain typed-array inputs and never touches glTF. A showcase must therefore own document I/O and viewport rendering in an application layer, consuming the library through its public API and built `dist/`. The UI kit (`vscode-workbench` 0.1.x) is browser-only, React 19 based, and favors selective composition over the full preset. Deployment target is GitHub Pages, which serves static files without custom headers.

See proposal.md - Why, and the two spec deltas for the behavior contracts.

## Goals / Non-Goals

**Goals:**

- One window: drop, inspect, bake AO, export - with the library doing all lightmap work.
- AO-only round trip that is valid glTF 2.0 for any conformant viewer.
- Minimal workbench UI: shell layout, sidebar tree + settings, status bar progress.
- CI-verifiable: the smoke gate proves bake + export inside the built app before every deploy.

**Non-Goals:**

- Full-radiance lightmap baking (no ratified glTF target; revisit as a preview-only mode later).
- DRACO/KTX2/meshopt decoding, material or lighting editing, multiple simultaneous scenes.
- A Web Worker bake in v1: the library yields to the main thread between passes; the UI stays responsive enough for showcase-scale scenes.
- Mobile layout; the showcase is a desktop tool.

## Decisions

### D1: AO is a uniform-sky bake, not an ambient term

The studio's flat `ambient` term is added unoccluded (it goes straight into `lmCreate`), so white ambient does not produce AO. The hemisphere pass however genuinely ray-casts against the environment. The app bakes with a uniform white equirectangular environment, `ambient: [0,0,0]`, no emitters/points: radiance then equals sky visibility, which is textbook ambient occlusion, and is independent of albedo - which also sidesteps `MeshInput`'s flat-albedo limitation. Bounces default to **1** (an AO bake has only direct sky; higher bounce counts are wasted work) and are user-configurable (1-4) via a settings dropdown that overrides the quality preset through `BakeInput.options.bounces`. Alternative considered: a custom occlusion ray pass in the app - rejected, it duplicates the library's value instead of showcasing it.

### D2: Export uses standard glTF `occlusionTexture` - nothing custom

three.js `GLTFExporter` (verified against r180) writes `material.aoMap` as `occlusionTexture` with `texCoord: texture.channel` and `aoMapIntensity` as `strength`, and `GLTFLoader` reads it back. Pipeline: bake result UVs become the `uv1` attribute, the baked atlas becomes an 8-bit canvas texture with `channel = 1`, `aoMapIntensity` stays 1. `TEXCOORD_0` and base color textures are untouched. Output format matches input (binary GLB for `.glb`, JSON with embedded data URIs for `.gltf`); filename is `<input-basename>.ao.<ext>`. Alternative considered: a three.js `lightMap` convention or custom extension - rejected, not portable to other viewers.

### D3: The lightmap leaves the app only as clamped 8-bit pixels

The bake result is float RGBA. For preview the app draws one canvas-backed texture (`R = clamp(ao)` replicated to RGB, alpha 255 to avoid premultiplication issues, linear values, no color-space conversion). The 3D view has a three-way display switch (both by default). AO-only shows this texture directly on an unlit `MeshBasicMaterial` (`channel = 1`, `flipY = false`); both uses a `MeshBasicMaterial` with the original albedo `map`/color on TEXCOORD_0 plus `aoMap` on TEXCOORD_1, which three.js multiplies without custom shaders; albedo-only restores the original material. PBR `aoMap` alone only attenuates ambient light and is invisible under strong direct lighting, so the raw/combined unlit views are the preview. The same unflipped texture is exported: the glTF 2.0 uv origin is the stored image's top-left row - exactly where the studio's UVs put array row 0 - and GLTFLoader loads at flipY=false. An earlier flipY=true export texture made GLTFExporter flip the stored image and vertically mirrored the AO in viewers (fixed; pinned by the smoke's orientation round trip: export -> reimport -> pixel-compare at shared UVs, max delta 0). This keeps preview and export byte-identical and avoids float-texture color-management traps in the exporter; no pixel flipping anywhere.

### D3b: The sample scene and bake geometry rules

The sample document is a room interior: textured floor slab, three solid wall slabs, and boxes contacting floor and walls. All bake geometry is solid (closed boxes) because the library's occlusion pass renders without backface culling - open planes would shadow themselves; boxes must not interpenetrate walls or hemisphere origins land inside solid geometry (pure-black charts). The scene demonstrates that the bake is scene-global: the shared-atlas lightmap contains shadows cast between objects (walls darken behind boxes), not per-object self-occlusion. glTF 2.0 represents this natively - one atlas texture referenced by every baked material's `occlusionTexture` with `texCoord = 1` - so no custom extension is needed for AO; a custom extension would only enter play for full-radiance lightmaps (out of scope).

### D4: Mesh extraction and bookkeeping

`GLTFLoader` parses the document with a custom `LoadingManager` whose URL modifier resolves every referenced `.bin`/texture against the dropped file set via blob URLs (this is what makes multi-file `.gltf` drops work). Each `Mesh` primitive becomes one `MeshInput`: positions transformed by `matrixWorld`, normals by the normal matrix, original index buffer reused. Geometries shared between nodes are cloned into separate inputs (each node needs its own atlas charts). Non-triangle primitives (lines, points) and meshes with degenerate geometry are skipped from baking but preserved in export. A document declaring unsupported compression extensions is rejected up front via `extensionsUsed` inspection (D4 aligns with the spec's rejection requirement).

The bake result cannot be written directly onto the source geometry: xatlas emits a new index buffer and may duplicate vertices at chart seams, so a `uv1` attribute indexed by the source geometry would address unrelated vertices (the shipped bug that put AO on the wrong faces). Instead the app reassembles ONE geometry per source mesh from its per-primitive unwrapped objects: the baked UVs become `uv1`, `UnwrappedObject.xref` maps every output vertex back to its input vertex so TEXCOORD_0/colors/skin/morph data are carried over, and primitive groups are recreated with their material indices. Single-material meshes stay one glTF primitive; multi-material meshes keep their group/material mapping. `xref` is an additive field on the library's `UnwrappedObject` - the mapping cannot be recovered reliably from positions alone because duplicate vertices can share position and normal but differ in UVs.

### D3c: Atlas inspector shares the bake's UV space

The Lightmap Atlas tab draws the same canvas texture and UV space as the viewport: `x = u * width`, `y = v * height`, with chart outlines colored per island plus atlas size, chart count and utilization. There is no second flip or UV transform; the tab is deliberately the place where a seam/atlas mapping regression is visible directly, before it is inferred from the 3D viewport.

### D5: UI = composition level with omitted slots

`WorkbenchShell` with `titleBar` = `TitleBar` (app icon/title plus Import and Export actions), `primarySideBar` = `ResizablePane` > `Sidebar` (tree + bake settings) and `statusBar` = `StatusBar`; no activity bar, tabs or panel slots. Import opens a hidden multi-file input and feeds the existing drop pipeline, so the title bar, drag-and-drop and the test hook share one ingestion path; Export reuses the bake-gated export flow and stays disabled until a bake completes. Per-tag registrations only: `vscode-tree`, `vscode-button`, `vscode-collapsible`, `vscode-icon`, plus form tags registered straight from the `@vscode-elements` peer (`vscode-single-select`, `vscode-option`, `vscode-form-container`, `vscode-form-group`, `vscode-label`, `vscode-form-helper`). Styles: `tokens.css` + `global.css` first, then the component entries (`shell`, `title-bar`, `resizable-pane`, `sidebar`, `status-bar`, `icon-button`); the document body must reset margins and derive every surface from workbench tokens so no white bleeds through. Atlas size, chart padding and quality are `vscode-single-select` dropdowns laid out with `variant="settings-group"` form groups (VS Code settings-page rows); the albedo/AO/both switch is a small segmented control overlaid on the 3D view (both default, disabled until a bake); Bake/Export are accent/secondary buttons; progress lives in the status bar. Chart padding exposes xatlas's per-chart texel padding because dilation/filtering can bleed between tightly packed islands; the default is 8 px and the atlas inspector reports the value used. The selects dispatch plain non-bubbling `change` events, handled once at document level in the capture phase. Codicons ship from `@vscode/codicons` copied into `public/` with the `vscode-codicon-stylesheet` link. Alternative considered: the preset (drags in menus, quick open, persistence, demo markers) or bare primitives (rebuilds shell layout for no gain). The kit is pinned to the exact 0.1.x version in the app lockfile.

### D6: App placement - self-contained `apps/showcase/`

Own `package.json` + lockfile, not an npm workspace, so the library's root manifest, README-pinned tests and `test:pack` tarball checks stay untouched. The app depends on the workspace library via `file:../../` (npm symlinks it), so CI and dev always bake through the repo's current `dist/`; the root `npm run build` must precede app build/dev, and the pages workflow encodes that order. Vite config: `base: '/lightmap-studio/'`, `@vitejs/plugin-react`. Both wasm assets are emitted by Vite's `new URL(...)` handling - already proven by `scripts/consumer-test.mjs`; the app smoke asserts both files exist in its own output. Alternatives considered: npm workspaces (touches root lockfile), vite alias to `../../dist` (bypasses real package resolution, wasm provenance unclear).

### D7: Pages workflow with a real bake gate

`.github/workflows/pages.yml`: on push to `Main` (paths: `src/**`, `apps/**`, the workflow file) plus `workflow_dispatch`; `permissions: pages: write, id-token: write`; concurrency group `pages`. Steps: library `npm ci`/`build`/`typecheck`/`test` (same gates as CI) -> app `npm ci` + `vite build` -> smoke -> `actions/configure-pages` (with enablement so the first run self-configures) -> `upload-pages-artifact` -> `deploy-pages`. The smoke follows the established headless pattern (`scripts/consumer-test.mjs`): serve the app dist with a plain static server, launch chrome-headless-shell with SwiftShader flags, and drive the app through a small `window.__showcase` test hook (`loadFiles(File[])`, await bake, export to bytes, dump the atlas). The sample document is generated at smoke time by exporting a procedurally built room scene with `GLTFExporter` - no checked-in binary fixtures - and the smoke exercises the real loader -> bake -> exporter path end to end, including dropdown interactions and page screenshots for visual verification.

## Risks / Trade-offs

- [Lightmap/UV orientation mismatch] -> pin with the library's headless golden orientation early in implementation; single flip constant, asserted by the smoke's AO-mean check (corners darker than open faces).
- [npm `file:` symlink quirks under `npm ci` in CI] -> smoke gate runs in the same workflow; if symlinks misbehave, fall back to `npm install` for the app step.
- [vscode-workbench is 0.x and may break] -> exact version pin + lockfile; UI is confined to a small set of primitives, so breakage is contained and visible at build time.
- [Large documents freeze the main thread during bake passes] -> library already yields between passes; v1 accepts this and documents it. Worker offload is a future change (the studio API is context-based, not worker-hostile).
- [Skinned/morph-target meshes bake in bind pose] -> accepted for v1; the export preserves the original data so nothing is corrupted, and the limitation is visible only in the baked preview.
- [Two WebGL contexts (viewport + bake)] -> the studio owns its own 1x1 context; disposal handled by keeping one studio instance for the app lifetime.

## Migration Plan

Purely additive. Rollback = remove `apps/showcase/` and the pages workflow. The only manual step is enabling GitHub Pages with the "GitHub Actions" source once; `actions/configure-pages` with `enablement: true` performs it on the first successful run.
