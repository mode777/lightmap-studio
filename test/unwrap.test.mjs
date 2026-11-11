import assert from "node:assert/strict";
import { test } from "node:test";
import createXAtlas from "xatlas-wasm";
import {
  StudioError,
  UV_MAX,
  createStudio,
  normalizeAtlasUv,
  unwrapMeshes
} from "../dist/index.js";

function quad(offset = 0, name = "quad") {
  const o = offset;
  return {
    name,
    positions: new Float32Array([
      o, 0, 0,
      o + 1, 0, 0,
      o + 1, 1, 0,
      o, 1, 0
    ]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    albedo: [0.8, 0.7, 0.6]
  };
}

test("normalizes atlas texels and clamps the exact edge", () => {
  assert.equal(normalizeAtlasUv(0, 512), 0);
  assert.equal(normalizeAtlasUv(256, 512), 0.5);
  assert.equal(normalizeAtlasUv(512, 512), UV_MAX);
  assert.ok(normalizeAtlasUv(512, 512) < 1);
  assert.throws(() => normalizeAtlasUv(-1, 512), /outside/);
  assert.throws(() => normalizeAtlasUv(513, 512), /outside/);
  assert.throws(() => normalizeAtlasUv(Number.NaN, 512), /non-finite/);
});

test("unwraps multiple meshes into one shared atlas", async () => {
  const xatlas = await createXAtlas();
  try {
    const scene = unwrapMeshes([quad(0, "left"), quad(2, "right")], {
      module: xatlas,
      size: 64
    });
    assert.equal(scene.litObjects.length, 2);
    assert.ok(scene.atlas.width > 0);
    assert.ok(scene.atlas.height > 0);
    assert.ok(scene.atlas.chartCount > 0);
    assert.ok(scene.atlas.utilization > 0);
    for (const object of scene.litObjects) {
      assert.equal(object.uvs.length, (object.positions.length / 3) * 2);
      for (const uv of object.uvs) assert.ok(uv >= 0 && uv < 1);
      assert.equal(object.triangleCount, 2);
    }
  } finally {
    xatlas.destroy?.();
  }
});

test("rejects invalid mesh input with a validation error", async () => {
  const xatlas = await createXAtlas();
  try {
    assert.throws(
      () => unwrapMeshes([{ ...quad(), normals: new Float32Array(0) }], { module: xatlas, size: 64 }),
      /normals must match positions/
    );
    assert.throws(
      () => unwrapMeshes([{ ...quad(), indices: new Uint32Array([0, 1, 99]) }], { module: xatlas, size: 64 }),
      /out of range/
    );
  } finally {
    xatlas.destroy?.();
  }
});

test("studio.unwrap runs without WebGL in Node", async () => {
  const studio = await createStudio();
  try {
    const scene = await studio.unwrap([quad()], { size: 32 });
    assert.equal(scene.litObjects.length, 1);
    assert.ok(scene.atlas.width > 0);
    assert.equal(scene.emissiveObjects.length, 0);
  } finally {
    studio.dispose();
  }
});

test("disposed studios reject unwrap", async () => {
  const studio = await createStudio();
  studio.dispose();
  studio.dispose();
  await assert.rejects(
    () => studio.unwrap([quad()], { size: 32 }),
    (error) => error instanceof StudioError && error.code === "disposed"
  );
});
