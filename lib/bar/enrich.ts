import "server-only";
import type { Track } from "./types";

// Server-side title enrichment via YouTube / SoundCloud oEmbed. Runs on the
// server precisely because browser CORS to these endpoints is flaky at scale
// (CLAUDE.md lesson #3). Best-effort: on any failure we keep the parsed values
// so a non-embeddable / region-locked link still files cleanly.

export async function enrichTracks(tracks: Track[]): Promise<Track[]> {
  return Promise.all(tracks.map(enrichOne));
}

async function enrichOne(rec: Track): Promise<Track> {
  // Skip if the paste already carried a real "Artist — Title" (no placeholder).
  const placeholder = /^YouTube ·|^SoundCloud/.test(rec.title);
  if (rec.artist && !placeholder) return rec;

  const url = rec.scUrl ?? `https://www.youtube.com/watch?v=${rec.ytId}`;
  const endpoint = rec.scUrl
    ? `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`
    : `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;

  try {
    const r = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return rec;
    const j = (await r.json()) as { title?: string; author_name?: string };
    if (!j.title) return rec;

    const cleaned = j.title
      .replace(/\s*\[.*?\]\s*/g, " ")
      .replace(/\(Official.*?\)/i, "")
      .trim();
    const parts = cleaned.split(/\s+[–—-]\s+/);

    let artist = rec.artist;
    let title = rec.title;
    if (parts.length >= 2) {
      artist = rec.artist || parts[0].trim();
      title = parts.slice(1).join(" - ").trim();
    } else {
      title = cleaned;
    }
    if (!artist && j.author_name) artist = j.author_name.replace(/ - Topic$/, "");

    return { ...rec, artist, title };
  } catch {
    return rec;
  }
}
