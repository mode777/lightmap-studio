import assert from "node:assert/strict";
import { test } from "node:test";
import {
  QUALITY_PRESETS,
  StudioError,
  createEmissiveSphere,
  decodeHdr,
  flipRowsBottomUp,
  normalizeLighting,
  prefilterEnvironment,
  resolveBakeSettings,
  validateEnvironment
} from "../dist/index.js";

function environment(overrides = {}) {
  return {
    width: 2,
    height: 1,
    data: new Float32Array([1, 0.5, 0.25, 1, 0, 0.5, 1, 1]),
    intensity: 1,
    ...overrides
  };
}

test("quality presets expose the documented defaults", () => {
  assert.equal(QUALITY_PRESETS.draft.atlasSize, 512);
  assert.equal(QUALITY_PRESETS.draft.hemisphereSize, 32);
  assert.equal(QUALITY_PRESETS.draft.bounces, 1);
  assert.equal(QUALITY_PRESETS.preview.atlasSize, 1024);
  assert.equal(QUALITY_PRESETS.preview.hemisphereSize, 64);
  assert.equal(QUALITY_PRESETS.preview.bounces, 2);
  assert.equal(QUALITY_PRESETS.final.hemisphereSize, 128);
  assert.equal(QUALITY_PRESETS.final.bounces, 3);
});

test("explicit overrides win over preset values", () => {
  const settings = resolveBakeSettings(
    {
      meshes: [],
      quality: "draft",
      atlas: { size: 2048, padding: 12 },
      options: { hemisphereSize: 64, bounces: 3 }
    },
    true
  );
  assert.equal(settings.atlasSize, 2048);
  assert.equal(settings.atlasPadding, 12);
  assert.equal(settings.hemisphereSize, 64);
  assert.equal(settings.bounces, 3);
});

test("atlas padding can be overridden and rejects invalid values", () => {
  assert.equal(
    resolveBakeSettings({ meshes: [], options: { atlasPadding: 6 } }, true).atlasPadding,
    6
  );
  assert.equal(resolveBakeSettings({ meshes: [] }, true).atlasPadding, 2);
  assert.throws(
    () => resolveBakeSettings({ meshes: [], atlas: { padding: -1 } }, true),
    /atlas padding/
  );
  assert.throws(
    () => resolveBakeSettings({ meshes: [], options: { atlasPadding: 65 } }, true),
    /atlas padding/
  );
});

test("unknown presets and invalid settings are rejected", () => {
  assert.throws(
    () => resolveBakeSettings({ meshes: [], quality: "cinematic" }, true),
    (error) => error instanceof StudioError && error.code === "validation"
  );
  assert.throws(
    () => resolveBakeSettings({ meshes: [], options: { hemisphereSize: 63 } }, true),
    /power of two/
  );
});

test("environment validation accepts linear data and rejects bad values", () => {
  assert.doesNotThrow(() => validateEnvironment(environment()));
  assert.throws(() => validateEnvironment(environment({ width: 0 })), /width 0/);
  assert.throws(() => validateEnvironment(environment({ data: new Float32Array(4) })), /data length/);
  const negative = environment();
  negative.data[0] = -1;
  assert.throws(() => validateEnvironment(negative), /negative/);
});

test("row flipping is bottom-up", () => {
  const data = new Float32Array([1, 2, 3, 1, 4, 5, 6, 1]);
  const flipped = flipRowsBottomUp(data, 1, 2);
  assert.deepEqual(Array.from(flipped), [4, 5, 6, 1, 1, 2, 3, 1]);
});

test("prefilter downsamples and preserves intensity", () => {
  const source = {
    width: 8,
    height: 4,
    data: new Float32Array(8 * 4 * 4).fill(0.5),
    intensity: 2
  };
  const prefilted = prefilterEnvironment(source.data, source.width, source.height, 2, 1, 1);
  assert.equal(prefilted.width, 2);
  assert.equal(prefilted.height, 1);
  assert.equal(prefilted.data.length, 8);
  for (const value of prefilted.data) assert.ok(Math.abs(value - 0.5) < 1e-6);
});

test("point-light proxies use the documented radiance formula", () => {
  const proxy = createEmissiveSphere(
    { position: [1, 2, 3], color: [2, 1, 0.5], power: 4, radius: 0.5 },
    12
  );
  const expected = 4 / (4 * Math.PI * Math.PI * 0.5 * 0.5);
  assert.equal(proxy.source, "point");
  assert.equal(proxy.point.radius, 0.5);
  assert.ok(Math.abs(proxy.emissive[0] - 2 * expected) < 1e-9);
  assert.ok(Math.abs(proxy.emissive[1] - 1 * expected) < 1e-9);
  assert.ok(proxy.triangleCount > 0);
});

test("point lights and emitters are normalized into emissive objects", () => {
  const normalized = normalizeLighting(
    {
      ambient: [0.1, 0.1, 0.1],
      points: [{ position: [0, 1, 0], color: [1, 1, 1], power: 1 }],
      emitters: [
        {
          name: "bar",
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
          indices: new Uint32Array([0, 1, 2]),
          emissive: [4, 2, 1]
        }
      ]
    },
    { environmentPrefilter: false, pointSegments: 12 }
  );
  assert.equal(normalized.emitters.length, 2);
  assert.equal(normalized.emitters[0].source, "emitter");
  assert.equal(normalized.emitters[1].source, "point");
});

test("HDR decoding reads a minimal flat RGBE image", () => {
  const header = "#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 2\n";
  const pixels = new Uint8Array([128, 64, 32, 128, 0, 0, 0, 0]);
  const bytes = new Uint8Array(header.length + pixels.length);
  bytes.set(new TextEncoder().encode(header), 0);
  bytes.set(pixels, header.length);
  const decoded = decodeHdr(bytes);
  assert.equal(decoded.width, 2);
  assert.equal(decoded.height, 1);
  assert.ok(Math.abs(decoded.data[0] - 128 / 255) < 1e-6);
  assert.ok(Math.abs(decoded.data[1] - 64 / 255) < 1e-6);
  assert.ok(Math.abs(decoded.data[2] - 32 / 255) < 1e-6);
  assert.equal(decoded.data[4], 0);
});
