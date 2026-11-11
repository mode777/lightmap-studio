import { StudioError } from "./errors.js";
import {
  prefilterEnvironmentWithOptions,
  resolvePrefilterOptions,
  validateEnvironment
} from "./environment/index.js";
import type {
  EmissiveMeshInput,
  EmissiveObject,
  EnvironmentInput,
  EnvironmentPrefilterOptions,
  LightingInput,
  PointLightInput,
  PointLightInfo,
  Vec3
} from "./types.js";

export interface NormalizedLighting {
  ambient: Vec3;
  environment?: EnvironmentInput;
  emitters: EmissiveObject[];
}

export interface NormalizeLightingOptions {
  environmentPrefilter: boolean | EnvironmentPrefilterOptions;
  pointSegments: number;
}

const DEFAULT_POINT_RADIUS = 0.05;

export function normalizeLighting(
  lighting: LightingInput | undefined,
  options: NormalizeLightingOptions
): NormalizedLighting {
  const ambient = lighting?.ambient ?? [0, 0, 0];
  validateColor(ambient, "ambient");

  validateEnvironment(lighting?.environment);
  let environment = lighting?.environment;
  const prefilter = resolvePrefilterOptions(options.environmentPrefilter);
  if (environment && prefilter) {
    environment = prefilterEnvironmentWithOptions(environment, prefilter);
  }

  const emitters: EmissiveObject[] = [];
  for (let index = 0; index < (lighting?.emitters?.length ?? 0); index += 1) {
    emitters.push(emissiveObject(lighting!.emitters![index], index));
  }
  for (let index = 0; index < (lighting?.points?.length ?? 0); index += 1) {
    emitters.push(createEmissiveSphere(lighting!.points![index], options.pointSegments, index));
  }

  return { ambient, environment, emitters };
}

/** Build an emissive sphere proxy for a point light. */
export function createEmissiveSphere(
  point: PointLightInput,
  segments = 20,
  index = 0
): EmissiveObject {
  if (!Array.isArray(point.position) || point.position.length !== 3 || point.position.some((v) => !Number.isFinite(v))) {
    throw new StudioError(`point light ${index}: position must be three finite values`, "validation");
  }
  validateColor(point.color, `point light ${index} color`, true);
  if (!Number.isFinite(point.power) || point.power < 0) {
    throw new StudioError(`point light ${index}: power ${point.power} must be finite and non-negative`, "validation");
  }
  const radius = point.radius ?? DEFAULT_POINT_RADIUS;
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new StudioError(`point light ${index}: radius ${radius} must be finite and positive`, "validation");
  }
  if (!Number.isInteger(segments) || segments < 6) {
    throw new StudioError(`point light ${index}: segments ${segments} must be an integer >= 6`, "validation");
  }

  const scale = point.power / (4 * Math.PI * Math.PI * radius * radius);
  const radiance: Vec3 = [
    point.color[0] * scale,
    point.color[1] * scale,
    point.color[2] * scale
  ];
  const info: PointLightInfo = {
    position: [...point.position] as Vec3,
    color: [...point.color] as Vec3,
    power: point.power,
    radius,
    radiance
  };

  const geometry = sphereGeometry(point.position, radius, segments);
  return {
    name: point.name ?? `point light ${index + 1}`,
    positions: geometry.positions,
    normals: geometry.normals,
    indices: geometry.indices,
    emissive: radiance,
    triangleCount: geometry.indices.length / 3,
    source: "point",
    point: info
  };
}

function emissiveObject(mesh: EmissiveMeshInput, index: number): EmissiveObject {
  const name = mesh.name || `emitter ${index + 1}`;
  if (!mesh.positions || mesh.positions.length === 0 || mesh.positions.length % 3 !== 0) {
    throw new StudioError(`${name}: positions must be a non-empty xyz array`, "validation");
  }
  if (!mesh.normals || mesh.normals.length !== mesh.positions.length) {
    throw new StudioError(`${name}: normals must match positions`, "validation");
  }
  if (!mesh.indices || mesh.indices.length === 0 || mesh.indices.length % 3 !== 0) {
    throw new StudioError(`${name}: indices must be a non-empty triangle list`, "validation");
  }
  const vertexCount = mesh.positions.length / 3;
  for (let i = 0; i < mesh.indices.length; i += 1) {
    if (mesh.indices[i] >= vertexCount) {
      throw new StudioError(`${name}: index ${mesh.indices[i]} is out of range`, "validation");
    }
  }
  assertFinite(mesh.positions, `${name} positions`);
  assertFinite(mesh.normals, `${name} normals`);
  validateColor(mesh.emissive, `${name} emissive`, true);

  return {
    name,
    positions: mesh.positions,
    normals: mesh.normals,
    indices: new Uint32Array(mesh.indices),
    emissive: [...mesh.emissive] as Vec3,
    triangleCount: mesh.indices.length / 3,
    source: "emitter"
  };
}

function sphereGeometry(
  center: Vec3,
  radius: number,
  segments: number
): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {
  const slices = Math.max(6, Math.round(segments));
  const stacks = Math.max(3, Math.round(segments / 2));
  const vertexCount = (stacks + 1) * (slices + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);

  let vertex = 0;
  for (let stack = 0; stack <= stacks; stack += 1) {
    const theta = (stack / stacks) * Math.PI;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    for (let slice = 0; slice <= slices; slice += 1) {
      const phi = (slice / slices) * Math.PI * 2;
      const x = sinTheta * Math.cos(phi);
      const y = cosTheta;
      const z = sinTheta * Math.sin(phi);
      normals[vertex * 3] = x;
      normals[vertex * 3 + 1] = y;
      normals[vertex * 3 + 2] = z;
      positions[vertex * 3] = center[0] + x * radius;
      positions[vertex * 3 + 1] = center[1] + y * radius;
      positions[vertex * 3 + 2] = center[2] + z * radius;
      vertex += 1;
    }
  }

  const indices = new Uint32Array(stacks * slices * 6);
  let offset = 0;
  for (let stack = 0; stack < stacks; stack += 1) {
    for (let slice = 0; slice < slices; slice += 1) {
      const a = stack * (slices + 1) + slice;
      const b = a + 1;
      const c = a + (slices + 1);
      const d = c + 1;
      indices[offset] = a;
      indices[offset + 1] = c;
      indices[offset + 2] = b;
      indices[offset + 3] = b;
      indices[offset + 4] = c;
      indices[offset + 5] = d;
      offset += 6;
    }
  }

  return { positions, normals, indices };
}

function validateColor(value: Vec3, label: string, nonNegative = false): void {
  if (!Array.isArray(value) || value.length !== 3 || value.some((component) => !Number.isFinite(component))) {
    throw new StudioError(`${label} must be three finite values`, "validation");
  }
  if (nonNegative && value.some((component) => component < 0)) {
    throw new StudioError(`${label} must be non-negative`, "validation");
  }
}

function assertFinite(values: Float32Array, label: string): void {
  for (let i = 0; i < values.length; i += 1) {
    if (!Number.isFinite(values[i])) {
      throw new StudioError(`${label}: non-finite value at index ${i}`, "validation");
    }
  }
}
