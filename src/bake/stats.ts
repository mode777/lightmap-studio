import type { BakeStats } from "../types.js";

const NON_BLACK_THRESHOLD = 1e-4;

export function computeBakeStats(lightmap: Float32Array): BakeStats {
  if (lightmap.length % 4 !== 0) {
    throw new Error(`bake stats: lightmap length ${lightmap.length} is not RGBA`);
  }
  const pixelCount = lightmap.length / 4;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  let litPixels = 0;

  for (let i = 0; i < lightmap.length; i += 4) {
    const r = lightmap[i];
    const g = lightmap[i + 1];
    const b = lightmap[i + 2];
    const pixelMax = Math.max(r, g, b);
    const pixelMin = Math.min(r, g, b);
    if (!Number.isFinite(pixelMax)) {
      throw new Error(`bake stats: non-finite value at pixel ${i / 4}`);
    }
    sum += r + g + b;
    if (pixelMin < min) min = pixelMin;
    if (pixelMax > max) max = pixelMax;
    if (pixelMax > NON_BLACK_THRESHOLD) litPixels += 1;
  }

  return {
    mean: pixelCount > 0 ? sum / (pixelCount * 3) : 0,
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 0,
    nonBlackRatio: pixelCount > 0 ? litPixels / pixelCount : 0,
    litPixels
  };
}
