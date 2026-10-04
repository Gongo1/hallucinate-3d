import { beforeAll, describe, expect, it } from "vitest";
import { newTicketKeys, resetTicketKeyCache, signTicket } from "@/lib/collection/sign";
import { NonceLedger, TICKET_TTL_MS, admitAdmin, admitCue, b64urlDecode, b64urlEncode, verifyTicket } from "@/lib/collection/ticket";

const track = { title: "Plain", artist: "C", ytId: "plainYT", trackKey: "yt:plainYT" };
let pub: string;
let otherPub: string;

beforeAll(() => {
  const k = newTicketKeys();
  process.env.TICKET_SIGNING_KEY = k.TICKET_SIGNING_KEY;
  resetTicketKeyCache();
  pub = k.NEXT_PUBLIC_TICKET_PUBLIC_KEY;
  otherPub = newTicketKeys().NEXT_PUBLIC_TICKET_PUBLIC_KEY;
});

const cue = (by = "me", now = Date.now()) => signTicket({ k: "cue", copy: "c1", by, track }, now)!;

describe("cue tickets (what the host accepts onto the queue)", () => {
  it("accepts a server-signed ticket for the listener it was issued to, and plays the signed track", async () => {
    expect(await admitCue(cue("me"), "me", new NonceLedger(), pub)).toEqual(track);
  });

  it("rejects a cue with no ticket (every old crate / Dex / Added-board route)", async () => {
    expect(await admitCue(undefined, "me", new NonceLedger(), pub)).toBeNull();
    expect(await admitCue("", "me", new NonceLedger(), pub)).toBeNull();
  });

  it("rejects a forged ticket: a body the server never signed", async () => {
    const [, sig] = cue().split(".");
    const forged = b64urlEncode(new TextEncoder().encode(JSON.stringify({ k: "cue", copy: "c9", by: "me", track: { ...track, ytId: "anything" }, exp: Date.now() + 1e5, n: "x" })));
    expect(await admitCue(`${forged}.${sig}`, "me", new NonceLedger(), pub)).toBeNull();
  });

  it("rejects a ticket signed by a different key", async () => {
    expect(await admitCue(cue(), "me", new NonceLedger(), otherPub)).toBeNull();
  });

  it("rejects a tampered track (signature no longer matches)", async () => {
    const [body, sig] = cue().split(".");
    const t = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    t.track.ytId = "someoneElsesTrack";
    const tampered = b64urlEncode(new TextEncoder().encode(JSON.stringify(t)));
    expect(await admitCue(`${tampered}.${sig}`, "me", new NonceLedger(), pub)).toBeNull();
  });

  it("rejects an expired ticket", async () => {
    const old = cue("me", Date.now() - TICKET_TTL_MS - 1000);
    expect(await admitCue(old, "me", new NonceLedger(), pub)).toBeNull();
  });

  it("rejects a replay of a spent ticket", async () => {
    const ledger = new NonceLedger();
    const t = cue();
    expect(await admitCue(t, "me", ledger, pub)).not.toBeNull();
    expect(await admitCue(t, "me", ledger, pub)).toBeNull();
  });

  it("rejects someone else's ticket (issued to another listener)", async () => {
    expect(await admitCue(cue("them"), "me", new NonceLedger(), pub)).toBeNull();
  });

  it("fails closed with no public key configured", async () => {
    expect(await admitCue(cue(), "me", new NonceLedger(), undefined)).toBeNull();
  });

  it("a non-cue ticket can't be used as a cue", async () => {
    const admin = signTicket({ k: "admin", cmd: { kind: "forceSkip" } })!;
    expect(await admitCue(admin, "me", new NonceLedger(), pub)).toBeNull();
  });
});

describe("admin tickets (god mode)", () => {
  it("accepts a server-signed command once", async () => {
    const ledger = new NonceLedger();
    const t = signTicket({ k: "admin", cmd: { kind: "lockCue", locked: true } })!;
    expect(await admitAdmin(t, ledger, pub)).toEqual({ kind: "lockCue", locked: true });
    expect(await admitAdmin(t, ledger, pub)).toBeNull();
  });

  it("rejects an unsigned admin event (what anyone could broadcast before)", async () => {
    expect(await admitAdmin(undefined, new NonceLedger(), pub)).toBeNull();
    expect(await verifyTicket(JSON.stringify({ kind: "forcePlay" }), pub)).toBeNull();
  });

  it("a cue ticket can't be used as an admin command", async () => {
    expect(await admitAdmin(cue(), new NonceLedger(), pub)).toBeNull();
  });
});

describe("signing", () => {
  it("refuses to sign without a key", () => {
    const saved = process.env.TICKET_SIGNING_KEY;
    delete process.env.TICKET_SIGNING_KEY;
    resetTicketKeyCache();
    expect(signTicket({ k: "copy", copy: "c1", track: "yt:x" })).toBeNull();
    process.env.TICKET_SIGNING_KEY = saved;
    resetTicketKeyCache();
  });
});
