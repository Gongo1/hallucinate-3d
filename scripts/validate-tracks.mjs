// Validate researched tracks before they touch the library.
//  • drops anything whose ID already exists in the DB (pass existing IDs via file)
//  • drops anything YouTube oEmbed doesn't confirm (dead/private/hallucinated IDs)
//  • unescapes HTML entities the researchers left in artist names
// Usage: node scripts/validate-tracks.mjs <candidates.json> <existing-ids.txt> <out.json>
import { readFileSync, writeFileSync } from "fs";

const [, , candidatesPath, existingPath, outPath] = process.argv;
const candidates = JSON.parse(readFileSync(candidatesPath, "utf8"));
const existing = new Set(readFileSync(existingPath, "utf8").trim().split(","));

const unescape = (s) =>
  s
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");

const ok = [];
const dropped = [];
const seen = new Set();
for (const t of candidates) {
  const id = t.ytId?.trim();
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) {
    dropped.push({ ...t, why: "bad id" });
    continue;
  }
  if (existing.has(id) || seen.has(id)) {
    dropped.push({ ...t, why: "duplicate" });
    continue;
  }
  seen.add(id);
  try {
    const r = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(
        "https://www.youtube.com/watch?v=" + id
      )}`
    );
    if (!r.ok) {
      dropped.push({ ...t, why: `oembed ${r.status}` });
      continue;
    }
    const j = await r.json();
    ok.push({
      crate: t.crate,
      artist: unescape(t.artist),
      title: unescape(t.title),
      ytId: id,
      oembedTitle: j.title,
      channel: j.author_name,
    });
  } catch (e) {
    dropped.push({ ...t, why: "fetch error" });
  }
  await new Promise((r) => setTimeout(r, 120)); // be polite
}

writeFileSync(outPath, JSON.stringify(ok, null, 1));
console.log(`ok: ${ok.length}, dropped: ${dropped.length}`);
for (const d of dropped) console.log(`  ✕ ${d.artist} — ${d.title} (${d.why})`);
