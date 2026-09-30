import "server-only";
import { getServerClient } from "@/lib/supabase/server";
import type { Shelf, Track } from "./types";
import { FULL_SET_CRATES, isFullSet } from "./flow";
import { THIS_WEEK } from "./layout";
import { weeklyShuffle } from "./week";

// Retired + unplayable rows — hidden until they're deleted in Supabase (the anon
// key can't delete). 2026-09-29.
const RETIRED_CRATES = new Set([
  "stacks", // THE STACKS (labyrinth) — owner: Gongo's sets live only in the Gongo crate
]);
const UNPLAYABLE = new Set([
  "8f840e47-1ed7-4265-b133-b7aaa0ccca9d", // "Fade" (HOUSE) — the YouTube video is now private
]);

// DB → runtime mapping. The DB keeps the Supabase-normalized field names
// (yt_id / sc_url / is_ingest); the renderer wants the prototype's camelCase
// (ytId / scUrl / ingest). This module is the single seam between them.

interface RecordRow {
  id: string;
  title: string;
  artist: string | null;
  yt_id: string | null;
  sc_url: string | null;
  sort: number;
  duration_seconds: number | null;
  play_count?: number | null;
}
interface ShelfRow {
  id: string;
  slug: string | null;
  label: string;
  color: string;
  is_ingest: boolean;
  sort: number;
  room: string;
  energy: number | null;
  records: RecordRow[];
}

function toTrack(r: RecordRow): Track {
  return {
    id: r.id,
    title: r.title,
    artist: r.artist ?? "",
    ytId: r.yt_id ?? undefined,
    scUrl: r.sc_url ?? undefined,
    durationSeconds: r.duration_seconds,
    plays: r.play_count ?? 0,
  };
}

/** Read the whole library from Supabase. The ingest shelf always sorts last. */
export async function loadShelves(): Promise<Shelf[]> {
  const sb = getServerClient();
  const query = (recordCols: string) =>
    sb
      .from("shelves")
      .select(`id, slug, label, color, is_ingest, sort, room, energy, records ( ${recordCols} )`)
      .order("is_ingest", { ascending: true })
      .order("sort", { ascending: true });
  const base = "id, title, artist, yt_id, sc_url, sort, duration_seconds";
  let { data, error } = await query(`${base}, play_count`);
  // play counts arrive with a migration (20260930c): until it has run, load
  // the library without them rather than taking the bar down
  if (error && /play_count/.test(error.message)) ({ data, error } = await query(base));
  if (error) throw new Error(`loadShelves: ${error.message}`);

  // A set lives only in its own full-set crate (the Gongo crate, the Selection):
  // any copy of it filed anywhere else is dropped — there it would hit the
  // 15-min cap and get skipped anyway.
  const rows = ((data ?? []) as unknown as ShelfRow[]).filter((s) => !(s.slug && RETIRED_CRATES.has(s.slug)));
  const setUrls = new Set(
    rows
      .filter((s) => s.slug && FULL_SET_CRATES.has(s.slug))
      .flatMap((s) => (s.records ?? []).map((r) => r.sc_url).filter((u): u is string => !!u))
  );
  const keep = (s: ShelfRow, r: RecordRow) =>
    !UNPLAYABLE.has(r.id) && (!!s.slug && FULL_SET_CRATES.has(s.slug) ? true : !(r.sc_url && setUrls.has(r.sc_url)));

  return rows.map((s) => ({
    id: s.id,
    slug: s.slug ?? undefined,
    label: s.label,
    color: s.color,
    ingest: s.is_ingest || undefined,
    room: s.room ?? "kissa",
    energy: s.energy ?? 3,
    records: weeklyOrder(
      s,
      (s.records ?? [])
        .filter((r) => keep(s, r))
        .sort((a, b) => a.sort - b.sort)
        .map((r) => (isFullSet(s.slug ?? undefined, r.duration_seconds) ? { ...toTrack(r), fullSet: true } : toTrack(r)))
    ),
  }));
}

// Crates reshuffle every drop-week so flipping through never opens on the same
// record (Austin, 2026-09-29). THIS WEEK keeps its curated order.
function weeklyOrder(s: ShelfRow, records: Track[]): Track[] {
  return s.slug === THIS_WEEK ? records : weeklyShuffle(records, s.id);
}
