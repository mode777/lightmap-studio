import type { Mesh, XAtlasModule } from "xatlas-wasm";
import { AddMeshError } from "xatlas-wasm";

import type {
  AtlasMetadata,
  MeshInput,
  UnwrappedObject,
  UnwrappedScene,
  Vec3
} from "../types.js";

export const UV_MAX = 1 - 1e-6;
const UV_AREA_EPSILON = 1e-14;

/**
 * Normalize an xatlas texel coordinate. The lightmapper's positive-mod maps
 * exactly 1.0 to 0.0, so the atlas edge is clamped to `UV_MAX`; coordinates
 * outside the atlas are invalid and rejected.
 */
export function normalizeAtlasUv(texel: number, size: number): number {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`atlas UV: invalid atlas size ${size}`);
  }
  if (!Number.isFinite(texel)) {
    throw new Error(`atlas UV: non-finite texel coordinate ${texel}`);
  }
  if (texel < 0 || texel > size) {
    throw new Error(`atlas UV: texel ${texel} is outside the atlas range [0, ${size}]`);
  }
  return Math.min(Math.max(texel / size, 0), UV_MAX);
}

export interface UnwrapMeshesOptions {
  module: XAtlasModule;
  size: number;
  label?: string;
}

/** Unwrap lit meshes into one shared atlas. Emissive meshes are not handled. */
export function unwrapMeshes(
  meshes: MeshInput[],
  options: UnwrapMeshesOptions
): UnwrappedScene {
  const label = options.label ?? "scene";
  if (meshes.length === 0) throw new Error(`${label}: no lit meshes to unwrap`);
  if (!Number.isInteger(options.size) || options.size <= 0) {
    throw new Error(`${label}: invalid atlas size ${options.size}`);
  }

  const atlas = options.module.createAtlas();
  try {
    for (const mesh of meshes) {
      validateLitInput(label, mesh);
      const error = atlas.addMesh({
        positions: mesh.positions,
        normals: mesh.normals,
        indices: mesh.indices,
        meshCountHint: meshes.length
      });
      if (error !== AddMeshError.Success) {
        throw new Error(
          `${label}/${mesh.name ?? "mesh"}: xatlas addMesh failed: ${options.module.addMeshErrorString(error)}`
        );
      }
    }

    atlas.generate(
      { maxIterations: 1 },
      {
        resolution: options.size,
        padding: 2,
        bilinear: true,
        blockAlign: true
      }
    );

    if (atlas.meshCount !== meshes.length) {
      throw new Error(
        `${label}: xatlas produced ${atlas.meshCount} meshes for ${meshes.length} inputs`
      );
    }
    if (atlas.atlasCount !== 1) {
      throw new Error(`${label}: xatlas produced ${atlas.atlasCount} atlases; one is required`);
    }
    if (atlas.width <= 0 || atlas.height <= 0) {
      throw new Error(`${label}: xatlas produced an empty atlas`);
    }

    const litObjects = meshes.map((mesh, index) =>
      unwrapObject(label, mesh, atlas.getMesh(index), atlas.width, atlas.height)
    );

    const metadata: AtlasMetadata = {
      width: atlas.width,
      height: atlas.height,
      chartCount: atlas.chartCount,
      utilization: atlas.getUtilization(0)
    };

    return { litObjects, emissiveObjects: [], atlas: metadata };
  } finally {
    atlas.destroy();
  }
}

function validateLitInput(label: string, mesh: MeshInput): void {
  const name = mesh.name || "mesh";
  if (!mesh.normals) throw new Error(`${label}/${name}: lit mesh needs normals for xatlas`);
  if (mesh.positions.length === 0 || mesh.indices.length === 0) {
    throw new Error(`${label}/${name}: lit mesh has empty geometry`);
  }
  if (mesh.positions.length % 3 !== 0) {
    throw new Error(`${label}/${name}: positions must be an xyz array`);
  }
  if (mesh.normals.length !== mesh.positions.length) {
    throw new Error(`${label}/${name}: normals must match positions`);
  }
  if (mesh.indices.length % 3 !== 0) {
    throw new Error(`${label}/${name}: indices must be a triangle list`);
  }
  const vertexCount = mesh.positions.length / 3;
  for (let i = 0; i < mesh.indices.length; i += 1) {
    if (mesh.indices[i] >= vertexCount) {
      throw new Error(`${label}/${name}: index ${mesh.indices[i]} is out of range`);
    }
  }
  assertFinite(mesh.positions, `${label}/${name} positions`);
  assertFinite(mesh.normals, `${label}/${name} normals`);
  if (mesh.albedo !== undefined) {
    if (!Array.isArray(mesh.albedo) || mesh.albedo.length !== 3 || mesh.albedo.some((v) => !Number.isFinite(v))) {
      throw new Error(`${label}/${name}: albedo must be three finite values`);
    }
  }
}

function unwrapObject(
  sceneId: string,
  input: MeshInput,
  output: Mesh,
  width: number,
  height: number
): UnwrappedObject {
  const name = input.name || "mesh";
  const label = `${sceneId}/${name}`;
  if (output.indexCount === 0) throw new Error(`${label}: xatlas output has no indices`);
  if (output.indices.length % 3 !== 0) throw new Error(`${label}: xatlas output is not triangles`);

  const inputNormals = input.normals;
  if (!inputNormals) throw new Error(`${label}: missing input normals`);

  const positions = new Float32Array(output.vertexCount * 3);
  const normals = new Float32Array(output.vertexCount * 3);
  const uvs = new Float32Array(output.vertexCount * 2);
  const charts = new Uint32Array(output.vertexCount);
  const inputVertexCount = input.positions.length / 3;

  for (let i = 0; i < output.vertexCount; i += 1) {
    const vertex = output.vertices[i];
    const xref = vertex.xref;
    if (!Number.isInteger(xref) || xref < 0 || xref >= inputVertexCount) {
      throw new Error(`${label}: xatlas xref ${xref} at vertex ${i} is out of range`);
    }
    positions[i * 3] = input.positions[xref * 3];
    positions[i * 3 + 1] = input.positions[xref * 3 + 1];
    positions[i * 3 + 2] = input.positions[xref * 3 + 2];
    normals[i * 3] = inputNormals[xref * 3];
    normals[i * 3 + 1] = inputNormals[xref * 3 + 1];
    normals[i * 3 + 2] = inputNormals[xref * 3 + 2];
    uvs[i * 2] = normalizeAtlasUv(vertex.uv[0], width);
    uvs[i * 2 + 1] = normalizeAtlasUv(vertex.uv[1], height);
    charts[i] = vertex.chartIndex;
  }

  const indices = new Uint32Array(output.indices);
  assertFinite(positions, `${label} positions`);
  assertFinite(normals, `${label} normals`);
  assertFinite(uvs, `${label} uvs`);
  validateUvTriangles(label, uvs, indices);

  const albedo: Vec3 = input.albedo ?? [0.8, 0.8, 0.8];

  return {
    name,
    positions,
    normals,
    uvs,
    indices,
    charts,
    albedo,
    triangleCount: indices.length / 3,
    chartCount: output.chartCount
  };
}

function validateUvTriangles(label: string, uvs: Float32Array, indices: Uint32Array): void {
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 2;
    const b = indices[i + 1] * 2;
    const c = indices[i + 2] * 2;
    const ua = uvs[a];
    const va = uvs[a + 1];
    const ub = uvs[b];
    const vb = uvs[b + 1];
    const uc = uvs[c];
    const vc = uvs[c + 1];
    if (
      ua < 0 || ua >= 1 || va < 0 || va >= 1 ||
      ub < 0 || ub >= 1 || vb < 0 || vb >= 1 ||
      uc < 0 || uc >= 1 || vc < 0 || vc >= 1
    ) {
      throw new Error(`${label}: UV outside [0, 1) at triangle ${i / 3}`);
    }
    const area = Math.abs((ub - ua) * (vc - va) - (uc - ua) * (vb - va)) * 0.5;
    if (!(area > UV_AREA_EPSILON)) {
      throw new Error(`${label}: degenerate UV triangle ${i / 3} (area ${area})`);
    }
  }
}

function assertFinite(values: Float32Array, label: string): void {
  for (let i = 0; i < values.length; i += 1) {
    if (!Number.isFinite(values[i])) {
      throw new Error(`${label}: non-finite value at index ${i}: ${values[i]}`);
    }
  }
}
