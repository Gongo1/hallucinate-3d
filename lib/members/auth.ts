import "server-only";
import crypto from "node:crypto";

// Anonymous membership cookie. The value is "m.<member uuid>.<hmac>", signed with
// ADMIN_SECRET under its own "m" tag (so a member cookie can never pass as a
// booth session, which is tagged "booth"). httpOnly + server-set: Safari's 7-day
// cap on script-written storage doesn't apply, so a regular keeps their number.

export const MEMBER_COOKIE = "hallu_member";
export const KEY_COOKIE = "hallu_key"; // a /k/<code> invite waiting at the door
export const MEMBER_MAX_AGE = 400 * 24 * 3600; // Chrome's cap on cookie lifetime
export const KEY_MAX_AGE = 7 * 24 * 3600;

function sign(payload: string): string | null {
  const key = process.env.ADMIN_SECRET;
  if (!key) return null;
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

export function mintMemberCookie(memberId: string): string | null {
  const payload = `m.${memberId}`;
  const sig = sign(payload);
  return sig ? `${payload}.${sig}` : null;
}

/** The member id in a valid cookie, else null. */
export function readMemberCookie(value: string | undefined | null): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "m") return null;
  const expected = sign(`m.${parts[1]}`);
  if (!expected) return null;
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return /^[0-9a-f-]{36}$/.test(parts[1]) ? parts[1] : null;
}

/** An 8-character invite code without look-alike characters (0/O, 1/I/L). */
export function newKeyCode(): string {
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  const bytes = crypto.randomBytes(8);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export const KEY_CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;
