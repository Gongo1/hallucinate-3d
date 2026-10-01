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
  /** every record you've ever kept, even ones since let go from your crate:
   *  titles + realm badges count this, so freeing a slot never costs you */
  kept: Record<string, 1>;
  secrets: Record<string, number>;
  talked: Record<string, number>;
  badges: Record<string, number>;
  /** gifts you've been given (lib/bar/gifts.ts) → when */
  gifts: Record<string, number>;
  /** missions (lib/bar/quests.ts) → how far along */
  quests: Record<string, QuestState>;
  /** crate slots a pre-slots save keeps (it already held this many records) */
  slotFloor: number;
}

export interface QuestState {
  /** the step you're on (steps.length = ready to hand in) */
  step: number;
  at: number;
  /** when it was handed in */
  done?: number;
}

const KEY = "hallucinate-progress-v1";
export const emptyProgress = (): Progress => ({
  visited: {},
  seen: {},
  dug: {},
  kept: {},
  secrets: {},
  talked: {},
  badges: {},
  gifts: {},
  quests: {},
  slotFloor: 0,
});
const empty = emptyProgress;

let state: Progress = empty();
let loaded = false;
const subs = new Set<() => void>();

function load() {
  if (loaded || typeof localStorage === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = { ...empty(), ...JSON.parse(raw) };
    // saves from before `kept` existed: everything in the crate was kept
    for (const k of Object.keys(state.dug)) if (!state.kept[k]) state.kept = { ...state.kept, [k]: 1 };
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
    state.kept = { ...state.kept, [key]: 1 };
    state.seen = { ...state.seen, [key]: 1 };
    // realm badge: keep BADGE_AT records (or all of them, if it's a small realm)
    const r = realmStats(room, shelves);
    if (!state.badges[room] && r.kept >= Math.min(BADGE_AT, r.total) && r.total > 0) {
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

/** Record a gift as yours. Returns false if you already had it. */
export function markGift(id: string): boolean {
  load();
  if (state.gifts[id]) return false;
  state.gifts = { ...state.gifts, [id]: Date.now() };
  save();
  return true;
}
/** Let a record go from your crate (frees a slot). Badges already earned stay. */
export function releaseDug(key: string): boolean {
  load();
  if (!state.dug[key]) return false;
  const dug = { ...state.dug };
  delete dug[key];
  state.dug = dug;
  save();
  return true;
}

/** Write a mission's state (lib/bar/quests.ts owns the rules). */
export function setQuest(id: string, q: QuestState) {
  load();
  state.quests = { ...state.quests, [id]: q };
  save();
}
export function setSlotFloor(n: number) {
  load();
  if (n <= state.slotFloor) return;
  state.slotFloor = n;
  save();
}

/**
 * Two saves of the same player (this device + the profile's copy) folded into
 * one: everything found on either is kept, earliest timestamp wins, and a
 * mission keeps whichever side got further.
 */
export function mergeProgress(a: Progress, raw: unknown): Progress {
  if (!raw || typeof raw !== "object") return a;
  const b = { ...emptyProgress(), ...(raw as Partial<Progress>) };
  const firstOf = <T extends number>(x: Record<string, T>, y: Record<string, T>) => {
    const out = { ...y, ...x };
    for (const k of Object.keys(y)) if (x[k] !== undefined) out[k] = Math.min(x[k], y[k]) as T;
    return out;
  };
  const quests = { ...b.quests, ...a.quests };
  for (const k of Object.keys(b.quests)) {
    const x = a.quests[k];
    const y = b.quests[k];
    if (x && y) quests[k] = y.done && !x.done ? y : x.done && !y.done ? x : y.step > x.step ? y : x;
  }
  return {
    visited: firstOf(a.visited, b.visited),
    seen: { ...b.seen, ...a.seen },
    dug: { ...b.dug, ...a.dug },
    kept: { ...b.kept, ...a.kept, ...Object.fromEntries(Object.keys({ ...a.dug, ...b.dug }).map((k) => [k, 1 as const])) },
    secrets: firstOf(a.secrets, b.secrets),
    talked: firstOf(a.talked, b.talked),
    badges: firstOf(a.badges, b.badges),
    gifts: firstOf(a.gifts, b.gifts),
    quests,
    slotFloor: Math.max(a.slotFloor ?? 0, b.slotFloor ?? 0),
  };
}

/** Swap in a whole save (a profile restored from the server, already merged). */
export function replaceProgress(p: Progress) {
  load();
  state = { ...empty(), ...p };
  save();
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

export function realmStats(room: string, shelves: Shelf[]): { total: number; dug: number; kept: number; seen: number } {
  load();
  const recs = realmRecords(room, shelves);
  let dug = 0;
  let kept = 0;
  let seen = 0;
  for (const { track } of recs) {
    const k = recordKey(track);
    if (state.dug[k]) dug++;
    if (state.kept[k]) kept++;
    if (state.seen[k]) seen++;
  }
  return { total: recs.length, dug, kept, seen };
}

/** how many records you've ever kept (titles count this, not your crate) */
export function keptCount(p: Progress = state): number {
  return Object.keys(p.kept ?? {}).length;
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
    title: titleFor(keptCount()),
  };
}

