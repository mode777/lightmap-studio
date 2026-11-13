/**
 * Uniform white sky environment: baking against it turns the studio's
 * hemisphere pass into a sky-visibility (ambient occlusion) integration.
 * The flat ambient term is added unoccluded by the lightmapper, so it must
 * stay black for a pure AO result.
 */
import type { EnvironmentInput } from "lightmap-studio";

export function uniformSkyEnvironment(intensity = 1): EnvironmentInput {
  const width = 2;
  const height = 2;
  const data = new Float32Array(width * height * 4);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = intensity;
  }
  return { width, height, data };
}
