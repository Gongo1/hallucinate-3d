// The venue's week. Crates reshuffle and the THIS WEEK crate turns over on the
// same boundary: Friday 17:00 UTC (noon in Austin), the weekly drop.
// UTC-global like the venue clock, so every listener sees the same order.

const WEEK_MS = 7 * 24 * 3600 * 1000;
const EPOCH = Date.UTC(2026, 0, 2, 17); // Fri 2 Jan 2026, 17:00 UTC

/** Which drop-week `ms` falls in (increments every Friday 17:00 UTC). */
export function weekKey(ms: number = Date.now()): number {
  return Math.floor((ms - EPOCH) / WEEK_MS);
}

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A copy of `items` in this week's order for `salt` (a crate id): the same for
 *  everyone all week, different every week and for every crate. */
export function weeklyShuffle<T>(items: T[], salt: string, week: number = weekKey()): T[] {
  let h = week * 0x9e3779b1;
  for (let i = 0; i < salt.length; i++) h = Math.imul(h ^ salt.charCodeAt(i), 0x01000193);
  const rnd = mulberry32(h >>> 0);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
