import "server-only";
import crypto from "node:crypto";
import { TICKET_TTL_MS, b64urlEncode, type AdminTicket, type CopyTicket, type CueTicket, type Ticket } from "./ticket";

// Server half of the signed tickets (ticket.ts). TICKET_SIGNING_KEY is the
// PKCS#8 private key, base64url — never NEXT_PUBLIC. Signatures use the
// IEEE-P1363 (r‖s) encoding WebCrypto verifies.

type Unsigned<T extends Ticket> = Omit<T, "exp" | "n">;

let cached: crypto.KeyObject | null | undefined;
function privateKey(): crypto.KeyObject | null {
  if (cached !== undefined) return cached;
  const raw = process.env.TICKET_SIGNING_KEY;
  try {
    cached = raw ? crypto.createPrivateKey({ key: Buffer.from(raw, "base64url"), format: "der", type: "pkcs8" }) : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Sign a ticket body (adds expiry + nonce). Null when no key is configured. */
export function signTicket(body: Unsigned<CueTicket> | Unsigned<AdminTicket> | Unsigned<CopyTicket>, now = Date.now()): string | null {
  const key = privateKey();
  if (!key) return null;
  const full = { ...body, exp: now + TICKET_TTL_MS, n: crypto.randomUUID() };
  const payload = b64urlEncode(new TextEncoder().encode(JSON.stringify(full)));
  const sig = crypto.sign("sha256", Buffer.from(payload), { key, dsaEncoding: "ieee-p1363" });
  return `${payload}.${b64urlEncode(new Uint8Array(sig))}`;
}

/** For tests + key setup: a fresh P-256 pair as the two env values. */
export function newTicketKeys(): { TICKET_SIGNING_KEY: string; NEXT_PUBLIC_TICKET_PUBLIC_KEY: string } {
  const { privateKey: pk, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    TICKET_SIGNING_KEY: pk.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    NEXT_PUBLIC_TICKET_PUBLIC_KEY: publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
  };
}

/** test hook: forget the cached key (tests swap TICKET_SIGNING_KEY) */
export function resetTicketKeyCache() {
  cached = undefined;
}
