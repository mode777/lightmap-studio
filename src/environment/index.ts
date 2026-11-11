import { StudioError } from "../errors.js";
import type {
  EnvironmentInput,
  EnvironmentPrefilterOptions
} from "../types.js";

export const PREFILTERED_ENVIRONMENT_WIDTH = 128;
export const PREFILTERED_ENVIRONMENT_HEIGHT = 64;

export function validateEnvironment(environment: EnvironmentInput | undefined): void {
  if (!environment) return;
  const { width, height, data, intensity = 1 } = environment;
  if (!Number.isInteger(width) || width <= 0) {
    throw new StudioError(`environment width ${width} must be a positive integer`, "validation");
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new StudioError(`environment height ${height} must be a positive integer`, "validation");
  }
  const expected = width * height * 4;
  if (!data || data.length !== expected) {
    throw new StudioError(
      `environment data length ${data?.length ?? "missing"} does not match ${width}x${height}x4 = ${expected}`,
      "validation"
    );
  }
  for (let i = 0; i < data.length; i += 1) {
    const value = data[i];
    if (!Number.isFinite(value)) {
      throw new StudioError(`environment data at index ${i} is not finite: ${value}`, "validation");
    }
    if (value < 0) {
      throw new StudioError(`environment data at index ${i} is negative: ${value}`, "validation");
    }
  }
  if (!Number.isFinite(intensity) || intensity < 0) {
    throw new StudioError(
      `environment intensity ${intensity} must be finite and non-negative`,
      "validation"
    );
  }
}


/**
 * The Radiance file stores scanlines top-down. Flip once so both the bake
 * skybox and display use bottom-up rows: row 0 is the south pole (v = 0), the
 * last row is the north pole (v = 1).
 */
export function flipRowsBottomUp(
  data: Float32Array,
  width: number,
  height: number
): Float32Array {
  const rowLength = width * 4;
  if (data.length !== rowLength * height) {
    throw new StudioError(
      `HDRI data length ${data.length} does not match ${width}x${height}x4`,
      "validation"
    );
  }
  const flipped = new Float32Array(data.length);
  for (let y = 0; y < height; y += 1) {
    const source = (height - 1 - y) * rowLength;
    flipped.set(data.subarray(source, source + rowLength), y * rowLength);
  }
  return flipped;
}

function gaussianWeights(radius: number): number[] {
  if (radius === 2) return [1, 4, 6, 4, 1];
  const sigma = radius / 2;
  return Array.from({ length: radius * 2 + 1 }, (_, index) => {
    const offset = index - radius;
    return Math.exp(-(offset * offset) / (2 * sigma * sigma));
  });
}

/**
 * Build a low-resolution, blurred irradiance copy for diffuse baking. The
 * full-resolution environment is still used for the visible background.
 */
export function prefilterEnvironment(
  data: Float32Array,
  width: number,
  height: number,
  targetWidth = PREFILTERED_ENVIRONMENT_WIDTH,
  targetHeight = PREFILTERED_ENVIRONMENT_HEIGHT,
  radius = 2
): EnvironmentInput {
  if (!Number.isInteger(targetWidth) || !Number.isInteger(targetHeight) || targetWidth <= 0 || targetHeight <= 0) {
    throw new StudioError(`invalid prefilter dimensions ${targetWidth}x${targetHeight}`, "validation");
  }
  if (!Number.isInteger(radius) || radius < 1 || radius > 4) {
    throw new StudioError(`prefilter radius ${radius} must be an integer in [1, 4]`, "validation");
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new StudioError(`invalid environment dimensions ${width}x${height}`, "validation");
  }
  if (data.length !== width * height * 4) {
    throw new StudioError(
      `environment data length ${data.length} does not match ${width}x${height}x4`,
      "validation"
    );
  }

  const downsampled = new Float32Array(targetWidth * targetHeight * 4);
  for (let ty = 0; ty < targetHeight; ty += 1) {
    const sourceY0 = (ty * height) / targetHeight;
    const sourceY1 = ((ty + 1) * height) / targetHeight;
    const yStart = Math.floor(sourceY0);
    const yEnd = Math.min(height, Math.ceil(sourceY1));
    for (let tx = 0; tx < targetWidth; tx += 1) {
      const sourceX0 = (tx * width) / targetWidth;
      const sourceX1 = ((tx + 1) * width) / targetWidth;
      const xStart = Math.floor(sourceX0);
      const xEnd = Math.min(width, Math.ceil(sourceX1));
      const sum = [0, 0, 0, 0];
      let totalWeight = 0;
      for (let sy = yStart; sy < yEnd; sy += 1) {
        const wy = Math.min(sourceY1, sy + 1) - Math.max(sourceY0, sy);
        if (wy <= 0) continue;
        for (let sx = xStart; sx < xEnd; sx += 1) {
          const wx = Math.min(sourceX1, sx + 1) - Math.max(sourceX0, sx);
          if (wx <= 0) continue;
          const weight = wx * wy;
          const source = (sy * width + sx) * 4;
          sum[0] += data[source] * weight;
          sum[1] += data[source + 1] * weight;
          sum[2] += data[source + 2] * weight;
          sum[3] += data[source + 3] * weight;
          totalWeight += weight;
        }
      }
      const target = (ty * targetWidth + tx) * 4;
      if (totalWeight > 0) {
        downsampled[target] = sum[0] / totalWeight;
        downsampled[target + 1] = sum[1] / totalWeight;
        downsampled[target + 2] = sum[2] / totalWeight;
        downsampled[target + 3] = sum[3] / totalWeight;
      }
    }
  }

  const weights = gaussianWeights(radius);
  const weightSum = weights.reduce((total, weight) => total + weight, 0) ** 2;
  const blurred = new Float32Array(downsampled.length);
  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const sum = [0, 0, 0, 0];
      for (let ky = -radius; ky <= radius; ky += 1) {
        const sourceY = Math.min(targetHeight - 1, Math.max(0, y + ky));
        for (let kx = -radius; kx <= radius; kx += 1) {
          const sourceX = (x + kx + targetWidth) % targetWidth;
          const source = (sourceY * targetWidth + sourceX) * 4;
          const weight = weights[ky + radius] * weights[kx + radius];
          sum[0] += downsampled[source] * weight;
          sum[1] += downsampled[source + 1] * weight;
          sum[2] += downsampled[source + 2] * weight;
          sum[3] += downsampled[source + 3] * weight;
        }
      }
      const target = (y * targetWidth + x) * 4;
      blurred[target] = sum[0] / weightSum;
      blurred[target + 1] = sum[1] / weightSum;
      blurred[target + 2] = sum[2] / weightSum;
      blurred[target + 3] = sum[3] / weightSum;
    }
  }

  return {
    width: targetWidth,
    height: targetHeight,
    data: blurred,
    intensity: 1
  };
}

export function resolvePrefilterOptions(
  value: boolean | EnvironmentPrefilterOptions | undefined
): EnvironmentPrefilterOptions | null {
  if (value === false) return null;
  if (value === true || value === undefined) return {};
  if (typeof value !== "object" || value === null) {
    throw new StudioError("environmentPrefilter must be a boolean or an options object", "validation");
  }
  return value;
}

export function prefilterEnvironmentWithOptions(
  environment: EnvironmentInput,
  options: EnvironmentPrefilterOptions
): EnvironmentInput {
  const prefilted = prefilterEnvironment(
    environment.data,
    environment.width,
    environment.height,
    options.width ?? PREFILTERED_ENVIRONMENT_WIDTH,
    options.height ?? PREFILTERED_ENVIRONMENT_HEIGHT,
    options.radius ?? 2
  );
  prefilted.intensity = environment.intensity ?? 1;
  return prefilted;
}

/** Decode a Radiance RGBE (.hdr) file into bottom-up linear RGBA data. */
export function decodeHdr(buffer: ArrayBuffer | Uint8Array): EnvironmentInput {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const { width, height, offset } = readHdrHeader(bytes);
  const rgba = readHdrPixels(bytes, offset, width, height);
  const data = RGBEToFloat(rgba);
  const flipped = flipRowsBottomUp(data, width, height);
  return {
    width,
    height,
    data: flipped,
    intensity: 1
  };
}

export async function loadEnvironment(
  url: string | URL,
  options: { intensity?: number; fetch?: typeof fetch } = {}
): Promise<EnvironmentInput> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new StudioError("environment loading requires fetch", "assets");
  }
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    throw new StudioError(`environment fetch failed for ${String(url)}`, "assets", { cause: error });
  }
  if (!response.ok) {
    throw new StudioError(
      `environment fetch failed for ${String(url)}: HTTP ${response.status}`,
      "assets"
    );
  }
  const buffer = await response.arrayBuffer();
  const environment = decodeHdr(buffer);
  if (options.intensity !== undefined) {
    if (!Number.isFinite(options.intensity) || options.intensity < 0) {
      throw new StudioError(
        `environment intensity ${options.intensity} must be finite and non-negative`,
        "validation"
      );
    }
    environment.intensity = options.intensity;
  }
  return environment;
}

function readHdrHeader(bytes: Uint8Array): { width: number; height: number; offset: number } {
  let offset = 0;
  let format = "";
  let width = 0;
  let height = 0;
  let sawBlank = false;

  while (offset < bytes.length) {
    const lineStart = offset;
    while (offset < bytes.length && bytes[offset] !== 0x0a) offset += 1;
    const line = decodeAscii(bytes.subarray(lineStart, offset));
    offset += 1;

    if (line === "") {
      sawBlank = true;
      continue;
    }
    if (!sawBlank && line.startsWith("#?")) continue;
    const formatMatch = /^FORMAT=(\S+)/.exec(line);
    if (formatMatch) {
      format = formatMatch[1];
      continue;
    }
    const dimensionMatch = /^-Y\s+(\d+)\s+\+X\s+(\d+)\s*$/.exec(line);
    if (dimensionMatch) {
      height = Number.parseInt(dimensionMatch[1], 10);
      width = Number.parseInt(dimensionMatch[2], 10);
      break;
    }
  }

  if (format && format !== "32-bit_rle_rgbe") {
    throw new StudioError(`unsupported HDR format ${format}`, "validation");
  }
  if (!width || !height) {
    throw new StudioError("HDR header is missing a -Y height +X width resolution", "validation");
  }
  return { width, height, offset };
}

function readHdrPixels(
  bytes: Uint8Array,
  offset: number,
  width: number,
  height: number
): Uint8Array {
  const scanlineWidth = width;
  const pos = offset;

  if (
    scanlineWidth < 8 ||
    scanlineWidth > 0x7fff ||
    pos + 4 > bytes.length ||
    bytes[pos] !== 2 ||
    bytes[pos + 1] !== 2 ||
    (bytes[pos + 2] & 0x80) !== 0
  ) {
    const expected = width * height * 4;
    if (pos + expected > bytes.length) {
      throw new StudioError("HDR pixel data is truncated", "validation");
    }
    return bytes.subarray(pos, pos + expected);
  }

  const data = new Uint8Array(width * height * 4);
  const scanline = new Uint8Array(scanlineWidth * 4);
  let cursor = pos;
  let output = 0;

  for (let y = 0; y < height; y += 1) {
    if (cursor + 4 > bytes.length) {
      throw new StudioError("HDR scanline header is truncated", "validation");
    }
    const marker = (bytes[cursor] << 8) | bytes[cursor + 1];
    const lineWidth = (bytes[cursor + 2] << 8) | bytes[cursor + 3];
    if (marker !== 0x0202 || lineWidth !== scanlineWidth) {
      throw new StudioError(`invalid HDR scanline at row ${y}`, "validation");
    }
    cursor += 4;

    let channelOffset = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      let written = 0;
      while (written < scanlineWidth) {
        if (cursor >= bytes.length) {
          throw new StudioError("HDR scanline data is truncated", "validation");
        }
        const count = bytes[cursor];
        cursor += 1;
        if (count === 0) {
          throw new StudioError("invalid HDR scanline run length 0", "validation");
        }
        if (count > 128) {
          const run = count - 128;
          if (written + run > scanlineWidth || cursor >= bytes.length) {
            throw new StudioError("invalid HDR scanline run", "validation");
          }
          const value = bytes[cursor];
          cursor += 1;
          for (let i = 0; i < run; i += 1) {
            scanline[channelOffset + written + i] = value;
          }
          written += run;
        } else {
          if (written + count > scanlineWidth || cursor + count > bytes.length) {
            throw new StudioError("invalid HDR scanline literal", "validation");
          }
          for (let i = 0; i < count; i += 1) {
            scanline[channelOffset + written + i] = bytes[cursor + i];
          }
          cursor += count;
          written += count;
        }
      }
      channelOffset += scanlineWidth;
    }

    for (let x = 0; x < scanlineWidth; x += 1) {
      data[output] = scanline[x];
      data[output + 1] = scanline[x + scanlineWidth];
      data[output + 2] = scanline[x + scanlineWidth * 2];
      data[output + 3] = scanline[x + scanlineWidth * 3];
      output += 4;
    }
  }

  return data;
}

function RGBEToFloat(rgba: Uint8Array): Float32Array {
  const data = new Float32Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const exponent = rgba[i + 3];
    const scale = Math.pow(2, exponent - 128) / 255;
    data[i] = rgba[i] * scale;
    data[i + 1] = rgba[i + 1] * scale;
    data[i + 2] = rgba[i + 2] * scale;
    data[i + 3] = 1;
  }
  return data;
}

function decodeAscii(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 1) {
    result += String.fromCharCode(bytes[i]);
  }
  return result.trim();
}
