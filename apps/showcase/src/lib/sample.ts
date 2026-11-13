/**
 * Procedural sample document: a ground plane with a floating occluder box.
 * Used by the smoke test (generated at test time - no binary fixtures in the
 * repo) and by humans via a "Load sample" action. The floor chart under the
 * occluder must bake darker than the open half, which doubles as a live
 * orientation probe.
 */
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

export const SAMPLE_DOCUMENT_NAME = "sample-scene.glb";

export function buildSampleScene(): THREE.Group {
  const group = new THREE.Group();
  group.name = "sample-scene";

  const texture = sampleCheckerTexture();

  const floorGeometry = new THREE.PlaneGeometry(4, 4);
  floorGeometry.rotateX(-Math.PI / 2);
  const floor = new THREE.Mesh(
    floorGeometry,
    new THREE.MeshStandardMaterial({ map: texture, color: 0xffffff })
  );
  floor.name = "floor";
  group.add(floor);

  const occluder = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  occluder.name = "occluder";
  occluder.position.set(-1, 1, 0);
  group.add(occluder);

  return group;
}

function sampleCheckerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 2;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas unavailable");
  context.fillStyle = "#d0d0d0";
  context.fillRect(0, 0, 2, 2);
  context.fillStyle = "#808080";
  context.fillRect(0, 0, 1, 1);
  context.fillRect(1, 1, 1, 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export async function buildSampleGlbFile(): Promise<File> {
  const exporter = new GLTFExporter();
  const glb = (await exporter.parseAsync(buildSampleScene(), { binary: true })) as ArrayBuffer;
  return new File([glb], SAMPLE_DOCUMENT_NAME, { type: "model/gltf-binary" });
}
