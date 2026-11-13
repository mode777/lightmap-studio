/**
 * glTF export: serialize the document with the baked AO attached. The flipY
 * export texture replaces the preview texture on baked materials for the
 * duration of the parse; GLTFExporter then flips image rows at encode so the
 * written image matches glTF's sampling of these UVs. TEXCOORD_0 and base
 * color are untouched.
 */
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { hasBakedAo } from "./lightmap.ts";

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
  exportTexture: THREE.Texture
): Promise<ExportResult> {
  const restores = attachExportTexture(root, exportTexture);
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

function attachExportTexture(root: THREE.Object3D, exportTexture: THREE.Texture): Array<() => void> {
  const restores: Array<() => void> = [];
  const seen = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (seen.has(material) || !hasBakedAo(material)) continue;
      seen.add(material);
      const previous = material.aoMap;
      material.aoMap = exportTexture;
      material.needsUpdate = true;
      restores.push(() => {
        material.aoMap = previous;
        material.needsUpdate = true;
      });
    }
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
