# Architecture

## The cardinal rule: ONE shared stream
The whole venue is a single synced audio stream — one radio/cue/skip/now-playing
for everyone, in every room. Moving between rooms changes scenery, never the music.
All music/sync/flow-limit logic lives in **`presence.ts`, `player.ts`, `flow.ts`**.
The **engine (`engine.ts`) never touches audio/sync** — it only renders + handles
input. Keep it that way: any room/visual work must not move sync logic into the
engine.

## Modules
| File | Responsibility |
|------|----------------|
| `lib/bar/engine.ts` | Canvas renderer: rooms, fixtures, NPCs, particles, camera, input, zones, draw loop. No audio/sync. |
| `lib/bar/player.ts` | Audio-only playback. `playStation(track, offsetSec)` (synced, seeks), `replayFromStart`, `togglePlay` (local mute), reports `onStationEnded`/`onDurationKnown`. |
| `lib/bar/presence.ts` | The Supabase Realtime hub: presence roster, chat/reactions, **the shared RoomState** (host-authoritative), god-mode admin apply, venue-room tracking. |
| `lib/bar/flow.ts` | **Single source of truth** for limits: `MAX_TRACK_SECONDS`, `MAX_CUE_LENGTH`, `flowLimits(P)`. |
| `lib/bar/rooms.ts` | Room-as-data registry (`ROOMS`, doors, spawns). |
| `lib/bar/data.ts` | DB → runtime mapping (server-only). |
| `lib/bar/types.ts` | `Track`, `Shelf`, `RemotePlayer`. |
| `lib/supabase/{server,client}.ts` | Server (service-or-anon) + browser (anon) clients. |
| `components/Bar.tsx` | React host: wires engine + player + presence; UI chrome (now-playing, cue, lobby chat, ingest, Added board, intro). |
| `app/actions/{ingest,booth}.ts` | Server actions: link ingest; god-mode authority. |
| `app/booth/*` | Hidden owner route. |

## The shared RoomState (authoritative, host-owned)
Broadcast over Realtime channel `hallucinate-bar`. One client is **host** (lowest
present id); only the host mutates state. Shape (see `presence.ts` `RoomState`):
`now, nowCuedBy, startedAt, cue[], seed, index, skipVotes[], present, cooldownUntil,
cueLocked, live, dj, liveStartedAt, rev, host`. Newer `rev` wins; host handoff is
automatic. Clients send *intents* (cue/skip/uncue/clearCue); the host applies them
under the flow rules and rebroadcasts. Followers seek to `now - startedAt` so
everyone hears ~the same spot (not frame-perfect — iframe limitation).

## Realtime channel `hallucinate-bar` — event map
- `presence` (sync) — roster + per-user color/hair + venue-room (`vroom`)
- broadcast `move` — ~10Hz positions (+ room) → moving avatars
- broadcast `chat` / `react` — lobby chat + emoji
- broadcast `room` — the authoritative RoomState (host → all)
- broadcast `intent` — anyone's cue/skip request → host
- broadcast `room-req` — newcomer asks host for current state
- broadcast `admin` — **server-origin** god-mode command (see [god mode](god-mode.md))

## Data model (Supabase, additive to Sombra's DB)
```
shelves(id, slug, label, color, sort, is_ingest, room, owner, created_at)
records(id, shelf_id→shelves, title, artist, source['youtube'|'soundcloud'],
        yt_id, sc_url, sort, duration_seconds, added_by, added_by_color, created_at)
```
RLS: public read on both; public insert (writes go through server actions). The
`records` table is in the `supabase_realtime` publication (for the live Added board).
