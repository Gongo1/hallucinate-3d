// MISSIONS — the story layer. A mission is a short run of steps a keeper hands
// you; finishing one pays out a gift and grows your crate. The first one is the
// orientation: until it's handed in, the Listening Room's doors stay shut so a
// newcomer learns the loop (dig → save → put it on → report back) before they
// wander off. Pure client state, kept in your save (progress.ts).

import { getProgress, isPreMissionsSave, setQuest, setSlotFloor, type Progress } from "./progress";
import { ROOMS, HUB_ROOM } from "./rooms";
import { SECRETS } from "./realms";

export interface Quest {
  id: string;
  name: string;
  /** the realm whose keeper gives it and takes it back */
  giver: string;
  /** what the tracker says for each step; the last step is always "go back" */
  steps: string[];
  /** gift id paid out on hand-in (lib/bar/gifts.ts) */
  reward: string;
}

export const FIRST_RECORD: Quest = {
  id: "first-record",
  name: "Your First Record",
  giver: "kissa",
  steps: [
    "Save a record from any crate (✦)",
    "Put it on the deck, down by the speakers",
    "Head back to Rio",
  ],
  reward: "sombra-tee",
};

export const QUESTS: Quest[] = [FIRST_RECORD];
export const QUEST_BY_ID: Record<string, Quest> = Object.fromEntries(QUESTS.map((q) => [q.id, q]));

/* ------------------------------------------------------------ state */

export type QuestPhase = "offer" | "active" | "ready" | "done";

/** Where you are with a mission. `step` is only meaningful while active. */
export function questPhase(id: string, p: Progress = getProgress()): { phase: QuestPhase; step: number } {
  const q = QUEST_BY_ID[id];
  const s = p.quests?.[id];
  if (!q || !s) return { phase: "offer", step: -1 };
  if (s.done) return { phase: "done", step: q.steps.length };
  // the last step is "go back to the keeper": reaching it means ready to hand in
  if (s.step >= q.steps.length - 1) return { phase: "ready", step: s.step };
  return { phase: "active", step: s.step };
}

export function startQuest(id: string) {
  if (questPhase(id).phase !== "offer") return;
  setQuest(id, { step: 0, at: Date.now() });
}

/** Move a mission forward, but only from the step named (so events out of order
 *  — a cue before the save — never skip ahead). Returns true if it moved. */
export function advanceQuest(id: string, from: number): boolean {
  const s = getProgress().quests?.[id];
  if (!s || s.done || s.step !== from) return false;
  setQuest(id, { ...s, step: from + 1, at: Date.now() });
  return true;
}

export function completeQuest(id: string): boolean {
  if (questPhase(id).phase !== "ready") return false;
  const s = getProgress().quests[id];
  setQuest(id, { ...s, done: Date.now() });
  return true;
}

/** The orientation gates the doors (and the map's travel, the dice, the cat). */
export function doorsLocked(p: Progress = getProgress()): boolean {
  return questPhase(FIRST_RECORD.id, p).phase !== "done";
}

/** The mission on the HUD tracker: the first one not yet handed in. */
export function currentQuest(p: Progress = getProgress()): { quest: Quest; phase: QuestPhase; step: number } | null {
  for (const q of QUESTS) {
    const { phase, step } = questPhase(q.id, p);
    if (phase !== "done") return { quest: q, phase, step };
  }
  return null;
}

/**
 * Saves from before missions existed already know the room (they've dug, been
 * through a door, or hold Rio's tee): count the orientation as done so nobody
 * gets locked in, and let them keep every record they already hold. Only a
 * save written before missions counts: a newcomer who saves a record before
 * finding Rio still gets the orientation. Runs once; the floor it sets is the
 * only way past the slot cap besides missions (a merge never raises it).
 */
export function grandfatherQuests() {
  const p = getProgress();
  if (!isPreMissionsSave() || p.quests?.[FIRST_RECORD.id]) return;
  const dug = Object.keys(p.dug).length;
  const veteran = dug > 0 || Object.keys(p.visited).some((r) => r !== HUB_ROOM) || !!p.gifts["sombra-tee"];
  if (!veteran) return;
  setQuest(FIRST_RECORD.id, { step: FIRST_RECORD.steps.length - 1, at: Date.now(), done: Date.now() });
  if (dug > slotsFor(getProgress())) setSlotFloor(dug);
}

/* ------------------------------------------------------------ crate slots */

/** your crate starts small and grows with every mission handed in */
export const SLOTS_BASE = 10;
export const SLOTS_PER_QUEST = 5;

function slotsFor(p: Progress): number {
  const done = QUESTS.filter((q) => p.quests?.[q.id]?.done).length;
  return SLOTS_BASE + done * SLOTS_PER_QUEST;
}

export function slotCap(p: Progress = getProgress()): number {
  return Math.max(slotsFor(p), p.slotFloor ?? 0);
}

export function slotsFree(p: Progress = getProgress()): number {
  return slotCap(p) - Object.keys(p.dug).length;
}

/* ------------------------------------------------------------ depth */

/** How many rooms from the Listening Room (doors, then secret hatches for the
 *  door-less rooms). Deeper realms are where the rarer records live. */
export const DEPTH: Record<string, number> = (() => {
  const d: Record<string, number> = { [HUB_ROOM]: 0 };
  const queue = [HUB_ROOM];
  const links = (id: string) => [
    ...ROOMS[id].doors.map((x) => x.to),
    ...SECRETS.flatMap((s) => (s.a.room === id ? [s.b.room] : s.b.room === id ? [s.a.room] : [])),
  ];
  while (queue.length) {
    const id = queue.shift()!;
    for (const to of links(id)) {
      if (d[to] !== undefined || !ROOMS[to]) continue;
      d[to] = d[id] + 1;
      queue.push(to);
    }
  }
  return d;
})();

/* ------------------------------------------------------------ Rio */

/** What Rio says, by where you are with the orientation. */
export function rioLines(phase: QuestPhase, step: number, cap: number): string[] {
  if (phase === "offer")
    return [
      "Hey — welcome to the Sombra Listening Room. I'm Rio, I scout records for the room.",
      "Before you go wandering, a first job. Every digger starts the same way: with one record.",
      "Walk up to any crate in here and flip through. Each record plays 30 seconds, just for you. When one stops you, hit ✦ Save to my crate.",
      "Then take it to the deck, down by the big speakers, and give it a practice spin. Come find me after.",
      "The doors stay shut till then. House rules.",
    ];
  if (phase === "active" && step <= 0)
    return ["No record yet? Walk up to any crate, flip through, and ✦ save the one that stops you."];
  if (phase === "active")
    return ["Nice pull. Now take it to the deck, down by the speakers, and give it a practice spin."];
  if (phase === "ready")
    return [
      "Saw you at the deck. Good taste. That's your first one.",
      "Here, you've earned this. The ☉☽ on the chest is how we know our own.",
      "Now, how this place works. The doors are open. Every room is its own realm, with its own crates and its own keeper.",
      "The deeper you go, the better the records. Past the garden, under the archive… the good stuff is never by the front door.",
      `Your crate holds ${cap} records for now. Every mission you finish, it holds more. And soon you'll be able to trade with other diggers, so dig with intent.`,
      "One more thing. Every track has only three copies in the whole bar. Hit ◆ Claim copy and it's yours, in your backpack. Only a copy you hold goes on the deck for the room.",
      "Press M for the map, C for your crate, B for your backpack. Go find something.",
    ];
  return [];
}
