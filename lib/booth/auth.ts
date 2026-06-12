import "server-only";
import crypto from "node:crypto";

// Owner (god-mode) auth — server-only. The client NEVER decides who is admin.
// Login compares a posted passphrase against ADMIN_SECRET (server env). On success
// we mint a signed token (HMAC of "booth.<expiry>" with ADMIN_SECRET) stored as a
// signed, httpOnly cookie. Every admin action re-verifies that cookie server-side.
// No admin flag ever reaches the client bundle or any Realtime payload.

const COOKIE = "booth_session";
const TTL_MS = 1000 * 60 * 60 * 12; // 12h

function secret(): string | null {
  return process.env.ADMIN_SECRET || null;
}

function sign(payload: string, key: string): string {
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

/** Mint a signed session token, or null if ADMIN_SECRET isn't configured. */
export function mintToken(): string | null {
  const key = secret();
  if (!key) return null;
  const exp = Date.now() + TTL_MS;
  const payload = `booth.${exp}`;
  return `${payload}.${sign(payload, key)}`;
}

/** True only if the token is a valid, unexpired, correctly-signed owner session. */
export function verifyToken(token: string | undefined | null): boolean {
  const key = secret();
  if (!key || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [tag, exp, sig] = parts;
  const payload = `${tag}.${exp}`;
  // constant-time compare against the expected signature
  const expected = sign(payload, key);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  if (tag !== "booth") return false;
  if (!Number.isFinite(+exp) || +exp < Date.now()) return false;
  return true;
}

/** Check a posted passphrase against ADMIN_SECRET (constant-time). */
export function checkPassphrase(input: string): boolean {
  const key = secret();
  if (!key) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const BOOTH_COOKIE = COOKIE;
export const BOOTH_TTL_MS = TTL_MS;
