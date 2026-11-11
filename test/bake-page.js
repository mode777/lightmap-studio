import { createStudio } from "/dist/index.js";

function quad({ y = 0, size = 4, facing = 1, offset = 0, emissive = null, name = "quad" }) {
  const half = size / 2;
  return {
    name,
    positions: new Float32Array([
      -half + offset, y, -half,
      half + offset, y, -half,
      half + offset, y, half,
      -half + offset, y, half
    ]),
    normals: new Float32Array([
      0, facing, 0,
      0, facing, 0,
      0, facing, 0,
      0, facing, 0
    ]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    ...(emissive ? { emissive } : { albedo: [0.8, 0.8, 0.8] })
  };
}

function scene(extraLighting = {}) {
  return {
    meshes: [quad({ y: 0, size: 4, facing: 1, name: "floor" })],
    lighting: {
      ambient: [0.02, 0.02, 0.02],
      emitters: [quad({ y: 2, size: 1.5, facing: -1, offset: 0.6, emissive: [8, 6, 4], name: "ceiling" })],
      ...extraLighting
    },
    atlas: { size: 64 },
    quality: "draft",
    options: { hemisphereSize: 16, bounces: 1, dilationPasses: 1, environmentPrefilter: false }
  };
}

const checks = [];
function check(name, condition, detail = "") {
  checks.push({ name, ok: Boolean(condition), detail: String(detail) });
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function finite(values) {
  for (const value of values) if (!Number.isFinite(value)) return false;
  return true;
}

async function main() {
  const studio = await createStudio();
  try {
    const result = await studio.bake(scene());
    check("bake returns one mesh per lit input", result.scene.litObjects.length === 1);
    check("bake returns the RGBA lightmap", result.lightmap.length === result.width * result.height * 4);
    check("lightmap values are finite", finite(result.lightmap));
    check("emissive ceiling lights the floor", result.stats.max > 0.01, result.stats.max);
    check("point proxies are absent when no point lights are supplied", result.scene.emissiveObjects.length === 1);

    const near = await studio.bake(
      scene({
        ambient: [0, 0, 0],
        emitters: [],
        points: [{ position: [0, 1, 0], color: [1, 1, 1], power: 8, radius: 0.1 }]
      })
    );
    const far = await studio.bake(
      scene({
        ambient: [0, 0, 0],
        emitters: [],
        points: [{ position: [0, 2, 0], color: [1, 1, 1], power: 8, radius: 0.1 }]
      })
    );
    const ratio = far.stats.mean / near.stats.mean;
    check("point light falls off between one and two units", ratio > 0.1 && ratio < 0.5, ratio);
    check("point light proxy is returned", far.scene.emissiveObjects.some((object) => object.source === "point"));

    const first = await studio.bake(scene());
    const second = await studio.bake(scene());
    check(
      "atlas metadata is deterministic",
      first.scene.atlas.width === second.scene.atlas.width &&
        first.scene.atlas.height === second.scene.atlas.height &&
        first.scene.atlas.chartCount === second.scene.atlas.chartCount,
      `${first.scene.atlas.width}x${first.scene.atlas.height}/${first.scene.atlas.chartCount} vs ${second.scene.atlas.width}x${second.scene.atlas.height}/${second.scene.atlas.chartCount}`
    );
    let maxUvDelta = 0;
    if (first.scene.litObjects.length === second.scene.litObjects.length) {
      for (let objectIndex = 0; objectIndex < first.scene.litObjects.length; objectIndex += 1) {
        const a = first.scene.litObjects[objectIndex];
        const b = second.scene.litObjects[objectIndex];
        if (a.uvs.length !== b.uvs.length) {
          maxUvDelta = Infinity;
          break;
        }
        for (let i = 0; i < a.uvs.length; i += 1) {
          maxUvDelta = Math.max(maxUvDelta, Math.abs(a.uvs[i] - b.uvs[i]));
        }
      }
    } else {
      maxUvDelta = Infinity;
    }
    check("atlas UVs are deterministic", maxUvDelta < 1e-9, maxUvDelta);
    let maxDelta = 0;
    if (first.lightmap.length === second.lightmap.length) {
      for (let i = 0; i < first.lightmap.length; i += 1) {
        maxDelta = Math.max(maxDelta, Math.abs(first.lightmap[i] - second.lightmap[i]));
      }
    } else {
      maxDelta = Infinity;
    }
    check("repeated bakes are deterministic", maxDelta < 1e-6, maxDelta);

    const controller = new AbortController();
    let aborted = null;
    try {
      await studio.bake({
        ...scene(),
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.stage === "bounce" && !controller.signal.aborted) controller.abort();
        }
      });
    } catch (error) {
      aborted = error;
    }
    check("abort rejects with the aborted code", aborted?.code === "aborted", aborted?.code);

    let busy = null;
    const running = studio.bake(scene());
    try {
      await studio.bake(scene());
    } catch (error) {
      busy = error;
    }
    await running;
    check("concurrent bakes are rejected", busy?.code === "busy", busy?.code);

    const floatStudio = await createStudio({
      testHooks: { failFloat: true },
      wasm: { lightmapper: { url: "/missing-lightmapper.wasm" } }
    });
    let floatError = null;
    try {
      await floatStudio.bake(scene());
    } catch (error) {
      floatError = error;
    } finally {
      floatStudio.dispose();
    }
    check("float failure rejects before the lightmapper fetch", floatError?.code === "float", floatError?.code);

    studio.dispose();
    let disposed = null;
    try {
      await studio.bake(scene());
    } catch (error) {
      disposed = error;
    }
    check("disposed studios reject bakes", disposed?.code === "disposed", disposed?.code);
  } catch (error) {
    checks.push({ name: "fatal", ok: false, detail: error?.stack ?? String(error) });
  }

  return {
    ok: checks.every((entry) => entry.ok),
    checks
  };
}

window.__studioTestResult = main();
