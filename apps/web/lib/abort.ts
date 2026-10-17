/**
 * Abort detection for client fetch effects.
 *
 * Unmounting a component (and React StrictMode's dev double-mount) aborts its
 * in-flight requests via the effect cleanup. That rejection is a lifecycle
 * artifact, not a failure — surfacing it (Next's dev overlay, an error
 * boundary) would blame the user for navigating away. Everything else —
 * network errors, JSON failures — must keep surfacing.
 */
export function isAbortError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  return (err as { name?: unknown }).name === "AbortError";
}
