import "server-only";
import { getServerClient } from "@/lib/supabase/server";
import type { Shelf, Track } from "./types";
import { FULL_SET_CRATES } from "./flow";

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
  };
}

/** Read the whole library from Supabase. The ingest shelf always sorts last. */
export async function loadShelves(): Promise<Shelf[]> {
  const sb = getServerClient();
  const { data, error } = await sb
    .from("shelves")
    .select(
      "id, slug, label, color, is_ingest, sort, room, energy, records ( id, title, artist, yt_id, sc_url, sort, duration_seconds )"
    )
    .order("is_ingest", { ascending: true })
    .order("sort", { ascending: true });
  if (error) throw new Error(`loadShelves: ${error.message}`);

  return ((data ?? []) as unknown as ShelfRow[]).map((s) => ({
    id: s.id,
    slug: s.slug ?? undefined,
    label: s.label,
    color: s.color,
    ingest: s.is_ingest || undefined,
    room: s.room ?? "kissa",
    energy: s.energy ?? 3,
    records: (s.records ?? [])
      .slice()
      .sort((a, b) => a.sort - b.sort)
      .map((r) => (s.slug && FULL_SET_CRATES.has(s.slug) ? { ...toTrack(r), fullSet: true } : toTrack(r))),
  }));
}
