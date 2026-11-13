# lightmap-studio

Engine-agnostic unwrapping and lightmap baking for the web, built on
[`xatlas-wasm`](https://github.com/mode777/xatlas-wasm) and
[`lightmapper-wasm`](https://github.com/mode777/lightmapper-wasm).

The studio owns the mesh-to-lightmap path: one shared xatlas atlas, a WebGL2
lightmapper bake, optional environment prefiltering, quality presets and a
plain-data result. It does not bundle three.js and does not export renderer
objects.

## Install

```sh
npm install lightmap-studio
```

`lightmapper-wasm` (minimum `0.2.0`) and `xatlas-wasm` are installed as direct
runtime dependencies. A bundler emits both wasm assets, and the loader resolves
them beside each dependency's published entry. Consumers do not need
Emscripten, CMake or a local `lightmapper-wasm` checkout.

The package is pre-1.0: the `0.1.x` line may change its API before `1.0`.
Changes follow the project's OpenSpec specifications.

## Quick start

```js
import { createStudio } from "lightmap-studio";

const studio = await createStudio();

// Unwrap only (works without WebGL, including in Node).
const scene = await studio.unwrap(
  [{ name: "floor", positions, normals, indices, albedo: [0.8, 0.8, 0.8] }],
  { size: 1024 }
);

// Unwrap and bake.
const result = await studio.bake({
  meshes: [
    { name: "floor", positions, normals, indices, albedo: [0.8, 0.8, 0.8] }
  ],
  lighting: {
    environment: { data, width, height, intensity: 1 },
    ambient: [0, 0, 0],
    emitters: [
      { name: "ceiling", positions, normals, indices, emissive: [6, 5, 4] }
    ],
    points: [
      { position: [0, 2, 0], color: [1, 0.8, 0.6], power: 40, radius: 0.08 }
    ]
  },
  atlas: { size: 1024 },
  quality: "preview"
});

// result.scene.litObjects[i].uvs / positions / normals / indices / charts / xref
// result.scene.litObjects[i].degenerateTriangleCount  triangles xatlas left uncharted
// result.lightmap       Float32Array, RGBA
// result.scene.atlas    width, height, chartCount, utilization
// result.stats          mean, min, max, nonBlackRatio, litPixels
// result.scene.emissiveObjects  emitters and generated point proxies
studio.dispose();
```

`bake` unwraps raw meshes and bakes them in one call. `unwrap` is the same
atlas step without a WebGL context. Inputs and outputs are typed arrays and
plain values; no three.js type crosses the boundary.

## Lighting model

The lightmapper integrates radiance from the geometry and sky drawn during each
hemisphere pass. The studio input reflects that:

```ts
interface LightingInput {
  environment?: EnvironmentInput; // the only sky source
  ambient?: Vec3;                 // constant term, default black
  emitters?: EmissiveMeshInput[]; // area lights, drawn during the bake
  points?: PointLightInput[];     // expanded to emissive sphere proxies
}
```

There is **no directional-light input**. Sky lighting is supplied as linear
equirectangular data; a procedural sky is simply a generator that produces
that data.

A point light is:

```ts
interface PointLightInput {
  position: Vec3;
  color: Vec3;
  power: number;   // total radiant power in scene units
  radius?: number; // proxy sphere radius, default 0.05
}
```

The proxy sphere uses uniform radiance `power / (4 * pi^2 * radius^2)`. A small
radius gives sharper shadows and more sampling noise; a larger radius gives
softer area-light shadows. The generated proxy is returned in
`result.scene.emissiveObjects` with `source: "point"` so the caller can render
the same bulb.

`EnvironmentInput` is linear RGBA radiance in bottom-up row order: row 0 is the
south pole (`v = 0`), the last row is the north pole (`v = 1`). The studio
prefilters the environment to a 128x64 irradiance copy by default. Pass
`options.environmentPrefilter: false` to draw the full-resolution environment,
or `{ width, height, radius }` to control the copy.

## Wasm assets

Both modules load lazily: `createStudio()` fetches nothing, `unwrap()` loads
`xatlas.wasm`, and `bake()` probes WebGL2 and `EXT_color_buffer_float` before
loading `lightmapper.wasm`. A bundler that follows the packages' default
`new URL(...)` resolution emits both `.wasm` files as build assets. Override a
module with `wasm.xatlas` / `wasm.lightmapper` when the application serves the
assets from a custom location.

## Quality presets

| Preset | Atlas | Hemisphere | Bounces | Dilation | Smooth passes | Interpolation |
|---|---|---|---|---|---|---|
| `draft` | 512 | 32 | 1 | 4 | 1 | 1 |
| `preview` | 1024 | 64 | 2 | 8 | 1 | 2 |
| `final` | 1024 | 128 | 3 | 8 | 2 | 2 |

Explicit fields in `options` override the preset. Consumers can pass
per-scene values as overrides without changing the preset table.

```ts
studio.bake({
  ...scene,
  quality: "final",
  options: { bounces: 4, hemisphereWeight: "cosine", smoothPasses: 2 }
});
```

`hemisphereWeight` defaults to the library's `uniform`; use `"cosine"` for
physically weighted diffuse sampling. The studio seeds the lightmapper's
rotation jitter before each bake, so repeated bakes of the same scene and
options are reproducible.

## Loader options

```ts
const studio = await createStudio({
  gl, // optional existing context
  canvas, // optional canvas to create the context from
  wasm: {
    lightmapper: { url: "/wasm/lightmapper.wasm" },
    xatlas: { binary: preloadedBytes }
  },
  modules: {
    // Optional: reuse modules you already initialized.
    xatlas: existingXAtlasModule
  }
});
```

Resolution order per module: injected module, then `binary`, then `url`, then
the dependency's own default `new URL(...)` asset. Omit `wasm` to use the
package defaults.

Errors are `StudioError` instances with a `code` of `webgl2`, `float`,
`assets`, `validation`, `atlas`, `aborted`, `disposed`, `busy` or `bake`. The
original error is preserved as `cause`. Injected modules remain caller-owned
and are not disposed by the studio.

## Three-free display recipe

The result is a float RGBA lightmap and plain geometry. Any renderer can use
it. A three.js consumer can create a texture like this without the studio
depending on three:

```js
import * as THREE from "three";

const texture = new THREE.DataTexture(
  result.lightmap,
  result.width,
  result.height,
  THREE.RGBAFormat,
  THREE.FloatType
);
texture.colorSpace = THREE.LinearSRGBColorSpace;
texture.minFilter = texture.magFilter = THREE.LinearFilter;
texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
texture.generateMipmaps = false;
texture.needsUpdate = true;
```

Use `result.scene.litObjects[i].uvs` as the lightmap UV attribute and multiply
the material albedo by the texture. xatlas duplicates vertices at chart seams;
`litObjects[i].xref` maps every output vertex back to its input vertex so you
can carry TEXCOORD_0 and other per-vertex data onto the unwrapped geometry.
Triangles xatlas cannot chart (zero-area or sub-texel input triangles) are
omitted from `indices` and reported via `degenerateTriangleCount`, so one bad
triangle does not abort the bake. Use `result.scene.emissiveObjects` for
emissive geometry and point proxies.

## Showcase

A browser showcase lives in [`apps/showcase`](apps/showcase): drop `.glb` /
`.gltf` documents (plus their `.bin` and texture files) onto the page, inspect
them in a viewport, bake **ambient occlusion** into an atlas lightmap, and
export the document back with the baked AO embedded as a standard glTF
`occlusionTexture` sampled on `TEXCOORD_1`. A **Lightmap Atlas** tab shows the
baked atlas with the unwrapped chart outlines and atlas statistics, so UV or
seam problems are visible directly. The published instance is served at
`https://mode777.github.io/lightmap-studio/` via GitHub Actions.

Scope notes: the showcase bakes AO only (a uniform white sky with a single
bounce), so the export is readable by any glTF 2.0 viewer. Full-radiance
lightmaps have no ratified glTF destination and are not exported. DRACO,
KTX2 and meshopt compressed documents are rejected.

To run it locally (the app consumes this repository's built `dist/`, so build
the library first):

```sh
npm ci && npm run build                 # repository root
cd apps/showcase
npm install                             # also copies codicons into public/
npm run dev                             # http://localhost:5173/lightmap-studio/
```

The application has its own checks:

```sh
npm run typecheck
npm test                                # pure-helper unit tests (node --test)
CHROME_SHELL_PATH=... npm run test:smoke  # headless bake + export gate
```

The smoke gate generates a sample document at runtime, bakes and exports it
in headless Chrome with SwiftShader WebGL, and asserts the exported GLB
carries `occlusionTexture` on a second texture-coordinate set with the base
color texture preserved. CI deploys to Pages only after the library gates and
this smoke pass.

## Build and test

```sh
npm ci
npm run build
npm run typecheck
npm test                               # unit, unwrap, loader and import boundary
npm run test:consumer                  # pack → scratch Vite app → headless load
npm run test:pack                      # published tarball layout
CHROME_SHELL_PATH=... npm run test:headless
```

`test:consumer` installs the packed tarball, builds an application that
imports `lightmap-studio`, asserts that both wasm assets are emitted and
unwraps in headless Chrome. The headless suite covers the bake result,
point-light falloff, deterministic repeat bakes, abort, busy rejection, float
preflight and disposal. CI runs the same gates on Node 24 with pinned
`chrome-headless-shell` 131 and ANGLE SwiftShader.

## Releases

A `v<version>` tag runs the release workflow. The tag must equal the
`package.json` version; the workflow runs the build, unit, packed-consumer,
tarball and headless gates before publishing with provenance. If npm trusted
publishing is unavailable, configure an `NPM_TOKEN` repository secret; the
workflow then uses the token with the same gates.

## License

Unlicense. See [LICENSE](./LICENSE).
