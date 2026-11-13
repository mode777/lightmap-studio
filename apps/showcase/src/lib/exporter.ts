/**
 * glTF export: serialize the document with the baked AO attached. Regardless
 * of the current display mode, the PBR baked material set is attached for the
 * duration of the parse so every baked material carries its occlusionTexture
 * (sampled on TEXCOORD_1, one shared scene-global atlas). The texture is
 * stored unflipped - see lightmap.ts for the orientation contract.
 * TEXCOORD_0 and base color are untouched.
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
  sourceName: string
): Promise<ExportResult> {
  const restores = attachBakedMaterials(root);
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

function attachBakedMaterials(root: THREE.Object3D): Array<() => void> {
  const restores: Array<() => void> = [];
  root.traverse((object) => {
    const set = object instanceof THREE.Mesh ? bakedMaterialsOf(object) : null;
    // The baked material set is app-internal bookkeeping; GLTFExporter would
    // serialize it into glTF extras (JSON.stringify of userData), producing
    // junk that breaks disposal on reimport. Strip it for the parse.
    const baked = object.userData.bakedMaterials;
    if (baked !== undefined) {
      delete object.userData.bakedMaterials;
      restores.push(() => {
        object.userData.bakedMaterials = baked;
      });
    }
    if (!(object instanceof THREE.Mesh) || !set) return;
    const previousMaterial = object.material;
    object.material = set.ao;
    restores.push(() => {
      object.material = previousMaterial;
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
