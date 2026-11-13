import { test } from "node:test";
import assert from "node:assert/strict";
import { lightmapToRgbaBytes } from "../src/lib/lightmap.ts";

test("lightmapToRgbaBytes clamps, replicates R to RGB and writes opaque alpha", () => {
  // Two texels: radiance -0.5 (clamps to black) and 1.25 (clamps to white).
  const lightmap = new Float32Array([-0.5, 0, 0, 1, 1.25, 1, 1, 1]);
  const bytes = lightmapToRgbaBytes(lightmap);

  assert.equal(bytes.length, 8);
  assert.deepEqual(Array.from(bytes.slice(0, 4)), [0, 0, 0, 255]);
  assert.deepEqual(Array.from(bytes.slice(4, 8)), [255, 255, 255, 255]);
});

test("lightmapToRgbaBytes keeps mid values linear (no gamma applied)", () => {
  const lightmap = new Float32Array([0.5, 0, 0, 1]);
  const bytes = lightmapToRgbaBytes(lightmap);
  assert.equal(bytes[0], 128); // 0.5 * 255, clamped arithmetic, no sRGB curve
  assert.equal(bytes[1], 128);
  assert.equal(bytes[2], 128);
  assert.equal(bytes[3], 255);
});
