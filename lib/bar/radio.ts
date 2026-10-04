// SOMBRA RADIO's pick: what plays when nobody has cued anything. It reads the
// whole catalog (every crate's records) and never looks at who holds which
// collectible copy: ownership gates the queue, not the radio.

import type { Shelf, Track } from "./types";
import { trackKey } from "./presence";

// A small deterministic RNG. Seeded so a given (seed, index) picks the same track —
// the host advances the radio and broadcasts the result, so all clients agree and a
// promoted host can keep the sequence going from the shared index.
export function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ENERGY × TIME auto-radio. The phase (lib/bar/clock.ts) gives a target energy;
// each crate weights toward the radio by how close its energy is to that target —
// so the favored crates (Detroit at Afterhours, Golden Hour at Sunrise, …) emerge
// purely from data, never a hardcoded list. The non-zero `floor` means NO crate is
// ever locked out — you can always dig anything; the pull is gravity, not a gate.
function energyWeight(energy: number, target: number): number {
  // floor 0.01 (never zero → never locked out) + a steep 0.22^distance falloff so
  // the phase's crates clearly lead. Tuned against the live library so each phase's
  // favored crates emerge (Detroit/Deep Down at night, Golden Hour/Organica at dawn).
  return 0.01 + Math.pow(0.22, Math.abs(energy - target));
}

/**
 * Pick one playable record, weighted per-record by its crate's energy proximity to
 * `target`. Per-record (not per-crate) weighting lets energy dominate the pick while
 * bigger crates still bring variety. `avoidKey` re-rolls once to dodge an immediate
 * repeat of the now-playing track. Returns null if nothing is loaded yet.
 */
export function weightedPick(
  shelves: Shelf[],
  target: number,
  rnd: () => number,
  avoidKey?: string
): Track | null {
  const pool: { track: Track; w: number }[] = [];
  let total = 0;
  for (const s of shelves) {
    if (s.ingest) continue; // the 新着 paste crate isn't a radio source
    const w = energyWeight(s.energy ?? 3, target);
    for (const r of s.records) {
      if (!r.ytId && !r.scUrl) continue;
      if (r.fullSet) continue; // full DJ sets are cue-only — never the radio's pick
      pool.push({ track: r, w });
      total += w;
    }
  }
  if (!pool.length) return null;
  const roll = () => {
    let n = rnd() * total;
    for (const e of pool) {
      n -= e.w;
      if (n <= 0) return e.track;
    }
    return pool[pool.length - 1].track;
  };
  let pick = roll();
  if (avoidKey && pool.length > 1 && trackKey(pick) === avoidKey) pick = roll();
  return pick;
}
