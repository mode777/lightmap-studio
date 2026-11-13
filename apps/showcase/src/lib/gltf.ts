/**
 * glTF document ingestion: pure inspection of the document JSON (before any
 * external part is fetched) plus GLTFLoader parsing with blob-URL resolution
 * against the dropped file set.
 */
import { LoadingManager } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Group } from "three";
import { basenameOf, type DroppedFile } from "./drop.ts";

/** Compression extensions the showcase deliberately does not decode. */
export const UNSUPPORTED_EXTENSIONS: readonly string[] = [
  "KHR_draco_mesh_compression",
  "KHR_texture_basisu",
  "EXT_meshopt_compression"
];

export function findUnsupportedExtension(extensionsUsed: readonly string[]): string | null {
  for (const used of extensionsUsed) {
    if (UNSUPPORTED_EXTENSIONS.includes(used)) return used;
  }
  return null;
}

export interface DocumentSummary {
  extensionsUsed: string[];
}

/** Parse the JSON chunk of a GLB container without touching external parts. */
export function inspectGlb(bytes: Uint8Array): DocumentSummary {
  if (bytes.byteLength < 20) throw new Error("not a valid GLB container (too short)");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== 0x46546c67) throw new Error("not a valid GLB container (bad magic)");
  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`unsupported GLB version ${version}`);
  const chunkLength = view.getUint32(12, true);
  const chunkType = view.getUint32(16, true);
  if (chunkType !== 0x4e4f534a) throw new Error("GLB container has no JSON chunk");
  const json = new TextDecoder().decode(bytes.subarray(20, 20 + chunkLength));
  return inspectGltfJson(json);
}

export function inspectGltfJson(text: string): DocumentSummary {
  let json: { extensionsUsed?: unknown };
  try {
    json = JSON.parse(text) as { extensionsUsed?: unknown };
  } catch {
    throw new Error("document is not valid JSON");
  }
  const extensionsUsed = Array.isArray(json.extensionsUsed)
    ? (json.extensionsUsed as string[])
    : [];
  return { extensionsUsed };
}

export function dirnameOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function joinPath(directory: string, relative: string): string {
  if (directory === "") return relative;
  return `${directory}/${relative}`;
}

/**
 * Build a LoadingManager URL modifier that resolves every referenced part
 * against the dropped file set via blob URLs. Unresolvable references throw
 * with the missing file named, which GLTFLoader surfaces as a load error.
 */
export function createBlobUrlResolver(
  files: DroppedFile[],
  documentDirectory: string
): (url: string) => string {
  const byPath = new Map<string, string>();
  const byBasename = new Map<string, string>();
  for (const { path, file } of files) {
    const blobUrl = URL.createObjectURL(file);
    if (!byPath.has(path)) byPath.set(path, blobUrl);
    const base = basenameOf(path);
    if (!byBasename.has(base)) byBasename.set(base, blobUrl);
  }

  return (raw) => {
    if (raw.startsWith("data:") || raw.startsWith("blob:")) return raw;
    let cleaned = (raw.split(/[?#]/)[0] ?? raw).replace(/\\/g, "/");
    try {
      cleaned = decodeURIComponent(cleaned);
    } catch {
      // Keep the raw text when it is not valid percent-encoding.
    }
    cleaned = cleaned.replace(/^\.\//, "");
    const candidates = [
      joinPath(documentDirectory, cleaned),
      cleaned,
      basenameOf(cleaned)
    ];
    for (const candidate of candidates) {
      const resolved = byPath.get(candidate) ?? byBasename.get(basenameOf(candidate));
      if (resolved) return resolved;
    }
    throw new Error(`missing document part: ${cleaned}`);
  };
}

export interface ParsedDocument {
  scene: Group;
  /** glTF animations, cameras etc. are preserved on the raw gltf result. */
  raw: Awaited<ReturnType<GLTFLoader["loadAsync"]>>;
}

/** Inspect, then parse a dropped document. Throws before fetch on rejection. */
export async function parseDocument(
  document: DroppedFile,
  files: DroppedFile[]
): Promise<ParsedDocument> {
  const bytes = new Uint8Array(await document.file.arrayBuffer());
  const isGlb = /\.glb$/i.test(document.file.name);
  const summary = isGlb ? inspectGlb(bytes) : inspectGltfJson(new TextDecoder().decode(bytes));

  const unsupported = findUnsupportedExtension(summary.extensionsUsed);
  if (unsupported) {
    throw new Error(`unsupported compression extension: ${unsupported}`);
  }

  const manager = new LoadingManager();
  manager.setURLModifier(createBlobUrlResolver(files, dirnameOf(document.path)));
  const loader = new GLTFLoader(manager);

  const raw = await new Promise<Awaited<ReturnType<GLTFLoader["loadAsync"]>>>((resolve, reject) => {
    const onDone = (gltf: Awaited<ReturnType<GLTFLoader["loadAsync"]>>): void => resolve(gltf);
    const onError = (error: unknown): void => {
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    if (isGlb) {
      const buffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer
        : bytes.slice().buffer;
      loader.parse(buffer, "", onDone, onError);
    } else {
      loader.parse(new TextDecoder().decode(bytes), "", onDone, onError);
    }
  });

  return { scene: raw.scene, raw };
}
