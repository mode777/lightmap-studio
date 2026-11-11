import type { Vec3 } from "../types.js";
import { BakeError, type BakeEnvironment } from "./types.js";

/**
 * Validate an optional equirectangular environment before any GPU resource is
 * created. The data is linear RGBA radiance in bottom-up row order.
 */
export function validateBakeEnvironment(environment: BakeEnvironment | undefined): void {
  if (!environment) return;

  const { width, height, data, intensity = 1 } = environment;
  if (!Number.isInteger(width) || width <= 0) {
    throw new BakeError(
      `environment width ${width} must be a positive integer`,
      "validation"
    );
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new BakeError(
      `environment height ${height} must be a positive integer`,
      "validation"
    );
  }

  const expected = width * height * 4;
  if (!data || data.length !== expected) {
    throw new BakeError(
      `environment data length ${data?.length ?? "missing"} does not match ${width}x${height}x4 = ${expected}`,
      "validation"
    );
  }

  for (let i = 0; i < data.length; i += 1) {
    const value = data[i];
    if (!Number.isFinite(value)) {
      throw new BakeError(
        `environment data at index ${i} is not finite: ${value}`,
        "validation"
      );
    }
    if (value < 0) {
      throw new BakeError(
        `environment data at index ${i} is negative: ${value}`,
        "validation"
      );
    }
  }

  if (!Number.isFinite(intensity) || intensity < 0) {
    throw new BakeError(
      `environment intensity ${intensity} must be finite and non-negative`,
      "validation"
    );
  }
}

export function environmentIntensity(environment: BakeEnvironment): number {
  return environment.intensity ?? 1;
}

/**
 * Reconstruct a world-space direction for an NDC point from the lightmapper's
 * view and projection matrices. The view matrix stores side/up/backward as its
 * rows; zView = -1 gives the center ray along the hemisphere normal.
 */
export function rayDirectionForNdc(
  ndcX: number,
  ndcY: number,
  view: ArrayLike<number>,
  projection: ArrayLike<number>
): Vec3 {
  const xView = (ndcX + projection[8]) / projection[0];
  const yView = (ndcY + projection[9]) / projection[5];
  const zView = -1;

  let x = view[0] * xView + view[1] * yView + view[2] * zView;
  let y = view[4] * xView + view[5] * yView + view[6] * zView;
  let z = view[8] * xView + view[9] * yView + view[10] * zView;
  const length = Math.hypot(x, y, z);
  if (length === 0) return [0, 0, 0];
  x /= length;
  y /= length;
  z /= length;
  return [x, y, z];
}

/** Ray directions for the three vertices of the fullscreen skybox triangle. */
export function environmentRayDirections(
  view: ArrayLike<number>,
  projection: ArrayLike<number>
): [Vec3, Vec3, Vec3] {
  return [
    rayDirectionForNdc(-1, -1, view, projection),
    rayDirectionForNdc(3, -1, view, projection),
    rayDirectionForNdc(-1, 3, view, projection)
  ];
}
