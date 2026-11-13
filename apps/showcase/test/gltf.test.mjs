import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findUnsupportedExtension,
  inspectGlb,
  inspectGltfJson
} from "../src/lib/gltf.ts";

function glbContainer(jsonText) {
  const jsonBytes = new TextEncoder().encode(jsonText);
  // Header (12 bytes) + chunk header (8 bytes) + JSON chunk, 4-byte padded.
  const padding = (4 - (jsonBytes.length % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + padding;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true); // magic 'glTF'
  view.setUint32(4, 2, true); // version
  view.setUint32(8, total, true); // total length
  view.setUint32(12, jsonBytes.length, true); // chunk length
  view.setUint32(16, 0x4e4f534a, true); // chunk type 'JSON'
  new Uint8Array(buffer, 20).set(jsonBytes);
  return new Uint8Array(buffer);
}

test("findUnsupportedExtension names the first unsupported compression extension", () => {
  assert.equal(findUnsupportedExtension([]), null);
  assert.equal(findUnsupportedExtension(["KHR_materials_unlit"]), null);
  assert.equal(
    findUnsupportedExtension(["KHR_materials_unlit", "KHR_draco_mesh_compression"]),
    "KHR_draco_mesh_compression"
  );
  assert.equal(findUnsupportedExtension(["EXT_meshopt_compression"]), "EXT_meshopt_compression");
  assert.equal(findUnsupportedExtension(["KHR_texture_basisu"]), "KHR_texture_basisu");
});

test("inspectGlb reads extensionsUsed from the JSON chunk", () => {
  const summary = inspectGlb(glbContainer(JSON.stringify({ asset: {}, extensionsUsed: ["KHR_texture_basisu"] })));
  assert.deepEqual(summary.extensionsUsed, ["KHR_texture_basisu"]);
});

test("inspectGlb rejects non-GLB bytes with a clear error", () => {
  assert.throws(() => inspectGlb(new Uint8Array([1, 2, 3])), /not a valid GLB/);
  assert.throws(
    () => inspectGlb(glbContainer("{broken")),
    /not valid JSON/
  );
});

test("inspectGltfJson tolerates missing extensionsUsed", () => {
  const summary = inspectGltfJson(JSON.stringify({ asset: { version: "2.0" } }));
  assert.deepEqual(summary.extensionsUsed, []);
});
