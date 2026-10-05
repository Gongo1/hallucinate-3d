// What a crate shows and offers, given which copies are left. Pure (no React,
// no server) so the rules are tested on their own.

import type { Shelf, Track } from "@/lib/bar/types";
import { COPIES_PER_TRACK, isHouseCrate, type Availability, type OwnedCopy } from "./rules";

/** Track keys of every house record (filed in a house crate). A house track
 *  is house in every crate it's in: never claimable, never hidden. */
export function houseKeys(shelves: Shelf[]): Set<string> {
  const out = new Set<string>();
  for (const s of shelves) if (isHouseCrate(s.slug)) for (const t of s.records) if (t.trackKey) out.add(t.trackKey);
  return out;
}

const NONE: ReadonlySet<string> = new Set();

/** Copies of a track still in crates; null when we can't say (collecting
 *  closed) or it doesn't apply (a house record). */
export function copiesLeft(t: Track, avail: Availability | null, house: ReadonlySet<string> = NONE): number | null {
  if (!avail || !t.trackKey || house.has(t.trackKey)) return null;
  return avail[t.trackKey]?.length ?? 0;
}

/** A crate's records on show: a track whose three copies are all claimed is
 *  gone from every crate (it still plays on Sombra Radio, which reads the
 *  whole catalog). Unknown availability hides nothing. */
export function claimableRecords(records: Track[], avail: Availability | null, house: ReadonlySet<string> = NONE): Track[] {
  if (!avail) return records;
  return records.filter((t) => copiesLeft(t, avail, house) !== 0);
}

/** A copy was claimed (by anyone): it leaves the crate. */
export function dropCopy(avail: Availability | null, copyId: string, trackKey: string): Availability | null {
  if (!avail || !avail[trackKey]?.some((c) => c.id === copyId)) return avail;
  return { ...avail, [trackKey]: avail[trackKey].filter((c) => c.id !== copyId) };
}

/** The server's fresh word on some tracks replaces what we had for them. */
export function mergeAvailability(avail: Availability | null, fresh: Availability | null): Availability | null {
  if (!fresh) return avail;
  return { ...(avail ?? {}), ...fresh };
}

export interface ClaimButton {
  label: string;
  disabled: boolean;
  hint?: string;
  /** the copy a click claims */
  copyId?: string;
}

/** The ◆ button for one record: claimable only while a copy is left and you
 *  have room (and don't already hold this track). Null = collecting closed,
 *  or a house record (nobody claims those). */
export function claimButton(
  t: Track,
  avail: Availability | null,
  backpack: { cap: number; copies: OwnedCopy[] } | null,
  house: ReadonlySet<string> = NONE
): ClaimButton | null {
  const left = copiesLeft(t, avail, house);
  if (left === null || !t.trackKey) return null;
  if (!backpack) return { label: "◆ Claim copy", disabled: true, hint: "Knock in to start collecting" };
  const held = backpack.copies.length;
  if (backpack.copies.some((c) => c.trackKey === t.trackKey))
    return { label: "◆ In your backpack", disabled: true, hint: "You hold a copy of this one" };
  const next = avail?.[t.trackKey]?.[0];
  if (!next) return { label: "◆ Every copy is claimed", disabled: true };
  if (held >= backpack.cap)
    return { label: `◆ Backpack full · ${held}/${backpack.cap}`, disabled: true, hint: "Your backpack is full" };
  return {
    label: `◆ Claim copy #${next.serial} of ${COPIES_PER_TRACK} · ${held}/${backpack.cap}`,
    disabled: false,
    hint: `${left} of ${COPIES_PER_TRACK} left`,
    copyId: next.id,
  };
}
