import { createBakeHarness, type BakeHarness } from "./bake/harness.js";
import { BakeError, type BakeObject, type BakeScene, type BakeSnapshot } from "./bake/types.js";
import { abortError, isAbortError, StudioError, type StudioErrorCode } from "./errors.js";
import { StudioLoader } from "./loader.js";
import { normalizeLighting, type NormalizedLighting } from "./lighting.js";
import { resolveBakeSettings, type ResolvedBakeSettings } from "./presets.js";
import { unwrapMeshes } from "./unwrap/index.js";
import type {
  BakeInput,
  MeshInput,
  Studio,
  StudioOptions,
  StudioProgress,
  StudioResult,
  UnwrappedScene,
  UnwrapOptions
} from "./types.js";

export async function createStudio(options: StudioOptions = {}): Promise<Studio> {
  return new StudioImpl(options);
}

class StudioImpl implements Studio {
  readonly version = "0.0.0";
  readonly options: StudioOptions;

  private readonly loader: StudioLoader;
  private glState: WebGL2RenderingContext | null;
  private ownedCanvas: HTMLCanvasElement | null = null;
  private ownedContext = false;
  private harness: BakeHarness | null = null;
  private baking = false;
  private disposedState = false;

  constructor(options: StudioOptions) {
    this.options = options;
    this.loader = new StudioLoader(options);
    this.glState = options.gl ?? null;
  }

  get gl(): WebGL2RenderingContext | null {
    return this.glState;
  }

  get disposed(): boolean {
    return this.disposedState;
  }

  async unwrap(meshes: MeshInput[], options: UnwrapOptions = {}): Promise<UnwrappedScene> {
    if (this.disposedState) throw new StudioError("studio has been disposed", "disposed");
    const size = options.size ?? 1024;
    try {
      const module = await this.loader.loadXAtlas();
      return unwrapMeshes(meshes, { module, size, label: "studio" });
    } catch (error) {
      throw mapError(error, "atlas");
    }
  }

  async bake(input: BakeInput): Promise<StudioResult> {
    if (this.disposedState) throw new StudioError("studio has been disposed", "disposed");
    if (this.baking) throw new StudioError("a bake is already running", "busy");
    if (input.signal?.aborted) throw abortError();
    if (input.meshes.length === 0) {
      throw new StudioError("scene has no lit meshes", "validation");
    }

    const settings = resolveBakeSettings(input, this.options.environmentPrefilter ?? true);
    this.baking = true;
    let phase: "unwrap" | "bake" = "bake";

    try {
      throwIfAborted(input.signal);

      // Capability preflight happens before any lightmapper asset request.
      if (this.options.testHooks?.failWebGL2) {
        throw new StudioError("WebGL2 is unavailable (forced test hook)", "webgl2");
      }
      const gl = this.resolveContext();
      if (this.options.testHooks?.failFloat) {
        throw new StudioError("EXT_color_buffer_float is unavailable (forced test hook)", "float");
      }

      const lighting = normalizeLighting(input.lighting, {
        environmentPrefilter: settings.environmentPrefilter,
        pointSegments: settings.pointSegments
      });

      const progress = createProgressReporter(input.onProgress, input.meshes.length);
      progress.emit("unwrap", 0.02, 0, 1, 0, input.meshes.length);
      throwIfAborted(input.signal);

      phase = "unwrap";
      const xatlas = await this.loader.loadXAtlas();
      const unwrapped = unwrapMeshes(input.meshes, {
        module: xatlas,
        size: settings.atlasSize,
        label: "studio"
      });
      progress.emit("unwrap", 0.1, 0, 1, 0, input.meshes.length);
      throwIfAborted(input.signal);

      phase = "bake";
      const lightmapper = await this.loader.loadLightmapper(gl);
      throwIfAborted(input.signal);

      if (!this.harness) {
        this.harness = await createBakeHarness({
          webglContext: gl,
          module: lightmapper,
          testHooks: this.options.testHooks
        });
      }

      // The lightmapper adds a small random rotation jitter to its
      // hemisphere samples. Seed it per bake so repeated bakes of the same
      // scene are reproducible.
      lightmapper.lmSeed?.(0);

      const scene = toBakeScene(unwrapped, lighting, settings);
      const snapshot = await this.harness.bake(scene, {
        hemisphereSize: settings.hemisphereSize,
        bounces: settings.bounces,
        dilationPasses: settings.dilationPasses,
        smooth: settings.smooth,
        smoothPasses: settings.smoothPasses,
        interpolationPasses: settings.interpolationPasses,
        interpolationThreshold: settings.interpolationThreshold,
        zNear: settings.zNear,
        zFar: settings.zFar,
        hemisphereWeight: settings.hemisphereWeight,
        signal: input.signal,
        yieldToMain: this.options.yieldToMain,
        onProgress: (bakeProgress) => {
          progress.emit(
            bakeProgress.stage,
            0.1 + 0.9 * bakeProgress.fraction,
            bakeProgress.bounce,
            bakeProgress.bounces,
            bakeProgress.object,
            bakeProgress.objectCount
          );
        },
        onBounce: (bounce) => {
          if (!input.onBounce) return;
          input.onBounce(toResult(bounce, unwrapped, lighting));
        }
      });

      const result = toResult(snapshot, unwrapped, lighting);
      progress.emit("done", 1, settings.bounces - 1, settings.bounces, input.meshes.length, input.meshes.length);
      return result;
    } catch (error) {
      if (input.signal?.aborted && !isAbortError(error)) throw abortError();
      throw mapError(error, phase === "unwrap" ? "atlas" : "bake");
    } finally {
      this.baking = false;
    }
  }

  dispose(): void {
    if (this.disposedState) return;
    this.disposedState = true;
    this.harness?.dispose();
    this.harness = null;
    if (this.ownedContext && this.glState) {
      this.glState.getExtension("WEBGL_lose_context")?.loseContext();
    }
    this.glState = null;
    this.ownedCanvas = null;
  }

  private resolveContext(): WebGL2RenderingContext {
    if (this.glState) return this.glState;
    if (this.options.gl) {
      this.glState = this.options.gl;
      return this.glState;
    }
    if (this.options.canvas) {
      const context = this.options.canvas.getContext("webgl2") as WebGL2RenderingContext | null;
      if (!context) {
        throw new StudioError(
          "WebGL2 is unavailable: the supplied canvas could not create a WebGL2 context",
          "webgl2"
        );
      }
      this.glState = context;
      return context;
    }
    if (typeof document === "undefined") {
      throw new StudioError("WebGL2 is unavailable: no canvas and no document", "webgl2");
    }
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false
    }) as WebGL2RenderingContext | null;
    if (!context) {
      throw new StudioError(
        "WebGL2 is unavailable: the browser could not create a WebGL2 context",
        "webgl2"
      );
    }
    this.ownedCanvas = canvas;
    this.ownedContext = true;
    this.glState = context;
    return context;
  }
}

function toBakeScene(
  unwrapped: UnwrappedScene,
  lighting: NormalizedLighting,
  settings: ResolvedBakeSettings
): BakeScene {
  const objects: BakeObject[] = [];
  for (const object of unwrapped.litObjects) {
    objects.push({
      kind: "lit",
      name: object.name,
      positions: object.positions,
      normals: object.normals,
      indices: object.indices,
      uvs: object.uvs,
      albedo: object.albedo
    });
  }
  for (const emitter of lighting.emitters) {
    objects.push({
      kind: "emissive",
      name: emitter.name,
      positions: emitter.positions,
      normals: emitter.normals,
      indices: emitter.indices,
      emissive: emitter.emissive
    });
  }

  return {
    atlas: { width: unwrapped.atlas.width, height: unwrapped.atlas.height },
    ambient: lighting.ambient,
    objects,
    ...(lighting.environment ? { environment: lighting.environment } : {}),
    hemisphereWeight: settings.hemisphereWeight
  };
}

function toResult(
  snapshot: BakeSnapshot,
  unwrapped: UnwrappedScene,
  lighting: NormalizedLighting
): StudioResult {
  return {
    scene: {
      litObjects: unwrapped.litObjects,
      emissiveObjects: lighting.emitters,
      atlas: unwrapped.atlas
    },
    lightmap: snapshot.lightmap,
    width: snapshot.width,
    height: snapshot.height,
    channels: 4,
    stats: snapshot.stats,
    durationMs: snapshot.durationMs,
    bounces: snapshot.bounces,
    objectCount: snapshot.objectCount,
    triangleCount: snapshot.triangleCount,
    ...(lighting.environment ? { environment: lighting.environment } : {})
  };
}

function createProgressReporter(
  callback: ((progress: StudioProgress) => void) | undefined,
  objectCount: number
): { emit(stage: StudioProgress["stage"], fraction: number, bounce: number, bounces: number, object: number, objects: number): void } {
  let lastFraction = 0;
  return {
    emit(stage, fraction, bounce, bounces, object, objects): void {
      if (!callback) return;
      lastFraction = Math.max(lastFraction, Math.min(1, Math.max(0, fraction)));
      callback({
        stage,
        fraction: lastFraction,
        bounce: Math.min(bounce + 1, Math.max(1, bounces)),
        bounces: Math.max(1, bounces),
        object,
        objectCount: objects || objectCount
      });
    }
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function mapError(error: unknown, fallback: StudioErrorCode): StudioError {
  if (error instanceof StudioError) return error;
  if (error instanceof BakeError) {
    const code: StudioErrorCode =
      error.code === "module"
        ? "assets"
        : error.code === "gl"
          ? "bake"
          : error.code;
    return new StudioError(error.message, code, { cause: error });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new StudioError(message, fallback, { cause: error });
}
