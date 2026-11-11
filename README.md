# lightmap-studio

Engine-agnostic unwrapping and lightmap baking for the web, built on
[`xatlas-wasm`](https://github.com/mode777/xatlas-wasm) and
[`lightmapper-wasm`](https://github.com/mode777/lightmapper-wasm).

> **Status: private stage 1.** This package lives under `studio/` in the
> `lightmapper-wasm` repository while the API is proven by the showcase. It is
> not published from this repository. Stage 2 extracts it to its own
> `lightmap-studio` repository and npm package; stage 3 removes the local copy
> and consumes the published package from the samples.

The studio owns the mesh-to-lightmap path: one shared xatlas atlas, a WebGL2
lightmapper bake, optional environment prefiltering, quality presets and a
plain-data result. It does not bundle three.js and does not export renderer
objects.

## Build

The private package consumes the repository's built `dist/` and the registry
`xatlas-wasm` package:

```sh
npm run build:studio        # from the repository root
# or
npm run build --prefix studio
```

`studio/dist/index.js` and `studio/dist/index.d.ts` are the package entry.

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

// result.scene.litObjects[i].uvs / positions / normals / indices / charts
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

There is **no directional-light input**. Sky lighting is supplied as HDRI or
generated equirectangular data. The showcase's procedural sky remains a
sample-local generator.

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
`result.scene.emissiveObjects` with `source: "point"` so the sample can render
the same bulb.

`EnvironmentInput` is linear RGBA radiance in bottom-up row order: row 0 is the
south pole (`v = 0`), the last row is the north pole (`v = 1`). The studio
prefilters the environment to a 128x64 irradiance copy by default. Pass
`options.environmentPrefilter: false` to draw the full-resolution environment,
or `{ width, height, radius }` to control the copy.

## Quality presets

| Preset | Atlas | Hemisphere | Bounces | Dilation | Smooth passes | Interpolation |
|---|---|---|---|---|---|---|
| `draft` | 512 | 32 | 1 | 4 | 1 | 1 |
| `preview` | 1024 | 64 | 2 | 8 | 1 | 2 |
| `final` | 1024 | 128 | 3 | 8 | 2 | 2 |

Explicit fields in `options` override the preset. The showcase passes its
per-scene values as overrides, so its tuned look is unchanged.

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

Both wasm modules load lazily. `createStudio()` fetches nothing; `unwrap()`
loads xatlas; `bake()` probes WebGL2 and `EXT_color_buffer_float` before loading
lightmapper.

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
package defaults; a bundler emits both wasm assets.

Errors are `StudioError` instances with a `code` of `webgl2`, `float`,
`assets`, `validation`, `atlas`, `aborted`, `disposed`, `busy` or `bake`. The
original error is preserved as `cause`. Injected modules remain caller-owned
and are not disposed by the studio.

## Three-free display recipe

The result is a float RGBA lightmap and plain geometry. Any renderer can use
it. A three.js sample can create a texture like this without the studio
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
the material albedo by the texture. Use `result.scene.emissiveObjects` for
emissive geometry and point proxies.

## Commands

```sh
npm run build --prefix studio          # tsc -> studio/dist
npm run typecheck --prefix studio
npm test --prefix studio               # Node unit/unwrap/loader/boundary tests
CHROME_SHELL_PATH=... npm run test:headless --prefix studio
npm run test:consumer --prefix studio  # Vite build emits both wasm assets
```

The headless suite covers the bake result, point-light falloff, deterministic
repeat bakes, abort, busy rejection, float preflight and disposal.

## Verification

The root `npm run verify:remote` pipeline builds the wasm, assembles `dist`,
runs the studio checks and then runs the showcase checks. The studio is not a
published artifact in this stage.
