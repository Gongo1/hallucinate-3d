# PROMPT.md — paste this into Claude Code

You're building **HALLUCINATE**, a walk-around Japanese listening bar that's a
playable front-end for discovering electronic music on YouTube & SoundCloud.

Read `CLAUDE.md` and `README.md` first. `prototype.html` is a complete, working
single-file build — **treat its visuals and behavior as the source of truth**.
`library.seed.json` is the starter catalog. I have the **Vercel** and
**Supabase** MCPs connected — use them to provision and deploy.

Work in the phases below. After each phase, stop, summarize what changed, run it,
and wait for me to confirm before moving on. Don't skip ahead.

---

## Phase 0 — Scaffold + port the prototype (get it live, unchanged)
- Scaffold **Next.js (App Router, TypeScript strict, ESLint)**.
- Port the entire Canvas game from `prototype.html` into a client component
  (e.g. `components/Bar.tsx`) backed by a framework-agnostic renderer module
  (`lib/bar/*` — keep the rAF loop and Canvas drawing out of React state).
  Keep the look **identical**: kissa room, shelves, NPCs, particles, fonts,
  now-playing card, ingest overlay.
- For now keep the library in-memory by importing `library.seed.json`.
- **Playback: switch to the YouTube IFrame API hidden player** (audio-only) +
  SoundCloud Widget — we're hosted now, so the API loads. Auto-advance on track
  end; skip on player error; keep the per-record "open ↗" escape hatch.
- Deploy to Vercel via the MCP.
- **Done when:** the hosted URL plays a shelf as audio-only and auto-advances,
  and the room/ingest UI matches the prototype.

## Phase 1 — Supabase persistence
- Provision Postgres with the schema in `CLAUDE.md` (`shelves`, `records`).
  Add RLS: public read; writes allowed for now (we'll gate on auth in Phase 3).
- Seed from `library.seed.json`.
- Replace the in-memory import with DB reads (server components / route handler).
- **Rewire ingest to persist:** a server action takes the pasted text, parses
  links (reuse the prototype's parser logic), enriches titles **server-side**
  via YouTube/SoundCloud oEmbed (no CORS there), inserts `records`, returns them.
  New shelves persist too. Remove the manual "Export" bridge.
- **Done when:** I can paste links, reload the page, and they're still there.

## Phase 2 — The radio
- A **unified queue** across YouTube + SoundCloud; SoundCloud FINISH → next.
- **Radio mode:** a "leave it on" station that plays the whole bar continuously,
  shelf to shelf, with a short crossfade; surfaces the current track on the deck.
- Mobile pass: joystick + action button already exist in the prototype — make
  sure they survive the port and the now-playing card is thumb-reachable.
- **Done when:** I can hit "radio" and it just plays, hands-off, on desktop + phone.

## Phase 3 — Make it social (the homage to the original "online rave")
- Auth (Supabase). Personal shelves (owner-scoped) vs curated/public shelves;
  tighten RLS accordingly.
- **Shareable shelves**: a shelf has a public URL anyone can open and play.
- **Multiplayer presence** via Supabase Realtime: show other live listeners as
  little characters moving in the bar; optional **synced house radio** channel
  where everyone hears the same track (the MMO-rave spirit, made chill).
- **Done when:** two browsers in the same bar see each other and can share a shelf.

---

## Guardrails
- Don't reintroduce the visible-video player once hosted — keep playback audio-only.
- All writes go through server actions/route handlers; never ship the Supabase
  service key to the client; anon key + RLS only on the client.
- Keep the renderer decoupled from React (no per-frame React re-renders).
- Preserve the aesthetic and the field names (`yt_id`, `sc_url`, `source`).
- Keep a per-record fallback link and skip-on-error; assume some embeds fail.

## First reply I want from you
A short plan for Phase 0 — file/route structure, how you'll port the Canvas
module, and the exact Vercel/Supabase MCP steps — then start.
