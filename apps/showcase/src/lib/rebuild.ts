/**
 * Rebuild a source mesh for baking. The lightmapper unwraps each primitive
 * into its own indexed mesh and may duplicate vertices at chart seams, so its
 * lightmap UVs cannot be written onto the source geometry's vertex buffer.
 * Instead, this module assembles one geometry per source mesh:
 *
 * - every baked primitive contributes its unwrapped vertices (positions,
 *   normals, lightmap UVs and indices);
 * - every other source attribute (TEXCOORD_0, colors, skin data, tangents,
 *   morph targets) is carried over through `UnwrappedObject.xref`;
 * - primitive groups and their material indices are preserved so multi-material
 *   meshes still render and export the same way.
 */
import * as THREE from "three";
import type { UnwrappedObject } from "lightmap-studio";
import type { ExtractedEntry } from "./extract.ts";

export interface BakedPart {
  entry: ExtractedEntry;
  unwrapped: UnwrappedObject;
}

type AnyBufferAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

interface TypedArrayConstructor {
  new (length: number): THREE.TypedArray;
}

function attributeArrayConstructor(attribute: AnyBufferAttribute): TypedArrayConstructor {
  const source =
    attribute instanceof THREE.InterleavedBufferAttribute
      ? (attribute.data.array as THREE.TypedArray)
      : attribute.array;
  return source.constructor as TypedArrayConstructor;
}

function copyAttributeByXref(
  attribute: AnyBufferAttribute,
  parts: BakedPart[],
  vertexCount: number
): THREE.BufferAttribute {
  const Ctor = attributeArrayConstructor(attribute);
  const target = new Ctor(vertexCount * attribute.itemSize);
  let vertex = 0;
  for (const part of parts) {
    const xref = part.unwrapped.xref;
    const count = part.unwrapped.positions.length / 3;
    for (let i = 0; i < count; i += 1) {
      const sourceVertex = xref[i] ?? 0;
      for (let component = 0; component < attribute.itemSize; component += 1) {
        target[vertex * attribute.itemSize + component] = attribute.getComponent(
          sourceVertex,
          component
        );
      }
      vertex += 1;
    }
  }
  return new THREE.BufferAttribute(target, attribute.itemSize, attribute.normalized);
}

function copyMorphAttributes(
  source: THREE.BufferGeometry,
  target: THREE.BufferGeometry,
  parts: BakedPart[],
  vertexCount: number
): void {
  const morphAttributes = source.morphAttributes as Record<string, AnyBufferAttribute[]>;
  if (!morphAttributes || Object.keys(morphAttributes).length === 0) return;

  const targetMorphAttributes = target.morphAttributes as Record<string, THREE.BufferAttribute[]>;
  for (const [name, attributes] of Object.entries(morphAttributes)) {
    targetMorphAttributes[name] = attributes.map((attribute) =>
      copyAttributeByXref(attribute, parts, vertexCount)
    );
  }
  target.morphTargetsRelative = source.morphTargetsRelative;
}

/**
 * Assemble one baked mesh from its per-primitive unwrap results. `multiMaterial`
 * controls whether primitive groups are written (a single-material mesh does
 * not need groups and should stay one glTF primitive).
 */
export function rebuildBakedGeometry(parts: BakedPart[], multiMaterial: boolean): THREE.BufferGeometry {
  if (parts.length === 0) throw new Error("cannot rebuild a mesh without baked parts");
  const source = parts[0]!.entry.geometry;
  const sourceVertexCount = source.getAttribute("position")?.count ?? 0;
  let vertexCount = 0;
  let indexCount = 0;
  for (const part of parts) {
    vertexCount += part.unwrapped.positions.length / 3;
    indexCount += part.unwrapped.indices.length;
  }

  const geometry = new THREE.BufferGeometry();
  const lightmapUvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(indexCount);

  let vertexOffset = 0;
  let indexOffset = 0;
  for (const part of parts) {
    const partVertices = part.unwrapped.positions.length / 3;
    const xref = part.unwrapped.xref;
    if (!xref || xref.length !== partVertices) {
      throw new Error(
        `${part.entry.name}: unwrapped result is missing a complete xref mapping`
      );
    }
    for (let i = 0; i < partVertices; i += 1) {
      if (xref[i]! >= sourceVertexCount) {
        throw new Error(
          `${part.entry.name}: xref ${xref[i]} is outside the source vertex range`
        );
      }
    }
    lightmapUvs.set(part.unwrapped.uvs, vertexOffset * 2);
    for (let i = 0; i < part.unwrapped.indices.length; i += 1) {
      indices[indexOffset + i] = part.unwrapped.indices[i]! + vertexOffset;
    }
    if (multiMaterial) {
      geometry.addGroup(
        indexOffset,
        part.unwrapped.indices.length,
        part.entry.materialIndex
      );
    }
    vertexOffset += partVertices;
    indexOffset += part.unwrapped.indices.length;
  }

  // Carry every source attribute across the xatlas seam duplication. `uv1` is
  // replaced by the baked atlas coordinates and is deliberately not copied.
  for (const [name, attribute] of Object.entries(source.attributes)) {
    if (name === "uv1") continue;
    geometry.setAttribute(name, copyAttributeByXref(attribute, parts, vertexCount));
  }
  geometry.setAttribute("uv1", new THREE.BufferAttribute(lightmapUvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  copyMorphAttributes(source, geometry, parts, vertexCount);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
