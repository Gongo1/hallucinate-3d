# The digging game (Sep 2026)

HALLUCINATE plays like **Pokémon meets crate-digging**. Each room is a *realm* with a keeper who explains it (and how it ties to Sombra), crates to dig through (30s previews), and secret passages to far-off realms. **Dig piles were removed 2026-09-29 (96f001f, owner: "kind of annoying")**: crate digging is the game. Keeping a crate record fills the Dex, counts toward titles and badges, and scores a dig on the weekly board. Everything you find goes into your **Crate Dex**. The point is still to find music: digging only *reveals* records from the realm's own crates, and cueing still goes through the shared queue and flow rules.

## Modules
| File | What it holds |
|---|---|
| `lib/bar/realms.ts` | Data for all 12 realms: name/kanji/tagline, lore, the **Sombra connection** line, the keeper (name, look, dialogue), 2 dig piles, the world-map position. Also the 3 `SECRETS` (hatch pairs) and `WANDER_CAT` (the Kissa's lucky cat). |
| `lib/bar/progress.ts` | Your save file (localStorage `hallucinate-progress-v1`): realms visited, records seen and dug, secrets, keepers met, badges. It also covers tiers, titles and `pickDig()`. |
| `lib/bar/engine.ts` | Game zones (`pile`, `keeper`, `secret`, `wander`), the dig timer and pile rest, click-to-use with grid A* pathfinding, walk-through doors, sprint, `travelTo()` / `wander()`. |
| `lib/bar/three/game.ts` | 3D for the game layer: dig mounds with loot beams and sparkles, the keeper's `!`/`…` bubble, secret hatches, the maneki-neko. |
| `components/` (Bar.tsx + game UI) | Dig reveal card, keeper dialogue, Crate Dex (C), world map (M), arrival banners, toasts. |

## Rules of play
- **Dig:** stand on a glinting pile and press E (or click it). After ~0.8s a record from that realm's crates pops out, preferring ones you haven't dug or seen. The pile then rests for 40s.
- **Tiers:** Reissue, First Press, White Label, Test Pressing (58/27/11/4%). The tier is rolled from the record's key, so it's the same for every player. It's flavour, not a claim about real-world rarity.
- **Keep:** the crate browser's "✦ keep" also catches a record into the Dex, and cueing a record counts too.
- **Badges:** you earn a realm badge by digging 5 records from that realm (or all of them, if it has fewer). **Titles** come from your total dug: Newcomer, Crate Flipper, Digger, Selector, Head, Archivist, Legend.
- **Secrets:**
  - The three passages are the Hollow Stack (Archive ↔ Berlin), the Lighthouse Stair (La Playa ↔ Skyline) and the Oven Door (Il Mattarello ↔ Houseum).
  - The first E on either hatch discovers the passage. Keepers drop hints.
- **Travel:**
  - You walk *into* a doorway to go through (E still works).
  - The map fast-travels to any realm you've visited.
  - The lucky cat, the map's dice and the R key all send you to a random realm.
- **Movement:** speed is 240 (Shift sprints ×1.5, and clicked routes ×1.3). Clicking the floor or a thing routes around fixtures, and clicking a thing also uses it on arrival. The rave portal still needs an explicit E, per its rule.

## Gifts (you start in basic clothes)
`lib/bar/gifts.ts` has 36 gifts: 18 **wearables** and 18 **keepsakes**. Each has a line that teaches a bit of Sombra, and some have a link (the Sombra site, /hum, La Hora, Gongo's SoundCloud, @sombra.atx, or the tribute rooms' own pages).

**Wearables** fill the gear slots on `Fit`, which are drawn on the 3D character and broadcast to everyone as the presence `gear` code:
- hat (the old five + a bucket hat)
- top (Sombra tee, haori, hoodie)
- neck (chain, USB lanyard, mala, gold record)
- eyes (shades, specs)
- back (crate pack, tote, mini gong)

**When gifts drop:**
- **Keepers:** every keeper except Rio gives a signature gift the first time you talk to them. The **Sombra tee** is now the first mission's reward (Oct 1).
- **Adding records:** your first 新着 paste earns the **USB lanyard**.
- **Guaranteed:** secrets and badges always gift.
- **By chance:** digs gift 40% of the time, and after 2 dry digs the next one is guaranteed. Keeps gift 20% of the time and first visits 30%.
- **Weighting:** rare pieces (halo, gong, gold record) come up less often.

**Existing players:** `grandfatherFit` makes their old hat theirs, so nobody gets undressed by the update. `clampFit` keeps a fit to owned gear.

## 💃 Dance
The **💃 dance** button (reaction row on desktop, round button beside E on touch) plays a random two-bar house move: Jack in the Box, Heel Toe, Shuffle, Criss Cross, Stomp, Loose Legs or The Skate (names from frague.at/house-move-list).
- **Behaviour:** the move is never the same twice in a row. Walking ends it early; otherwise it eases back to normal after ~4s.
- **How it's built:** it's procedural, like every other animation, so there are no animation files. See `dancePose()` in `three/character.ts`.
- **Everyone sees it:** the move is broadcast as a `dance` presence event.

## ⤒ Jump
**Space** jumps (mute moved to **U**). On touch it's the round ⤒ above 💃. A jump lasts `JUMP_SECONDS` (0.62s) and covers about 150 units walking, 220 sprinting.
- **It clears things:** solids made with `solid(..., low = true)` (the `low` flag on `Rect` in `engine.ts`) don't block you while `airborne()`. Low = crates, the kissa low table, the zen stone, the cat, the koi pond (sprint to clear it), the tsukubai basin, the chabudai and potted plants, the fire pit, rooftop planters, and flour sacks. Walls, doors, counters, the deck and speakers, keepers, pillars, trees, lanterns and railings still block you mid-air.
- **Landing:** come down on top of something low and `landClear()` steps you off to the nearest open side. If none is open, you can walk out of it.
- **Click-to-walk** paths still route around low things. Jumping is a keyboard / button move.
- **Everyone sees it:** broadcast as a `jump` presence event. Your feet leave the floor at once, so what others see matches what you can clear.

## Guardrails
- Keep the placements valid:
  - Piles, keepers and hatches must sit on open floor, away from other zones, and be reachable by path from every spawn.
  - Re-run the geometry check after moving any of them. It jumps to each realm through the dev hook and path-tests every game zone from every spawn.
  - Arrivals are nudged to the nearest free spot (`freeSpot`), so a spawn can never trap you inside a fixture.
- The engine still references no music, sync or flow symbols. `onDig` hands the host a realm and a pile index, and the host picks the record.
- Tribute rooms (Houseum, Il Mattarello) keep attribution language. Their keepers say "tribute" and never "partner".

## Dig previews (Sep 2026)
Flipping a crate or turning up a dig plays **30s of that record, just for you**. It starts a third of the way in, since house intros run long; unknown lengths start 60s in. The room keeps playing for everyone else.
- `BarPlayer.startPreview / endPreview / rejoin` play the preview through the SAME players as the room. On iPhone those are already unlocked by the knock; a second player would need its own tap.
- The `previewing` effect in `Bar.tsx` previews whatever crate record or dig reveal is showing, and ends the preview when neither is open. `#previewChip` shows the countdown and "back to the room".
- While previewing, `playStation` is ignored and `tickProgress` pauses. A preview ending never counts as the room's track ending (`onTrackEnded` → `endPreview`). `onPreviewEnd` → `rejoin(room track, live offset)`.
- Mute during a preview ends it. Previews are skipped while you're muted or blocked. SoundCloud records may not preview on iOS.

## Crates: the three-crate Listening Room + weekly reshuffle (Sep 2026)
- **The Listening Room holds only GONGO, THIS WEEK (`this-week`, owner-curated weekly drop) and SOMBRA SELECTION** (`KISSA_FEATURED` in layout.ts). All three are in `CURATED_CRATES`.
  - HOUSE is in the warehouse. FLIP THE WAX and the 新着 ingest crate are in the archive.
  - New crates are owner-only (`ingest.ts`) and are created in the garden.
- **Weekly reshuffle:** `lib/bar/week.ts` `weeklyShuffle(records, shelf.id)`, applied in `loadShelves`. The week turns over Friday 17:00 UTC, and THIS WEEK is not shuffled.
- **No link-outs to Beatport/DigDeeper, ever** (owner rule). The weekly drop is Austin-approved picks matched to YouTube/SoundCloud uploads.

## Crates as the back of a record + play counts (bdde6c3, Sep 30)
- **A crate opens as a paper back cover:** the full tracklist split into Side A / B, play counts (▶) and lengths per row, and ✦ on rows already in your Dex. The selected record sits on the left with sleeve, cue and keep.
- **Controls:** ↑/↓ (or ←/→) move, ↵ cues, K keeps. The listener is capture-phase, so the engine never sees those keys while a crate is open. On a phone, tap a row.
- **The preview follows the selection** after a 260ms beat, so arrowing down a list doesn't load every row.
- **Play counts:** `records.play_count` (migration `20260930c`). The room host reports each new track once (`presence.amHost()` → `notePlay` → `hallu_note_play()`, which ignores repeats within 3 minutes). Counting started 2026-09-30, with no history before it. `loadShelves` loads without counts if the migration hasn't run.

## The Crate Map (owner tool)
`node scripts/crate-map/build.mjs <out.html>` builds a 2D board of every room → crate → song from the live library: drag songs and crates, rename and recolor, add crates, rooms and links, and a removed tray.
- **Copy changes as Markdown** ends with an exact JSON change list (record ids) for Claude to apply.
- New rooms and rooms past their crate spots are flagged: those need code (a room builder, DIG_SPOTS).
- Published copy: https://claude.ai/artifact/HyhhRVCVMXPvCuvwG1ViSJ

## Sombra Radio UI (Sep 30)
- **Top bar:** Now Playing (● LIVE · Sombra Radio · N listening) · Discover (my crate, map, board, wander) · Contribute (submit, the list, invite) · World (fit, camera, mute, sombraproject.com) · ? (the three actions + keys). `navContent(k)` in Bar.tsx renders each; desktop = `#navPanel.pop`, phone = `#navPanel.sheet` with every section.
- **Phones:** `#np` is the bottom bar. The stick, E, dance and chat are lifted 66px, and `#radioNav` + `#venueClock` are hidden. VenueClock must stay mounted because it pushes the phase light.
- **The omakase counter** (`OMAKASE.radio`, zone + pick `radio`) → `RadioCounter`: who picks, how to add.
- **Welcome:** one first-visit card (`WELCOME_KEY`) carries the member number. `welcomeDueRef` suppresses the "You're #N" toast and the hub's realm banner that visit.
- **Wording:** crate prompt "Dig through X", "✦ Save to my crate", "⤵ Play next for the room", "Submit a record".

## Missions + crate slots (Oct 1)
`lib/bar/quests.ts` holds the story layer: missions, crate slots and realm depth. The UI is `components/game/Quest.tsx` (tracker, deck, swap).
- **Orientation, "Your First Record" (from Rio):** talk to Rio → ✦ save a record from any crate → put it on the deck (the deck zone now opens a picker of your crate) → back to Rio. The hand-in gives the **Sombra tee**, then Rio explains the game: deeper rooms have better records, missions grow your crate, trading is coming.
- **Doors are locked until it's handed in.** `engine.setDoorsLocked()` blocks doors, `travelTo`, `wander` (the cat, the dice, R). A blocked try calls `onLocked` (a toast, throttled to every 1.5s). Door prompts read "🔒 Locked".
- **Putting it on the deck counts even when the cue is refused** (a full queue, or ON AIR cue-lock), so a newcomer is never stuck.
- **Old saves:** `grandfatherQuests()` marks the orientation done if a save has dug anything, been through a door, or owns the tee. `slotFloor` keeps every record a save already held.
- **Slots:** 10 to start, +5 per mission handed in (`SLOTS_BASE`, `SLOTS_PER_QUEST`). Saving into a full crate opens the swap (let one go). Cueing from a crate only keeps the record when a slot is free. The Dex ✕ lets one go. **Titles and realm badges count `progress.kept`** (every record ever kept), not the crate, so letting one go never demotes you. Older saves are backfilled from `dug` on load.
- **Depth:** `DEPTH` is the number of rooms from the hub (doors, then secret hatches), shown on the map. It's a label for now: the crates aren't ranked by depth yet.
- After the hand-in, the **profile offer** shows once (see members.md). The Sombra list auto-offer waits until after the orientation, and never in the same visit as the profile offer.
