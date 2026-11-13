/**
 * Bake result application: float lightmap -> 8-bit canvas texture, atlas UVs
 * -> uv1 attribute, aoMap -> baked materials. Orientation contract:
 *
 * - The library's lightmap UVs put v=0 at array row 0 (its display recipe
 *   uses a DataTexture, whose default flipY is false).
 * - Preview therefore uses a canvas texture with flipY = false.
 * - GLTFExporter flips image rows at encode time when texture.flipY is true
 *   (verified in GLTFExporter.processImage), which is exactly what glTF
 *   viewers need for these UVs. The flipY=true export texture is only
 *   attached while an export is running (see exporter.ts).
 */
import * as THREE from "three";
import type { StudioResult } from "lightmap-studio";
import type { ExtractedEntry } from "./extract.ts";

/** Clamp a radiance sample to displayable 0..255 bytes (AO is 0..1). */
export function lightmapToRgbaBytes(lightmap: Float32Array): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(lightmap.length);
  for (let texel = 0; texel < lightmap.length; texel += 4) {
    const value = Math.min(1, Math.max(0, lightmap[texel] ?? 0)) * 255;
    out[texel] = value;
    out[texel + 1] = value;
    out[texel + 2] = value;
    // Opaque alpha avoids premultiplication loss in the 2D canvas pipeline.
    out[texel + 3] = 255;
  }
  return out;
}

export function lightmapToCanvas(
  lightmap: Float32Array,
  width: number,
  height: number
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas is unavailable for lightmap encoding");
  context.putImageData(new ImageData(lightmapToRgbaBytes(lightmap), width, height), 0, 0);
  return canvas;
}

function configureTexture(texture: THREE.CanvasTexture): THREE.CanvasTexture {
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.channel = 1;
  return texture;
}

export interface BakedTextures {
  /** flipY=false; samples array row 0 at v=0, matching the studio UVs. */
  preview: THREE.CanvasTexture;
  /** flipY=true; GLTFExporter flips rows at encode for glTF viewers. */
  export: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
}

export interface AppliedBake {
  textures: BakedTextures;
  bakedMeshCount: number;
}

/**
 * Write the bake result back onto the scene: atlas UVs to `uv1`, per-mesh
 * material clones carrying the baked AO texture in userData (the viewport
 * assigns aoMap according to the display mode). Geometries shared by several
 * baked meshes are cloned per mesh so each gets its own atlas UVs; materials
 * are cloned per mesh so AO never leaks across objects.
 */
export function applyBakeResult(entries: ExtractedEntry[], result: StudioResult): AppliedBake {
  const canvas = lightmapToCanvas(result.lightmap, result.width, result.height);
  const preview = configureTexture(new THREE.CanvasTexture(canvas));
  preview.flipY = false;
  const exportTexture = configureTexture(new THREE.CanvasTexture(canvas));
  exportTexture.flipY = true;

  const litObjects = result.scene.litObjects;
  if (litObjects.length !== entries.length) {
    throw new Error(
      `bake returned ${litObjects.length} lit objects for ${entries.length} extracted meshes`
    );
  }

  // Group entries by source geometry to detect sharing.
  const byGeometry = new Map<THREE.BufferGeometry, number>();
  for (const entry of entries) {
    byGeometry.set(entry.geometry, (byGeometry.get(entry.geometry) ?? 0) + 1);
  }

  entries.forEach((entry, index) => {
    const litObject = litObjects[index];
    if (!litObject) throw new Error(`bake result is missing lit object ${index}`);
    if ((byGeometry.get(entry.geometry) ?? 0) > 1) {
      entry.mesh.geometry = entry.geometry.clone();
    }
    entry.mesh.geometry.setAttribute(
      "uv1",
      new THREE.BufferAttribute(new Float32Array(litObject.uvs), 2)
    );

    const materialOrList = entry.mesh.material;
    if (Array.isArray(materialOrList)) {
      entry.mesh.material = materialOrList.map((material) => withAoTexture(material, preview));
    } else {
      entry.mesh.material = withAoTexture(materialOrList, preview);
    }
  });

  return { textures: { preview, export: exportTexture, canvas }, bakedMeshCount: entries.length };
}

function withAoTexture(
  material: THREE.Material,
  texture: THREE.CanvasTexture
): THREE.MeshStandardMaterial {
  const clone = material.clone() as THREE.MeshStandardMaterial;
  clone.userData.aoTexture = texture;
  clone.aoMap = texture;
  clone.aoMapIntensity = 1;
  clone.needsUpdate = true;
  return clone;
}

/** True for materials this app prepared with a baked AO texture. */
export function hasBakedAo(material: THREE.Material): material is THREE.MeshStandardMaterial {
  return material instanceof THREE.MeshStandardMaterial && material.userData.aoTexture != null;
}
