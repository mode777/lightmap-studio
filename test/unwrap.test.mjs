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

test("atlas padding is configurable and validated", async () => {
  const xatlas = await createXAtlas();
  try {
    const scene = unwrapMeshes([quad()], { module: xatlas, size: 64, padding: 8 });
    assert.equal(scene.atlas.padding, 8);
    assert.equal(scene.litObjects[0].uvs.length, (scene.litObjects[0].positions.length / 3) * 2);
    assert.throws(
      () => unwrapMeshes([quad()], { module: xatlas, size: 64, padding: -1 }),
      /atlas padding/
    );
    assert.throws(
      () => unwrapMeshes([quad()], { module: xatlas, size: 64, padding: 65 }),
      /atlas padding/
    );
  } finally {
    xatlas.destroy?.();
  }
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
      assert.equal(object.xref.length, object.positions.length / 3);
      for (const uv of object.uvs) assert.ok(uv >= 0 && uv < 1);
      assert.equal(object.triangleCount, 2);
    }
    // xref points back at the source vertex, so per-vertex input data can be
    // carried onto the unwrapped mesh.
    const left = scene.litObjects[0];
    const source = quad(0, "left");
    for (let i = 0; i < left.xref.length; i += 1) {
      const sourceVertex = left.xref[i];
      assert.deepEqual(
        [left.positions[i * 3], left.positions[i * 3 + 1], left.positions[i * 3 + 2]],
        [
          source.positions[sourceVertex * 3],
          source.positions[sourceVertex * 3 + 1],
          source.positions[sourceVertex * 3 + 2]
        ]
      );
    }
  } finally {
    xatlas.destroy?.();
  }
});

test("drops triangles xatlas leaves uncharted instead of failing the bake", async () => {
  const xatlas = await createXAtlas();
  try {
    const normals = (count) =>
      new Float32Array(count * 3).fill(0).map((_, index) => (index % 3 === 2 ? 1 : 0));
    const zeroArea = {
      name: "zero-area",
      positions: new Float32Array([
        0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
        // Duplicate position: the third triangle has zero 3D area.
        1, 0, 0
      ]),
      normals: normals(5),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3, 0, 1, 4])
    };
    const tiny = {
      name: "tiny",
      positions: new Float32Array([
        0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
        // Valid but too small for xatlas to give it a chart at this resolution.
        10, 0, 0, 10.00001, 0, 0, 10, 0.00001, 0
      ]),
      normals: normals(7),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6])
    };

    const scene = unwrapMeshes([zeroArea, tiny], { module: xatlas, size: 64 });
    assert.equal(scene.litObjects.length, 2);
    for (const object of scene.litObjects) {
      assert.equal(object.degenerateTriangleCount, 1);
      assert.equal(object.triangleCount, 2);
      assert.equal(object.indices.length, 6);
      for (let i = 0; i < object.indices.length; i += 1) {
        assert.notEqual(object.charts[object.indices[i]], 0xffffffff);
      }
      for (let i = 0; i < object.indices.length; i += 3) {
        const a = object.indices[i] * 2;
        const b = object.indices[i + 1] * 2;
        const c = object.indices[i + 2] * 2;
        const area = Math.abs(
          (object.uvs[b] - object.uvs[a]) * (object.uvs[c + 1] - object.uvs[a + 1]) -
            (object.uvs[c] - object.uvs[a]) * (object.uvs[b + 1] - object.uvs[a + 1])
        ) * 0.5;
        assert.ok(area > 0, `${object.name}: kept UV triangle ${i / 3} has area ${area}`);
      }
    }
  } finally {
    xatlas.destroy?.();
  }
});

test("rejects a mesh whose triangles are all uncharted", async () => {
  const xatlas = await createXAtlas();
  try {
    const valid = quad(0, "valid");
    const allDegenerate = {
      name: "all-degenerate",
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2])
    };
    assert.throws(
      () => unwrapMeshes([valid, allDegenerate], { module: xatlas, size: 64 }),
      /left all 1 triangles uncharted/
    );
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
