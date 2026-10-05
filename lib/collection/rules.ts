// COLLECTIBLES — the rules in one place (like flow.ts for the queue). Safe to
// import anywhere: no server code, no secrets.
//
// A track in the catalog is not a collectible. Every track has exactly three
// numbered copies across the whole game (minted in Postgres; see
// supabase/migrations/20261004_copies.sql). Claiming a copy moves it from its
// crate to your backpack. Only a copy you hold can go on the room's queue;
// Sombra Radio plays the catalog regardless of who holds what.

/** copies every track has, game-wide */
export const COPIES_PER_TRACK = 3;
/** how many copies a player can hold before storage upgrades exist */
export const STARTER_CAPACITY = 8;

/** what the server says to a claim (hallu_claim_copy) */
export type ClaimResult = "ok" | "gone" | "owned" | "full" | "no_member" | "closed";

/** a copy still sitting in a crate */
export interface CrateCopy {
  id: string;
  serial: number;
}
/** track key → the copies of it still in crates */
export type Availability = Record<string, CrateCopy[]>;

/** a copy in your backpack */
export interface OwnedCopy {
  id: string;
  serial: number;
  trackKey: string;
  title: string;
  artist: string;
  ytId?: string;
  scUrl?: string;
  claimedAt: number;
}
