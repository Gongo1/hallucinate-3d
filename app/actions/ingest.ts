"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { BOOTH_COOKIE, verifyToken } from "@/lib/booth/auth";
import { CURATED_CRATES } from "@/lib/bar/layout";
import { getServerClient } from "@/lib/supabase/server";
import { enrichTracks } from "@/lib/bar/enrich";
import { parseLinks } from "@/lib/bar/ingest";
import { resolveDuration } from "@/lib/bar/duration";
import { FULL_SET_CRATES, MAX_TRACK_SECONDS } from "@/lib/bar/flow";
import type { Track } from "@/lib/bar/types";

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// The ingest write path. The client hands over raw pasted text + a target; the
// server parses links, enriches titles via oEmbed, creates/resolves the shelf,
// inserts the records, and returns them so the client can update optimistically.
// On reload the page re-reads from the DB (page.tsx is force-dynamic), so the
// additions persist — that's the Phase 1 "done when".

type IngestTarget =
  | { kind: "existing"; shelfId: string }
  | { kind: "new"; name?: string; color?: string; energy?: number };

export interface IngestResult {
  ok: boolean;
  message: string;
  shelf?: { id: string; label: string; color: string; ingest?: boolean; energy?: number };
  records?: Track[];
  /** per-link rejections (e.g. over the 15-min cap), surfaced to the user */
  rejected?: { title: string; reason: string }[];
}

/** Crate energy is a required 1–5 (drives the energy×time radio); clamp + default. */
function clampEnergy(e?: number): number {
  const n = Math.round(Number(e ?? 3));
  return Number.isFinite(n) ? Math.max(1, Math.min(5, n)) : 3;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export async function ingestLinks(input: {
  text: string;
  target: IngestTarget;
  /** the adder's anonymous colour (for the Added board's dot) */
  byColor?: string;
}): Promise<IngestResult> {
  const parsed = parseLinks(input.text);
  if (!parsed.length)
    return { ok: false, message: "No YouTube/SoundCloud links found." };

  // Curated crates (the Listening Room's featured Gongo + Sombra Selection) take
  // records from the owner only — a verified /booth session.
  let targetSlug: string | null = null;
  if (input.target.kind === "existing") {
    const { data: t } = await getServerClient()
      .from("shelves")
      .select("slug")
      .eq("id", input.target.shelfId)
      .single();
    targetSlug = (t?.slug as string | null | undefined) ?? null;
    if (targetSlug && CURATED_CRATES.has(targetSlug)) {
      const jar = await cookies();
      if (!verifyToken(jar.get(BOOTH_COOKIE)?.value))
        return {
          ok: false,
          message: "That crate is curated by Sombra — drop your links in 新着 or start your own shelf.",
        };
    }
  }
  // the one cap exception: full DJ sets filed into a FULL_SET_CRATES crate
  const fullSets = !!targetSlug && FULL_SET_CRATES.has(targetSlug);

  const enriched = await enrichTracks(parsed);

  // Library rule (fixed, not room-relative): resolve each link's length and
  // REJECT anything at/over the 15-min cap, with a clear per-link reason.
  const durations = await Promise.all(enriched.map(resolveDuration));
  const accepted: { track: Track; duration: number | null }[] = [];
  const rejected: { title: string; reason: string }[] = [];
  enriched.forEach((t, i) => {
    const d = durations[i];
    if (d != null && d >= MAX_TRACK_SECONDS && !fullSets) {
      rejected.push({
        title: t.title,
        reason: `${fmt(d)} — over the ${MAX_TRACK_SECONDS / 60}-min limit`,
      });
    } else {
      accepted.push({ track: t, duration: d });
    }
  });
  if (!accepted.length)
    return {
      ok: false,
      message: `All ${rejected.length} link${rejected.length > 1 ? "s" : ""} exceeded the ${
        MAX_TRACK_SECONDS / 60
      }-min limit.`,
      rejected,
    };
  const sb = getServerClient();

  // --- resolve or create the target shelf ---
  let shelf: { id: string; label: string; color: string; is_ingest: boolean; energy: number };
  if (input.target.kind === "new") {
    const label = (input.target.name?.trim() || "My Shelf").toUpperCase();
    const slug = `${slugify(label) || "shelf"}-${randomUUID().slice(0, 8)}`;
    const { data: maxRow } = await sb
      .from("shelves")
      .select("sort")
      .eq("is_ingest", false)
      .order("sort", { ascending: false })
      .limit(1);
    const sort = ((maxRow?.[0]?.sort as number | undefined) ?? -1) + 1;
    const { data, error } = await sb
      .from("shelves")
      .insert({
        slug,
        label,
        color: input.target.color || "#7e9b5e",
        sort,
        is_ingest: false,
        energy: clampEnergy(input.target.energy),
      })
      .select("id, label, color, is_ingest, energy")
      .single();
    if (error || !data)
      return {
        ok: false,
        message: `Couldn’t create shelf: ${error?.message ?? "unknown error"}`,
      };
    shelf = data;
  } else {
    const { data, error } = await sb
      .from("shelves")
      .select("id, label, color, is_ingest, energy")
      .eq("id", input.target.shelfId)
      .single();
    if (error || !data)
      return { ok: false, message: "That shelf no longer exists." };
    shelf = data;
  }

  // --- append records after the shelf's current last sort ---
  const { data: maxRec } = await sb
    .from("records")
    .select("sort")
    .eq("shelf_id", shelf.id)
    .order("sort", { ascending: false })
    .limit(1);
  let sort = ((maxRec?.[0]?.sort as number | undefined) ?? -1) + 1;

  const rows = accepted.map(({ track: t, duration }) => ({
    shelf_id: shelf.id,
    title: t.title,
    artist: t.artist ?? "",
    source: t.scUrl ? "soundcloud" : "youtube",
    yt_id: t.ytId ?? null,
    sc_url: t.scUrl ?? null,
    sort: sort++,
    duration_seconds: duration,
    added_by_color: input.byColor ?? null,
  }));

  const { data: inserted, error } = await sb
    .from("records")
    .insert(rows)
    .select("id, title, artist, yt_id, sc_url, sort, duration_seconds");
  if (error || !inserted)
    return {
      ok: false,
      message: `Couldn’t save records: ${error?.message ?? "unknown error"}`,
    };

  const records: Track[] = (inserted as RecordInsertRow[])
    .slice()
    .sort((a, b) => a.sort - b.sort)
    .map((r) => ({
      id: r.id,
      title: r.title,
      artist: r.artist ?? "",
      ytId: r.yt_id ?? undefined,
      scUrl: r.sc_url ?? undefined,
      durationSeconds: r.duration_seconds,
    }));

  const okMsg = `Filed ${records.length} record${records.length > 1 ? "s" : ""}.`;
  return {
    ok: true,
    message: rejected.length
      ? `${okMsg} Skipped ${rejected.length} over the ${MAX_TRACK_SECONDS / 60}-min limit.`
      : okMsg,
    shelf: {
      id: shelf.id,
      label: shelf.label,
      color: shelf.color,
      ingest: shelf.is_ingest || undefined,
      energy: shelf.energy,
    },
    records,
    rejected: rejected.length ? rejected : undefined,
  };
}

interface RecordInsertRow {
  id: string;
  title: string;
  artist: string | null;
  yt_id: string | null;
  sc_url: string | null;
  sort: number;
  duration_seconds: number | null;
}
