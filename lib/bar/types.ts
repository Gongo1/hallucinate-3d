// Runtime shapes used by the canvas renderer and the player. These keep the
// prototype's field names (ytId / scUrl) so the ported renderer reads cleanly.
// The Supabase-facing names (yt_id / sc_url / source) live in the seed/DB layer
// and are mapped in seed.ts.

export type Source = "youtube" | "soundcloud";

export interface Track {
  title: string;
  artist: string;
  ytId?: string;
  scUrl?: string;
  /** DB record id — present for catalog tracks (needed for cue ownership / duration) */
  id?: string;
  /** known length in seconds, or null/undefined if unresolved (backstop covers it) */
  durationSeconds?: number | null;
}

export interface Shelf {
  id: string;
  label: string;
  color: string;
  records: Track[];
  /** the live "新着 NEW ARRIVALS" crate — opens the paste box instead of a flip view */
  ingest?: boolean;
  /** which venue room this crate lives in (scenery only — audio is one shared stream) */
  room?: string;
  /** the crate's intensity (1–5). The auto-radio leans toward crates whose energy
   *  is near the current phase's target (see lib/bar/clock.ts). Required in the DB;
   *  defaults to 3 if a row predates the column. */
  energy: number;
}

/**
 * Another live listener in the bar (Supabase Realtime presence). The network
 * owns `tx/ty/dir` (the last broadcast target); the engine owns `x/y/bob`,
 * which it lerps toward the target each frame so movement stays smooth between
 * the ~10Hz position broadcasts. Anonymous — colour/hair are the only identity.
 */
export interface RemotePlayer {
  id: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: number;
  bob: number;
  color: string;
  hair: string;
  /** which venue room this listener is currently in (for per-room avatar render) */
  room: string;
}
