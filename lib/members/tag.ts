/** A member number as the room shows it: 42 → "#042". Client-safe. */
export function memberTag(n: number): string {
  return `#${String(n).padStart(3, "0")}`;
}

/** Points per scored action on the weekly board (the server is the authority). */
export const POINTS = { dig: 10, keep: 3, gift: 15, secret: 25, badge: 40, set: 20 } as const;
export type ScoreKind = keyof typeof POINTS;
