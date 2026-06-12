# Session summary — 2026-05-31 → 2026-06-01

One-off log of what shipped across this stretch. Durable detail lives in `../wiki/`.

## Shipped (all live)
- **Music imports:** Detroit shelf (right wall, 13); Desert Essence → House (+15);
  Flip The Wax (+6). Later: Garden's **Golden Hour + Organica = 100 deep-house
  tracks** from the owner's playlist (50/50). All validated via oEmbed + 15-min cap.
- **Hard cue cap = 10** (`MAX_CUE_LENGTH` in flow.ts).
- **Room system:** room-as-data registry + the **Garden** courtyard; door
  transitions; one shared audio stream across rooms; presence venue-wide, avatars
  per-room.
- **God mode:** owner `/booth`, server-verified (ADMIN_SECRET → httpOnly cookie →
  Realtime HTTP broadcast); force-skip/clear/remove/pin/force-play/lock/on-air;
  only god mode bypasses flow rules.
- **ON AIR** primitive (sign + banner + cue-lock; default off).
- **Sombra connection:** `hallucinate.sombraproject.com` subdomain + secret ☉☽
  warp portal on the live homepage + continuity touches in the bar. No code merge.
- **Sombra content:** HUM (Jul 11) event added to Experiencias; El Barrio tab hidden.

## Decisions
- Strictly **house** music; **always ask before adding any music** (after an
  off-genre auto-pull was caught + removed).
- "Merge with Sombra" = **subdomain + portal**, not a codebase merge.
- Only ever commit **specific files** to the live Sombra repo (its tree has
  unrelated uncommitted work).

## Gotchas discovered (now in wiki/deploy-ops.md)
- `vercel --prod` can ship a **stale `.next`** → `rm -rf .next` first; verify the
  deploy actually shipped before debugging.
- Vercel **SSL cert stalls** with GoDaddy-managed DNS → `vercel certs issue
  <domain>` (a redeploy won't fix it). This was the "hallucinate.sombraproject.com
  didn't load" issue — DNS was fine, cert just hadn't issued.
- Verify canvas layout changes by **screenshot**, not by reading source (a silent
  find/replace miss once shipped a deck that hadn't moved).

## Process notes / corrections (for honesty)
- The Sombra ☉☽ portal was committed **directly to `main`** (per owner's "commit
  only my files" choice) → deployed to production immediately. A PR-first flow was
  offered for next time.
- A couple of headless multi-client tests were skewed by **ghost presences**
  (kill -9'd Chrome doesn't untrack) — real tabs untrack cleanly.

## Open / future
- ON AIR is the minimal primitive — scheduled sets / guest DJ / independent live
  audio not built.
- Radio "default to chill" curation idea noted earlier; the Garden crates are the
  closest realization.
