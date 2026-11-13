import type { LightmapperModule } from "lightmapper-wasm";
import type { XAtlasModule } from "xatlas-wasm";

export type Vec3 = [number, number, number];

/** Lightmapper hemisphere weighting. Uniform is the library default. */
export type HemisphereWeight = "uniform" | "cosine";

/** Built-in bake quality presets. */
export type QualityPreset = "draft" | "preview" | "final";

/** A lit mesh supplied to the studio. Geometry is in world space. */
export interface MeshInput {
  name?: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array | Uint32Array;
  /** Linear albedo; defaults to a neutral grey. */
  albedo?: Vec3;
}

/** An emissive mesh used as an area light. It is never unwrapped. */
export interface EmissiveMeshInput {
  name?: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array | Uint32Array;
  /** Linear emissive radiance. */
  emissive: Vec3;
}

/**
 * Linear equirectangular radiance in bottom-up row order: row 0 is the south
 * pole (v = 0), the last row is the north pole (v = 1).
 */
export interface EnvironmentInput {
  width: number;
  height: number;
  /** RGBA radiance. */
  data: Float32Array;
  /** Linear radiance multiplier; defaults to 1. */
  intensity?: number;
}

export interface PointLightInput {
  name?: string;
  position: Vec3;
  /** Linear light color. */
  color: Vec3;
  /** Total radiant power in scene units. */
  power: number;
  /** Proxy sphere radius in world units; defaults to 0.05. */
  radius?: number;
}

export interface PointLightInfo {
  position: Vec3;
  color: Vec3;
  power: number;
  radius: number;
  /** Uniform radiance written to the proxy sphere. */
  radiance: Vec3;
}

export interface LightingInput {
  /** The only sky light source. No directional-light input exists. */
  environment?: EnvironmentInput;
  /** Constant ambient term; defaults to black. */
  ambient?: Vec3;
  /** Emissive meshes used as area lights. */
  emitters?: EmissiveMeshInput[];
  /** Point lights expanded into emissive sphere proxies. */
  points?: PointLightInput[];
}

export interface AtlasMetadata {
  width: number;
  height: number;
  chartCount: number;
  /** Normalized atlas texel utilization in [0, 1]. */
  utilization: number;
}

export interface UnwrappedObject {
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  /** Normalized lightmap UVs in [0, 1). */
  uvs: Float32Array;
  indices: Uint32Array;
  /** Chart index for each output vertex. */
  charts: Uint32Array;
  /**
   * Input vertex index for each output vertex. xatlas duplicates vertices at
   * chart seams, so this is the mapping consumers need to carry per-vertex
   * attributes (TEXCOORD_0, colors, skin data, ...) onto the unwrapped mesh.
   */
  xref: Uint32Array;
  albedo: Vec3;
  triangleCount: number;
  chartCount: number;
}

export interface EmissiveObject {
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  emissive: Vec3;
  triangleCount: number;
  source: "emitter" | "point";
  /** Present when the object was generated from a point light. */
  point?: PointLightInfo;
}

export interface UnwrappedScene {
  litObjects: UnwrappedObject[];
  emissiveObjects: EmissiveObject[];
  atlas: AtlasMetadata;
}

export interface BakeStats {
  mean: number;
  min: number;
  max: number;
  nonBlackRatio: number;
  litPixels: number;
}

export interface StudioResult {
  /** The unwrapped scene the lightmap belongs to. */
  scene: UnwrappedScene;
  lightmap: Float32Array;
  width: number;
  height: number;
  channels: 4;
  stats: BakeStats;
  durationMs: number;
  bounces: number;
  objectCount: number;
  triangleCount: number;
  /** The environment actually drawn during the bake after prefiltering. */
  environment?: EnvironmentInput;
}

export type StudioStage =
  | "unwrap"
  | "prepare"
  | "bounce"
  | "postprocess"
  | "readback"
  | "done";

export interface StudioProgress {
  stage: StudioStage;
  /** Monotonically increasing overall fraction in [0, 1]. */
  fraction: number;
  bounce: number;
  bounces: number;
  object: number;
  objectCount: number;
}

export interface EnvironmentPrefilterOptions {
  width?: number;
  height?: number;
  /** Gaussian radius in target texels, 1-4. */
  radius?: number;
}

export interface BakeOverrides {
  atlasSize?: number;
  hemisphereSize?: number;
  bounces?: number;
  dilationPasses?: number;
  smooth?: boolean;
  smoothPasses?: number;
  interpolationPasses?: number;
  interpolationThreshold?: number;
  zNear?: number;
  zFar?: number;
  hemisphereWeight?: HemisphereWeight;
  /** Set false to draw the full-resolution environment. */
  environmentPrefilter?: boolean | EnvironmentPrefilterOptions;
  /** Point-proxy sphere segments; from the quality preset by default. */
  pointSegments?: number;
}

export interface BakeInput {
  /** Lit meshes. Each receives a region of the shared atlas. */
  meshes: MeshInput[];
  lighting?: LightingInput;
  atlas?: { size?: number };
  /** Defaults to "preview". */
  quality?: QualityPreset;
  options?: BakeOverrides;
  signal?: AbortSignal;
  onProgress?: (progress: StudioProgress) => void;
  /** Called after each bounce with the partial result. */
  onBounce?: (result: StudioResult) => void;
}

export interface UnwrapOptions {
  /** Shared atlas size in texels; defaults to the preview preset or 1024. */
  size?: number;
}

export interface WasmAssetOptions {
  /** Pre-fetched wasm bytes. Takes precedence over `url`. */
  binary?: ArrayBuffer | Uint8Array;
  /** Asset location to fetch instead of the package default. */
  url?: string | URL;
}

export interface StudioWasmOptions {
  lightmapper?: WasmAssetOptions;
  xatlas?: WasmAssetOptions;
}

export interface StudioModules {
  /** Reuse an already initialized module instead of loading one. */
  lightmapper?: LightmapperModule;
  xatlas?: XAtlasModule;
}

export interface StudioTestHooks {
  failWebGL2?: boolean;
  failFloat?: boolean;
}

export interface StudioOptions {
  /** Use an existing WebGL2 context. */
  gl?: WebGL2RenderingContext;
  /** Create the bake context from this canvas. */
  canvas?: HTMLCanvasElement | OffscreenCanvas;
  wasm?: StudioWasmOptions;
  modules?: StudioModules;
  testHooks?: StudioTestHooks;
  /** Cooperative yield used between bake batches. */
  yieldToMain?: () => Promise<void>;
  /** Default environment prefilter for all bakes. */
  environmentPrefilter?: boolean | EnvironmentPrefilterOptions;
}

export interface Studio {
  readonly disposed: boolean;
  readonly gl: WebGL2RenderingContext | null;
  /** Studio package version (diagnostics). */
  readonly version: string;
  /** Unwrap lit meshes without creating a WebGL2 context. */
  unwrap(meshes: MeshInput[], options?: UnwrapOptions): Promise<UnwrappedScene>;
  /** Unwrap and bake a scene. */
  bake(input: BakeInput): Promise<StudioResult>;
  /** Release bake resources. Injected modules remain caller-owned. */
  dispose(): void;
}
