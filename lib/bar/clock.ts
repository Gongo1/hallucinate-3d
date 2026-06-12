// The venue's WORLD-TIME. A single UTC clock drives a phase shared by every
// client — there is deliberately NO local time, so everyone sees the same sky and
// the radio leans the same way at the same moment ("tuning into a place", not a
// bug). Phase changes every 3h.
//
// Pure + framework-agnostic: callers pass `utcMs` (Date.now()); nothing in here
// reads the clock itself, which keeps it trivially testable and SSR-safe. Two
// things consume a phase:
//   • the engine — composites `light` over each room's palette (scenery only)
//   • the auto-radio — leans toward crates whose energy is near `target`
// Both are data-driven off the schedule below; the clock only drives the DEFAULT
// fill — cues and god mode still override (see presence.ts).

export type RGBA = readonly [number, number, number, number];

export interface PhaseLight {
  /** multiply layer — recolors + darkens the room toward the phase hue */
  mult: RGBA;
  /** screen layer — adds the phase's glow (dawn gold, ember, neon) */
  glow: RGBA;
}

export interface Phase {
  id: string;
  label: string;
  glyph: string;
  /** UTC hour this 3h block begins (0,3,6,…,21) */
  startHour: number;
  /** the energy (1–5) the auto-radio aims for during this phase */
  targetEnergy: number;
  light: PhaseLight;
}

export interface PhaseNow {
  id: string;
  label: string;
  glyph: string;
  /** "02:14 UTC" */
  utcLabel: string;
  /** eased target energy (fractional while drifting across a boundary) */
  target: number;
  /** eased composite light for the engine */
  light: PhaseLight;
  /** 0..1 progress through the current 3h block */
  progress: number;
}

// The schedule is DATA (tunable). Light is two layers the engine composites:
// `mult` (× the scene → darken + colour-cast) and `glow` (screen → add light).
// Alpha is the layer's strength. Energies reproduce the spec's "favored crates"
// purely from data (Detroit 5 shines at Afterhours/Peak; Golden Hour/Organica 2
// at Sunrise; mid house 3 at Midday).
export const PHASES: readonly Phase[] = [
  {
    id: "afterhours", label: "Afterhours", glyph: "☾", startHour: 0, targetEnergy: 5,
    // dark + cool (deep indigo) but LEGIBLE — dims to ~55% with a blue cast, not a
    // near-black crush; the ember glow is a faint hint so it doesn't haze contrast.
    light: { mult: [46, 46, 97, 0.55], glow: [150, 40, 26, 0.06] },
  },
  {
    id: "lastcall", label: "Last Call", glyph: "✶", startHour: 3, targetEnergy: 4,
    light: { mult: [56, 64, 110, 0.46], glow: [40, 70, 120, 0.05] }, // deep blue, still clear
  },
  {
    id: "sunrise", label: "Sunrise", glyph: "◔", startHour: 6, targetEnergy: 2,
    light: { mult: [255, 224, 204, 0.3], glow: [255, 168, 120, 0.2] }, // golden-pink dawn
  },
  {
    id: "morning", label: "Morning", glyph: "◑", startHour: 9, targetEnergy: 2.5,
    light: { mult: [255, 246, 232, 0.15], glow: [255, 240, 210, 0.08] }, // soft cream, bright
  },
  {
    id: "midday", label: "Midday", glyph: "☀", startHour: 12, targetEnergy: 3,
    light: { mult: [255, 250, 240, 0.06], glow: [255, 248, 230, 0.05] }, // warm, near-neutral
  },
  {
    id: "golden", label: "Golden", glyph: "◕", startHour: 15, targetEnergy: 3,
    light: { mult: [255, 230, 194, 0.24], glow: [255, 196, 120, 0.14] }, // warm amber
  },
  {
    id: "sunset", label: "Sunset", glyph: "☼", startHour: 18, targetEnergy: 3.5,
    light: { mult: [206, 148, 168, 0.4], glow: [255, 150, 88, 0.16] }, // gold → violet
  },
  {
    id: "peak", label: "Peak", glyph: "☽", startHour: 21, targetEnergy: 4.5,
    light: { mult: [54, 28, 92, 0.5], glow: [150, 40, 160, 0.07] }, // dark violet + neon, legible
  },
];

const DAY_MS = 86_400_000;
const PHASE_MS = DAY_MS / PHASES.length; // exactly 3h
/** half the cross-boundary ease window, as a fraction of one phase (~7 min) */
const EASE = 0.04;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix = (a: RGBA, b: RGBA, t: number): RGBA => [
  lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t),
];

/**
 * The phase right now. The displayed phase (id/label/glyph) flips discretely at
 * the top of each 3h block, but `target` and `light` EASE across the boundary —
 * over a ~14-min window straddling it — so the music drifts and the sky melts
 * rather than lurching at the hour. `utcMs` is the only input (Date.now()).
 */
export function phaseAt(utcMs: number): PhaseNow {
  const msIntoDay = ((utcMs % DAY_MS) + DAY_MS) % DAY_MS;
  const pos = msIntoDay / PHASE_MS; // 0..8, continuous position on the phase ring
  const i = Math.floor(pos) % PHASES.length; // current phase (drives the readout)
  const frac = pos - Math.floor(pos); // 0..1 within the current phase
  const cur = PHASES[i];

  // Pick the two phases to blend + the weight `t` toward the second, so the eased
  // value glides phase[i] → phase[i+1] across [1-EASE, +EASE] around each boundary
  // (settled at the phase's own value through the middle of the block).
  let aIdx = i, bIdx = i, t = 0;
  if (frac < EASE) {
    aIdx = (i + PHASES.length - 1) % PHASES.length; bIdx = i;
    t = 0.5 + frac / (2 * EASE); // boundary midpoint (0.5) → settled (1)
  } else if (frac > 1 - EASE) {
    aIdx = i; bIdx = (i + 1) % PHASES.length;
    t = 0.5 + (frac - 1) / (2 * EASE); // settled (0) → boundary midpoint (0.5)
  }
  const a = PHASES[aIdx], b = PHASES[bIdx];

  const hh = Math.floor(msIntoDay / 3_600_000);
  const mm = Math.floor((msIntoDay % 3_600_000) / 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");

  return {
    id: cur.id,
    label: cur.label,
    glyph: cur.glyph,
    utcLabel: `${pad(hh)}:${pad(mm)} UTC`,
    target: lerp(a.targetEnergy, b.targetEnergy, t),
    light: { mult: mix(a.light.mult, b.light.mult, t), glow: mix(a.light.glow, b.light.glow, t) },
    progress: frac,
  };
}
