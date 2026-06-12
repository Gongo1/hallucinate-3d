import "server-only";

// Resolve a track's length in seconds, server-side. Prefers the official YouTube
// Data API (set YT_API_KEY) and falls back to a keyless scrape of the watch
// page's "lengthSeconds" so ingest validation + backfill work without a key.
// SoundCloud has no cheap server-side duration → returns null (the play-time
// backstop in the host covers it). Per CLAUDE.md: API key stays server-only.

const ISO8601 = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;

function parseIso8601(d: string): number | null {
  const m = ISO8601.exec(d);
  if (!m) return null;
  return (+(m[1] ?? 0)) * 3600 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0));
}

async function ytViaApi(id: string): Promise<number | null> {
  const key = process.env.YT_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${id}&key=${key}`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!r.ok) return null;
    const j = (await r.json()) as {
      items?: { contentDetails?: { duration?: string } }[];
    };
    const iso = j.items?.[0]?.contentDetails?.duration;
    return iso ? parseIso8601(iso) : null;
  } catch {
    return null;
  }
}

async function ytViaScrape(id: string): Promise<number | null> {
  try {
    const r = await fetch(`https://www.youtube.com/watch?v=${id}`, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "accept-language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(7000),
    });
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(/"lengthSeconds":"(\d+)"/);
    return m ? parseInt(m[1], 10) : null;
  } catch {
    return null;
  }
}

/** Length in seconds, or null if unresolvable (SoundCloud / dead / private). */
export async function resolveDuration(t: {
  ytId?: string;
  scUrl?: string;
}): Promise<number | null> {
  if (t.ytId) {
    const api = await ytViaApi(t.ytId);
    if (api != null) return api;
    return ytViaScrape(t.ytId);
  }
  return null; // SoundCloud — backstop covers it at play-time
}
