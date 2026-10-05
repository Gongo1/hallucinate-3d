import { describe, expect, it } from "vitest";
import { mulberry32, weightedPick } from "@/lib/bar/radio";
import { claimableRecords } from "@/lib/collection/crate";
import type { Availability } from "@/lib/collection/rules";
import type { Shelf, Track } from "@/lib/bar/types";

const t = (k: string): Track => ({ title: k, artist: "A", ytId: k, trackKey: `yt:${k}` });
const shelf: Shelf = { id: "s1", label: "HOUSE", color: "#c0432f", room: "kissa", energy: 3, records: [t("a"), t("b")] };
// every copy of both tracks has been claimed
const soldOut: Availability = { "yt:a": [], "yt:b": [] };

describe("Sombra Radio vs collectible ownership", () => {
  it("a sold-out track leaves its crate but stays in the radio's pool", () => {
    expect(claimableRecords(shelf.records, soldOut)).toEqual([]);
    expect(shelf.records).toHaveLength(2); // the catalog itself is untouched
    const picks = new Set(Array.from({ length: 40 }, (_, i) => weightedPick([shelf], 3, mulberry32(i))?.title));
    expect(picks).toEqual(new Set(["a", "b"]));
  });
});
