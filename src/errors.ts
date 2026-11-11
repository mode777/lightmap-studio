import { BakeError } from "./bake/types.js";

export type StudioErrorCode =
  | "webgl2"
  | "float"
  | "assets"
  | "validation"
  | "atlas"
  | "aborted"
  | "disposed"
  | "busy"
  | "bake";

export class StudioError extends Error {
  readonly code: StudioErrorCode;

  constructor(message: string, code: StudioErrorCode, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StudioError";
    this.code = code;
  }
}

export function abortError(message = "bake aborted"): StudioError {
  return new StudioError(message, "aborted");
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof StudioError && error.code === "aborted") ||
    (error instanceof BakeError && error.code === "aborted") ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}
