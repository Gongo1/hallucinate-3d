"use server";

import { cookies } from "next/headers";
import { BOOTH_COOKIE, verifyToken } from "@/lib/booth/auth";
import { MEMBER_COOKIE, readMemberCookie } from "@/lib/members/auth";
import { adminClient, memberNumber } from "@/lib/members/store";
import { parseLinks } from "@/lib/bar/ingest";
import { ingestLinks } from "./ingest";

// Suggested records (Austin, 2026-09-30): visitors don't add to crates; they
// suggest, and the owner reviews the list weekly in /booth, sending the best to
// THIS WEEK or the Sombra Selection.

const MAX_LINKS = 5;
const MAX_PER_DAY = 10;
const REVIEW_TARGETS = new Set(["this-week", "sombra-selection"]);

export async function submitRecords(input: {
  text: string;
  note?: string;
  instagram?: string;
}): Promise<{ ok: boolean; count?: number; message?: string }> {
  const sb = adminClient();
  if (!sb) return { ok: false, message: "The drop box is closed right now. Try again soon." };
  const member = readMemberCookie((await cookies()).get(MEMBER_COOKIE)?.value);
  if (!member) return { ok: false, message: "Knock and come in first, then drop your record." };
  const links = parseLinks(input.text).slice(0, MAX_LINKS);
  if (!links.length) return { ok: false, message: "Paste a YouTube or SoundCloud link." };

  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await sb
    .from("hallu_submissions")
    .select("id", { count: "exact", head: true })
    .eq("member_id", member)
    .gte("created_at", since);
  if ((count ?? 0) + links.length > MAX_PER_DAY)
    return { ok: false, message: "That's plenty for today. The box opens again tomorrow." };

  const note = input.note?.trim().slice(0, 280) || null;
  const instagram = input.instagram?.trim().replace(/^@/, "").slice(0, 40) || null;
  const rows = links.map((t) => {
    const url = t.scUrl ?? `https://www.youtube.com/watch?v=${t.ytId}`;
    const hint = t.artist || t.title ? [t.artist, t.title].filter(Boolean).join(" — ") : null;
    return { url, source: t.scUrl ? "soundcloud" : "youtube", hint, note, instagram, member_id: member };
  });
  // already waiting in the box? don't queue it twice
  const { data: waiting } = await sb
    .from("hallu_submissions")
    .select("url")
    .eq("status", "pending")
    .in("url", rows.map((r) => r.url));
  const seen = new Set((waiting ?? []).map((w) => w.url as string));
  const fresh = rows.filter((r) => !seen.has(r.url));
  if (fresh.length) {
    const { error } = await sb.from("hallu_submissions").insert(fresh);
    if (error) return { ok: false, message: "Couldn't drop that in just now. Try again in a moment." };
  }
  return { ok: true, count: rows.length };
}

export type Submission = {
  id: string;
  url: string;
  source: "youtube" | "soundcloud";
  hint: string | null;
  note: string | null;
  instagram: string | null;
  member: number | null;
  createdAt: string;
};

async function owner(): Promise<boolean> {
  return verifyToken((await cookies()).get(BOOTH_COOKIE)?.value);
}

/** The owner's review list: everything still waiting, oldest first. */
export async function boothSubmissions(): Promise<Submission[] | null> {
  const sb = adminClient();
  if (!sb || !(await owner())) return null;
  const { data } = await sb
    .from("hallu_submissions")
    .select("id, url, source, hint, note, instagram, member_id, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(200);
  return Promise.all(
    (data ?? []).map(async (r) => ({
      id: r.id as string,
      url: r.url as string,
      source: r.source as Submission["source"],
      hint: (r.hint as string | null) ?? null,
      note: (r.note as string | null) ?? null,
      instagram: (r.instagram as string | null) ?? null,
      member: r.member_id ? await memberNumber(r.member_id as string) : null,
      createdAt: r.created_at as string,
    }))
  );
}

/** Send a suggestion to THIS WEEK / the Sombra Selection (through the normal
 *  ingest: titles, lengths, the 15-min rule), or pass on it. */
export async function boothReviewSubmission(
  id: string,
  to: "this-week" | "sombra-selection" | "pass"
): Promise<{ ok: boolean; message?: string }> {
  const sb = adminClient();
  if (!sb || !(await owner())) return { ok: false };
  const { data: sub } = await sb.from("hallu_submissions").select("url, hint, status").eq("id", id).maybeSingle();
  if (!sub || sub.status !== "pending") return { ok: false, message: "Already reviewed." };
  if (to !== "pass") {
    if (!REVIEW_TARGETS.has(to)) return { ok: false };
    const { data: shelf } = await sb.from("shelves").select("id").eq("slug", to).maybeSingle();
    if (!shelf) return { ok: false, message: "Crate not found." };
    const line = sub.hint ? `${sub.hint} | ${sub.url}` : (sub.url as string);
    const res = await ingestLinks({ text: line, target: { kind: "existing", shelfId: shelf.id as string } });
    if (!res.ok) return { ok: false, message: res.message };
  }
  await sb
    .from("hallu_submissions")
    .update({ status: to === "pass" ? "passed" : "added", shelf_slug: to === "pass" ? null : to, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  return { ok: true };
}
