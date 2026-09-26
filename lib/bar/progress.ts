// YOUR DIG — the player's progress, kept on this device (localStorage), like a
// save file: realms stamped, records seen / dug (your Crate Dex), secrets found,
// keepers met, badges earned. Pure client state — never shared, never touches
// the room's audio. Components subscribe for re-renders.

import type { Shelf, Track } from "./types";
import { REALMS } from "./realms";

/* ------------------------------------------------------------ rarity */

// A pressing's tier is a fixed, fun fiction rolled from the record itself — so
// a "test pressing" is a test pressing for everyone who digs it.
export type Tier = "reissue" | "first" | "white" | "test";
export const TIERS: Record<Tier, { name: string; short: string; color: string; odds: number; rank: number }> = {
  reissue: { name: "Reissue", short: "RE", color: "#cfc3a8", odds: 0.58, rank: 0 },
  first: { name: "First Press", short: "1ST", color: "#7ed6a0", odds: 0.27, rank: 1 },
  white: { name: "White Label", short: "WL", color: "#e9ecff", odds: 0.11, rank: 2 },
  test: { name: "Test Pressing", short: "TP", color: "#ffd76a", odds: 0.04, rank: 3 },
};

export function recordKey(t: Track): string {
  return t.id ?? t.ytId ?? t.scUrl ?? `${t.artist}—${t.title}`;
}

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export function tierOf(key: string): Tier {
  const r = hash01("press:" + key);
  if (r < TIERS.test.odds) return "test";
  if (r < TIERS.test.odds + TIERS.white.odds) return "white";
  if (r < TIERS.test.odds + TIERS.white.odds + TIERS.first.odds) return "first";
  return "reissue";
}

/* ------------------------------------------------------------ titles + badges */

export const TITLES: { at: number; name: string }[] = [
  { at: 0, name: "Newcomer" },
  { at: 5, name: "Crate Flipper" },
  { at: 15, name: "Digger" },
  { at: 30, name: "Selector" },
  { at: 60, name: "Head" },
  { at: 120, name: "Archivist" },
  { at: 250, name: "Legend" },
];
export function titleFor(dugCount: number): string {
  let t = TITLES[0].name;
  for (const x of TITLES) if (dugCount >= x.at) t = x.name;
  return t;
}

/** dig this many records from a realm's crates to earn its badge */
export const BADGE_AT = 5;

/* ------------------------------------------------------------ the save */

export interface DugEntry {
  at: number;
  room: string;
  shelf: string; // shelf label
  shelfId: string;
  color: string;
  tier: Tier;
  title: string;
  artist: string;
  ytId?: string;
  scUrl?: string;
  id?: string;
}

export interface Progress {
  visited: Record<string, number>;
  seen: Record<string, 1>;
  dug: Record<string, DugEntry>;
  secrets: Record<string, number>;
  talked: Record<string, number>;
  badges: Record<string, number>;
}

const KEY = "hallucinate-progress-v1";
const empty = (): Progress => ({ visited: {}, seen: {}, dug: {}, secrets: {}, talked: {}, badges: {} });

let state: Progress = empty();
let loaded = false;
const subs = new Set<() => void>();

function load() {
  if (loaded || typeof localStorage === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = { ...empty(), ...JSON.parse(raw) };
  } catch {
    state = empty();
  }
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
  // new object identity so React's useSyncExternalStore sees the change
  state = { ...state };
  subs.forEach((f) => f());
}

export function getProgress(): Progress {
  load();
  return state;
}
export function subscribeProgress(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

/* ------------------------------------------------------------ events */
// Each mark* returns what changed so the UI can celebrate (toasts, badges).

export function markVisited(room: string): { first: boolean } {
  load();
  if (state.visited[room]) return { first: false };
  state.visited = { ...state.visited, [room]: Date.now() };
  save();
  return { first: true };
}

export function markSeen(t: Track) {
  load();
  const k = recordKey(t);
  if (state.seen[k]) return;
  state.seen = { ...state.seen, [k]: 1 };
  save();
}

export function markDug(
  t: Track,
  shelf: Shelf,
  room: string,
  shelves: Shelf[]
): { key: string; entry: DugEntry; isNew: boolean; badge: string | null } {
  load();
  const key = recordKey(t);
  const prev = state.dug[key];
  const entry: DugEntry = prev ?? {
    at: Date.now(),
    room,
    shelf: shelf.label,
    shelfId: shelf.id,
    color: shelf.color,
    tier: tierOf(key),
    title: t.title,
    artist: t.artist,
    ytId: t.ytId,
    scUrl: t.scUrl,
    id: t.id,
  };
  let badge: string | null = null;
  if (!prev) {
    state.dug = { ...state.dug, [key]: entry };
    state.seen = { ...state.seen, [key]: 1 };
    // realm badge: dig BADGE_AT records (or all of them, if it's a small realm)
    const r = realmStats(room, shelves);
    if (!state.badges[room] && r.dug >= Math.min(BADGE_AT, r.total) && r.total > 0) {
      state.badges = { ...state.badges, [room]: Date.now() };
      badge = room;
    }
    save();
  }
  return { key, entry, isNew: !prev, badge };
}

export function markSecret(id: string): { first: boolean } {
  load();
  if (state.secrets[id]) return { first: false };
  state.secrets = { ...state.secrets, [id]: Date.now() };
  save();
  return { first: true };
}

export function markTalked(room: string) {
  load();
  if (state.talked[room]) return;
  state.talked = { ...state.talked, [room]: Date.now() };
  save();
}

/* ------------------------------------------------------------ stats */

/** records in a realm's crates (the ingest crate never counts) */
export function realmRecords(room: string, shelves: Shelf[]): { track: Track; shelf: Shelf }[] {
  const out: { track: Track; shelf: Shelf }[] = [];
  for (const s of shelves) {
    if (s.ingest || (s.room ?? "kissa") !== room) continue;
    for (const t of s.records) out.push({ track: t, shelf: s });
  }
  return out;
}

export function realmStats(room: string, shelves: Shelf[]): { total: number; dug: number; seen: number } {
  load();
  const recs = realmRecords(room, shelves);
  let dug = 0;
  let seen = 0;
  for (const { track } of recs) {
    const k = recordKey(track);
    if (state.dug[k]) dug++;
    if (state.seen[k]) seen++;
  }
  return { total: recs.length, dug, seen };
}

export function totals(shelves: Shelf[]) {
  load();
  let total = 0;
  for (const s of shelves) if (!s.ingest) total += s.records.length;
  const dug = Object.keys(state.dug).length;
  return {
    total,
    dug,
    realms: Object.keys(state.visited).filter((r) => REALMS[r]).length,
    realmsTotal: Object.keys(REALMS).length,
    secrets: Object.keys(state.secrets).length,
    badges: Object.keys(state.badges).length,
    title: titleFor(dug),
  };
}

/* ------------------------------------------------------------ digging */

/**
 * What a dig pile turns up: a record from THIS realm's crates, preferring ones
 * you haven't dug yet (then ones you haven't even seen). Returns null if the
 * realm has no records yet. Selection only — cueing is the caller's business
 * and still goes through presence + flow rules.
 */
export function pickDig(room: string, shelves: Shelf[]): { track: Track; shelf: Shelf } | null {
  load();
  const recs = realmRecords(room, shelves);
  if (!recs.length) return null;
  const fresh = recs.filter((r) => !state.dug[recordKey(r.track)]);
  const unseen = fresh.filter((r) => !state.seen[recordKey(r.track)]);
  const pool = unseen.length ? unseen : fresh.length ? fresh : recs;
  return pool[Math.floor(Math.random() * pool.length)];
}
