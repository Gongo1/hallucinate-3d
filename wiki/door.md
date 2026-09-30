# The door (arrival ritual)

Replaced the old fade-out intro on 2026-09-29 (b7a52a9). Full spec with a playable
demo: `KB/Sombra/outputs/html/2026-09-29-hallucinate-door-ritual.html`.

## What happens
A lit shoji door covers the room, which is already rendering behind it. The door
shows the real headcount (the lurk roster) and the phase, and one line: "The room is
yours" (empty), "Welcome back" (has visited before), or "ON AIR · <dj> is spinning".
Knock → ready gate → the panels slide → the room swells in → the chrome fades in.

| | First visit | Returning |
|---|---|---|
| Knocks | 2 | 1 |
| Slide starts | 650ms | 200ms |
| Slide / dolly | 1200 / 1600ms | 700 / 800ms |
| Chrome in | 1850ms (+150ms stagger) | 900ms |
| Muffled bed | yes | no |

Timing lives in `ARRIVAL` (Bar.tsx). A second tap skips. `prefers-reduced-motion`
gets a 400ms fade with no dolly.

## Modules
| File | Role |
|---|---|
| `components/game/Door.tsx` | The door markup. **Keeps `id="intro"`**, and the click on it is the knock. |
| `components/Bar.tsx` | `enter()` sequences it; `openDoor()`; the `ready` gate (scene drew + roster known + room state if anyone is inside, max 2.5s); `chrome-hidden` / `chrome-in` on `#wrap`; `onInsideRef` holds the realm banner and the first-run hint until the chrome comes in. |
| `lib/bar/sfx.ts` | Procedural Web Audio: the knock, the slide, and a low-passed 122 BPM bed. |
| `lib/bar/player.ts` | `holdLow(12)` before playStation, then `swell(ms)`. A safety swell fires after 4s. |
| `lib/bar/three/world.ts` | `setArrival(mult, ms)`: the camera distance dolly (view-only, passed through `engine.setArrival`). |

## Rules
- **`playStation` stays inside the knock's click** (see the mobile-audio rules). Never
  await anything before it.
- The room audio is a cross-origin iframe, so Web Audio can't filter it. The
  "through the wall" sound is only the synthesized bed.
- **iOS ignores `setVolume`**, so the swell is desktop-only (the old `fadeIn` never
  worked there either). Spike 0 (a real-device test of mute/unmute) is open.
- The headcount is **real**. The 10–20 padded pill (5685dac) was reverted.
- Capture rigs that click `#intro` now need about 2.6s (first visit) before the room
  is settled.

## Next (Phase 2, decided)
Anonymous member numbers (#001 Gongo, #002 Elixir Pau) in a signed httpOnly cookie.
3 keys at join, +1 per ON AIR set attended, as `/k/<code>` links with a per-code
OG image ("#017 saved you a key"). The door stays open to everyone: keys add status,
not access. Needs `SUPABASE_SERVICE_ROLE_KEY` (server-only) on Vercel.
