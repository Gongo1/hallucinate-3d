// Build the Crate Map: a 2D board of every room → crate → song, for the owner
// to rearrange and export as Markdown (Claude applies the changes).
// usage: node scripts/crate-map/build.mjs <out.html>
// Reads the live library with the public anon key (.env.local); applies the
// same hidden/retired filters as lib/bar/data.ts. Crate spots per room mirror
// DIG_SPOTS in lib/bar/layout.ts (+ the Listening Room's 3 featured crates).
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const env = {};
for (const l of fs.readFileSync(path.join(root, ".env.local"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z_]+)="?(.*?)"?$/);
  if (m) env[m[1]] = m[2];
}
const src = fs.readFileSync(path.join(root, "lib/bar/data.ts"), "utf8");
const listOf = (name, re) => [...src.slice(src.indexOf(name), src.indexOf("]);", src.indexOf(name))).matchAll(re)].map((m) => m[1]);
const retired = listOf("RETIRED_CRATES", /"([^"]+)"/g);
const unplayable = listOf("UNPLAYABLE", /"([0-9a-f-]{36})"/g);

const ROOMS = [
  ["kissa", "SOMBRA LISTENING ROOM", 3], ["garden", "庭 · THE GARDEN", 4], ["housemiam", "Houseum · 宇宙", 2],
  ["omakase", "御任せ · OMAKASE", 2], ["berlin", "BERLIN · 地下", 2], ["tearoom", "茶室 · TEA ROOM", 2],
  ["mattarello", "IL MATTARELLO · 麺棒", 2], ["playa", "LA PLAYA · 波", 2], ["warehouse", "WAREHOUSE · 倉庫", 2],
  ["rooftop", "SKYLINE · 空", 2], ["labyrinth", "迷路 · THE LABYRINTH", 1], ["archive", "書庫 · THE ARCHIVE", 3],
].map(([id, name, spots]) => ({ id, name, spots }));

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const { data, error } = await sb
  .from("shelves")
  .select("id,slug,label,color,room,is_ingest,sort,records(id,title,artist,yt_id,sc_url,sort,duration_seconds)")
  .order("sort");
if (error) throw error;
const crates = data
  .filter((s) => !retired.includes(s.slug))
  .map((s) => ({
    id: s.id, slug: s.slug, label: s.label, color: s.color, room: s.room || "kissa", ingest: !!s.is_ingest,
    songs: (s.records || [])
      .filter((r) => !unplayable.includes(r.id))
      .sort((a, b) => a.sort - b.sort)
      .map((r) => ({ id: r.id, a: r.artist || "", t: r.title, src: r.sc_url ? "sc" : "yt", d: r.duration_seconds || null })),
  }));
const live = { generated: new Date().toISOString().slice(0, 10), rooms: ROOMS, crates };
const html = fs
  .readFileSync(path.join(root, "scripts/crate-map/template.html"), "utf8")
  .replace("__DATA__", JSON.stringify(live).replace(/</g, "\\u003c"));
fs.writeFileSync(process.argv[2] ?? "crate-map.html", html);
console.log(`crate map: ${crates.length} crates, ${crates.reduce((n, c) => n + c.songs.length, 0)} songs → ${process.argv[2] ?? "crate-map.html"}`);
