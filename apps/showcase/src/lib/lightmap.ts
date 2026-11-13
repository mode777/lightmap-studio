/**
 * Bake result application: float lightmap -> 8-bit canvas texture, atlas UVs
 * -> uv1 attribute, per-mesh material variants for display and export.
 * Orientation contract:
 *
 * - The studio's lightmap UVs put v=0 at array row 0 (its display recipe uses
 *   a DataTexture, whose default flipY is false).
 * - glTF 2.0 defines uv origin at the top-left of the stored image (spec:
 *   "the texture coordinate value of (0.0, 0.0) points to the beginning of
 *   the first (upper-left) image pixel"), and GLTFLoader loads textures with
 *   flipY = false - so glTF space and our UV space agree, provided the
 *   exported image is stored unflipped.
 * - One flipY=false canvas texture therefore serves both the viewport and
 *   the export; GLTFExporter would only flip rows if texture.flipY were true,
 *   which vertically mirrors the baked AO in viewers (verified in
 *   GLTFExporter.processImage) - that bug shipped once and is pinned by the
 *   smoke's orientation round trip (export -> reimport -> pixel compare).
 *
 * Display modes live on the mesh's userData (bakedMaterials):
 * - albedo: the original material
 * - ao: an unlit MeshBasicMaterial showing the raw baked occlusion directly.
 *   PBR aoMap only attenuates ambient light, which is invisible under strong
 *   direct lighting - the showcase shows the occlusion itself instead.
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
  /**
   * flipY=false everywhere. Orientation contract: the studio's lightmap UVs
   * put v=0 at array row 0 (its own display recipe uses a DataTexture with
   * flipY=false), and the glTF 2.0 convention is v=0 at the top row of the
   * stored image with GLTFLoader loading textures at flipY=false. So the
   * SAME unflipped texture is correct for viewport preview and for export -
   * GLTFExporter only flips rows when texture.flipY is true, which must NOT
   * happen here (verified in GLTFExporter.processImage).
   */
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
}

export interface BakedMaterialSet {
  /** The original material as loaded (possibly an array). */
  albedo: THREE.Material | THREE.Material[];
  /** PBR clone(s) carrying aoMap; the export source (possibly an array). */
  ao: THREE.Material | THREE.Material[];
  /** Unlit raw-AO display material(s). */
  aoView: THREE.Material | THREE.Material[];
}

export interface AppliedBake {
  textures: BakedTextures;
  bakedMeshCount: number;
}

/**
 * Write the bake result back onto the scene: atlas UVs to `uv1` and a
 * per-mesh material set on userData. Geometries shared by several baked
 * meshes are cloned per mesh so each gets its own atlas UVs; materials are
 * cloned per mesh so nothing leaks across objects.
 */
export function applyBakeResult(entries: ExtractedEntry[], result: StudioResult): AppliedBake {
  const canvas = lightmapToCanvas(result.lightmap, result.width, result.height);
  const texture = configureTexture(new THREE.CanvasTexture(canvas));
  texture.flipY = false;

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

    const albedo = entry.mesh.material;
    const toStandard = (material: THREE.Material): THREE.MeshStandardMaterial => {
      const clone = material.clone() as THREE.MeshStandardMaterial;
      clone.aoMap = texture;
      clone.aoMapIntensity = 1;
      clone.needsUpdate = true;
      return clone;
    };
    const ao = Array.isArray(albedo) ? albedo.map(toStandard) : toStandard(albedo);
    const toAoView = (): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ map: texture });
    const aoView = Array.isArray(albedo) ? albedo.map(toAoView) : toAoView();
    const set: BakedMaterialSet = { albedo, ao, aoView };
    entry.mesh.userData.bakedMaterials = set;
    entry.mesh.material = aoView;
  });

  return { textures: { texture, canvas }, bakedMeshCount: entries.length };
}

/** The baked material set attached to a mesh, if any. */
export function bakedMaterialsOf(mesh: THREE.Mesh): BakedMaterialSet | null {
  return (mesh.userData.bakedMaterials as BakedMaterialSet | undefined) ?? null;
}
