// SINGLE SOURCE OF TRUTH for all playback limits.
//
// Two kinds of rule:
//   • Library rule  — about the catalog, fixed, NOT room-relative: the 15-min cap.
//   • Room-flow rules — about contention, scale with P = present listeners:
//                       cue cap, vote-skip threshold, skip cooldown. At P = 1
//                       they switch off (private-jukebox mode).
//
// The host derives every cap/threshold/cooldown from flowLimits(P); the UI reads
// the same function so the numbers it shows always match what the host enforces.
// Do NOT hardcode any of these limits anywhere else.

/** Library cap — fixed, not room-relative. No track at or over 15 minutes. */
export const MAX_TRACK_SECONDS = 900;

/**
 * The one exception: owner-curated crates (by shelf slug) may hold full DJ sets
 * over the cap. Those sets are CUE-ONLY — the auto-radio never picks them, so a
 * 3-hour set only plays when someone chooses it (the duration backstop lets it
 * run). Short tracks in the same crates play on the radio as normal.
 * Owner decisions, 2026-09-29: Gongo's own uploads; the Sombra Selection.
 */
export const FULL_SET_CRATES: ReadonlySet<string> = new Set(["gongo", "sombra-selection"]);

/** A track in a FULL_SET_CRATES crate is a (cue-only) full set if it's over the
 *  cap — or of unknown length (SoundCloud links arrive without one). */
export function isFullSet(crateSlug: string | undefined, durationSeconds: number | null | undefined): boolean {
  return !!crateSlug && FULL_SET_CRATES.has(crateSlug) && (durationSeconds == null || durationSeconds >= MAX_TRACK_SECONDS);
}

export interface FlowLimits {
  /** max pending cue entries a single user may hold (Infinity when solo) */
  cueCap: number;
  /** distinct skip votes needed to advance the now-playing track */
  skipNeeded: number;
  /** min ms between room advances (0 when solo) */
  skipCooldownMs: number;
  /** min ms between a single session's cues — anti-spam failsafe (0 when solo) */
  cueIntervalMs: number;
}

/**
 *  P        cueCap   skipNeeded   skipCooldownMs   cueIntervalMs
 *  1        ∞        1 (instant)  0                0   (private jukebox)
 *  2        5        1            5000             60000
 *  3–5      5        ⌈P/2⌉        5000             60000
 *  6–12     3        ⌈P/2⌉        15000            60000
 *  13+      2        ⌈P/2⌉        15000            60000
 */
export function flowLimits(P: number): FlowLimits {
  const n = Math.max(1, P | 0);
  return {
    cueCap: n <= 1 ? Infinity : n <= 5 ? 5 : n <= 12 ? 3 : 2,
    skipNeeded: n <= 2 ? 1 : Math.ceil(n * 0.5),
    skipCooldownMs: n <= 1 ? 0 : n <= 5 ? 5000 : 15000,
    // 1 cue per minute per session once the room is shared (off when solo)
    cueIntervalMs: n <= 1 ? 0 : 60000,
  };
}

/** Hard cap on total cued songs, regardless of P — anti-spam + a firm ceiling. */
export const MAX_CUE_LENGTH = 10;
