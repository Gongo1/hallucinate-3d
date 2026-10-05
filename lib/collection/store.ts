import "server-only";
import { adminClient } from "@/lib/members/store";
import { isFullSet } from "@/lib/bar/flow";
import { HOUSE_CRATES, type Availability, type ClaimResult, type OwnedCopy } from "./rules";
import type { TicketTrack } from "./ticket";

// Server-side reads/writes for collectible copies (service role only: the
// tables have RLS on and no policies). Every function degrades to null when
// membership isn't configured, like the rest of lib/members.

const PAGE = 1000; // PostgREST's default row cap

const KEYS_PER_QUERY = 100; // track keys ride in the query string: keep it short

/** Copies still in crates, by track (all tracks, or just `keys`). Null if
 *  collecting isn't available. */
export async function loadAvailability(keys?: string[]): Promise<Availability | null> {
  const sb = adminClient();
  if (!sb) return null;
  const out: Availability = {};
  const batches = keys ? Array.from({ length: Math.ceil(keys.length / KEYS_PER_QUERY) }, (_, i) => keys.slice(i * KEYS_PER_QUERY, (i + 1) * KEYS_PER_QUERY)) : [null];
  for (const batch of batches) {
    for (let from = 0; ; from += PAGE) {
      let q = sb.from("hallu_copies").select("id, serial, track_key").is("owner_id", null);
      if (batch) q = q.in("track_key", batch);
      const { data, error } = await q.order("track_key").order("serial").range(from, from + PAGE - 1);
      if (error) return null;
      for (const r of data ?? []) (out[r.track_key as string] ??= []).push({ id: r.id as string, serial: r.serial as number });
      if (!data || data.length < PAGE) break;
    }
  }
  if (keys) for (const k of keys) out[k] ??= []; // asked about and none left
  return out;
}

export async function backpackOf(member: string): Promise<OwnedCopy[] | null> {
  const sb = adminClient();
  if (!sb) return null;
  const { data, error } = await sb
    .from("hallu_copies")
    .select("id, serial, track_key, title, artist, yt_id, sc_url, claimed_at")
    .eq("owner_id", member)
    .order("claimed_at", { ascending: false });
  if (error) return null;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    serial: r.serial as number,
    trackKey: r.track_key as string,
    title: r.title as string,
    artist: r.artist as string,
    ytId: (r.yt_id as string | null) ?? undefined,
    scUrl: (r.sc_url as string | null) ?? undefined,
    claimedAt: Date.parse(r.claimed_at as string) || 0,
  }));
}

/** The atomic claim (hallu_claim_copy). */
export async function claim(member: string, copyId: string, cap: number): Promise<{ result: ClaimResult; trackKey?: string }> {
  const sb = adminClient();
  if (!sb) return { result: "closed" };
  const { data, error } = await sb.rpc("hallu_claim_copy", { p_member: member, p_copy: copyId, p_cap: cap });
  if (error) return { result: "closed" };
  const result = data as ClaimResult;
  if (result !== "ok") return { result };
  const { data: c } = await sb.from("hallu_copies").select("track_key").eq("id", copyId).maybeSingle();
  return { result, trackKey: (c?.track_key as string | undefined) ?? undefined };
}

/** What a cue of this copy plays — only if `member` holds it. */
export async function cueTrackFor(member: string, copyId: string): Promise<TicketTrack | null> {
  const sb = adminClient();
  if (!sb) return null;
  const { data: c } = await sb
    .from("hallu_copies")
    .select("track_key, title, artist, yt_id, sc_url")
    .eq("id", copyId)
    .eq("owner_id", member)
    .maybeSingle();
  if (!c) return null;
  const { data: rec } = await sb
    .from("records")
    .select("id, title, artist, duration_seconds, shelves ( slug )")
    .eq("track_key", c.track_key)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  return ticketTrack(c.track_key as string, rec, {
    title: c.title as string,
    artist: c.artist as string,
    ytId: (c.yt_id as string | null) ?? undefined,
    scUrl: (c.sc_url as string | null) ?? undefined,
  });
}

/** Is this track a house record (in the Gongo crate or the Sombra Selection)?
 *  A track filed in a house crate is house everywhere: never claimable. */
export async function isHouseTrack(trackKey: string): Promise<boolean> {
  const sb = adminClient();
  if (!sb) return false;
  const { data } = await sb
    .from("records")
    .select("id, shelves!inner ( slug )")
    .eq("track_key", trackKey)
    .in("shelves.slug", [...HOUSE_CRATES])
    .limit(1);
  return !!data?.length;
}

/** The track a copy is of (null if there's no such copy). */
export async function copyTrackKey(copyId: string): Promise<string | null> {
  const sb = adminClient();
  if (!sb) return null;
  const { data } = await sb.from("hallu_copies").select("track_key").eq("id", copyId).maybeSingle();
  return (data?.track_key as string | undefined) ?? null;
}

/** What a cue of a house record plays — only if it is one. */
export async function houseCueTrack(trackKey: string): Promise<TicketTrack | null> {
  const sb = adminClient();
  if (!sb) return null;
  const { data: rec } = await sb
    .from("records")
    .select("id, title, artist, yt_id, sc_url, duration_seconds, shelves!inner ( slug )")
    .eq("track_key", trackKey)
    .in("shelves.slug", [...HOUSE_CRATES])
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!rec) return null;
  return ticketTrack(trackKey, rec, {
    title: rec.title as string,
    artist: rec.artist as string,
    ytId: (rec.yt_id as string | null) ?? undefined,
    scUrl: (rec.sc_url as string | null) ?? undefined,
  });
}

/** A cue ticket's track. The catalog's record (when it still exists) supplies
 *  the id plays are counted against and the length the queue rules need; the
 *  media ids come from `src`. */
function ticketTrack(
  trackKey: string,
  rec: Record<string, unknown> | null,
  src: { title: string; artist: string; ytId?: string; scUrl?: string }
): TicketTrack {
  const slug = (rec?.shelves as { slug?: string | null } | null)?.slug ?? undefined;
  const duration = (rec?.duration_seconds as number | null) ?? null;
  return {
    id: (rec?.id as string | undefined) ?? undefined,
    title: (rec?.title as string | undefined) ?? src.title,
    artist: (rec?.artist as string | undefined) ?? src.artist,
    ytId: src.ytId,
    scUrl: src.scUrl,
    durationSeconds: duration,
    fullSet: isFullSet(slug, duration) || undefined,
    trackKey,
  };
}
