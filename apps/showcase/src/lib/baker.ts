/**
 * Bake orchestration: capability preflight (before any lightmapper asset is
 * fetched - a library invariant), one studio instance for the app lifetime,
 * and the AO bake invocation (uniform sky, zero ambient, one bounce).
 */
import {
  createStudio,
  StudioError,
  type QualityPreset,
  type Studio,
  type StudioProgress,
  type StudioResult
} from "lightmap-studio";
import type { ExtractedEntry } from "./extract.ts";
import { uniformSkyEnvironment } from "./sky.ts";

let studioPromise: Promise<Studio> | null = null;

export function getStudio(): Promise<Studio> {
  studioPromise ??= createStudio();
  return studioPromise;
}

export interface CapabilityCheck {
  ok: boolean;
  message?: string;
}

/**
 * Probe WebGL2 + EXT_color_buffer_float before ever requesting
 * lightmapper.wasm. createStudio() fetches nothing, so this is the only
 * capability gate the UI needs.
 */
export function checkBakeCapabilities(): CapabilityCheck {
  if (typeof document === "undefined") {
    return { ok: false, message: "Baking requires a browser environment." };
  }
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: true });
  if (!gl) {
    return { ok: false, message: "WebGL2 is unavailable in this browser. Baking is disabled." };
  }
  if (!gl.getExtension("EXT_color_buffer_float")) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return {
      ok: false,
      message: "EXT_color_buffer_float is unavailable. Baking is disabled; the viewport still works."
    };
  }
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return { ok: true };
}

export interface BakeSettings {
  atlasSize: number;
  quality: QualityPreset;
}

export interface BakeRunOptions {
  settings: BakeSettings;
  signal?: AbortSignal;
  onProgress?: (progress: StudioProgress) => void;
}

export const QUALITY_PRESETS: readonly QualityPreset[] = ["draft", "preview", "final"];
export const ATLAS_SIZES: readonly number[] = [512, 1024, 2048];

export function errorMessage(error: unknown): string {
  if (error instanceof StudioError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

export async function bakeAmbientOcclusion(
  entries: ExtractedEntry[],
  options: BakeRunOptions
): Promise<StudioResult> {
  const studio = await getStudio();
  return studio.bake({
    meshes: entries.map((entry) => entry.input),
    lighting: {
      environment: uniformSkyEnvironment(),
      ambient: [0, 0, 0]
    },
    atlas: { size: options.settings.atlasSize },
    quality: options.settings.quality,
    signal: options.signal,
    onProgress: options.onProgress
  });
}
