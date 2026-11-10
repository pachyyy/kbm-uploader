/**
 * Which screen the upload page shows. Previously this was spelled out as
 * boolean combinations (`teachers === null && loadError`, `teachers && !mappingDone`)
 * inside the JSX; naming the four phases keeps the page and the docs in step.
 *
 *   loading ──(fetch fails, nothing cached)──▶ load_error
 *   loading ──(teachers known)──▶ needs_mapping ──(every teacher assigned)──▶ ready
 *
 * Derived, not stored: the inputs are the single source of truth.
 */
export type UploadPhase = "loading" | "load_error" | "needs_mapping" | "ready";

export function uploadPhase(input: {
  teachersLoaded: boolean;
  loadError: string | null;
  mappingDone: boolean;
}): UploadPhase {
  if (!input.teachersLoaded) return input.loadError ? "load_error" : "loading";
  return input.mappingDone ? "ready" : "needs_mapping";
}
