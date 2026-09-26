# Rooms (the venue)

The venue is multiple **rooms**; one engine renders any room from its data.
Moving between rooms changes **scenery only** — audio stays one shared stream
([architecture](architecture.md)).

## Room-as-data
`lib/bar/rooms.ts` exports `ROOMS`, a registry of `RoomDef { id, name, scene,
doors[], spawns, defaultSpawn }`. Adding a room = adding data, not engine code.
Current rooms:
- **`kissa`** (HUB_ROOM, the hub/entrance) — deck, pour-over bar, the record-shelf
  library, the rave portal. Scene renderer: warm hinoki interior.
- **`garden`** — open-air Japanese courtyard at dusk. Scene renderer `drawGarden`:
  twilight sky + moon/stars, koi pond, raked-gravel karesansui, red maple, bamboo,
  stone lanterns, tsukubai + shishi-odoshi, moss, drifting fireflies.

## Shelf → room
Each shelf row has a `room` column (default `kissa`). `setShelves` filters shelves
to the current room. Kissa shelves render as the wall library + the right-wall
Detroit shelf; garden shelves (`goldenhour`, `organica`) render as compact dig-spots
among the scenery (`placeGardenShelves`). **Every crate in any room cues into the
one shared queue.**

## Doors & transitions
Doors reuse the portal primitive pointed inward: a solid frame + a `type:"door"`
zone in front. Press **E** → ~320ms fade-out → `enterRoom()` swaps room at full
dark → fade-in. Movement freezes while dark (`transitioning()`) so you don't drift
through the new room's walls. Kissa ↔ Garden door is on the Kissa right wall / Garden
left wall.

## Presence: venue-wide, avatars per-room
Presence + the **listener count are whole-venue**, but each avatar only renders in
the room it's currently in. Implemented via a SEPARATE `venueRoom` field in
presence (NOT RoomState — that's audio). `setRoom()` re-tracks presence; `vroom` in
the presence meta + `room` in the move broadcast; `RemotePlayer.room` filters which
avatars draw (`engine.remoteEntities` filters by current room).

## 3D scenery (Sep 2026 — the low-poly upgrade)
Each scene has a builder in `lib/bar/three/rooms/<scene>.ts` that returns meshes +
lighting + an `update()` for its animation. Fixture footprints come from
`lib/bar/layout.ts`, the same constants the engine turns into solids — move a
fixture there and both the collision and the mesh move. Doors (themed by
destination) and crates are built for every room by `lib/bar/three/shared.ts`.

## Layout / camera notes (for editing fixtures)
- Room is 1140×800, WALL=28, x→right, y→toward the camera. Three.js maps world
  (x, y) → (x, elevation, y). The camera follows the player from +Z, pitched 54°
  down; the near (front) wall is kept low so it never hides the room.
- Headless testing: `node scripts/shot.mjs <outDir> <roomId>[@x,y] …` (dev server
  on :3100; uses the dev-only `window.__barEngine` hook to jump rooms / teleport).
  Click-to-walk goes through `World3D.screenToWorld` (a floor raycast).
- **Verify canvas layout changes by screenshot, not by reading source.** A silent
  find/replace miss once shipped a "moved" deck that hadn't moved. Headless Chrome
  via `puppeteer-core` at `/Applications/Google Chrome.app/...`, dismiss `#intro`,
  wait ~3.5s for the rAF loop, screenshot, `sips -Z` to downscale.
- Run a geometry assertion (no fixture-rect overlaps, zones reachable, spawn clear)
  before shipping a fixture move.

Kissa room map, exact coords, and the deck/sign/portal placement history are in the
memory note `room-layout.md`.
