import type { ExtractedEntry } from "./extract.ts";
import type * as THREE from "three";

/** The currently loaded document plus its bake bookkeeping. */
export interface ActiveDocument {
  sourceName: string;
  sourcePath: string;
  root: THREE.Group;
  entries: ExtractedEntry[];
  triangleCount: number;
}
