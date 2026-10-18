import { describe, it, expect, vi, afterEach } from "vitest";
import { hashPassword, verifyPassword, verifyAgainstDummy, createSessionToken, verifySessionToken } from "../lib/auth";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("password hashing", () => {
  it("hashes and verifies", async () => {
    const h = await hashPassword("correct horse");
    expect(await verifyPassword(h, "correct horse")).toBe(true);
    expect(await verifyPassword(h, "wrong")).toBe(false);
  });
  it("never returns the raw password", async () => {
    const h = await hashPassword("secret123");
    expect(h).not.toContain("secret123");
  });
  it("salts so two hashes of the same password differ", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
  });
  it("verifyAgainstDummy always fails (login timing equalization)", async () => {
    expect(await verifyAgainstDummy("anything")).toBe(false);
  });
});

describe("session tokens", () => {
  it("round-trips a valid token to the same userId", () => {
    const tok = createSessionToken("user-1");
    expect(verifySessionToken(tok)).toEqual({ userId: "user-1" });
  });
  it("rejects a tampered token", () => {
    const tok = createSessionToken("user-1");
    const tampered = tok.slice(0, -2) + (tok.endsWith("aa") ? "bb" : "aa");
    expect(verifySessionToken(tampered)).toBeNull();
  });
  it("rejects garbage", () => {
    expect(verifySessionToken("not-a-token")).toBeNull();
    expect(verifySessionToken("")).toBeNull();
  });
  it("rejects an expired token", () => {
    vi.useFakeTimers();
    const tok = createSessionToken("user-1");
    vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000); // 8 days > 7-day TTL
    expect(verifySessionToken(tok)).toBeNull();
  });
});
