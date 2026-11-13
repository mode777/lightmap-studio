/**
 * Scene traversal: turn loaded three.js meshes into lightmap-studio
 * MeshInput entries. Each mesh primitive becomes one entry with world-space
 * geometry; the entry keeps the bookkeeping needed to write bake results
 * (atlas UVs, aoMap) back onto the right object.
 */
import * as THREE from "three";
import type { MeshInput } from "lightmap-studio";

export interface ExtractedEntry {
  /** Node path, e.g. "walls/wall_left[0]". */
  name: string;
  mesh: THREE.Mesh;
  /** Source geometry (pre-clone); several entries can share one geometry. */
  geometry: THREE.BufferGeometry;
  /** Material this primitive resolved to on the source mesh. */
  material: THREE.Material;
  /** Index into the source mesh's material array (0 for a single material). */
  materialIndex: number;
  input: MeshInput;
}

export function extractMeshInputs(root: THREE.Object3D): ExtractedEntry[] {
  root.updateWorldMatrix(true, true);

  const entries: ExtractedEntry[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (!object.visible) return;
    const geometry = object.geometry as THREE.BufferGeometry;
    const position = geometry.getAttribute("position");
    if (!position) return;

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const groups = geometry.groups.length > 0 ? geometry.groups : [defaultGroup(geometry)];
    const objectName = pathOf(object, root);

    groups.forEach((group, groupIndex) => {
      const requestedIndex = group.materialIndex ?? 0;
      const material = materials[requestedIndex] ?? materials[0];
      if (!material) return;
      const indices = primitiveIndices(geometry, group);
      if (!indices || indices.length < 3) return;

      entries.push({
        name: groups.length > 1 ? `${objectName}[${groupIndex}]` : objectName,
        mesh: object,
        geometry,
        material,
        materialIndex: materials[requestedIndex] ? requestedIndex : 0,
        input: {
          name: groups.length > 1 ? `${objectName}[${groupIndex}]` : objectName,
          positions: worldPositions(geometry, object.matrixWorld),
          normals: worldNormals(geometry, object.matrixWorld),
          indices,
          albedo: linearAlbedo(material)
        }
      });
    });
  });

  return entries;
}

interface GeometryGroup {
  start: number;
  count: number;
  materialIndex?: number;
}

function defaultGroup(geometry: THREE.BufferGeometry): GeometryGroup {
  const count = geometry.getIndex()?.count ?? geometry.getAttribute("position")?.count ?? 0;
  return { start: 0, count, materialIndex: 0 };
}

function primitiveIndices(
  geometry: THREE.BufferGeometry,
  group: GeometryGroup
): Uint32Array | null {
  const index = geometry.getIndex();
  if (index) {
    if (group.start + group.count > index.count) return null;
    const source = index.array;
    const out = new Uint32Array(group.count);
    for (let i = 0; i < group.count; i += 1) {
      out[i] = source[group.start + i]!;
    }
    return out;
  }
  const positionCount = geometry.getAttribute("position")?.count ?? 0;
  if (group.start + group.count > positionCount) return null;
  const out = new Uint32Array(group.count);
  for (let i = 0; i < group.count; i += 1) {
    out[i] = group.start + i;
  }
  return out;
}

function worldPositions(
  geometry: THREE.BufferGeometry,
  matrixWorld: THREE.Matrix4
): Float32Array {
  const attribute = geometry.getAttribute("position");
  const out = new Float32Array(attribute.count * 3);
  const vector = new THREE.Vector3();
  for (let i = 0; i < attribute.count; i += 1) {
    vector.fromBufferAttribute(attribute, i).applyMatrix4(matrixWorld);
    out[i * 3] = vector.x;
    out[i * 3 + 1] = vector.y;
    out[i * 3 + 2] = vector.z;
  }
  return out;
}

function worldNormals(
  geometry: THREE.BufferGeometry,
  matrixWorld: THREE.Matrix4
): Float32Array {
  let attribute = geometry.getAttribute("normal");
  if (!attribute) {
    // AO needs normals; compute flat-ish vertex normals for rare un-normalized geometry.
    const clone = geometry.clone();
    clone.computeVertexNormals();
    attribute = clone.getAttribute("normal");
  }
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrixWorld);
  const out = new Float32Array(attribute.count * 3);
  const vector = new THREE.Vector3();
  for (let i = 0; i < attribute.count; i += 1) {
    vector.fromBufferAttribute(attribute, i).applyMatrix3(normalMatrix).normalize();
    out[i * 3] = vector.x;
    out[i * 3 + 1] = vector.y;
    out[i * 3 + 2] = vector.z;
  }
  return out;
}

function linearAlbedo(material: THREE.Material): [number, number, number] {
  if (!(material instanceof THREE.MeshStandardMaterial)) return [0.8, 0.8, 0.8];
  const target = new THREE.Color();
  material.color.getRGB(target, THREE.LinearSRGBColorSpace);
  return [target.r, target.g, target.b];
}

function pathOf(object: THREE.Object3D, root: THREE.Object3D): string {
  const names: string[] = [];
  let current: THREE.Object3D | null = object;
  while (current && current !== root) {
    if (current.name) names.unshift(current.name);
    current = current.parent;
  }
  return names.join("/") || object.type || "mesh";
}
