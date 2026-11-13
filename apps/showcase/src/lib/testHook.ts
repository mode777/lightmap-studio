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
  bakeSettings: { atlasSize: number; quality: string };
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
  state(): ShowcaseHookState;
}

export interface HookInputs {
  ingestFiles(files: DroppedFile[]): Promise<{ documents: string[]; skipped: string[] }>;
  runBake(): Promise<BakeOutcome["ao"] | null>;
  runExport(): Promise<ExportOutcome | null>;
  loadSample(): Promise<void>;
  getHookState(): ShowcaseHookState;
  getAtlasDataUrl(): string | null;
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

    state: inputs.getHookState
  };
}
