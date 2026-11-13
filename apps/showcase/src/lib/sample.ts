/**
 * Procedural sample document: a small room interior - textured floor, three
 * walls, and boxes that contact the floor and walls. Occlusion between
 * different objects (boxes shading the floor, boxes against walls) is what
 * makes the scene-global bake visible. Used by the smoke test (generated at
 * test time - no binary fixtures in the repo) and by humans via a "Load
 * sample" action.
 */
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

export const SAMPLE_DOCUMENT_NAME = "sample-room.glb";

export function buildSampleScene(): THREE.Group {
  const group = new THREE.Group();
  group.name = "sample-room";

  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xb8b8b8 });
  const boxMaterial = new THREE.MeshStandardMaterial({ color: 0x707070 });

  // All geometry is solid (closed boxes): the lightmapper's occlusion pass
  // does not backface-cull, so open planes would shadow themselves.

  // Floor slab with a base-color texture (kept on TEXCOORD_0 through the bake).
  const floorGeometry = new THREE.BoxGeometry(8, 0.1, 8);
  const floor = new THREE.Mesh(
    floorGeometry,
    new THREE.MeshStandardMaterial({ map: sampleCheckerTexture(), color: 0xffffff })
  );
  floor.name = "floor";
  floor.position.set(0, -0.05, 0);
  group.add(floor);

  // Three walls, open at the front so the interior stays visible.
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 0.1), wallMaterial);
  backWall.name = "wall_back";
  backWall.position.set(0, 2, -4.05);
  group.add(backWall);

  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.1, 4, 8), wallMaterial.clone());
  leftWall.name = "wall_left";
  leftWall.position.set(-4.05, 2, 0);
  group.add(leftWall);

  const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.1, 4, 8), wallMaterial.clone());
  rightWall.name = "wall_right";
  rightWall.position.set(4.05, 2, 0);
  group.add(rightWall);

  // Contents: a pillar touching floor + back wall, a slab against the left
  // wall, and a low block on the floor. Cross-object contact shadows are the
  // point of the scene.
  const pillar = new THREE.Mesh(new THREE.BoxGeometry(1, 3, 1), boxMaterial.clone());
  pillar.name = "pillar";
  pillar.position.set(-1.5, 1.5, -3.4);
  group.add(pillar);

  const slab = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1, 1), boxMaterial.clone());
  slab.name = "slab";
  slab.position.set(-2.6, 0.5, 1);
  group.add(slab);

  const block = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 1.2), boxMaterial.clone());
  block.name = "block";
  block.position.set(1.6, 0.4, -2.2);
  group.add(block);

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
