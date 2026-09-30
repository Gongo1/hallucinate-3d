"use server";

import { cookies } from "next/headers";
import {
  BOOTH_COOKIE,
  BOOTH_TTL_MS,
  checkPassphrase,
  mintToken,
  verifyToken,
} from "@/lib/booth/auth";
import { ADMIN_EVENT, BAR_CHANNEL, type AdminCmd } from "@/lib/booth/commands";
import { MEMBER_COOKIE, MEMBER_MAX_AGE, mintMemberCookie, newKeyCode } from "@/lib/members/auth";
import { adminClient } from "@/lib/members/store";

// God-mode authority lives HERE, on the server. The client can call these, but
// every privileged action re-verifies the signed owner cookie before doing
// anything. There is no admin flag in the client bundle and no secret in any
// Realtime payload — the command broadcast carries only the command + an
// "origin:server" marker the host trusts because only this verified path emits it.

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

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { ok: false };

  const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      messages: [
        {
          topic: BAR_CHANNEL,
          event: ADMIN_EVENT,
          // `origin: "server"` is informational; authority came from the verified
          // cookie above. A forged client broadcast can't reach this code path.
          payload: { ...cmd, origin: "server", at: Date.now() },
        },
      ],
    }),
  });
  return { ok: res.status === 202 || res.ok };
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
