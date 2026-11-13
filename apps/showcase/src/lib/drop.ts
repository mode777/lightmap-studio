/**
 * Pure drop-pipeline helpers: classifying dropped entries by extension and
 * building the sidebar tree structure. DOM access lives in dropDom.ts; these
 * functions are covered by node --test unit tests.
 */

export type FileRole = "document" | "part" | "unsupported";

export const DOCUMENT_EXTENSIONS: readonly string[] = ["glb", "gltf"];
export const PART_EXTENSIONS: readonly string[] = ["bin", "png", "jpg", "jpeg", "webp"];

export interface DroppedFile {
  /** Path relative to the drop root, e.g. "assets/textures/wall.png". */
  path: string;
  file: File;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export function classifyFileName(name: string): FileRole {
  const extension = extensionOf(name);
  if (DOCUMENT_EXTENSIONS.includes(extension)) return "document";
  if (PART_EXTENSIONS.includes(extension)) return "part";
  return "unsupported";
}

export function basenameOf(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slash === -1 ? path : path.slice(slash + 1);
}

export function stemOf(name: string): string {
  const base = basenameOf(name);
  const dot = base.lastIndexOf(".");
  return dot === -1 ? base : base.slice(0, dot);
}

export interface TreePart {
  kind: "part";
  name: string;
  path: string;
}

export interface TreeDocument {
  kind: "document";
  name: string;
  path: string;
  file: File;
  parts: TreePart[];
}

/** Parts that match no document by stem prefix. */
export interface TreeGroup {
  kind: "group";
  name: string;
  parts: TreePart[];
}

export type TreeEntry = TreeDocument | TreeGroup;

const SUPPORTING_FILES_GROUP = "Supporting files";

/**
 * Group parts under the document whose stem is the longest prefix of the
 * part's file name; leftovers land in a shared "Supporting files" group.
 */
export function buildFileTree(files: DroppedFile[]): TreeEntry[] {
  const documents: TreeDocument[] = [];
  const parts: TreePart[] = [];

  for (const { path, file } of files) {
    const role = classifyFileName(file.name);
    if (role === "document") {
      documents.push({ kind: "document", name: file.name, path, file, parts: [] });
    } else if (role === "part") {
      parts.push({ kind: "part", name: file.name, path });
    }
  }

  const leftover: TreePart[] = [];
  for (const part of parts) {
    const name = basenameOf(part.path);
    let owner: TreeDocument | null = null;
    let ownerStemLength = 0;
    for (const document of documents) {
      const stem = stemOf(document.name);
      if (name.startsWith(stem) && stem.length > ownerStemLength) {
        owner = document;
        ownerStemLength = stem.length;
      }
    }
    if (owner) owner.parts.push(part);
    else leftover.push(part);
  }

  const entries: TreeEntry[] = documents;
  if (leftover.length > 0) {
    entries.push({ kind: "group", name: SUPPORTING_FILES_GROUP, parts: leftover });
  }
  return entries;
}
