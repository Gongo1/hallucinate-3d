# CLAUDE.md — project context

This file is durable context for Claude Code. Read it before changing things.

## The product in one line
A walk-around Japanese listening bar (a *kissa*) that is a playable, vibe-first
front-end for discovering electronic music on YouTube & SoundCloud. Explore the
room, browse record shelves, drop a record on the deck, it plays.

Lineage: a reimagining of `stagas/hallucinate` (a 3D "online rave"). We kept the
core idea — *a spatial world with music at the center* — and made it a cozy
audio-led record bar.

## What already exists (`prototype.html`)
A single self-contained HTML file. **Treat its look & behavior as the spec.**
It contains, in vanilla JS + Canvas 2D:

- **A top-down explorable room** with smooth camera follow, WASD/click/touch
  movement, AABB collision, depth-sorted sprites.
- **The kissa aesthetic**: hinoki wood floor, kumiko-lattice record wall, round
  *marumado* moon window, hanging wooden sign, paper lanterns with light pools,
  big hi-fi speakers (pulse on playback), raised tatami lounge with zabuton,
  pour-over/matcha bar, bamboo / red maple / raked-gravel zen stone, dust +
  incense particles, vignette. Fonts: Shippori Mincho (display), Anton
  (record labels), DM Mono (UI).
- **NPCs** for presence: wandering patrons, a seated nodding pair, a kissa master.
- **Shelves = genres.** Walk up + E → a record-flip overlay (sleeve art, prev/
  next, PLAY this record, PLAY whole shelf).
- **Playback** with a queue: play a record or a shelf; prev/next/shuffle
  ("master's pick"); progress bar.
- **Bulk link ingest** (the headline feature): the red 新着 NEW ARRIVALS shelf /
  the ＋ button opens a paste box. Parser handles `watch?v=`, `youtu.be`,
  `/embed/`, `/shorts/`, and SoundCloud URLs; optional `Artist — Title | URL`
  tagging; files into an existing or new (named/colored) shelf. Best-effort
  title enrichment via a CORS-friendly oEmbed proxy. An **Export** button dumps
  the current library as a `SHELVES = [...]` block (the manual persistence
  bridge, since the prototype has no backend).

## Hard-won lessons — DO NOT relitigate these
1. **Hidden/background audio is blocked in the Claude.ai artifact sandbox.**
   The YouTube IFrame *API script* (`youtube.com/iframe_api`) won't load there,
   and an off-screen autoplaying iframe is muted. So the prototype shows a small
   **visible tap-to-play** player in-sandbox. **Hosted / opened locally, the API
   loads** and we get the intended audio-only + auto-advance. The whole point of
   moving to Vercel is to live where the API works.
2. **The prototype's library is in-memory** → additions vanish on reload. This
   is the #1 thing to fix with Supabase.
3. **oEmbed for titles must run server-side** at scale (browser CORS is flaky).
   A server route calling YouTube/SoundCloud oEmbed solves enrichment cleanly.
4. **Embeddability varies.** Some YouTube videos block embedding/region-lock.
   Always keep a per-record "open ↗" escape hatch; on player error, skip to next.
   Seed catalog uses Cercle (reliable embeds) + NCS (royalty-free singles).

## Data model
`library.seed.json` is the canonical shape. Normalized for Supabase:

```
shelves
  id uuid pk · slug text · label text · color text (hex) · sort int
  is_ingest bool default false · owner uuid null · created_at timestamptz
records
  id uuid pk · shelf_id uuid fk→shelves · title text · artist text
  source text check (source in ('youtube','soundcloud'))
  yt_id text null · sc_url text null · sort int
  added_by uuid null · created_at timestamptz
```
Keep the prototype's field names where possible (`yt_id`, `sc_url`, `source`).

## Target architecture
- **Next.js (App Router, TypeScript, strict).** The Canvas renderer from
  `prototype.html` ports into a single client component / module, kept
  framework-agnostic (plain Canvas + rAF loop; no React on the hot path).
- **Supabase**: Postgres (above schema), seeded from `library.seed.json`.
  Mutations via server actions / route handlers — never expose the service key
  client-side. Anon key + RLS on the client.
- **Vercel**: deploy via the connected Vercel MCP.
- **Playback** (hosted): YouTube IFrame API hidden player (audio-only,
  auto-advance on ENDED, skip on error); SoundCloud Widget API (FINISH→next);
  one unified queue.

## Conventions
- TypeScript strict; no `any` on public boundaries.
- Server actions for all writes; validate/parse links server-side.
- Keep the renderer in its own module; UI chrome (overlays, now-playing) in React.
- Small, readable names. Comments explain *why*, not *what*.
- Don't reintroduce the visible-video player once hosted — go audio-only.
- No secrets in the client bundle.

## Non-goals (for now)
- Hosting/serving audio ourselves (we only orchestrate YouTube/SoundCloud players).
- Ripping/downloading audio.
- A full 3D engine like the original — the 2.5D canvas bar is the aesthetic.
