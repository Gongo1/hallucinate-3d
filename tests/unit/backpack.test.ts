import { describe, expect, it } from "vitest";
import { copyState, copyTrack, sourceCrate, visibleCopies, NEW_FOR_MS, type RoomView } from "@/lib/collection/backpack";
import { claimButton, claimableRecords, copiesLeft, houseKeys } from "@/lib/collection/crate";
import { STARTER_CAPACITY, isHouseCrate, type Availability, type OwnedCopy } from "@/lib/collection/rules";
import type { Shelf, Track } from "@/lib/bar/types";

const NOW = 1_800_000_000_000;
const t = (k: string): Track => ({ title: k, artist: "A", ytId: k, trackKey: `yt:${k}` });
const own = (k: string, ageMs = 0): OwnedCopy => ({
  id: `c-${k}`,
  serial: 2,
  trackKey: `yt:${k}`,
  title: k,
  artist: "A",
  ytId: k,
  claimedAt: NOW - ageMs,
});
const shelf = (slug: string, keys: string[], extra: Partial<Shelf> = {}): Shelf => ({
  id: slug,
  slug,
  label: slug.toUpperCase(),
  color: "#000",
  records: keys.map(t),
  energy: 3,
  ...extra,
});
const room = (over: Partial<RoomView> = {}): RoomView => ({ nowKey: null, cueKeys: [], canQueue: true, reason: "Wait 40s", ...over });

describe("backpack row states", () => {
  it("ready, queued (with its place in line), playing, unavailable", () => {
    expect(copyState(own("a"), room())).toEqual({ kind: "ready" });
    expect(copyState(own("a"), room({ cueKeys: ["yt:x", "yt:a"] }))).toEqual({ kind: "queued", pos: 2 });
    expect(copyState(own("a"), room({ nowKey: "yt:a" }))).toEqual({ kind: "playing" });
    expect(copyState(own("a"), room({ canQueue: false }))).toEqual({ kind: "unavailable", reason: "Wait 40s" });
  });

  it("playing / queued win over a cue wait (the row says where it is, not why you can't add it)", () => {
    expect(copyState(own("a"), room({ canQueue: false, nowKey: "yt:a" })).kind).toBe("playing");
    expect(copyState(own("a"), room({ canQueue: false, cueKeys: ["yt:a"] })).kind).toBe("queued");
  });
});

describe("backpack filters + search", () => {
  const copies = [own("fresh"), own("old", NEW_FOR_MS + 1), own("cued", NEW_FOR_MS * 3)];
  const r = room({ cueKeys: ["yt:cued"] });
  const titles = (cs: OwnedCopy[]) => cs.map((c) => c.title);

  it("All keeps backpack order; Ready drops what's queued; Queued is the rest", () => {
    expect(titles(visibleCopies(copies, "all", "", r, NOW))).toEqual(["fresh", "old", "cued"]);
    expect(titles(visibleCopies(copies, "ready", "", r, NOW))).toEqual(["fresh", "old"]);
    expect(titles(visibleCopies(copies, "queued", "", r, NOW))).toEqual(["cued"]);
  });

  it("New = claimed within a day; Found here = filed in this room", () => {
    expect(titles(visibleCopies(copies, "new", "", r, NOW))).toEqual(["fresh"]);
    expect(titles(visibleCopies(copies, "here", "", r, NOW, new Set(["yt:old"])))).toEqual(["old"]);
  });

  it("search matches title or artist, any case", () => {
    expect(titles(visibleCopies(copies, "all", "OL", r, NOW))).toEqual(["old"]);
    expect(visibleCopies(copies, "all", "a", r, NOW)).toHaveLength(3); // artist "A"
    expect(visibleCopies(copies, "all", "zzz", r, NOW)).toHaveLength(0);
  });

  it("only owned copies are ever listed (filters never add a track)", () => {
    for (const f of ["all", "ready", "new", "queued", "here"] as const)
      for (const c of visibleCopies(copies, f, "", room({ cueKeys: ["yt:unowned"] }), NOW, new Set(["yt:unowned"])))
        expect(copies).toContain(c);
  });
});

describe("where a copy came from", () => {
  const shelves = [shelf("new-arrivals", ["a"], { ingest: true }), shelf("garden", ["a", "b"], { room: "garden" })];
  it("prefers a real crate over the ingest crate", () => {
    expect(sourceCrate("yt:a", shelves)?.slug).toBe("garden");
    expect(sourceCrate("yt:zz", shelves)).toBeNull();
  });
  it("previews the catalog track when there is one, else the copy's own media", () => {
    expect(copyTrack(own("b"), shelves)).toBe(shelves[1].records[1]);
    expect(copyTrack(own("gone"), shelves)).toMatchObject({ title: "gone", ytId: "gone", trackKey: "yt:gone" });
  });
});

describe("house records (Gongo crate + Sombra Selection)", () => {
  const shelves = [shelf("gongo", ["set1"]), shelf("sombra-selection", ["sel"]), shelf("this-week", ["wk", "sel"])];
  const house = houseKeys(shelves);
  const avail: Availability = {
    "yt:set1": [{ id: "s1", serial: 1 }],
    "yt:sel": [],
    "yt:wk": [{ id: "w1", serial: 1 }],
  };
  const pack = { cap: STARTER_CAPACITY, copies: [] as OwnedCopy[] };

  it("only the Gongo crate and the Selection are house crates (This Week is not)", () => {
    expect(isHouseCrate("gongo")).toBe(true);
    expect(isHouseCrate("sombra-selection")).toBe(true);
    expect(isHouseCrate("this-week")).toBe(false);
    expect(isHouseCrate(undefined)).toBe(false);
    expect([...house].sort()).toEqual(["yt:sel", "yt:set1"]);
  });

  it("never offer a claim, even where the track is also filed in another crate", () => {
    expect(claimButton(t("set1"), avail, pack, house)).toBeNull();
    expect(claimButton(t("sel"), avail, pack, house)).toBeNull(); // also in This Week
    expect(claimButton(t("wk"), avail, pack, house)?.disabled).toBe(false);
  });

  it("show no copy count and are never hidden as sold out", () => {
    expect(copiesLeft(t("sel"), avail, house)).toBeNull();
    expect(claimableRecords([t("sel"), t("wk")], avail, house).map((x) => x.title)).toEqual(["sel", "wk"]);
    expect(claimableRecords([t("sel")], avail).map((x) => x.title)).toEqual([]); // without the rule it would vanish
  });
});
