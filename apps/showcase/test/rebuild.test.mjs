import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { extractMeshInputs } from "../src/lib/extract.ts";
import { rebuildBakedGeometry } from "../src/lib/rebuild.ts";

function fakePart(entry, partIndex) {
  const xref = Uint32Array.from(entry.input.indices);
  const vertexCount = xref.length;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i += 1) {
    const source = xref[i];
    for (let c = 0; c < 3; c += 1) {
      positions[i * 3 + c] = entry.input.positions[source * 3 + c];
      normals[i * 3 + c] = entry.input.normals[source * 3 + c];
    }
  }
  const uvs = new Float32Array(vertexCount * 2);
  for (let i = 0; i < vertexCount; i += 1) {
    uvs[i * 2] = 0.05 + partIndex * 0.1 + i * 0.001;
    uvs[i * 2 + 1] = 0.05 + i * 0.001;
  }
  return {
    entry,
    unwrapped: {
      name: entry.name,
      positions,
      normals,
      uvs,
      indices: Uint32Array.from({ length: vertexCount }, (_, index) => index),
      charts: new Uint32Array(vertexCount),
      xref,
      albedo: entry.input.albedo,
      triangleCount: vertexCount / 3,
      degenerateTriangleCount: 0,
      chartCount: 1
    }
  };
}

function quadGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(
      new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
      3
    )
  );
  geometry.setAttribute(
    "normal",
    new THREE.BufferAttribute(
      new Float32Array(12).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)),
      3
    )
  );
  geometry.setAttribute(
    "uv",
    new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2)
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.addGroup(0, 3, 0);
  geometry.addGroup(3, 3, 1);
  return geometry;
}

test("rebuild keeps multi-material groups and carries TEXCOORD_0 by xref", () => {
  const mesh = new THREE.Mesh(quadGeometry(), [
    new THREE.MeshStandardMaterial(),
    new THREE.MeshStandardMaterial()
  ]);
  mesh.name = "quad";
  const root = new THREE.Group();
  root.add(mesh);

  const entries = extractMeshInputs(root);
  assert.equal(entries.length, 2);
  const parts = entries.map((entry, index) => fakePart(entry, index));
  const geometry = rebuildBakedGeometry(parts, true);

  assert.equal(geometry.groups.length, 2);
  assert.deepEqual(
    geometry.groups.map((group) => [group.start, group.count, group.materialIndex]),
    [
      [0, 3, 0],
      [3, 3, 1]
    ]
  );

  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  const uv1 = geometry.getAttribute("uv1");
  const index = geometry.getIndex();
  assert.ok(position && uv && uv1 && index);
  assert.equal(position.count, 6);
  assert.equal(uv.count, position.count);
  assert.equal(uv1.count, position.count);
  assert.equal(index.count, 6);

  let vertexOffset = 0;
  for (const part of parts) {
    for (let i = 0; i < part.unwrapped.xref.length; i += 1) {
      const source = part.unwrapped.xref[i];
      const vertex = vertexOffset + i;
      assert.equal(uv1.getX(vertex), part.unwrapped.uvs[i * 2]);
      assert.equal(uv1.getY(vertex), part.unwrapped.uvs[i * 2 + 1]);
      // TEXCOORD_0 comes from the original source vertex, not from xatlas.
      assert.equal(uv.getX(vertex), entries[0].geometry.getAttribute("uv").getX(source));
      assert.equal(uv.getY(vertex), entries[0].geometry.getAttribute("uv").getY(source));
      assert.equal(position.getX(vertex), entries[0].geometry.getAttribute("position").getX(source));
    }
    vertexOffset += part.unwrapped.xref.length;
  }
  assert.ok(Math.max(...index.array) < position.count);
});

test("a single-material box stays one primitive with full uv1 coverage", () => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial()
  );
  mesh.name = "box";
  const root = new THREE.Group();
  root.add(mesh);

  const entries = extractMeshInputs(root);
  assert.equal(entries.length, 6); // BoxGeometry has one group per face.
  const parts = entries.map((entry, index) => fakePart(entry, index));
  const geometry = rebuildBakedGeometry(parts, false);

  const position = geometry.getAttribute("position");
  const uv1 = geometry.getAttribute("uv1");
  const index = geometry.getIndex();
  assert.equal(geometry.groups.length, 0);
  assert.ok(position && uv1 && index);
  assert.equal(uv1.count, position.count);
  assert.equal(index.count, 36);
  assert.ok(Math.max(...index.array) < position.count);
});
