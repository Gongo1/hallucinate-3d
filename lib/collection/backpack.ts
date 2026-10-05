// What the Backpack shows for each copy you hold, and how its list filters.
// Pure (no React, no server) so the rules are tested on their own. The server
// stays the authority: these states only decide which button a row offers;
// "put it on" still goes through requestCue's signed ticket.

import type { Shelf, Track } from "@/lib/bar/types";
import type { OwnedCopy } from "./rules";

/** a copy you hold, as of right now in the room */
export type CopyState =
  | { kind: "ready" }
  | { kind: "queued"; pos: number }
  | { kind: "playing" }
  | { kind: "unavailable"; reason: string };

export interface RoomView {
  /** track key of what the whole room hears now (null = nothing yet) */
  nowKey: string | null;
  /** track keys cued next, in order */
  cueKeys: string[];
  /** may you cue right now (flow rules: wait, your cue cap) */
  canQueue: boolean;
  /** why not, in a few words, when canQueue is false */
  reason: string;
}

export function copyState(copy: OwnedCopy, room: RoomView): CopyState {
  if (room.nowKey === copy.trackKey) return { kind: "playing" };
  const at = room.cueKeys.indexOf(copy.trackKey);
  if (at >= 0) return { kind: "queued", pos: at + 1 };
  if (!room.canQueue) return { kind: "unavailable", reason: room.reason };
  return { kind: "ready" };
}

export type BackpackFilter = "all" | "ready" | "new" | "queued" | "here";

/** claimed within the last day */
export const NEW_FOR_MS = 24 * 60 * 60 * 1000;

export function isNewCopy(copy: OwnedCopy, now: number): boolean {
  return now - copy.claimedAt < NEW_FOR_MS;
}

/** the copies a filter + search show, in backpack order (newest first) */
export function visibleCopies(
  copies: OwnedCopy[],
  filter: BackpackFilter,
  query: string,
  room: RoomView,
  now: number,
  /** track keys found in the room you're standing in */
  here: ReadonlySet<string> = new Set()
): OwnedCopy[] {
  const q = query.trim().toLowerCase();
  return copies.filter((c) => {
    if (q && !`${c.title} ${c.artist}`.toLowerCase().includes(q)) return false;
    const s = copyState(c, room).kind;
    if (filter === "ready") return s === "ready";
    if (filter === "queued") return s === "queued" || s === "playing";
    if (filter === "new") return isNewCopy(c, now);
    if (filter === "here") return here.has(c.trackKey);
    return true;
  });
}

/** where a track was found: the first crate it's filed in (ingest crates last) */
export function sourceCrate(trackKey: string, shelves: Shelf[]): Shelf | null {
  let fallback: Shelf | null = null;
  for (const s of shelves) {
    if (!s.records.some((t) => t.trackKey === trackKey)) continue;
    if (!s.ingest) return s;
    fallback ??= s;
  }
  return fallback;
}

/** a copy as a playable track (for a private preview) */
export function copyTrack(copy: OwnedCopy, shelves: Shelf[]): Track {
  for (const s of shelves) {
    const hit = s.records.find((t) => t.trackKey === copy.trackKey);
    if (hit) return hit;
  }
  return { title: copy.title, artist: copy.artist, ytId: copy.ytId, scUrl: copy.scUrl, trackKey: copy.trackKey };
}
