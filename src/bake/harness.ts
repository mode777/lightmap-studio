import { createLightmapperModule, type LightmapperModule } from "lightmapper-wasm";
import {
  createBufferSet,
  createFloatTexture,
  createProgram,
  deleteBufferSet,
  requireUniform,
  uploadFloatTexture,
  type BufferSet
} from "./gl.js";
import {
  environmentIntensity,
  environmentRayDirections,
  validateBakeEnvironment
} from "./environment.js";
import {
  BAKE_FRAGMENT_SHADER,
  BAKE_VERTEX_SHADER,
  ENVIRONMENT_FRAGMENT_SHADER,
  ENVIRONMENT_VERTEX_SHADER
} from "./shaders.js";
import { computeBakeStats } from "./stats.js";
import {
  BakeError,
  abortError,
  type BakeEmissiveObject,
  type BakeHarnessOptions,
  type BakeLitObject,
  type BakeObject,
  type BakeOptions,
  type BakeProgress,
  type BakeSnapshot,
  type BakeScene,
  type BakeStage
} from "./types.js";

export interface BakeHarness {
  bake(scene: BakeScene, options?: BakeOptions): Promise<BakeSnapshot>;
  dispose(): void;
  readonly gl: WebGL2RenderingContext;
  readonly module: LightmapperModule;
  readonly disposed: boolean;
}

interface GpuObject {
  object: BakeObject;
  buffers: BufferSet;
  uv: Float32Array;
}

interface HeapObject {
  object: BakeLitObject;
  positions: number;
  normals: number;
  uvs: number;
  indices: number;
}

interface ValidatedScene {
  lit: BakeLitObject[];
  emissive: BakeEmissiveObject[];
  triangleCount: number;
}

interface ResolvedContext {
  gl: WebGL2RenderingContext;
  ownedCanvas: boolean;
}

const DEFAULT_HEMISPHERE_SIZE = 64;
const DEFAULT_DILATION_PASSES = 8;

export async function createBakeHarness(options: BakeHarnessOptions = {}): Promise<BakeHarness> {
  if (options.testHooks?.failWebGL2) {
    throw new BakeError("WebGL2 is unavailable (forced test hook)", "webgl2");
  }

  const { gl, ownedCanvas } = resolveContext(options);

  if (options.testHooks?.failFloat) {
    throw new BakeError("EXT_color_buffer_float is unavailable (forced test hook)", "float");
  }
  if (!gl.getExtension("EXT_color_buffer_float")) {
    throw new BakeError(
      "EXT_color_buffer_float is unavailable; RGBA32F lightmaps require it",
      "float"
    );
  }

  let module: LightmapperModule;
  if (options.module) {
    module = options.module;
  } else {
    try {
      module = await createLightmapperModule({
        webglContext: gl,
        locateWasm: options.locateWasm,
        strictContextBinding: true
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BakeError(`lightmapper.wasm initialization failed: ${message}`, "module", {
        cause: error
      });
    }
  }

  const program = createProgram(gl, BAKE_VERTEX_SHADER, BAKE_FRAGMENT_SHADER);
  const uniforms = {
    view: requireUniform(gl, program, "u_view"),
    projection: requireUniform(gl, program, "u_projection"),
    lightmap: requireUniform(gl, program, "u_lightmap"),
    color: requireUniform(gl, program, "u_color"),
    mode: requireUniform(gl, program, "u_mode")
  };

  const environmentProgram = createProgram(gl, ENVIRONMENT_VERTEX_SHADER, ENVIRONMENT_FRAGMENT_SHADER);
  const environmentUniforms = {
    texture: requireUniform(gl, environmentProgram, "u_environment"),
    intensity: requireUniform(gl, environmentProgram, "u_intensity"),
    rays: [
      requireUniform(gl, environmentProgram, "u_ray[0]"),
      requireUniform(gl, environmentProgram, "u_ray[1]"),
      requireUniform(gl, environmentProgram, "u_ray[2]")
    ]
  };
  const environmentVao = gl.createVertexArray();
  if (!environmentVao) throw new BakeError("could not create the environment VAO", "gl");
  const textureFilter = gl.getExtension("OES_texture_float_linear") ? gl.LINEAR : gl.NEAREST;

  let disposed = false;

  const harness: BakeHarness = {
    gl,
    module,
    get disposed(): boolean {
      return disposed;
    },
    async bake(scene: BakeScene, bakeOptions: BakeOptions = {}): Promise<BakeSnapshot> {
      if (disposed) throw new BakeError("bake harness has been disposed", "disposed");
      throwIfAborted(bakeOptions.signal);

      const validated = validateBakeScene(scene);
      const width = scene.atlas.width;
      const height = scene.atlas.height;
      const bounces = Math.max(1, Math.floor(bakeOptions.bounces ?? 1));
      const hemisphereSize = Math.floor(bakeOptions.hemisphereSize ?? DEFAULT_HEMISPHERE_SIZE);
      if (!isPowerOfTwo(hemisphereSize) || hemisphereSize < 8) {
        throw new BakeError(`hemisphere size ${hemisphereSize} must be a power of two >= 8`, "validation");
      }
      const hemisphereWeight =
        bakeOptions.hemisphereWeight ?? scene.hemisphereWeight ?? "uniform";
      if (hemisphereWeight !== "uniform" && hemisphereWeight !== "cosine") {
        throw new BakeError(
          `hemisphere weight ${String(hemisphereWeight)} must be "uniform" or "cosine"`,
          "validation"
        );
      }
      const dilationPasses = Math.max(
        0,
        Math.floor(bakeOptions.dilationPasses ?? DEFAULT_DILATION_PASSES)
      );
      const smooth = bakeOptions.smooth ?? true;
      const smoothPasses = Math.max(0, Math.floor(bakeOptions.smoothPasses ?? 1));
      const interpolationPasses = Math.max(
        0,
        Math.min(8, Math.floor(bakeOptions.interpolationPasses ?? 2))
      );
      const interpolationThreshold = bakeOptions.interpolationThreshold ?? 0.01;
      if (!Number.isFinite(interpolationThreshold) || interpolationThreshold < 0) {
        throw new BakeError(
          `interpolation threshold ${interpolationThreshold} must be finite and non-negative`,
          "validation"
        );
      }
      const zNear = bakeOptions.zNear ?? 0.01;
      const zFar = bakeOptions.zFar ?? 100;
      const yieldToMain = bakeOptions.yieldToMain ?? defaultYield;
      const floatCount = width * height * 4;
      const startedAt = now();
      const progress = createProgressReporter(bakeOptions.onProgress, bounces, validated.lit.length);
      const snapshots: BakeSnapshot[] = [];

      progress.emit("prepare", 0, 0, 0);
      module.makeBoundContextCurrent();

      let lightmapPtr = 0;
      let tempPtr = 0;
      let beginBuffers: ReturnType<LightmapperModule["makeBeginFrameBuffers"]> | null = null;
      let texture: WebGLTexture | null = null;
      let environmentTexture: WebGLTexture | null = null;
      const heapObjects: HeapObject[] = [];
      const gpuObjects: GpuObject[] = [];

      try {
        lightmapPtr = module.allocF32(floatCount);
        tempPtr = module.allocF32(floatCount);
        // The post-process passes use this as a ping-pong buffer. Zero it so a
        // reused wasm heap cannot leak a previous bake into dilation edges.
        module.viewF32(tempPtr, floatCount).fill(0);

        for (const object of validated.lit) {
          heapObjects.push({
            object,
            positions: module.copyToHeap(object.positions),
            normals: module.copyToHeap(object.normals),
            uvs: module.copyToHeap(object.uvs),
            indices: module.copyToHeap(object.indices)
          });
        }
        beginBuffers = module.makeBeginFrameBuffers();

        for (const object of scene.objects) {
          const uvs =
            object.kind === "lit" ? object.uvs : new Float32Array((object.positions.length / 3) * 2);
          gpuObjects.push({
            object,
            uv: uvs,
            buffers: createBufferSet(gl, object.positions, object.normals, uvs, object.indices)
          });
        }

        texture = createFloatTexture(
          gl,
          width,
          height,
          new Float32Array(floatCount),
          textureFilter
        );
        if (scene.environment) {
          environmentTexture = createFloatTexture(
            gl,
            scene.environment.width,
            scene.environment.height,
            scene.environment.data,
            textureFilter
          );
        }

        gl.disable(gl.CULL_FACE);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
        gl.colorMask(true, true, true, true);

        const drawEnvironment = (view: Float32Array, projection: Float32Array): void => {
          if (!environmentTexture || !scene.environment) return;
          const rays = environmentRayDirections(view, projection);
          gl.disable(gl.DEPTH_TEST);
          gl.depthMask(false);
          gl.useProgram(environmentProgram);
          gl.uniform1i(environmentUniforms.texture, 0);
          gl.uniform1f(environmentUniforms.intensity, environmentIntensity(scene.environment));
          gl.uniform3f(environmentUniforms.rays[0], rays[0][0], rays[0][1], rays[0][2]);
          gl.uniform3f(environmentUniforms.rays[1], rays[1][0], rays[1][1], rays[1][2]);
          gl.uniform3f(environmentUniforms.rays[2], rays[2][0], rays[2][1], rays[2][2]);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, environmentTexture);
          gl.bindVertexArray(environmentVao);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.bindVertexArray(null);
          gl.enable(gl.DEPTH_TEST);
          gl.depthMask(true);
        };

        const drawAll = (view: Float32Array, projection: Float32Array): void => {
          drawEnvironment(view, projection);
          gl.useProgram(program);
          gl.uniformMatrix4fv(uniforms.view, false, view);
          gl.uniformMatrix4fv(uniforms.projection, false, projection);
          gl.uniform1i(uniforms.lightmap, 0);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          for (const gpu of gpuObjects) {
            const object = gpu.object;
            const color = object.kind === "lit" ? object.albedo : object.emissive;
            gl.uniform3f(uniforms.color, color[0], color[1], color[2]);
            gl.uniform1i(uniforms.mode, object.kind === "lit" ? 0 : 1);
            gl.bindVertexArray(gpu.buffers.vao);
            gl.drawElements(gl.TRIANGLES, gpu.object.indices.length, gl.UNSIGNED_INT, 0);
          }
          gl.bindVertexArray(null);
        };

        for (let bounce = 0; bounce < bounces; bounce += 1) {
          throwIfAborted(bakeOptions.signal);
          module.viewF32(lightmapPtr, floatCount).fill(0);

          for (let objectIndex = 0; objectIndex < heapObjects.length; objectIndex += 1) {
            throwIfAborted(bakeOptions.signal);
            const heap = heapObjects[objectIndex];
            const ctx = module.lmCreate(
              hemisphereSize,
              zNear,
              zFar,
              scene.ambient[0],
              scene.ambient[1],
              scene.ambient[2],
              interpolationPasses,
              interpolationThreshold,
              0
            );

            try {
              if (hemisphereWeight === "cosine") {
                module.lmSetCosineWeights(ctx);
              }
              module.lmSetTargetLightmap(ctx, lightmapPtr, width, height, 4);
              module.lmSetGeometry(
                ctx,
                0,
                module.LM_FLOAT,
                heap.positions,
                0,
                module.LM_FLOAT,
                heap.normals,
                0,
                module.LM_FLOAT,
                heap.uvs,
                0,
                heap.object.indices.length,
                module.LM_UNSIGNED_INT,
                heap.indices
              );

              let batchStart = now();
              let iterations = 0;
              while (module.lmBegin(ctx, beginBuffers.viewportPtr, beginBuffers.viewPtr, beginBuffers.projectionPtr)) {
                const viewport = beginBuffers.readViewport();
                gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
                drawAll(beginBuffers.readViewMatrix(), beginBuffers.readProjectionMatrix());
                module.lmEnd(ctx);
                iterations += 1;

                if ((iterations & 31) === 0) {
                  throwIfAborted(bakeOptions.signal);
                  const objectFraction = Math.min(1, Math.max(0, module.lmProgress(ctx)));
                  progress.emit(
                    "bounce",
                    (bounce + (objectIndex + objectFraction) / heapObjects.length) / bounces,
                    bounce,
                    objectIndex
                  );
                  if (now() - batchStart >= 30) {
                    await yieldToMain();
                    throwIfAborted(bakeOptions.signal);
                    batchStart = now();
                  }
                }
              }
            } finally {
              module.lmDestroy(ctx);
            }

            progress.emit(
              "bounce",
              (bounce + (objectIndex + 1) / heapObjects.length) / bounces,
              bounce,
              objectIndex
            );
            await yieldToMain();
            throwIfAborted(bakeOptions.signal);
          }

          progress.emit("postprocess", (bounce + 1) / bounces, bounce, heapObjects.length);
          postProcess(
            module,
            lightmapPtr,
            tempPtr,
            width,
            height,
            dilationPasses,
            smooth,
            smoothPasses
          );
          throwIfAborted(bakeOptions.signal);

          progress.emit("readback", (bounce + 1) / bounces, bounce, heapObjects.length);
          const snapshot = module.copyFromHeap(lightmapPtr, new Float32Array(floatCount));
          const stats = computeBakeStats(snapshot);
          const result: BakeSnapshot = {
            lightmap: snapshot,
            width,
            height,
            channels: 4,
            stats,
            durationMs: now() - startedAt,
            bounces: bounce + 1,
            objectCount: scene.objects.length,
            triangleCount: validated.triangleCount
          };
          snapshots.push(result);

          if (texture) uploadFloatTexture(gl, texture, width, height, snapshot);
          bakeOptions.testHooks?.onLightmapUpload?.(bounce);
          bakeOptions.onBounce?.(result);
        }

        const final = snapshots[snapshots.length - 1];
        if (!final) throw new BakeError("bake produced no result", "validation");
        final.durationMs = now() - startedAt;
        progress.emit("done", 1, bounces - 1, heapObjects.length);
        return final;
      } catch (error) {
        if (bakeOptions.signal?.aborted && !(error instanceof BakeError && error.code === "aborted")) {
          throw abortError();
        }
        throw error;
      } finally {
        for (const gpu of gpuObjects) deleteBufferSet(gl, gpu.buffers);
        if (texture) gl.deleteTexture(texture);
        if (environmentTexture) gl.deleteTexture(environmentTexture);
        if (beginBuffers) beginBuffers.dispose();
        for (const heap of heapObjects) {
          module.free(heap.positions);
          module.free(heap.normals);
          module.free(heap.uvs);
          module.free(heap.indices);
        }
        if (lightmapPtr) module.free(lightmapPtr);
        if (tempPtr) module.free(tempPtr);
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      gl.deleteProgram(program);
      gl.deleteProgram(environmentProgram);
      gl.deleteVertexArray(environmentVao);
      if (ownedCanvas) {
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
    }
  };

  return harness;
}

function resolveContext(options: BakeHarnessOptions): ResolvedContext {
  if (options.webglContext) {
    return { gl: options.webglContext, ownedCanvas: false };
  }

  const canvas =
    options.canvas ??
    (typeof document !== "undefined" ? document.createElement("canvas") : undefined);
  if (!canvas) {
    throw new BakeError("WebGL2 is unavailable: no canvas and no document", "webgl2");
  }
  if (canvas.width === 0) canvas.width = 1;
  if (canvas.height === 0) canvas.height = 1;

  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false
  }) as WebGL2RenderingContext | null;
  if (!gl) {
    throw new BakeError(
      "WebGL2 is unavailable: the browser could not create a WebGL2 context",
      "webgl2"
    );
  }
  return { gl, ownedCanvas: !options.canvas };
}

function validateBakeScene(scene: BakeScene): ValidatedScene {
  validateBakeEnvironment(scene.environment);
  const { width, height } = scene.atlas;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new BakeError(`invalid atlas dimensions ${width}x${height}`, "validation");
  }
  if (scene.ambient.length !== 3 || scene.ambient.some((value) => !Number.isFinite(value))) {
    throw new BakeError("ambient color must be three finite values", "validation");
  }
  if (scene.objects.length === 0) throw new BakeError("scene has no objects", "validation");

  const lit: BakeLitObject[] = [];
  const emissive: BakeEmissiveObject[] = [];
  let triangleCount = 0;

  for (let index = 0; index < scene.objects.length; index += 1) {
    const object = scene.objects[index];
    const label = object.name || `object ${index}`;
    if (!object.name) object.name = label;
    const vertexCount = object.positions.length / 3;
    if (vertexCount === 0 || object.positions.length % 3 !== 0) {
      throw new BakeError(`${label}: positions must be a non-empty xyz array`, "validation");
    }
    if (object.normals.length !== object.positions.length) {
      throw new BakeError(`${label}: normals must match positions`, "validation");
    }
    if (object.indices.length === 0 || object.indices.length % 3 !== 0) {
      throw new BakeError(`${label}: indices must be a non-empty triangle list`, "validation");
    }
    assertFinite(object.positions, `${label} positions`);
    assertFinite(object.normals, `${label} normals`);
    for (let i = 0; i < object.indices.length; i += 1) {
      if (object.indices[i] >= vertexCount) {
        throw new BakeError(`${label}: index ${object.indices[i]} is out of range`, "validation");
      }
    }
    triangleCount += object.indices.length / 3;

    if (object.kind === "lit") {
      if (object.uvs.length !== vertexCount * 2) {
        throw new BakeError(`${label}: lightmap UVs must have two values per vertex`, "validation");
      }
      for (let i = 0; i < object.uvs.length; i += 1) {
        const value = object.uvs[i];
        if (!Number.isFinite(value) || value < 0 || value >= 1) {
          throw new BakeError(
            `${label}: lightmap UV at index ${i} is ${value}; expected a finite value in [0, 1)`,
            "validation"
          );
        }
      }
      if (object.albedo.length !== 3 || object.albedo.some((value) => !Number.isFinite(value))) {
        throw new BakeError(`${label}: albedo must be three finite values`, "validation");
      }
      lit.push(object);
    } else {
      if (object.emissive.length !== 3 || object.emissive.some((value) => !Number.isFinite(value))) {
        throw new BakeError(`${label}: emissive must be three finite values`, "validation");
      }
      emissive.push(object);
    }
  }

  if (lit.length === 0) throw new BakeError("scene has no lit objects to bake", "validation");
  return { lit, emissive, triangleCount };
}

function assertFinite(values: Float32Array, label: string): void {
  for (let i = 0; i < values.length; i += 1) {
    if (!Number.isFinite(values[i])) {
      throw new BakeError(`${label}: non-finite value at index ${i}`, "validation");
    }
  }
}

function postProcess(
  module: LightmapperModule,
  lightmapPtr: number,
  tempPtr: number,
  width: number,
  height: number,
  dilationPasses: number,
  smooth: boolean,
  smoothPasses: number
): void {
  for (let i = 0; i < dilationPasses; i += 1) {
    module.lmImageDilate(lightmapPtr, tempPtr, width, height, 4);
    module.lmImageDilate(tempPtr, lightmapPtr, width, height, 4);
  }
  if (smooth) {
    for (let i = 0; i < smoothPasses; i += 1) {
      module.lmImageSmooth(lightmapPtr, tempPtr, width, height, 4);
      module.lmImageDilate(tempPtr, lightmapPtr, width, height, 4);
    }
  }
}

function createProgressReporter(
  callback: ((progress: BakeProgress) => void) | undefined,
  bounces: number,
  objectCount: number
): { emit(stage: BakeStage, fraction: number, bounce: number, object: number): void } {
  let lastFraction = 0;
  return {
    emit(stage: BakeStage, fraction: number, bounce: number, object: number): void {
      if (!callback) return;
      lastFraction = Math.max(lastFraction, Math.min(1, Math.max(0, fraction)));
      callback({
        stage,
        fraction: lastFraction,
        bounce: Math.min(bounce + 1, bounces),
        bounces,
        object,
        objectCount
      });
    }
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

function defaultYield(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
