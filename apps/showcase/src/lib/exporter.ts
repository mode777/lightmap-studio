/**
 * glTF export: serialize the document with the baked AO attached. Regardless
 * of the current display mode, the PBR baked material set is attached for the
 * duration of the parse, with the flipY export texture in place of the
 * preview texture; GLTFExporter then flips image rows at encode so the
 * written image matches glTF's sampling of these UVs. TEXCOORD_0 and base
 * color are untouched. The bake is scene-global (the lightmapper's
 * hemisphere pass occludes against the whole scene), stored in one shared
 * atlas referenced by every baked material's occlusionTexture.
 */
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { bakedMaterialsOf, type BakedMaterialSet } from "./lightmap.ts";

export function exportFileName(sourceName: string): string {
  const stem = sourceName.replace(/\.(glb|gltf)$/i, "");
  const extension = /\.gltf$/i.test(sourceName) ? "gltf" : "glb";
  return `${stem}.ao.${extension}`;
}

export interface ExportResult {
  name: string;
  bytes: Uint8Array;
}

export async function exportDocument(
  root: THREE.Object3D,
  sourceName: string,
  exportTexture: THREE.Texture,
  previewTexture: THREE.Texture
): Promise<ExportResult> {
  const restores = attachBakedMaterials(root, exportTexture, previewTexture);
  const binary = !/\.gltf$/i.test(sourceName);
  try {
    const exporter = new GLTFExporter();
    const result = await exporter.parseAsync(root, { binary });
    const bytes = binary
      ? new Uint8Array(result as ArrayBuffer)
      : new TextEncoder().encode(JSON.stringify(result));
    return { name: exportFileName(sourceName), bytes };
  } finally {
    for (const restore of restores) restore();
  }
}

function attachBakedMaterials(
  root: THREE.Object3D,
  exportTexture: THREE.Texture,
  previewTexture: THREE.Texture
): Array<() => void> {
  const restores: Array<() => void> = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const set = bakedMaterialsOf(object);
    if (!set) return;
    const previousMaterial = object.material;
    object.material = set.ao;
    // Every standard material in the baked set points at the flipY=true
    // texture for the encode run.
    const aoMaterials: THREE.MeshStandardMaterial[] = (
      Array.isArray(set.ao) ? set.ao : [set.ao]
    ) as THREE.MeshStandardMaterial[];
    const previousAoMaps = aoMaterials.map((material) => material.aoMap);
    for (const material of aoMaterials) {
      material.aoMap = exportTexture;
      material.needsUpdate = true;
    }
    restores.push(() => {
      object.material = previousMaterial;
      aoMaterials.forEach((material, index) => {
        material.aoMap = previousAoMaps[index] ?? previewTexture;
        material.needsUpdate = true;
      });
    });
  });
  return restores;
}

export function downloadResult(result: ExportResult): void {
  const mime = result.name.endsWith(".gltf") ? "model/gltf+json" : "model/gltf-binary";
  // Both producers hand back a Uint8Array spanning its whole buffer.
  const blob = new Blob([result.bytes.buffer as ArrayBuffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = result.name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export type { BakedMaterialSet };
