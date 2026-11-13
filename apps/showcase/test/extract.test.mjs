import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { extractMeshInputs } from "../src/lib/extract.ts";

function triangleGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3)
  );
  geometry.setAttribute(
    "normal",
    new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3)
  );
  geometry.setIndex([0, 1, 2]);
  return geometry;
}

test("extractMeshInputs transforms positions into world space", () => {
  const root = new THREE.Group();
  const child = new THREE.Group();
  child.position.set(0, 5, 0);
  child.rotation.y = Math.PI / 2;
  const mesh = new THREE.Mesh(triangleGeometry(), new THREE.MeshStandardMaterial());
  mesh.name = "wall";
  child.add(mesh);
  root.add(child);

  const entries = extractMeshInputs(root);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, "wall");
  // (0,0,0) rotated by pi/2 around Y: (0,0,-0)... x axis maps to -z; plus y offset 5.
  const positions = entries[0].input.positions;
  assert.ok(Math.abs(positions[0]) < 1e-6);
  assert.equal(positions[1], 5);
  assert.ok(Math.abs(positions[2]) < 1e-6);
  assert.ok(Math.abs(positions[3] - 0) < 1e-6 || Math.abs(positions[3]) < 1e-6);
});

test("extractMeshInputs skips non-triangle objects and invisible meshes", () => {
  const root = new THREE.Group();
  root.add(new THREE.Line(triangleGeometry()));
  root.add(new THREE.Points(triangleGeometry()));
  const hidden = new THREE.Mesh(triangleGeometry(), new THREE.MeshStandardMaterial());
  hidden.visible = false;
  root.add(hidden);
  root.add(new THREE.Mesh(triangleGeometry(), new THREE.MeshStandardMaterial()));

  const entries = extractMeshInputs(root);
  assert.equal(entries.length, 1);
});

test("extractMeshInputs keeps one entry per mesh using a shared geometry", () => {
  const shared = triangleGeometry();
  const root = new THREE.Group();
  root.add(new THREE.Mesh(shared, new THREE.MeshStandardMaterial()));
  root.add(new THREE.Mesh(shared, new THREE.MeshStandardMaterial()));

  const entries = extractMeshInputs(root);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].geometry, entries[1].geometry);
  assert.notEqual(entries[0].input.positions, entries[1].input.positions);
});

test("extractMeshInputs splits multi-material groups into separate primitives", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]), 3)
  );
  geometry.setAttribute(
    "normal",
    new THREE.BufferAttribute(new Float32Array(12).fill(1), 3)
  );
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  geometry.addGroup(0, 3, 0);
  geometry.addGroup(3, 3, 1);

  const root = new THREE.Group();
  const mesh = new THREE.Mesh(
    geometry,
    [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()]
  );
  mesh.name = "multi";
  root.add(mesh);

  const entries = extractMeshInputs(root);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, "multi[0]");
  assert.equal(entries[1].name, "multi[1]");
  assert.deepEqual(Array.from(entries[0].input.indices), [0, 1, 2]);
  assert.deepEqual(Array.from(entries[1].input.indices), [2, 1, 3]);
});

test("extractMeshInputs computes normals when geometry has none", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3)
  );
  geometry.setIndex([0, 1, 2]);
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));

  const entries = extractMeshInputs(root);
  assert.equal(entries.length, 1);
  const normals = entries[0].input.normals;
  const length = Math.hypot(normals[0], normals[1], normals[2]);
  assert.ok(Math.abs(length - 1) < 1e-5, `expected unit normal, got length ${length}`);
});

test("extractMeshInputs reports triangle counts via indices length", () => {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(triangleGeometry(), new THREE.MeshStandardMaterial()));
  const entries = extractMeshInputs(root);
  assert.equal(entries[0].input.indices.length, 3);
  assert.equal(typeof entries[0].input.albedo, "object");
});
