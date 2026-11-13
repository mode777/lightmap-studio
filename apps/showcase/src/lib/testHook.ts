/**
 * Debug/test hook exposed as window.__showcase. It drives the smoke test
 * through the same code paths a human uses (ingest -> parse -> bake ->
 * export) and is harmless in interactive use.
 */
import type { DroppedFile } from "./drop.ts";
import { buildSampleGlbFile } from "./sample.ts";

export interface ShowcaseHookState {
  documents: string[];
  active: string | null;
  bakeStatus: string;
  displayMode: string;
  bakedMeshes: number;
  hasUv1: boolean;
  messages: string[];
  materials: Array<{ mesh: string; name: string; type: string; map: boolean; aoMap: boolean }>;
  bakeSettings: { atlasSize: number; quality: string; bounces: number };
  atlas: { width: number; height: number; chartCount: number; utilization: number } | null;
}

export interface ExportOutcome {
  name: string;
  bytes: Uint8Array;
}

export interface BakeOutcome {
  bakedMeshes: number;
  ao: { min: number; max: number; mean: number };
}

export interface ShowcaseHook {
  loadFiles(files: File[]): Promise<{ documents: string[]; skipped: string[] }>;
  bake(): Promise<BakeOutcome | { error: string }>;
  exportActiveDocument(): Promise<ExportOutcome | { error: string }>;
  generateSampleDocument(): Promise<File>;
  atlasDataUrl(): string | null;
  floorUvAtlasSamples(): { points: Array<{ u: number; v: number }>; values: number[] } | null;
  sampleFloorAoMap(
    points: Array<{ u: number; v: number }>
  ): number[] | { error: string; detail?: unknown };
  uvIntegrity(): {
    ok: boolean;
    issues: string[];
    meshes: Array<{
      name: string;
      vertexCount: number;
      uv1Count: number;
      indexMax: number;
      groups: number;
    }>;
  };
  debugLoadGlb(
    base64: string
  ): Promise<{
    materials?: Array<{ name: string; parent: string; type: string; aoMap: boolean; aoMapChannel?: number }>;
    occlusionInJson?: unknown;
    extensionsUsed?: string[];
    error?: string;
  }>;
  state(): ShowcaseHookState;
}

export interface HookInputs {
  ingestFiles(files: DroppedFile[]): Promise<{ documents: string[]; skipped: string[] }>;
  runBake(): Promise<BakeOutcome["ao"] | null>;
  runExport(): Promise<ExportOutcome | null>;
  loadSample(): Promise<void>;
  getHookState(): ShowcaseHookState;
  getAtlasDataUrl(): string | null;
  getFloorUvAtlasSamples(): { points: Array<{ u: number; v: number }>; values: number[] } | null;
  sampleFloorAoMap(
    points: Array<{ u: number; v: number }>
  ): number[] | { error: string; detail?: unknown };
  uvIntegrity(): {
    ok: boolean;
    issues: string[];
    meshes: Array<{
      name: string;
      vertexCount: number;
      uv1Count: number;
      indexMax: number;
      groups: number;
    }>;
  };
}

export function installTestHook(inputs: HookInputs): void {
  const win = window as typeof window & { __showcase?: ShowcaseHook };
  win.__showcase = {
    async loadFiles(files) {
      return inputs.ingestFiles(files.map((file) => ({ path: file.name, file })));
    },

    async bake() {
      const ao = await inputs.runBake();
      if (!ao) {
        return { error: `bake did not complete (status: ${inputs.getHookState().bakeStatus})` };
      }
      return { bakedMeshes: inputs.getHookState().bakedMeshes, ao };
    },

    async exportActiveDocument() {
      const outcome = await inputs.runExport();
      if (!outcome) return { error: "export produced no file (missing bake or export failure)" };
      return outcome;
    },

    generateSampleDocument: buildSampleGlbFile,

    atlasDataUrl: inputs.getAtlasDataUrl,
    floorUvAtlasSamples: inputs.getFloorUvAtlasSamples,
    sampleFloorAoMap: inputs.sampleFloorAoMap,
    uvIntegrity: inputs.uvIntegrity,

    async debugLoadGlb(base64) {
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const buffer = bytes.buffer;
      return new Promise((resolve) => {
        const loader = new GLTFLoader();
        loader.parse(
          buffer,
          "",
          (gltf) => {
            const json = (gltf.parser as unknown as { json: {
              materials: Array<Record<string, unknown>>;
              extensionsUsed?: string[];
            } }).json;
            const materials: Array<{
              name: string;
              parent: string;
              type: string;
              aoMap: boolean;
              aoMapChannel?: number;
            }> = [];
            gltf.scene.traverse((object) => {
              const mesh = object as { isMesh?: boolean; material?: unknown; parent?: { name?: string } };
              if (!mesh.isMesh) return;
              const material = mesh.material as {
                type?: string;
                aoMap?: { channel?: number } | null;
              };
              materials.push({
                name: (object as { name?: string }).name ?? "",
                parent: mesh.parent?.name ?? "",
                type: material.type ?? "?",
                aoMap: material.aoMap != null,
                aoMapChannel: material.aoMap?.channel
              });
            });
            resolve({
              materials,
              occlusionInJson: json.materials.map((material) => material.occlusionTexture ?? null),
              extensionsUsed: json.extensionsUsed
            });
          },
          (error) => resolve({ error: String(error) })
        );
      });
    },

    state: inputs.getHookState
  };
}
