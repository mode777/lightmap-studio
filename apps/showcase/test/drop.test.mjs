import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFileTree,
  classifyFileName,
  extensionOf,
  stemOf
} from "../src/lib/drop.ts";

function file(name) {
  return new File([""], name, { type: "application/octet-stream" });
}

function dropped(path) {
  return { path, file: file(path.split("/").pop()) };
}

test("classifyFileName sorts documents, parts and unsupported entries", () => {
  assert.equal(classifyFileName("scene.glb"), "document");
  assert.equal(classifyFileName("scene.gltf"), "document");
  assert.equal(classifyFileName("buffers/scene.BIN"), "part");
  assert.equal(classifyFileName("textures/wall.png"), "part");
  assert.equal(classifyFileName("photo.JPG"), "part");
  assert.equal(classifyFileName("notes.txt"), "unsupported");
  assert.equal(classifyFileName("noextension"), "unsupported");
});

test("extensionOf and stemOf handle dotted names", () => {
  assert.equal(extensionOf("a.b.glb"), "glb");
  assert.equal(extensionOf("noext"), "");
  assert.equal(stemOf("room.west.gltf"), "room.west");
  assert.equal(stemOf("dir/scene.bin"), "scene");
});

test("buildFileTree groups parts under the longest matching document stem", () => {
  const files = [
    dropped("scene.gltf"),
    dropped("scene.bin"),
    dropped("scene_basecolor.png"),
    dropped("roomwest.gltf"),
    dropped("roomwest_normal.webp"),
    dropped("unrelated.jpg")
  ];
  const tree = buildFileTree(files);
  const documents = tree.filter((entry) => entry.kind === "document");
  const groups = tree.filter((entry) => entry.kind === "group");

  assert.equal(documents.length, 2);
  const scene = documents.find((entry) => entry.name === "scene.gltf");
  const roomwest = documents.find((entry) => entry.name === "roomwest.gltf");
  assert.deepEqual(scene.parts.map((part) => part.name), ["scene.bin", "scene_basecolor.png"]);
  assert.deepEqual(roomwest.parts.map((part) => part.name), ["roomwest_normal.webp"]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, "Supporting files");
  assert.deepEqual(groups[0].parts.map((part) => part.name), ["unrelated.jpg"]);
});

test("buildFileTree keeps document files attached and tolerates empty input", () => {
  assert.deepEqual(buildFileTree([]), []);
  const tree = buildFileTree([dropped("model.glb")]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].kind, "document");
  assert.deepEqual(tree[0].parts, []);
});

test("buildFileTree yields only supporting files when no document was dropped", () => {
  const tree = buildFileTree([dropped("buffers/geometry.bin")]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].kind, "group");
  assert.equal(tree[0].parts[0].path, "buffers/geometry.bin");
});

test("DroppedFile typing round-trips through tree building", () => {
  const entry = dropped("a/b/c.glb");
  assert.equal(entry.path, "a/b/c.glb");
});
