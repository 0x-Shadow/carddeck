import { hash, verify } from "@node-rs/argon2";
import { createHmac, timingSafeEqual } from "node:crypto";

/** Hash a plaintext password with argon2id (salted, peppered). */
export async function hashPassword(pw: string): Promise<string> {
  return hash(pw);
}

/** Verify a plaintext password against an argon2id hash. */
export async function verifyPassword(hashStr: string, pw: string): Promise<boolean> {
  try {
    return await verify(hashStr, pw);
  } catch {
    return false;
  }
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function secret(): string {
  const s = process.env.SESSION_SECRET ?? "dev-insecure-secret-change-me-0123456789abcdef";
  if (process.env.NODE_ENV === "production" && s.startsWith("dev-insecure")) {
    throw new Error("SESSION_SECRET must be set in production");
  }
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/**
 * Create a signed session token for a user. Format: base64url(userId).exp.sig.
 * The cookie value is this token; it is stateless (no server session store).
 */
export function createSessionToken(userId: string): string {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `${userId}.${exp}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

/**
 * Verify a session token. Returns { userId } when the signature is valid and
 * unexpired, else null.
 */
export function verifySessionToken(token: string): { userId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  let payload: string;
  try {
    payload = Buffer.from(b64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const sep = payload.lastIndexOf(".");
  if (sep < 0) return null;
  const userId = payload.slice(0, sep);
  const exp = Number(payload.slice(sep + 1));
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  return { userId };
}

export const SESSION_COOKIE = "carddeck_session";
