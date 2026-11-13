/**
 * Bake result application: float lightmap -> 8-bit canvas texture, unwrapped
 * geometry -> one mesh per source object, per-mesh material variants for
 * display and export. Orientation contract:
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
import type { StudioResult, UnwrappedScene } from "lightmap-studio";
import type { ExtractedEntry } from "./extract.ts";
import { rebuildBakedGeometry, type BakedPart } from "./rebuild.ts";

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
  // Selects TEXCOORD_1 for both the viewport material and the exported
  // occlusionTexture texCoord.
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
  /** Unlit albedo * AO display material(s). */
  combined: THREE.Material | THREE.Material[];
}

export interface AppliedBake {
  textures: BakedTextures;
  /** Unwrapped geometry layout, used by the atlas inspector. */
  scene: UnwrappedScene;
  /** Number of source meshes that received baked AO. */
  bakedMeshCount: number;
}

function materialsOf(material: THREE.Material | THREE.Material[]): THREE.Material[] {
  return Array.isArray(material) ? material : [material];
}

interface VisualMaterial {
  color?: THREE.Color;
  map?: THREE.Texture | null;
  alphaMap?: THREE.Texture | null;
  vertexColors?: boolean;
}

/**
 * Unlit albedo * AO. MeshBasicMaterial supports both `map` (TEXCOORD_0) and
 * `aoMap` (TEXCOORD_1), so the shader gives us the product without custom GLSL.
 */
function toCombinedView(material: THREE.Material, texture: THREE.CanvasTexture): THREE.MeshBasicMaterial {
  const source = material as THREE.Material & VisualMaterial;
  const combined = new THREE.MeshBasicMaterial({
    color: source.color ? source.color.clone() : 0xffffff,
    map: source.map ?? null,
    alphaMap: source.alphaMap ?? null,
    vertexColors: source.vertexColors ?? false,
    transparent: material.transparent,
    opacity: material.opacity,
    alphaTest: material.alphaTest,
    side: material.side,
    depthTest: material.depthTest,
    depthWrite: material.depthWrite,
    aoMap: texture,
    aoMapIntensity: 1
  });
  combined.name = `${material.name} (albedo + AO)`;
  combined.toneMapped = material.toneMapped;
  return combined;
}

export function createBakedMaterialSet(
  albedo: THREE.Material | THREE.Material[],
  texture: THREE.CanvasTexture
): BakedMaterialSet {
  const toAo = (material: THREE.Material): THREE.Material => {
    const clone = material.clone() as THREE.MeshStandardMaterial;
    clone.aoMap = texture;
    clone.aoMapIntensity = 1;
    clone.needsUpdate = true;
    return clone;
  };
  const toAoView = (): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ map: texture });
  const ao = Array.isArray(albedo) ? albedo.map(toAo) : toAo(albedo);
  const aoView = Array.isArray(albedo) ? albedo.map(toAoView) : toAoView();
  const combined = Array.isArray(albedo)
    ? albedo.map((material) => toCombinedView(material, texture))
    : toCombinedView(albedo, texture);
  return { albedo, ao, aoView, combined };
}

/**
 * Write the bake result back onto the scene. Each source mesh gets ONE rebuilt
 * geometry assembled from its baked primitives (see rebuild.ts): xatlas may
 * duplicate seam vertices, so its UVs cannot be indexed by the source
 * geometry's index buffer. Primitives keep their material groups; single
 * material meshes stay a single glTF primitive.
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

  // Group the per-primitive bake results by their source mesh, preserving the
  // traversal/group order used for material indices.
  const partsByMesh = new Map<THREE.Mesh, BakedPart[]>();
  entries.forEach((entry, index) => {
    const unwrapped = litObjects[index];
    if (!unwrapped) throw new Error(`bake result is missing lit object ${index}`);
    const part: BakedPart = { entry, unwrapped };
    const parts = partsByMesh.get(entry.mesh);
    if (parts) parts.push(part);
    else partsByMesh.set(entry.mesh, [part]);
  });

  const oldTextures = new Set<THREE.Texture>();
  let bakedMeshCount = 0;

  for (const [mesh, parts] of partsByMesh) {
    const previous = bakedMaterialsOf(mesh);
    const albedo = previous?.albedo ?? mesh.material;
    const multiMaterial = Array.isArray(albedo);
    const sourceGeometry = parts[0]!.entry.geometry;
    const previousGeometry = mesh.geometry;

    mesh.geometry = rebuildBakedGeometry(parts, multiMaterial);
    // On a re-bake the active geometry is the previous rebuilt one; the
    // original source geometry stays alive on the entry for the next bake.
    if (previous && previousGeometry !== sourceGeometry) previousGeometry.dispose();

    const set = createBakedMaterialSet(albedo, texture);
    mesh.userData.bakedMaterials = set;
    mesh.material = set.combined;

    if (previous) {
      for (const material of materialsOf(previous.ao)) material.dispose();
      for (const material of materialsOf(previous.aoView)) material.dispose();
      for (const material of materialsOf(previous.combined)) material.dispose();
      for (const material of materialsOf(previous.aoView)) {
        if (material instanceof THREE.MeshBasicMaterial && material.map) {
          oldTextures.add(material.map);
        }
      }
    }
    bakedMeshCount += 1;
  }

  // Disposing the texture after the old materials keeps disposal idempotent
  // when a rebake replaced the shared atlas.
  for (const old of oldTextures) old.dispose();

  return { textures: { texture, canvas }, scene: result.scene, bakedMeshCount };
}

/** The baked material set attached to a mesh, if any. */
export function bakedMaterialsOf(mesh: THREE.Mesh): BakedMaterialSet | null {
  return (mesh.userData.bakedMaterials as BakedMaterialSet | undefined) ?? null;
}
