"use server";

import { cookies, headers } from "next/headers";
import { MEMBER_COOKIE, MEMBER_MAX_AGE, mintMemberCookie, readMemberCookie } from "@/lib/members/auth";
import { adminClient, foldMember } from "@/lib/members/store";
import { checkUsername } from "@/lib/members/username";

// Profiles: a username + email on top of the anonymous membership, so a save
// can follow a player to another device. The email is proven by a Supabase Auth
// link (implicit flow: the token comes back in the URL hash, the client hands
// it to confirmProfile, and the server checks it with Auth). Like membership,
// every action degrades quietly when the service key isn't configured.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PENDING_TTL_MS = 24 * 3600_000; // an unverified username claim lapses after a day
const RESEND_MS = 60_000; // one link email a minute per profile
const MAX_SAVE_BYTES = 256 * 1024;

async function currentMemberId(): Promise<string | null> {
  return readMemberCookie((await cookies()).get(MEMBER_COOKIE)?.value);
}

async function setMemberCookie(id: string) {
  const value = mintMemberCookie(id);
  if (!value) return;
  (await cookies()).set(MEMBER_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MEMBER_MAX_AGE,
  });
}

/** Where the email link lands: this site, from the request (the Auth project's
 *  redirect allow-list must include it, or Auth falls back to its Site URL). */
async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export type MyProfile = { username: string; email: string; verified: boolean };

/** The profile on this device's membership, if any. */
export async function myProfile(): Promise<MyProfile | null> {
  const sb = adminClient();
  const id = await currentMemberId();
  if (!sb || !id) return null;
  const { data } = await sb.from("hallu_profiles").select("username, email, verified_at").eq("member_id", id).maybeSingle();
  if (!data) return null;
  return { username: data.username as string, email: data.email as string, verified: !!data.verified_at };
}

type Result = { ok: boolean; message?: string };

async function sendLink(email: string, create: boolean): Promise<boolean> {
  const sb = adminClient();
  if (!sb) return false;
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${await siteOrigin()}/?profile=confirm`, shouldCreateUser: create },
  });
  return !error;
}

/** Make a profile: claim the username now, prove the email with a link. */
export async function startProfile(username: string, email: string): Promise<Result> {
  const sb = adminClient();
  const id = await currentMemberId();
  if (!sb || !id) return { ok: false, message: "Profiles aren't open yet. Try again soon." };
  const name = username.trim();
  const bad = checkUsername(name);
  if (bad) return { ok: false, message: bad };
  const mail = email.trim().toLowerCase();
  if (mail.length > 254 || !EMAIL_RE.test(mail)) return { ok: false, message: "That email doesn't look right." };

  const { data: mine } = await sb.from("hallu_profiles").select("verified_at, email_sent_at").eq("member_id", id).maybeSingle();
  if (mine?.verified_at) return { ok: false, message: "This device already has a profile." };
  if (mine?.email_sent_at && Date.now() - Date.parse(mine.email_sent_at as string) < RESEND_MS)
    return { ok: false, message: "A link just went out. Give it a minute." };

  // the name: free, or held by an unverified claim that has lapsed (cleared here)
  const { data: holder } = await sb
    .from("hallu_profiles")
    .select("member_id, verified_at, created_at")
    .ilike("username", name.replace(/[\\%_]/g, (c) => "\\" + c))
    .maybeSingle();
  if (holder && holder.member_id !== id) {
    const lapsed = !holder.verified_at && Date.now() - Date.parse(holder.created_at as string) > PENDING_TTL_MS;
    if (!lapsed) return { ok: false, message: "That name's taken. Try another." };
    await sb.from("hallu_profiles").delete().eq("member_id", holder.member_id);
  }
  const { data: taken } = await sb.from("hallu_profiles").select("member_id").eq("email", mail).not("verified_at", "is", null).maybeSingle();
  if (taken) return { ok: false, message: "That email already has a profile. Use “sign in” instead." };

  const { error } = await sb.from("hallu_profiles").upsert(
    { member_id: id, username: name, email: mail, email_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { onConflict: "member_id" }
  );
  if (error) return { ok: false, message: error.code === "23505" ? "That name's taken. Try another." : "Couldn't save that just now." };
  if (!(await sendLink(mail, true))) return { ok: false, message: "Couldn't send the email just now. Try again in a bit." };
  return { ok: true };
}

/** A new device: email a sign-in link to a verified profile. Always answers the
 *  same way, so nobody can probe which emails have profiles. */
export async function startSignIn(email: string): Promise<Result> {
  const sb = adminClient();
  if (!sb) return { ok: false, message: "Profiles aren't open yet. Try again soon." };
  const mail = email.trim().toLowerCase();
  if (mail.length > 254 || !EMAIL_RE.test(mail)) return { ok: false, message: "That email doesn't look right." };
  const { data: p } = await sb
    .from("hallu_profiles")
    .select("member_id, email_sent_at")
    .eq("email", mail)
    .not("verified_at", "is", null)
    .maybeSingle();
  const recent = p?.email_sent_at && Date.now() - Date.parse(p.email_sent_at as string) < RESEND_MS;
  if (p && !recent) {
    await sb.from("hallu_profiles").update({ email_sent_at: new Date().toISOString() }).eq("member_id", p.member_id);
    await sendLink(mail, false);
  }
  return { ok: true };
}

export type Confirmed = {
  ok: boolean;
  message?: string;
  username?: string;
  /** "created" = this email was just verified; "signin" = a save came back */
  mode?: "created" | "signin";
  progress?: unknown;
  fit?: unknown;
};

/** The email link was opened: check its token with Auth, then verify the
 *  pending profile or sign this device into the existing one. */
export async function confirmProfile(accessToken: string): Promise<Confirmed> {
  const sb = adminClient();
  if (!sb || !accessToken || accessToken.length > 4096) return { ok: false, message: "That link didn't work." };
  const { data: auth, error } = await sb.auth.getUser(accessToken);
  const user = auth?.user;
  if (error || !user?.email) return { ok: false, message: "That link has expired. Ask for a new one." };
  const mail = user.email.toLowerCase();
  const me = await currentMemberId();

  const cols = "member_id, username, verified_at, progress, fit";
  const { data: verified } = await sb.from("hallu_profiles").select(cols).eq("auth_user", user.id).maybeSingle();
  let row = verified;
  let mode: "created" | "signin" = "signin";
  if (!row) {
    // a pending profile for this email: this device's own first, else the newest
    const { data: pending } = await sb
      .from("hallu_profiles")
      .select(cols)
      .eq("email", mail)
      .is("verified_at", null)
      .order("updated_at", { ascending: false });
    row = (pending ?? []).find((r) => r.member_id === me) ?? pending?.[0] ?? null;
    if (!row) return { ok: false, message: "That link doesn't match a profile." };
    await sb
      .from("hallu_profiles")
      .update({ auth_user: user.id, verified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("member_id", row.member_id);
    mode = "created";
  }

  const target = row.member_id as string;
  if (me && me !== target) {
    // fold a throwaway membership in, but never merge two real profiles
    const { data: mine } = await sb.from("hallu_profiles").select("verified_at").eq("member_id", me).maybeSingle();
    if (!mine?.verified_at) await foldMember(me, target);
  }
  if (me !== target) await setMemberCookie(target);
  return { ok: true, mode, username: row.username as string, progress: row.progress, fit: row.fit };
}

/** Keep this device's save on its profile (pending or verified). */
export async function saveProfileProgress(progress: unknown, fit: unknown): Promise<void> {
  const sb = adminClient();
  const id = await currentMemberId();
  if (!sb || !id || !progress || typeof progress !== "object") return;
  if (JSON.stringify(progress).length + JSON.stringify(fit ?? null).length > MAX_SAVE_BYTES) return;
  await sb
    .from("hallu_profiles")
    .update({ progress, fit: fit ?? null, updated_at: new Date().toISOString() })
    .eq("member_id", id);
}

/** Forget the profile on this device (a shared computer). The save stays on
 *  the profile; the next knock hands this device a fresh number. */
export async function signOutProfile(): Promise<void> {
  (await cookies()).delete(MEMBER_COOKIE);
}
