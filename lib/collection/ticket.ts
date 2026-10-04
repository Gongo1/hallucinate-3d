// SIGNED TICKETS — how the room's host (a browser) knows a request really came
// from the server. Anyone holding the page's public key can broadcast on the
// bar channel, so the host only obeys what the server signed:
//   • cue   — "this member holds this copy": the only way onto the room queue
//   • admin — a god-mode command from the verified owner (/booth)
//   • copy  — "this copy was just claimed": crates drop it live
// The server signs with an ECDSA P-256 private key (TICKET_SIGNING_KEY, server
// only; see sign.ts). Everyone verifies with the public half
// (NEXT_PUBLIC_TICKET_PUBLIC_KEY). Token = base64url(json) "." base64url(sig),
// the signature taken over the base64url text. Works in browsers and Node.

import type { AdminCmd } from "@/lib/booth/commands";

/** what a cue ticket plays: the server's copy of the track, not the client's */
export interface TicketTrack {
  id?: string;
  title: string;
  artist: string;
  ytId?: string;
  scUrl?: string;
  durationSeconds?: number | null;
  fullSet?: boolean;
  trackKey: string;
}

interface Base {
  /** expiry, ms since epoch */
  exp: number;
  /** one-time nonce */
  n: string;
}
export type CueTicket = Base & { k: "cue"; copy: string; by: string; track: TicketTrack };
export type AdminTicket = Base & { k: "admin"; cmd: AdminCmd };
export type CopyTicket = Base & { k: "copy"; copy: string; track: string };
export type Ticket = CueTicket | AdminTicket | CopyTicket;

/** how long a ticket stays good: long enough for a slow network, too short to stockpile */
export const TICKET_TTL_MS = 60_000;

export const TICKET_PUBLIC_KEY = process.env.NEXT_PUBLIC_TICKET_PUBLIC_KEY;

const enc = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

const keys = new Map<string, Promise<CryptoKey | null>>();
function importKey(spkiB64: string): Promise<CryptoKey | null> {
  let k = keys.get(spkiB64);
  if (!k) {
    k = crypto.subtle
      .importKey("spki", b64urlDecode(spkiB64), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
      .catch(() => null);
    keys.set(spkiB64, k);
  }
  return k;
}

/** The ticket's body if the server signed it and it hasn't expired, else null.
 *  Fails closed: no public key means nothing verifies. */
export async function verifyTicket(
  token: unknown,
  publicKey: string | undefined = TICKET_PUBLIC_KEY,
  now: number = Date.now()
): Promise<Ticket | null> {
  if (typeof token !== "string" || token.length > 8192 || !publicKey) return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  try {
    const key = await importKey(publicKey);
    if (!key) return null;
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      b64urlDecode(token.slice(dot + 1)),
      enc.encode(body)
    );
    if (!ok) return null;
    const t = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as Ticket;
    if (typeof t.exp !== "number" || t.exp < now || typeof t.n !== "string") return null;
    return t;
  } catch {
    return null;
  }
}

/**
 * One-time use: the host remembers nonces until they expire, so a ticket can't
 * be replayed (or reused by anyone who overheard it). Returns false for a nonce
 * already spent.
 */
export class NonceLedger {
  private seen = new Map<string, number>();
  spend(t: Ticket, now: number = Date.now()): boolean {
    for (const [n, exp] of this.seen) if (exp < now) this.seen.delete(n);
    if (this.seen.has(t.n)) return false;
    this.seen.set(t.n, t.exp);
    return true;
  }
}

/**
 * The host's whole rule for a cue: a server-signed cue ticket, issued to the
 * listener asking (by their presence id), unexpired and unspent. Returns the
 * track to queue (the signed one), or null to drop the cue.
 */
export async function admitCue(
  token: unknown,
  byId: string,
  ledger: NonceLedger,
  publicKey: string | undefined = TICKET_PUBLIC_KEY,
  now: number = Date.now()
): Promise<TicketTrack | null> {
  const t = await verifyTicket(token, publicKey, now);
  if (!t || t.k !== "cue" || t.by !== byId) return null;
  if (!ledger.spend(t, now)) return null;
  return t.track;
}

/** A server-signed god-mode command, once. */
export async function admitAdmin(
  token: unknown,
  ledger: NonceLedger,
  publicKey: string | undefined = TICKET_PUBLIC_KEY,
  now: number = Date.now()
): Promise<AdminCmd | null> {
  const t = await verifyTicket(token, publicKey, now);
  if (!t || t.k !== "admin" || !ledger.spend(t, now)) return null;
  return t.cmd;
}
