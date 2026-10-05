import { beforeAll, describe, expect, it, vi } from "vitest";
import type { BarPresence as BarPresenceT, RoomState } from "@/lib/bar/presence";
import type { Track } from "@/lib/bar/types";

// The real host code (BarPresence) deciding what reaches the room's queue. The
// old crate / Dex / Added-board routes all sent a bare cue intent; that must
// now do nothing, while a server-signed cue for a held copy plays the SIGNED
// track (never the one the client claims to be sending).

type Host = { room: RoomState | null; presentIds: string[]; onIntent: (i: unknown) => void; onAdmin: (p: Record<string, unknown>) => Promise<void> };

let BarPresence: typeof BarPresenceT;
let sign: typeof import("@/lib/collection/sign").signTicket;

beforeAll(async () => {
  const { newTicketKeys } = await import("@/lib/collection/sign");
  const k = newTicketKeys();
  process.env.TICKET_SIGNING_KEY = k.TICKET_SIGNING_KEY;
  process.env.NEXT_PUBLIC_TICKET_PUBLIC_KEY = k.NEXT_PUBLIC_TICKET_PUBLIC_KEY;
  vi.resetModules(); // re-read the public key at import
  ({ BarPresence } = await import("@/lib/bar/presence"));
  ({ signTicket: sign } = await import("@/lib/collection/sign"));
});

const nowTrack: Track = { title: "Radio pick", artist: "R", ytId: "radio", trackKey: "yt:radio" };
const owned = { title: "Mine", artist: "Me", ytId: "mineYT", trackKey: "yt:mineYT", id: "rec1", durationSeconds: 300 };

function host(): { p: BarPresenceT; h: Host } {
  const p = new BarPresence({
    getPose: () => ({ x: 0, y: 0, dir: 0 }),
    onChat: () => {},
    onReact: () => {},
    onRoster: () => {},
    onRoom: () => {},
    openRoom: () => null,
    nextAuto: () => null,
  });
  const h = p as unknown as Host;
  h.presentIds = [p.id];
  h.room = {
    now: nowTrack, nowCuedBy: null, startedAt: Date.now(), cue: [], seed: 1, index: 0, skipVotes: [],
    present: 1, cooldownUntil: 0, cueLocked: false, live: false, dj: null, liveStartedAt: null, rev: 1, host: p.id,
  } as RoomState;
  return { p, h };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

describe("the host's queue gate", () => {
  it("drops a bare cue (no ticket) — what every old crate / Dex / Added-board button sent", async () => {
    const { h } = host();
    h.onIntent({ kind: "cue", track: { title: "Unowned", artist: "X", ytId: "nope" }, by: "#fff", byId: "guest" });
    await settle();
    expect(h.room!.cue).toEqual([]);
  });

  it("queues a server-signed house-record cue (no copy) with no host change", async () => {
    const { h } = host();
    const house = { title: "Gongo set", artist: "Gongo", scUrl: "https://soundcloud.com/gongo-atx/set", trackKey: "sc:set" };
    const ticket = sign({ k: "cue", copy: "house", by: "guest", track: house })!;
    h.onIntent({ kind: "cue", track: house, ticket, by: "#fff", byId: "guest" });
    await settle();
    expect(h.room!.cue.map((c) => c.track.trackKey)).toEqual(["sc:set"]);
    // a house record without the server's ticket is still just a bare cue
    h.onIntent({ kind: "cue", track: { ...house, trackKey: "sc:other" }, by: "#fff", byId: "guest" });
    await settle();
    expect(h.room!.cue).toHaveLength(1);
  });

  it("queues a server-signed cue, playing the signed track", async () => {
    const { h } = host();
    const ticket = sign({ k: "cue", copy: "c1", by: "guest", track: owned })!;
    // the client claims it's sending something else: ignored
    h.onIntent({ kind: "cue", track: { title: "Swapped", artist: "X", ytId: "swap" }, ticket, by: "#fff", byId: "guest" });
    await settle();
    expect(h.room!.cue).toHaveLength(1);
    expect(h.room!.cue[0].track).toMatchObject({ ytId: "mineYT", title: "Mine", trackKey: "yt:mineYT" });
  });

  it("won't let a ticket be replayed", async () => {
    const { h } = host();
    const ticket = sign({ k: "cue", copy: "c1", by: "guest", track: owned })!;
    h.onIntent({ kind: "cue", track: owned, ticket, by: "#fff", byId: "guest" });
    await settle();
    h.onIntent({ kind: "cue", track: owned, ticket, by: "#fff", byId: "guest" });
    await settle();
    expect(h.room!.cue).toHaveLength(1);
  });

  it("ignores an unsigned god-mode command, obeys a signed one", async () => {
    const { h } = host();
    await h.onAdmin({ kind: "lockCue", locked: true });
    expect(h.room!.cueLocked).toBe(false);
    await h.onAdmin({ token: sign({ k: "admin", cmd: { kind: "lockCue", locked: true } }) });
    expect(h.room!.cueLocked).toBe(true);
  });
});
