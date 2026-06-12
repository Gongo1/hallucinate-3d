import type { Track } from "./types";

// Ported verbatim from the prototype's parseLinks: one link per line, optional
// "Artist — Title | URL" tagging. Handles watch?v=, youtu.be, /embed/, /shorts/,
// and SoundCloud URLs. Title enrichment happens elsewhere (server-side in Phase 1).
export function parseLinks(text: string): Track[] {
  const out: Track[] = [];
  for (let line of text.split("\n")) {
    line = line.trim();
    if (!line) continue;
    const um = line.match(/https?:\/\/[^\s]+/);
    if (!um) continue;
    const url = um[0];
    const pre = line
      .slice(0, um.index ?? 0)
      .replace(/[|–—:\-]\s*$/, "")
      .trim();
    let artist = "";
    let title = "";
    if (pre) {
      const parts = pre.split(/\s+[–—-]\s+|\s*\|\s*/);
      if (parts.length >= 2) {
        artist = parts[0].trim();
        title = parts.slice(1).join(" - ").trim();
      } else {
        title = pre;
      }
    }
    const yt = url.match(
      /(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/
    );
    if (yt) {
      out.push({ ytId: yt[1], artist, title: title || "YouTube · " + yt[1] });
    } else if (/soundcloud\.com/.test(url)) {
      out.push({ scUrl: url, artist, title: title || "SoundCloud track" });
    }
  }
  return out;
}
