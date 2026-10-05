"use server";

import { currentMemberId } from "@/lib/members/auth";
import { serverBroadcast } from "@/lib/booth/broadcast";
import { STARTER_CAPACITY, type Availability, type ClaimResult, type OwnedCopy } from "@/lib/collection/rules";
import { backpackOf, claim, copyTrackKey, cueTrackFor, houseCueTrack, isHouseTrack, loadAvailability } from "@/lib/collection/store";
import { signTicket } from "@/lib/collection/sign";
import type { TicketTrack } from "@/lib/collection/ticket";

// Collectible copies: claim one from a crate, see your backpack, and get a
// signed ticket to put a copy you hold on the room's queue. House records
// (lib/collection/rules.ts) can't be claimed; any member gets a ticket for one. Who you are comes
// only from the signed member cookie; the client never names a member.

/** the Realtime event a claim announces (crates drop the copy live) */
const COPY_EVENT = "copy";

export type Backpack = { cap: number; copies: OwnedCopy[] };

export async function myBackpack(): Promise<Backpack | null> {
  const me = await currentMemberId();
  if (!me) return null;
  const copies = await backpackOf(me);
  return copies ? { cap: STARTER_CAPACITY, copies } : null;
}

/** Fresh availability for the tracks in a crate you just opened. */
export async function crateCopies(trackKeys: string[]): Promise<Availability | null> {
  const keys = [...new Set(trackKeys.filter((k) => typeof k === "string" && k.length < 600))].slice(0, 500);
  if (!keys.length) return {};
  return loadAvailability(keys);
}

export async function claimCopy(copyId: string): Promise<{ result: ClaimResult; backpack?: Backpack }> {
  const me = await currentMemberId();
  if (!me || typeof copyId !== "string" || !/^[0-9a-f-]{36}$/.test(copyId)) return { result: "no_member" };
  const key = await copyTrackKey(copyId);
  if (key && (await isHouseTrack(key))) return { result: "house" };
  const { result, trackKey } = await claim(me, copyId, STARTER_CAPACITY);
  if (result === "ok" && trackKey) {
    const token = signTicket({ k: "copy", copy: copyId, track: trackKey });
    if (token) void serverBroadcast(COPY_EVENT, { token });
  }
  const backpack = result === "closed" ? undefined : ((await myBackpack()) ?? undefined);
  return { result, backpack };
}

/** A signed cue ticket for a copy you hold, issued to your presence id. */
export async function requestCue(
  copyId: string,
  presenceId: string
): Promise<{ ticket: string; track: TicketTrack } | { error: "not_yours" | "closed" }> {
  const me = await currentMemberId();
  if (!me || typeof copyId !== "string" || typeof presenceId !== "string" || presenceId.length > 64)
    return { error: "closed" };
  const track = await cueTrackFor(me, copyId);
  if (!track) return { error: "not_yours" };
  const ticket = signTicket({ k: "cue", copy: copyId, by: presenceId, track });
  return ticket ? { ticket, track } : { error: "closed" };
}

/** A signed cue ticket for a house record: no copy needed, only a member. */
export async function requestHouseCue(
  trackKey: string,
  presenceId: string
): Promise<{ ticket: string; track: TicketTrack } | { error: "not_house" | "closed" }> {
  const me = await currentMemberId();
  if (!me || typeof trackKey !== "string" || trackKey.length > 600 || typeof presenceId !== "string" || presenceId.length > 64)
    return { error: "closed" };
  const track = await houseCueTrack(trackKey);
  if (!track) return { error: "not_house" };
  const ticket = signTicket({ k: "cue", copy: "house", by: presenceId, track });
  return ticket ? { ticket, track } : { error: "closed" };
}
