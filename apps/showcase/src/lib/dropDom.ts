/**
 * DOM side of the drop pipeline: turning a DataTransfer into DroppedFile[]
 * with relative paths, traversing dropped folders recursively.
 */
import { classifyFileName, type DroppedFile } from "./drop.ts";

interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file(success: (file: File) => void, failure?: (error: unknown) => void): void;
  createReader(): {
    readEntries(success: (entries: FileSystemEntryLike[]) => void, failure?: (error: unknown) => void): void;
  };
}

interface DataTransferItemLike {
  webkitGetAsEntry?: () => FileSystemEntryLike | null;
}

export interface IngestResult {
  files: DroppedFile[];
  /** Paths of dropped entries that were skipped, with the reason. */
  skipped: Array<{ path: string; reason: string }>;
}

/** Read every recognized file from a drop event, recursing into folders. */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<IngestResult> {
  const entries = collectEntries(dt);
  if (entries.length > 0) {
    const files: DroppedFile[] = [];
    const skipped: IngestResult["skipped"] = [];
    for (const entry of entries) {
      await collectFromEntry(entry, files, skipped);
    }
    return { files, skipped };
  }

  // Plain file drop without entry access (e.g. some drag sources).
  const files: DroppedFile[] = [];
  const skipped: IngestResult["skipped"] = [];
  for (const file of dt.files) {
    noteFile(file.name, file, files, skipped);
  }
  return { files, skipped };
}

function collectEntries(dt: DataTransfer): FileSystemEntryLike[] {
  const entries: FileSystemEntryLike[] = [];
  for (const item of dt.items) {
    const entry = (item as DataTransferItemLike).webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  return entries;
}

async function collectFromEntry(
  entry: FileSystemEntryLike,
  files: DroppedFile[],
  skipped: IngestResult["skipped"]
): Promise<void> {
  if (entry.isFile) {
    const file = await entryToFile(entry);
    noteFile(entry.fullPath.replace(/^\//, ""), file, files, skipped);
    return;
  }
  if (entry.isDirectory) {
    const children = await readDirectory(entry);
    for (const child of children) {
      await collectFromEntry(child, files, skipped);
    }
  }
}

function noteFile(
  path: string,
  file: File,
  files: DroppedFile[],
  skipped: IngestResult["skipped"]
): void {
  const role = classifyFileName(file.name);
  if (role === "unsupported") {
    skipped.push({ path, reason: "unsupported file type" });
    return;
  }
  files.push({ path, file });
}

function entryToFile(entry: FileSystemEntryLike): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

/**
 * readEntries returns results in batches; keep calling until it yields an
 * empty array or the directory reports no more entries.
 */
function readDirectory(directory: FileSystemEntryLike): Promise<FileSystemEntryLike[]> {
  const reader = directory.createReader();
  const all: FileSystemEntryLike[] = [];
  return new Promise((resolve, reject) => {
    const readBatch = (): void => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all);
          return;
        }
        all.push(...batch);
        readBatch();
      }, reject);
    };
    readBatch();
  });
}
