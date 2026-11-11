import { QUALITY_PRESETS, createStudio } from "lightmap-studio";

const quad = {
  name: "quad",
  positions: new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5]),
  normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3])
};

const result = {
  ok: false,
  createStudio: typeof createStudio,
  preset: QUALITY_PRESETS.preview.atlasSize
};

try {
  const studio = await createStudio();
  try {
    const scene = await studio.unwrap([quad], { size: 32 });
    result.litObjects = scene.litObjects.length;
    result.atlas = `${scene.atlas.width}x${scene.atlas.height}`;
    result.ok = scene.litObjects.length === 1 && result.createStudio === "function";
  } finally {
    studio.dispose();
  }
} catch (error) {
  result.error = String(error?.stack || error);
}

window.__consumerResult = result;
