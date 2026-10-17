import { describe, it, expect } from "vitest";
import { isAbortError } from "../lib/abort";

describe("isAbortError", () => {
  it("recognizes the DOMException fetch aborts throw", () => {
    expect(isAbortError(new DOMException("The operation was aborted.", "AbortError"))).toBe(true);
  });

  it("recognizes abort-shaped plain errors (undici, polyfills)", () => {
    const err = new Error("The operation was aborted.");
    err.name = "AbortError";
    expect(isAbortError(err)).toBe(true);
  });

  it("recognizes signal.reason aborts (AbortController.abort())", () => {
    const ctrl = new AbortController();
    ctrl.abort();
    // fetch rejects with the signal's reason — DOMException("AbortError").
    expect(isAbortError(ctrl.signal.reason)).toBe(true);
  });

  it("rejects every other error — real failures must surface", () => {
    expect(isAbortError(new Error("network down"))).toBe(false);
    expect(isAbortError(new TypeError("failed to fetch"))).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });
});
