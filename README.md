# HALLUCINATE · 音楽喫茶 — a listening bar

A walk-around, *gameable* front-end for all the electronic music on YouTube &
SoundCloud. You explore a cozy Japanese listening bar (a **kissa**), browse the
record shelves, drop a record on the deck, and it plays. Think of it as a
playable interface for music discovery — vibe-first, audio-led.

Inspired by [`stagas/hallucinate`](https://github.com/stagas/hallucinate)
("Massively Multiplayer Online Rave") — same idea of *a spatial world where
music is the centerpiece*, reimagined as a chill record bar instead of a rave.

---

## What's in this folder

| File | What it is |
|---|---|
| `prototype.html` | The **working build**. One self-contained file. Open it in a browser. This is the design + behavior source of truth. |
| `library.seed.json` | The starter record library, extracted from the prototype. Shape is Supabase-ready (5 shelves / 11 records). |
| `CLAUDE.md` | Persistent project context for Claude Code — concept, what exists, hard-won technical lessons, data model, target architecture. |
| `PROMPT.md` | The **kickoff prompt** to paste into Claude Code to build the scalable version. Phased, with acceptance criteria. |

## Run the prototype right now

Just open `prototype.html` in a browser (double-click it). Controls:

- **WASD / arrows / click** — walk around
- **E** — browse the shelf / pour-over bar you're standing at
- **Space** — play/pause · **N** — next
- **＋ add records** (top-right) or the red **新着 NEW ARRIVALS** shelf — paste a
  stack of YouTube/SoundCloud links, one per line, to file them into shelves

> Opened **locally or hosted**, the YouTube JS API loads, so playback is
> audio-only and auto-advances through a shelf like a radio.
> Inside the Claude.ai chat sandbox that script is blocked, so there it falls
> back to a small visible tap-to-play player. This difference is the main
> reason to take it to a real host — see `CLAUDE.md`.

## Where it's going

The prototype is intentionally a single file with an **in-memory** library, so
anything you add disappears on reload. The next step (see `PROMPT.md`) is to
hand it to Claude Code and turn it into a real app:

- **Next.js on Vercel** — the canvas game becomes a client component
- **Supabase** — the library + ingest persist; shareable/curated shelves
- **Hosted playback** — proper audio-only, auto-advance, SoundCloud finish events
- **Radio mode** and (the homage to the original) **multiplayer presence**

## Quickstart with Claude Code

```bash
git init && git add -A && git commit -m "hallucinate: prototype + plan"
# (optional) push to GitHub
# then, in Claude Code, from this folder:
#   paste the contents of PROMPT.md
```

You have the Vercel and Supabase MCPs connected — `PROMPT.md` tells Claude Code
to use them to provision the DB and deploy.

## Contributors

- Blaine (GitHub: BlaineMcCullars): quests and passports
