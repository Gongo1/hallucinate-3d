# Shared player & flow rules

## The shared room player
One synced track for the whole venue. The **host** (lowest present id) owns the
authoritative `RoomState` and drives playback; everyone else follows + seeks to
`now - startedAt`. Anyone can control it (skip affects the room; selecting a song
cues it). Pause/▶ is the ONLY local control — it just mutes you; the bar plays on.
When the cue is empty the room auto-advances through a seeded shuffle of the whole
library, opening on a random Deep Down / Flip The Wax cut. The "now-playing" card
shows the trio: now / up-next (cue) / just-added.

History: this reversed two earlier designs in one session — first per-listener
audio, then a brief host/follower tune-in/out radio. Both are gone. **Do not
reintroduce per-listener playback or instant unilateral skip in a crowd.**

## Two kinds of rule (single source of truth: `lib/bar/flow.ts`)
The host AND the UI both read from `flow.ts`, so shown numbers always match what's
enforced. **Never hardcode a limit anywhere else.**

### Library rule (fixed, not room-relative)
- `MAX_TRACK_SECONDS = 900` — **no track ≥ 15 min.** Enforced at ingest (reject
  with a per-link reason), backstopped at play-time (host auto-advances a stale/long
  track once the player reports its true duration), and the original long Cercle
  sets were purged.

### Room-flow rules — scale with P = present listeners (`flowLimits(P)`)
At **P = 1 they switch off** (private-jukebox mode).

| P | cueCap (per user) | skipNeeded | skipCooldownMs | cueIntervalMs (anti-spam) |
|---|---|---|---|---|
| 1 | ∞ | 1 (instant) | 0 | 0 |
| 2 | 5 | 1 | 5000 | 60000 |
| 3–5 | 5 | ⌈P/2⌉ | 5000 | 60000 |
| 6–12 | 3 | ⌈P/2⌉ | 15000 | 60000 |
| 13+ | 2 | ⌈P/2⌉ | 15000 | 60000 |

Plus a hard ceiling: **`MAX_CUE_LENGTH = 10`** total cued songs, regardless of P.

- **Cue cap** — host rejects a cue if the user already holds ≥ cueCap. Over-cap
  entries are *grandfathered* (never removed when P grows); allowance re-opens when
  P shrinks. Users can remove their own pending entry; anyone can "clear cue".
- **Vote-skip** — host tallies `skipVotes`, advances at ≥ skipNeeded; resets on
  track change; the cuer of the current track may skip it solo (bypass). Live
  recompute on presence change (prune departed voters, re-evaluate threshold).
- **Skip cooldown** — `cooldownUntil` lives in the shared RoomState (so every client
  shows the same countdown). A skip starts it; a natural end / duration backstop
  doesn't. Votes accrue during cooldown and advance when it elapses.
- **Anti-spam** — 1 cue per session per 60s once P≥2 (off solo) + the 10 ceiling;
  the now-playing cue header has a "clear" button.

> The ONLY thing allowed to bypass vote-skip/cooldown/cue-cap is **god mode**
> (see [god mode](god-mode.md)). Normal users are always subject to the table above.

## Lobby (presence + chat)
Anonymous: a tab's only identity is a random colour/hair. Realtime channel carries
presence (the "☕ N listeners" pill), ~10Hz move broadcasts (moving avatars), and
chat + emoji reactions. The **Added board** drawer shows the latest records live
(Realtime inserts on `records`) with adder colour-dot + one-tap cue.

## Known limitation
Playback is via cross-origin YouTube/SoundCloud iframes, so sync is *same track,
~same position* (seek-on-change), not sample-accurate; clock skew can add a second
or two. The "beat pulse" visuals are simulated from a clock, not real audio
analysis (the iframe's waveform isn't readable).
