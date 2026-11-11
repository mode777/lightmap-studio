import { StudioError } from "./errors.js";
import type {
  BakeInput,
  EnvironmentPrefilterOptions,
  HemisphereWeight,
  QualityPreset
} from "./types.js";

export interface QualityPresetSettings {
  atlasSize: number;
  hemisphereSize: number;
  bounces: number;
  dilationPasses: number;
  smooth: boolean;
  smoothPasses: number;
  interpolationPasses: number;
  interpolationThreshold: number;
  zNear: number;
  zFar: number;
  pointSegments: number;
}

export const QUALITY_PRESETS: Readonly<Record<QualityPreset, QualityPresetSettings>> = {
  draft: {
    atlasSize: 512,
    hemisphereSize: 32,
    bounces: 1,
    dilationPasses: 4,
    smooth: true,
    smoothPasses: 1,
    interpolationPasses: 1,
    interpolationThreshold: 0.01,
    zNear: 0.01,
    zFar: 100,
    pointSegments: 12
  },
  preview: {
    atlasSize: 1024,
    hemisphereSize: 64,
    bounces: 2,
    dilationPasses: 8,
    smooth: true,
    smoothPasses: 1,
    interpolationPasses: 2,
    interpolationThreshold: 0.01,
    zNear: 0.01,
    zFar: 100,
    pointSegments: 20
  },
  final: {
    atlasSize: 1024,
    hemisphereSize: 128,
    bounces: 3,
    dilationPasses: 8,
    smooth: true,
    smoothPasses: 2,
    interpolationPasses: 2,
    interpolationThreshold: 0.01,
    zNear: 0.01,
    zFar: 100,
    pointSegments: 28
  }
};

export interface ResolvedBakeSettings {
  quality: QualityPreset;
  atlasSize: number;
  hemisphereSize: number;
  bounces: number;
  dilationPasses: number;
  smooth: boolean;
  smoothPasses: number;
  interpolationPasses: number;
  interpolationThreshold: number;
  zNear: number;
  zFar: number;
  hemisphereWeight: HemisphereWeight;
  environmentPrefilter: boolean | EnvironmentPrefilterOptions;
  pointSegments: number;
}

export function isQualityPreset(value: unknown): value is QualityPreset {
  return value === "draft" || value === "preview" || value === "final";
}

export function resolveBakeSettings(
  input: BakeInput,
  defaultPrefilter: boolean | EnvironmentPrefilterOptions
): ResolvedBakeSettings {
  const quality = input.quality ?? "preview";
  if (!isQualityPreset(quality)) {
    throw new StudioError(
      `unknown quality preset ${String(quality)}; expected draft, preview or final`,
      "validation"
    );
  }
  const preset = QUALITY_PRESETS[quality];
  const options = input.options ?? {};

  const atlasSize = input.atlas?.size ?? options.atlasSize ?? preset.atlasSize;
  if (!Number.isInteger(atlasSize) || atlasSize <= 0) {
    throw new StudioError(`atlas size ${atlasSize} must be a positive integer`, "validation");
  }

  const hemisphereSize = options.hemisphereSize ?? preset.hemisphereSize;
  if (!isPowerOfTwo(hemisphereSize) || hemisphereSize < 8) {
    throw new StudioError(
      `hemisphere size ${hemisphereSize} must be a power of two >= 8`,
      "validation"
    );
  }

  const bounces = Math.max(1, Math.floor(options.bounces ?? preset.bounces));
  const dilationPasses = Math.max(0, Math.floor(options.dilationPasses ?? preset.dilationPasses));
  const smooth = options.smooth ?? preset.smooth;
  const smoothPasses = Math.max(0, Math.floor(options.smoothPasses ?? preset.smoothPasses));
  const interpolationPasses = Math.max(
    0,
    Math.min(8, Math.floor(options.interpolationPasses ?? preset.interpolationPasses))
  );
  const interpolationThreshold =
    options.interpolationThreshold ?? preset.interpolationThreshold;
  if (!Number.isFinite(interpolationThreshold) || interpolationThreshold < 0) {
    throw new StudioError(
      `interpolation threshold ${interpolationThreshold} must be finite and non-negative`,
      "validation"
    );
  }

  const zNear = options.zNear ?? preset.zNear;
  const zFar = options.zFar ?? preset.zFar;
  if (!Number.isFinite(zNear) || zNear <= 0) {
    throw new StudioError(`zNear ${zNear} must be finite and positive`, "validation");
  }
  if (!Number.isFinite(zFar) || zFar <= zNear) {
    throw new StudioError(`zFar ${zFar} must be finite and greater than zNear`, "validation");
  }

  const hemisphereWeight = options.hemisphereWeight ?? "uniform";
  if (hemisphereWeight !== "uniform" && hemisphereWeight !== "cosine") {
    throw new StudioError(
      `hemisphere weight ${String(hemisphereWeight)} must be "uniform" or "cosine"`,
      "validation"
    );
  }

  const pointSegments = Math.floor(options.pointSegments ?? preset.pointSegments);
  if (!Number.isInteger(pointSegments) || pointSegments < 6) {
    throw new StudioError(
      `point segments ${pointSegments} must be an integer >= 6`,
      "validation"
    );
  }

  return {
    quality,
    atlasSize,
    hemisphereSize,
    bounces,
    dilationPasses,
    smooth,
    smoothPasses,
    interpolationPasses,
    interpolationThreshold,
    zNear,
    zFar,
    hemisphereWeight,
    environmentPrefilter: options.environmentPrefilter ?? defaultPrefilter,
    pointSegments
  };
}

function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}
