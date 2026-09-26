# Architecture

## The cardinal rule: ONE shared stream
The whole venue is a single synced audio stream — one radio/cue/skip/now-playing
for everyone, in every room. Moving between rooms changes scenery, never the music.
All music/sync/flow-limit logic lives in **`presence.ts`, `player.ts`, `flow.ts`**.
The **engine (`engine.ts`) never touches audio/sync** — it only handles input,
collision, zones, rooms, and hands the 3D view a read-only snapshot each frame. Keep it that way: any room/visual work must not move sync logic into the
engine.

## Modules
| File | Responsibility |
|------|----------------|
| `lib/bar/engine.ts` | Game logic: input, collision, zones, doors/rooms, NPC paths, rAF loop. Thinks in the 2D floor plan (world px). No audio/sync. |
| `lib/bar/layout.ts` | Every fixture's footprint per room (+ dig spots, LAB_GRID, door themes, crate styles). Shared by the engine (solids/zones) and the 3D view (meshes) — what you see is what you bump into. |
| `lib/bar/three/world.ts` | The low-poly 3D view (three.js): camera follow, lights, room swap, characters, crates, doors, click→floor raycast, and the screen-space finish (phase light multiply+screen, vignette, portal tunnel, door fade). |
| `lib/bar/three/character.ts` | The stylized low-poly listener built from a Fit — procedural walk / idle-nod-to-the-beat / sit / dance. |
| `lib/bar/three/{kit,shared}.ts` | Low-poly toolkit (flat-shaded materials, blocks, lumps, labels, glow pools, motes) + shared room shell, themed doors, record crates. |
| `lib/bar/three/rooms/*.ts` | One scenery builder per scene (kissa, garden, omakase, …). |
| `lib/bar/three/preview.ts` | The fit panel's live 3D preview (one small shared renderer). |
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
