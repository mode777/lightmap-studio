export { createStudio } from "./studio.js";
export {
  QUALITY_PRESETS,
  isQualityPreset,
  resolveBakeSettings,
  type QualityPresetSettings,
  type ResolvedBakeSettings
} from "./presets.js";
export {
  StudioError,
  abortError,
  isAbortError,
  type StudioErrorCode
} from "./errors.js";
export {
  createEmissiveSphere,
  normalizeLighting,
  type NormalizedLighting,
  type NormalizeLightingOptions
} from "./lighting.js";
export {
  UV_MAX,
  normalizeAtlasUv,
  unwrapMeshes,
  type UnwrapMeshesOptions
} from "./unwrap/index.js";
export {
  computeAtlasStats,
  type AtlasStats
} from "./unwrap/stats.js";
export {
  PREFILTERED_ENVIRONMENT_WIDTH,
  PREFILTERED_ENVIRONMENT_HEIGHT,
  decodeHdr,
  flipRowsBottomUp,
  loadEnvironment,
  prefilterEnvironment,
  prefilterEnvironmentWithOptions,
  resolvePrefilterOptions,
  validateEnvironment
} from "./environment/index.js";
export {
  createBakeHarness,
  type BakeHarness
} from "./bake/harness.js";
export {
  BakeError,
  type BakeEmissiveObject,
  type BakeEnvironment,
  type BakeHarnessOptions,
  type BakeLitObject,
  type BakeObject,
  type BakeOptions,
  type BakeProgress,
  type BakeScene,
  type BakeSnapshot,
  type BakeStage,
  type BakeTestHooks
} from "./bake/types.js";
export { validateBakeEnvironment, environmentIntensity, rayDirectionForNdc, environmentRayDirections } from "./bake/environment.js";
export { computeBakeStats } from "./bake/stats.js";
export { createProgram, compileShader, createBufferSet, deleteBufferSet, createFloatTexture, uploadFloatTexture } from "./bake/gl.js";
export type { StudioResult as BakeResult } from "./types.js";
export type { LightmapperModule } from "lightmapper-wasm";
export type { XAtlasModule } from "xatlas-wasm";
export type {
  AtlasMetadata,
  BakeInput,
  BakeOverrides,
  BakeStats,
  EmissiveMeshInput,
  EmissiveObject,
  EnvironmentInput,
  EnvironmentPrefilterOptions,
  HemisphereWeight,
  LightingInput,
  MeshInput,
  PointLightInfo,
  PointLightInput,
  QualityPreset,
  Studio,
  StudioModules,
  StudioOptions,
  StudioProgress,
  StudioResult,
  StudioStage,
  StudioTestHooks,
  StudioWasmOptions,
  UnwrappedObject,
  UnwrappedScene,
  UnwrapOptions,
  Vec3,
  WasmAssetOptions
} from "./types.js";
