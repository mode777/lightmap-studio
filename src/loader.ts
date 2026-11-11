import {
  createLightmapperModule,
  type LightmapperModule
} from "lightmapper-wasm";
import createXAtlas, { type XAtlasModule } from "xatlas-wasm";

import { StudioError } from "./errors.js";
import type { StudioOptions, WasmAssetOptions } from "./types.js";

export class StudioLoader {
  private xatlasPromise: Promise<XAtlasModule> | null = null;
  private lightmapperPromise: Promise<LightmapperModule> | null = null;

  constructor(private readonly options: StudioOptions) {
    validateWasmOptions(options.wasm);
  }

  async loadXAtlas(): Promise<XAtlasModule> {
    const injected = this.options.modules?.xatlas;
    if (injected) return injected;
    if (this.xatlasPromise) return this.xatlasPromise;

    const entry = this.options.wasm?.xatlas;
    this.xatlasPromise = createXAtlas({
      wasmBinary: entry?.binary,
      locateFile: entry?.url ? () => String(entry.url) : undefined
    }).catch((error: unknown) => {
      this.xatlasPromise = null;
      const message = error instanceof Error ? error.message : String(error);
      throw new StudioError(`xatlas.wasm could not be loaded: ${message}`, "assets", {
        cause: error
      });
    });
    return this.xatlasPromise;
  }

  async loadLightmapper(gl: WebGL2RenderingContext): Promise<LightmapperModule> {
    const injected = this.options.modules?.lightmapper;
    if (injected) return injected;
    if (this.lightmapperPromise) return this.lightmapperPromise;

    const entry = this.options.wasm?.lightmapper;
    this.lightmapperPromise = createLightmapperModule({
      webglContext: gl,
      wasmBinary: entry?.binary,
      locateWasm: entry?.url ? () => String(entry.url) : undefined,
      strictContextBinding: true
    }).catch((error: unknown) => {
      this.lightmapperPromise = null;
      const message = error instanceof Error ? error.message : String(error);
      const code = /EXT_color_buffer_float|RGBA32F/.test(message)
        ? "float"
        : /WebGL2|webgl2/.test(message)
          ? "webgl2"
          : "assets";
      throw new StudioError(`lightmapper.wasm could not be loaded: ${message}`, code, {
        cause: error
      });
    });
    return this.lightmapperPromise;
  }
}

function validateWasmOptions(wasm: StudioOptions["wasm"]): void {
  if (wasm === undefined) return;
  if (typeof wasm !== "object" || wasm === null) {
    throw new StudioError("wasm must be an object with lightmapper and xatlas entries", "validation");
  }
  validateAsset("wasm.lightmapper", wasm.lightmapper);
  validateAsset("wasm.xatlas", wasm.xatlas);
}

function validateAsset(label: string, asset: WasmAssetOptions | undefined): void {
  if (asset === undefined) return;
  if (typeof asset !== "object" || asset === null) {
    throw new StudioError(`${label} must be an object`, "validation");
  }
  if (asset.binary !== undefined) {
    const isBytes =
      asset.binary instanceof ArrayBuffer ||
      (ArrayBuffer.isView(asset.binary) && asset.binary instanceof Uint8Array);
    if (!isBytes) {
      throw new StudioError(`${label}.binary must be an ArrayBuffer or Uint8Array`, "validation");
    }
  }
  if (asset.url !== undefined && typeof asset.url !== "string" && !(asset.url instanceof URL)) {
    throw new StudioError(`${label}.url must be a string or URL`, "validation");
  }
}
