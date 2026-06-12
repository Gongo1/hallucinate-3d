// CURATOR ROOMS — the tribute-now / collab-later template.
//
// A curator room is a tribute to an artist/label: a themed room branching off an
// existing one, with a crate filled from THEIR playlist/channel and clear, honest
// attribution ("Music by X · find more ↗" → their link). It is NOT a partnership
// or endorsement — it's a tribute that sends them traffic.
//
// Adding a curator should be DATA + a curated ingest + original mascot art — not new
// sync/flow logic. Everything here is pure config the engine reads for a "curator"
// scene; the music still feeds the one shared queue exactly like any other crate,
// and the time-of-day clock re-tints the room like every other room.
//
// GUARDRAILS (do not soften):
//  • No partnership/endorsement language anywhere. Attribution only.
//  • Mascot art is an ORIGINAL homage — never a copy of the curator's logo/mascot.
//  • Get the curator's blessing before the room is public under their name.

export interface CuratorRoom {
  /** room id (matches a RoomDef in rooms.ts with scene "curator") */
  id: string;
  /** the room's own name in-world, e.g. "HouseMiam" */
  displayName: string;
  /** who is being honoured + where to send people */
  curator: { name: string; links: { youtube: string; store?: string } };
  /** the room's colour flavour (drives the cosmic scene renderer) */
  palette: CuratorPalette;
  /** scene flavour hint (cosmic, etc.) + the resident mascot (original art) */
  motif: string;
  mascot: "cat" | "none";
  /** where the crate is filled FROM — used by the god-mode playlist ingest, gated
   *  on owner approval. `url` is empty until the owner provides the playlist. */
  source: { kind: "playlist" | "channel"; url: string };
  /** the crate that lives in this room */
  crate: { slug: string; label: string; color: string; tags: string[]; energy: number };
  /** which existing room this one branches off (topology lives in rooms.ts) */
  placement: { branchOff: string };
  /** the honest attribution shown on the centerpiece — text + the link it opens */
  attribution: { text: string; url: string };
}

export interface CuratorPalette {
  skyTop: string;
  skyBottom: string;
  terrace: string;
  grid: string;
  aurora: [string, string, string];
  neon: string;
  neonAlt: string;
  gold: string;
  holo: [string, string, string];
}

// Houseum — a cosmic French-house lounge honouring Houseum (room id "housemiam").
// Deep indigo/violet,
// holographic shimmer, a starfield with slow aurora "blue-lava" bands, a Parisian-
// cosmic skyline, neon French signage, iridescent sleeves, a chill cosmic cat, and
// a gold "HOUSEUM" record as the focal point (and the attribution link).
const HOUSEMIAM: CuratorRoom = {
  id: "housemiam",
  displayName: "Houseum",
  curator: { name: "Houseum", links: { youtube: "https://www.youtube.com/@Houseum" } },
  palette: {
    skyTop: "#0c0628",
    skyBottom: "#241050",
    terrace: "#0e0a20",
    grid: "#6a44c8",
    aurora: ["#3a6ad6", "#7a3ad6", "#28d0c0"],
    neon: "#ff5ec6",
    neonAlt: "#5ee8ff",
    gold: "#ffd76a",
    holo: ["#ff8ad6", "#8affd6", "#8a9cff"],
  },
  motif: "cosmic",
  mascot: "cat",
  // The 77-track playlist URL is provided by the owner at ingest time (curation rule:
  // never auto-source). Left empty until then.
  source: { kind: "playlist", url: "" },
  crate: {
    slug: "houseum",
    label: "HOUSEUM · 宇宙",
    color: "#8a6cff",
    tags: ["french-house", "deep", "feel-good", "cosmic", "houseum"],
    energy: 3,
  },
  placement: { branchOff: "garden" },
  attribution: {
    text: "Houseum · find more on YouTube ↗",
    url: "https://www.youtube.com/@Houseum",
  },
};

export const CURATORS: Record<string, CuratorRoom> = {
  housemiam: HOUSEMIAM,
};
