# Proposal

## Why

The library ships as a three-free npm package with a README recipe but no runnable demonstration: a prospective user cannot see GLB-in / baked-GLB-out working in a browser. A hosted showcase gives the project a live demo of the studio's core value (mesh in, lightmap out) and doubles as an integration test of the documented consumer path (Vite + wasm assets + WebGL2 bake).

## What Changes

- Add `apps/showcase/`: a self-contained Vite + React application (own `package.json` and lockfile, not an npm workspace) that:
  - accepts drag-and-drop of one or more `.glb` / `.gltf` documents plus their external `.bin` / texture files (also folder drops), and shows the dropped files in a tree view;
  - loads a selected document with three.js `GLTFLoader` and renders it in a WebGL2 viewport (orbit controls, albedo / AO display toggle);
  - bakes ambient occlusion with `lightmap-studio` into an atlas lightmap (uniform white sky environment, single bounce);
  - rebuilds each baked mesh from the unwrapped primitives (using the library's `xref` mapping) so the lightmap UVs line up with the rendered triangles, and adds a Lightmap Atlas tab with chart outlines for inspecting the unwrap;
  - exports the document back as `.glb` (or `.gltf` for `.gltf` input) with the baked AO embedded: atlas UVs written to `TEXCOORD_1`, AO texture as `occlusionTexture`, via three.js `GLTFExporter`.
- Build the UI on `vscode-workbench` at composition level, using only what the tool needs: `WorkbenchShell` with a resizable sidebar (file tree + bake settings) and a status bar (bake progress); per-tag element registrations only (`vscode-tree`, `vscode-button`, `vscode-collapsible`, `vscode-icon`).
- Add `.github/workflows/pages.yml`: on push to `Main`, build library + app and deploy the app to GitHub Pages at `https://mode777.github.io/lightmap-studio/` (Vite `base: /lightmap-studio/`), including a headless smoke bake before deploy.
- Document the showcase in `README.md` and `AGENTS.md` (build/test commands for the app).

Out of scope: full-radiance lightmap baking in the showcase (no ratified glTF target exists; AO only for now), DRACO/KTX2/meshopt document decoding, editing materials or lights, and multi-scene editing.

## Capabilities

### New Capabilities

- `ao-showcase-app`: the browser showcase application - document ingestion (drag-drop, tree, resolution of external buffers/textures), AO baking through the studio, viewport preview, and AO-embedded GLB/GLTF export.
- `showcase-release`: how the showcase reaches GitHub Pages - workflow triggers, gates, deployed artifact contents (wasm assets, base path) and smoke verification.

### Modified Capabilities

(none - the library's specs and public API are unchanged)

## Impact

- New code: `apps/showcase/` (React 19, Vite, three, `vscode-workbench`, `@vscode-elements/elements`, `@vscode/codicons`), `.github/workflows/pages.yml`.
- Library code: one additive field, `UnwrappedObject.xref` (output-vertex to input-vertex mapping), used by the demo to carry TEXCOORD_0 and other attributes onto the unwrapped mesh. No exports are removed or renamed; no new dependencies. The app consumes the workspace package (`lightmap-studio`) via its built `dist/`.
- Repo docs: `README.md` gains a showcase section; `AGENTS.md` gains app build/test commands.
- CI: existing workflows untouched; the new pages workflow reuses the established Node 24 / chrome-headless-shell gates.
- Packaging guards stay intact: `apps/` is outside `files`, so `test:pack` tarball checks are unaffected.
