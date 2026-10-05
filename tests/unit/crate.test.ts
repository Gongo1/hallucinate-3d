import { describe, expect, it } from "vitest";
import { claimButton, claimableRecords, copiesLeft, dropCopy, mergeAvailability } from "@/lib/collection/crate";
import { STARTER_CAPACITY, type Availability, type OwnedCopy } from "@/lib/collection/rules";
import type { Track } from "@/lib/bar/types";

const t = (k: string): Track => ({ title: k, artist: "A", ytId: k, trackKey: `yt:${k}` });
const owned = (k: string, i = 0): OwnedCopy => ({ id: `o${i}`, serial: 1, trackKey: `yt:${k}`, title: k, artist: "A", claimedAt: 0 });
const avail: Availability = {
  "yt:a": [{ id: "a1", serial: 1 }, { id: "a2", serial: 2 }, { id: "a3", serial: 3 }],
  "yt:b": [{ id: "b3", serial: 3 }],
  "yt:c": [],
};
const pack = (copies: OwnedCopy[] = []) => ({ cap: STARTER_CAPACITY, copies });

describe("crate contents", () => {
  it("hides a track once every copy is claimed; unknown availability hides nothing", () => {
    expect(claimableRecords([t("a"), t("b"), t("c")], avail).map((x) => x.title)).toEqual(["a", "b"]);
    expect(claimableRecords([t("a"), t("c")], null)).toHaveLength(2);
  });

  it("a claim broadcast drops exactly that copy, live", () => {
    const next = dropCopy(avail, "b3", "yt:b")!;
    expect(next["yt:b"]).toEqual([]);
    expect(claimableRecords([t("a"), t("b")], next).map((x) => x.title)).toEqual(["a"]);
    expect(dropCopy(avail, "nope", "yt:a")).toBe(avail); // unknown copy: no change
  });

  it("refresh / reconnect: the server's snapshot replaces what we had (missed broadcasts heal)", () => {
    const stale = { ...avail }; // missed the claim of a1 while offline
    const fresh: Availability = { "yt:a": [{ id: "a2", serial: 2 }, { id: "a3", serial: 3 }] };
    const healed = mergeAvailability(stale, fresh)!;
    expect(healed["yt:a"].map((c) => c.id)).toEqual(["a2", "a3"]);
    expect(healed["yt:b"]).toEqual(avail["yt:b"]); // untouched tracks kept
    expect(copiesLeft(t("a"), healed)).toBe(2);
  });
});

describe("the ◆ claim button", () => {
  it("offers the lowest copy left while you have room", () => {
    expect(claimButton(t("b"), avail, pack())).toMatchObject({ disabled: false, copyId: "b3", label: "◆ Claim copy #3 of 3 · 0/8" });
  });

  it("is gone while collecting is closed", () => {
    expect(claimButton(t("a"), null, pack())).toBeNull();
  });

  it(`is disabled at capacity (${STARTER_CAPACITY})`, () => {
    const full = pack(Array.from({ length: STARTER_CAPACITY }, (_, i) => owned(`x${i}`, i)));
    expect(claimButton(t("a"), avail, full)).toMatchObject({ disabled: true, label: "◆ Backpack full · 8/8" });
  });

  it("is disabled for a track you already hold (one copy each)", () => {
    expect(claimButton(t("a"), avail, pack([owned("a")]))).toMatchObject({ disabled: true });
  });

  it("is disabled when no copy is left, and before you've knocked in", () => {
    expect(claimButton(t("c"), avail, pack())).toMatchObject({ disabled: true });
    expect(claimButton(t("a"), avail, null)).toMatchObject({ disabled: true });
  });
});
