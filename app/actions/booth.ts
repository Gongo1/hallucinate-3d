"use server";

import { cookies } from "next/headers";
import {
  BOOTH_COOKIE,
  BOOTH_TTL_MS,
  checkPassphrase,
  mintToken,
  verifyToken,
} from "@/lib/booth/auth";
import { ADMIN_EVENT, type AdminCmd } from "@/lib/booth/commands";
import { serverBroadcast } from "@/lib/booth/broadcast";
import { signTicket } from "@/lib/collection/sign";
import { MEMBER_COOKIE, MEMBER_MAX_AGE, mintMemberCookie, newKeyCode, readMemberCookie } from "@/lib/members/auth";
import { adminClient, foldMember } from "@/lib/members/store";

// God-mode authority lives HERE, on the server. The client can call these, but
// every privileged action re-verifies the signed owner cookie before doing
// anything. There is no admin flag in the client bundle and no secret in any
// Realtime payload — the command broadcast carries a ticket signed by the
// server (lib/collection/ticket.ts), which is what the host checks.

export async function boothLogin(passphrase: string): Promise<{ ok: boolean }> {
  if (!checkPassphrase(passphrase)) return { ok: false };
  const token = mintToken();
  if (!token) return { ok: false };
  const jar = await cookies();
  jar.set(BOOTH_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: Math.floor(BOOTH_TTL_MS / 1000),
  });
  return { ok: true };
}

export async function boothLogout(): Promise<void> {
  const jar = await cookies();
  jar.delete(BOOTH_COOKIE);
}

/** Whether the current request carries a valid owner session (server-verified). */
export async function boothStatus(): Promise<{ owner: boolean }> {
  const jar = await cookies();
  return { owner: verifyToken(jar.get(BOOTH_COOKIE)?.value) };
}

/**
 * Issue a god-mode command. Server-verifies the owner cookie, then publishes a
 * server-origin admin event to the bar's Realtime channel via the HTTP broadcast
 * API. Returns {ok:false} (and broadcasts nothing) for anyone not logged in —
 * so forging the call client-side does nothing.
 */
export async function boothCommand(cmd: AdminCmd): Promise<{ ok: boolean }> {
  const jar = await cookies();
  if (!verifyToken(jar.get(BOOTH_COOKIE)?.value)) return { ok: false };

  // The host obeys only what the server signed: anyone holding the page's
  // public key can broadcast an "admin" event, but not sign one. The plain
  // command rides along for hosts still on an older build.
  const token = signTicket({ k: "admin", cmd });
  if (!token) return { ok: false };
  return { ok: await serverBroadcast(ADMIN_EVENT, { ...cmd, token, origin: "server", at: Date.now() }) };
}

// ----- founding members (owner only) -----
// #001 is Gongo, #002 is Elixir Pau: reserved rows that nobody can knock into.
// The owner takes #001 on this device, and makes a one-time hand-off link that
// gives #002 to whichever phone opens it.

/** Make THIS device member #n (a founding number). */
export async function boothTakeNumber(n: number): Promise<{ ok: boolean }> {
  const jar = await cookies();
  if (!verifyToken(jar.get(BOOTH_COOKIE)?.value)) return { ok: false };
  const sb = adminClient();
  if (!sb) return { ok: false };
  const { data } = await sb.from("hallu_members").select("id").eq("number", n).maybeSingle();
  const value = data ? mintMemberCookie(data.id as string) : null;
  if (!value) return { ok: false };
  // this device may already hold a throwaway number (knocked before claiming):
  // fold it in so its points carry over and no number is left orphaned
  const current = readMemberCookie(jar.get(MEMBER_COOKIE)?.value);
  if (current) await foldMember(current, data!.id as string);
  jar.set(MEMBER_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MEMBER_MAX_AGE,
  });
  return { ok: true };
}

/** A one-time link that hands member #n to whoever opens it. */
export async function boothHandoffLink(n: number): Promise<{ ok: boolean; path?: string }> {
  const jar = await cookies();
  if (!verifyToken(jar.get(BOOTH_COOKIE)?.value)) return { ok: false };
  const sb = adminClient();
  if (!sb) return { ok: false };
  const { data } = await sb.from("hallu_members").select("id").eq("number", n).maybeSingle();
  if (!data) return { ok: false };
  const code = newKeyCode();
  const { error } = await sb.from("hallu_keys").insert({ code, claims_member: data.id });
  return error ? { ok: false } : { ok: true, path: `/k/${code}` };
}
