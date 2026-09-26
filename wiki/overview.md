# Overview

**HALLUCINATE** is a walk-around Japanese listening bar (a *kissa*) — a playable,
vibe-first front-end for discovering electronic music on YouTube & SoundCloud.
You explore a stylized low-poly 3D room (three.js), browse record shelves, and the bar plays
as one shared, synced stream everyone in the venue hears together.

Lineage: a reimagining of `stagas/hallucinate` (a 3D "online rave"), kept the core
idea — *a spatial world with music at the center* — as a cozy audio-led record bar.

## The nested-worlds story (reads end to end)
**Sombra** (the threshold — sombraproject.com) → click the secret **☉☽** glyph →
**Hallucinate** (the listening bar) → the in-world **rave portal** →
**hallucinate.site** (the external MMO rave).

## Stack
- **Next.js 15** (App Router, TypeScript strict), deployed on **Vercel** via CLI.
- **Engine + low-poly 3D view** in `lib/bar/*` (framework-agnostic; rAF loop, no
  React on the hot path; three.js renders, the engine keeps the 2D floor-plan
  logic); React only for UI chrome.
- **Supabase** — Postgres (shelves/records) + **Realtime** (presence, chat, the
  shared room player, god-mode admin events). Shared with the Sombra restaurant
  site; hallucinate's tables are additive (`shelves`, `records`).
- **Audio** — hidden YouTube IFrame API player + SoundCloud Widget, audio-only,
  one shared stream.

## Phase history (high level)
- **Phase 0** — scaffold + port the prototype, get it live.
- **Phase 1** — Supabase persistence (shelves/records, server-action ingest).
- **Phase 2/3 evolution** — the radio became a SYNCED shared room player; an
  anonymous multiplayer lobby (presence + chat); P-scaling flow rules; a rave
  portal; multi-room venue (Kissa hub + Garden); owner god mode + ON AIR; and the
  Sombra subdomain + ☉☽ portal connection.

See [architecture](architecture.md) for how the pieces fit.
