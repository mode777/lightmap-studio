import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createBakedMaterialSet, lightmapToRgbaBytes } from "../src/lib/lightmap.ts";

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

test("combined view keeps the albedo material and adds AO on TEXCOORD_1", () => {
  const albedoTexture = new THREE.Texture();
  albedoTexture.channel = 0;
  const aoTexture = new THREE.Texture();
  aoTexture.channel = 1;
  const source = new THREE.MeshStandardMaterial({
    color: 0x808080,
    map: albedoTexture,
    transparent: true,
    opacity: 0.75,
    side: THREE.DoubleSide
  });

  const set = createBakedMaterialSet(source, aoTexture);
  assert.ok(set.combined instanceof THREE.MeshBasicMaterial);
  assert.equal(set.combined.map, albedoTexture);
  assert.equal(set.combined.aoMap, aoTexture);
  assert.equal(set.combined.aoMapIntensity, 1);
  assert.equal(set.combined.color.getHex(), source.color.getHex());
  assert.equal(set.combined.side, THREE.DoubleSide);
  assert.equal(set.combined.transparent, true);
  assert.equal(set.combined.opacity, 0.75);
});

test("combined view mirrors material arrays", () => {
  const aoTexture = new THREE.Texture();
  aoTexture.channel = 1;
  const source = [
    new THREE.MeshStandardMaterial({ color: 0xff0000 }),
    new THREE.MeshStandardMaterial({ color: 0x00ff00 })
  ];
  const set = createBakedMaterialSet(source, aoTexture);
  assert.ok(Array.isArray(set.combined));
  assert.equal(set.combined.length, 2);
  assert.equal(set.combined[0].aoMap, aoTexture);
  assert.equal(set.combined[1].aoMap, aoTexture);
  assert.equal(set.combined[0].color.getHex(), source[0].color.getHex());
});
