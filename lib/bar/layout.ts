// FIXTURE LAYOUT — where everything sits in each room, in world px (the room is
// 1140×800, x → right, y → down/toward the camera). Shared by the engine (which
// turns these into collision solids + interaction zones) and the 3D renderer
// (which turns them into low-poly meshes). Moving a fixture here moves both, so
// the thing you see is always the thing you bump into.
//
// Pure data: no music / sync / flow symbols (same guardrail as rooms.ts).

export const ROOM = { x: 0, y: 0, w: 1140, h: 800 };
export const WALL = 28;

export interface XY {
  x: number;
  y: number;
}
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** a crate dig-spot: where a record-object sits + which side its browse zone is on */
export interface DigSpot {
  x: number;
  y: number;
  label: "left" | "right";
}

// ----- KISSA (the hub) -----
// Listening DECK: a booth across the BOTTOM of the room (user's call). The library
// is the left wall, the big sign + moon window own the top, the pour-over bar is
// the right wall — so the bottom is the open spot. Speakers flank it.
export const KISSA = {
  deck: { x: 400, y: 648, w: 290, h: 112 },
  speakers: [
    { x: 332, y: 658 },
    { x: 704, y: 658 },
  ],
  spkBox: { w: 58, h: 84 },
  bar: { x: ROOM.w - 156, y: 120, w: 116, h: 300 },
  platform: { x: 430, y: 300, w: 300, h: 230 },
  // the low chabudai at the centre of the tatami — solid, so you walk around it
  table: { x: 546, y: 393, w: 68, h: 44 },
  // The RAVE PORTAL — a torii doorway set into the lower-left wall. cx/cy is the
  // rift centre; the charge zone sits in front of it (right).
  portal: { cx: WALL + 36, cy: 600, w: 78, h: 132 },
  decor: [
    // bamboo moved right (was x80) to clear the rave portal doorway
    { t: "bamboo", x: 230, y: ROOM.h - 120 },
    { t: "maple", x: ROOM.w - 100, y: ROOM.h - 130 },
    { t: "stone", x: 170, y: ROOM.h - 110 },
  ] as { t: "bamboo" | "maple" | "stone"; x: number; y: number }[],
};
/** the weekly fresh-drop crate: new house records every Friday, owner-approved */
export const THIS_WEEK = "this-week";
/** The Listening Room's ONLY crates (Austin, 2026-09-29), front and centre under
 *  the big sign (by shelf slug): Gongo's sets, this week's drop, and the Sombra
 *  Selection. Owner-curated — see CURATED_CRATES. */
export const KISSA_FEATURED: Record<string, DigSpot> = {
  gongo: { x: 390, y: 190, label: "left" },
  [THIS_WEEK]: { x: 580, y: 190, label: "right" },
  "sombra-selection": { x: 770, y: 190, label: "right" },
};
/** The weekly board: a chalk whiteboard on the back wall, left of the big sign.
 *  x = its centre; y = where you stand to read it (the browse zone). */
export const KISSA_BOARD = { x: 205, w: 236, h: 124, readY: 118 };
/** crates only the owner (a /booth session) can add records to */
export const CURATED_CRATES: ReadonlySet<string> = new Set(["gongo", "sombra-selection", THIS_WEEK]);

/** the seated pair on the tatami + the kissa master behind the bar */
export const KISSA_SEATED: XY[] = [
  { x: KISSA.platform.x + 70, y: KISSA.platform.y + 150 },
  { x: KISSA.platform.x + 220, y: KISSA.platform.y + 90 },
];
// the master stands BEHIND the pour-over counter (between it and the back shelf)
export const KISSA_MASTER: XY = {
  x: KISSA.bar.x + 70,
  y: KISSA.bar.y + KISSA.bar.h / 2,
};

// ----- GARDEN (outdoor courtyard at dusk) -----
export const GARDEN = {
  koi: { x: 760, y: 470, r: 110 }, // koi pond (ellipse)
  gravel: { x: 250, y: 250, w: 300, h: 180 }, // karesansui raked gravel
  maple: { x: 940, y: 250 }, // red maple
  basin: { x: 430, y: 560 }, // tsukubai water basin (shishi-odoshi)
  lanterns: [
    { x: 150, y: 430 },
    { x: 980, y: 600 },
    { x: 560, y: 200 },
  ],
  bamboo: [
    { x: 90, y: 250 },
    { x: 90, y: 330 },
    { x: 120, y: 690 },
  ],
  cushions: [
    { x: 600, y: 640 },
    { x: 680, y: 660 },
  ],
};

// ----- OMAKASE (the selector's counter) -----
export const OMAKASE = {
  counter: { x: 250, y: 300, w: 640, h: 64 }, // long blonde-wood counter
  stools: [
    { x: 360, y: 478 }, { x: 470, y: 478 }, { x: 580, y: 478 }, { x: 690, y: 478 }, { x: 800, y: 478 },
  ],
};

// ----- BERLIN (Panorama-Bar room — breaks the Japanese palette) -----
export const BERLIN = {
  booth: { x: ROOM.w / 2 - 110, y: 150, w: 220, h: 74 }, // DJ booth, far wall
  pillars: [
    { x: 250, y: 300 }, { x: 890, y: 300 }, { x: 250, y: 600 }, { x: 890, y: 600 },
  ],
};

// ----- TEA ROOM (meditation / stillness) -----
export const TEA = {
  table: { x: ROOM.w / 2 - 70, y: 430, w: 140, h: 84 }, // low chabudai
  bowl: { x: 250, y: 300 }, // singing-bowl corner
  plants: [
    { x: 980, y: 250 }, { x: 980, y: 600 }, { x: 250, y: 620 },
  ],
};

// ----- CURATOR (Houseum cosmic terrace) -----
export const CURATOR = {
  railY: 320, // terrace edge: cosmos above, walkable terrace below
  record: { x: ROOM.w / 2, y: 462, r: 50 }, // the gold "HOUSEUM" centerpiece
  cat: { x: 690, y: 500 }, // the cosmic cat lounging beside it
};

// ----- LA PLAYA (dusk beach; sea along the BOTTOM of the room) -----
export const PLAYA = {
  shoreY: 620, // sand above, surf below (solid — you can't swim)
  fire: { x: 570, y: 460 }, // the fire pit everyone orbits
  palms: [
    { x: 180, y: 300 },
    { x: 950, y: 270 },
    { x: 290, y: 560 },
    { x: 900, y: 540 },
  ],
  torches: [
    { x: 460, y: 580 },
    { x: 690, y: 580 },
  ],
};

// ----- WAREHOUSE (Chicago — brick, steel, the speaker wall) -----
export const WAREHOUSE = {
  stage: { x: 380, y: 150, w: 380, h: 84 }, // speaker wall / stage, far wall
  pillars: [
    { x: 250, y: 330 },
    { x: 890, y: 330 },
    { x: 250, y: 620 },
    { x: 890, y: 620 },
  ],
  tr909: { x: 950, y: 560 }, // the TR-909 on a pedestal, like a relic
};

// ----- ROOFTOP (melodic deep over the skyline) -----
export const ROOFTOP = {
  railY: 300, // parapet: city sky above, terrace below
  planters: [
    { x: 250, y: 420 },
    { x: 890, y: 480 },
    { x: 480, y: 620 },
  ],
  cart: { x: 820, y: 380 }, // little terrace bar cart
};

// ----- TRATTORIA (Il Mattarello) -----
export const TRATTORIA = {
  oven: { x: 920, y: 150, w: 130, h: 100 }, // wood-fired oven, top right
  table: { x: 430, y: 400, w: 280, h: 74 }, // one long communal table
  easel: { x: 850, y: 520 }, // the framed piece = the attribution link
  flour: [
    { x: 180, y: 560 },
    { x: 238, y: 584 },
  ], // flour sacks by the pasta station
};

// ----- ARCHIVE (the deep-history vault) -----
export const ARCHIVE = {
  stacks: [
    { x: 200, y: 180, w: 600, h: 44 },
    { x: 200, y: 320, w: 600, h: 44 },
  ], // long record stacks (aisles between)
  table: { x: 420, y: 520, w: 300, h: 64 }, // reading table, banker's lamps
  catalog: { x: 950, y: 600 }, // the card catalogue
};

// ----- LABYRINTH -----
// THE MAZE. 12×8 cells over the room interior; '#' becomes a solid hedge block.
// Generated by recursive backtracking (perfect maze → every cell reachable) with a
// few braided loops, then the three door-zone cells opened. Spawns sit at
// OPEN-CELL CENTRES (rooms.ts) so a centred r13 player never clips a hedge.
// Verified by flood-fill: all 3 doors + the centre crate are one region.
// If you edit this, re-run the spawn-clearance + connectivity check.
export const LAB_GRID = [
  "...#.......#",
  "##.#.#####.#",
  ".#.........#",
  ".#####.#####",
  ".....#.....#",
  ".#######.#.#",
  "...........#",
  "########.###",
];
export const LAB_COLS = 12;
export const LAB_ROWS = 8;
export const LAB_CW = (ROOM.w - 2 * WALL) / LAB_COLS;
export const LAB_CH = (ROOM.h - 2 * WALL) / LAB_ROWS;

// ----- per-scene crate placement (see engine.placeDigSpots) -----
// Coords sit in walkable aisles, clear of each scene's fixtures/doors/spawn.
export const DIG_SPOTS: Record<string, DigSpot[]> = {
  garden: [
    { x: 250, y: 600, label: "left" },
    { x: 880, y: 360, label: "right" },
    { x: 540, y: 420, label: "right" },
    { x: 980, y: 470, label: "left" },
  ],
  // in the aisle in front of the blonde counter (counter is the back fixture)
  omakase: [
    { x: 430, y: 430, label: "right" },
    { x: 700, y: 430, label: "left" },
  ],
  // a lone crate against the left side of the cavern, off the dancefloor
  berlin: [
    { x: 300, y: 430, label: "right" },
    { x: 300, y: 560, label: "right" },
  ],
  // beside the chabudai, on the right (left wall holds the garden door)
  tearoom: [
    { x: 800, y: 500, label: "left" },
    { x: 800, y: 360, label: "left" },
  ],
  // the Houseum crate on the terrace, either side of the gold-record centerpiece
  curator: [
    { x: 250, y: 560, label: "right" },
    { x: 890, y: 560, label: "left" },
  ],
  // in the open sand between the palms, clear of the fire pit + shore
  playa: [
    { x: 360, y: 410, label: "right" },
    { x: 790, y: 380, label: "left" },
  ],
  // against the left brick wall, off the floor (berlin door is right wall)
  warehouse: [
    { x: 270, y: 430, label: "right" },
    { x: 270, y: 560, label: "right" },
  ],
  // on the terrace among the planters (railing above, stairs below)
  rooftop: [
    { x: 400, y: 480, label: "right" },
    { x: 740, y: 560, label: "left" },
  ],
  // by the flour station (left) and beside the communal table
  trattoria: [
    { x: 320, y: 290, label: "right" },
    { x: 660, y: 560, label: "left" },
  ],
  // in the reading aisles between the stacks
  archive: [
    { x: 320, y: 430, label: "right" },
    { x: 640, y: 430, label: "left" },
    { x: 480, y: 650, label: "right" },
  ],
  // the hidden crate caps the dead-end cell c4r4 (centre of the maze) — browse
  // zone on the LEFT (c3r4 is the only open neighbour). The treasure you earn.
  labyrinth: [{ x: 435, y: 447, label: "left" }],
};

// Every door is themed to the room it LEADS to — a distinct colour, frame design,
// glimpse-beyond, and an always-visible name + vibe placard, so it reads at a
// glance as a gateway to a different world. Keyed by destination room id.
export interface DoorTheme {
  name: string; // big label on the placard
  kanji: string; // a kanji tag for flavour
  vibe: string; // a one-line vibe tagline
  accent: string; // placard text / border
  glow: string; // doorway glimpse + floor-glow colour
  frame: string; // the door frame / posts
  style: "kissa" | "garden" | "omakase" | "berlin" | "tearoom" | "cosmic";
}
export const DOOR_THEME: Record<string, DoorTheme> = {
  kissa: { name: "LISTENING ROOM", kanji: "聴", vibe: "sombra's room · the hub", accent: "#ffce8c", glow: "#ffb35e", frame: "#3a2817", style: "kissa" },
  garden: { name: "THE GARDEN", kanji: "庭", vibe: "open air · dusk & koi", accent: "#cfe8a8", glow: "#7e9b5e", frame: "#4a3a22", style: "garden" },
  omakase: { name: "OMAKASE", kanji: "御任せ", vibe: "selector's counter", accent: "#a9cde8", glow: "#5a86a8", frame: "#caa06a", style: "omakase" },
  berlin: { name: "BERLIN", kanji: "地下", vibe: "concrete · fog · 4am", accent: "#ff7a72", glow: "#e0433a", frame: "#26262b", style: "berlin" },
  tearoom: { name: "TEA ROOM", kanji: "茶室", vibe: "tatami · tea · calm", accent: "#d4ecc4", glow: "#9bbf8a", frame: "#5a4a32", style: "tearoom" },
  housemiam: { name: "HOUSEUM", kanji: "宇宙", vibe: "cosmic french house", accent: "#ff8ad6", glow: "#8a6cff", frame: "#2a1d5e", style: "cosmic" },
  mattarello: { name: "IL MATTARELLO", kanji: "麺棒", vibe: "handmade · unhurried · baja", accent: "#f3c9a8", glow: "#e0875a", frame: "#7a4a2e", style: "omakase" },
  playa: { name: "LA PLAYA", kanji: "波", vibe: "dusk surf · fire · sand", accent: "#ffd9a8", glow: "#ff9e5e", frame: "#5a4630", style: "garden" },
  warehouse: { name: "WAREHOUSE", kanji: "倉庫", vibe: "chicago · where it began", accent: "#ffb38c", glow: "#d86a3a", frame: "#3a2a24", style: "berlin" },
  rooftop: { name: "SKYLINE", kanji: "空", vibe: "melodic · city far below", accent: "#bfe0ff", glow: "#7ab8d8", frame: "#2c3a4a", style: "cosmic" },
  labyrinth: { name: "LABYRINTH", kanji: "迷路", vibe: "get lost · find the centre", accent: "#cfe8a8", glow: "#86b86a", frame: "#3e4a2c", style: "garden" },
  archive: { name: "THE ARCHIVE", kanji: "書庫", vibe: "the deep history shelf", accent: "#c8e8c8", glow: "#3f7d5a", frame: "#33402e", style: "tearoom" },
};

// Crates lean into the room they sit in — the bin material, the disc-label colour,
// and the sleeve motif change per scene so records read as part of each world.
export interface CrateStyle {
  bin: string; // crate body
  binEdge: string; // lit top edge
  disc: string; // the vinyl centre-label + accents
  motif: "moon" | "leaf" | "dot" | "bar" | "ripple" | "holo";
}
export function crateStyleFor(scene: string): CrateStyle {
  switch (scene) {
    case "garden": return { bin: "#4e5b3c", binEdge: "#6f854f", disc: "#e9a44e", motif: "leaf" };
    case "omakase": return { bin: "#b98e56", binEdge: "#d8b27a", disc: "#5a86a8", motif: "dot" };
    case "berlin": return { bin: "#26262b", binEdge: "#3c3c44", disc: "#e0433a", motif: "bar" };
    case "tearoom": return { bin: "#6b5a40", binEdge: "#8a7350", disc: "#9bbf8a", motif: "ripple" };
    case "curator": return { bin: "#1a1240", binEdge: "#3a2a6e", disc: "#ffd76a", motif: "holo" }; // iridescent
    case "trattoria": return { bin: "#8a5638", binEdge: "#b07448", disc: "#f3c9a8", motif: "dot" }; // terracotta
    case "playa": return { bin: "#7a6a4e", binEdge: "#a08a64", disc: "#ff9e5e", motif: "ripple" }; // driftwood
    case "warehouse": return { bin: "#4a2e26", binEdge: "#6a4034", disc: "#ff8a4e", motif: "bar" }; // brick
    case "rooftop": return { bin: "#2c3a4a", binEdge: "#46586c", disc: "#7ab8d8", motif: "dot" }; // steel blue
    case "labyrinth": return { bin: "#3e4a2c", binEdge: "#5a6a40", disc: "#cfe8a8", motif: "leaf" }; // hedge
    case "archive": return { bin: "#33402e", binEdge: "#4a5a42", disc: "#c8e8c8", motif: "moon" }; // vault green
    default: return { bin: "#5b3f23", binEdge: "#6e4d2c", disc: "#ffb35e", motif: "moon" }; // kissa
  }
}
