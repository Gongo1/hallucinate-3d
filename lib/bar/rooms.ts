// ROOM-AS-DATA registry. The venue is one shared audio stream (radio / cue / skip
// / now-playing are global — see presence.ts); rooms only change SCENERY, palette,
// crate placement, and per-room presence rendering. One engine renders any room
// from its descriptor here. Adding a room = adding data, not new engine code.
//
// NOTHING in this file touches music / sync / flowLimits — it is pure scenery +
// topology (room ids, doors between rooms, which shelves live where).

export interface RoomDoor {
  /** id of the room this door leads to */
  to: string;
  /** door anchor + facing; the prompt/charge zone sits in front of it */
  x: number;
  y: number;
  w: number;
  h: number;
  /** which way the player approaches the door (zone offset direction) */
  facing: "up" | "down" | "left" | "right";
  label: string;
}

export interface RoomDef {
  id: string;
  name: string;
  /** scene kind the engine switches its background renderer on. "curator" is the
   *  tribute-room template (cosmic lounge), driven by lib/bar/curators.ts data. */
  scene:
    | "kissa"
    | "garden"
    | "omakase"
    | "berlin"
    | "tearoom"
    | "curator"
    | "trattoria"
    | "playa"
    | "warehouse"
    | "rooftop"
    | "labyrinth"
    | "archive";
  /** shelf slugs (DB) whose `room` matches this id render here; resolved at runtime */
  doors: RoomDoor[];
  /** where the player stands when they ARRIVE in this room (per incoming door) */
  spawns: Record<string, { x: number; y: number }>;
  /** default spawn if no specific incoming door */
  defaultSpawn: { x: number; y: number };
}

export const ROOM_W = 1140;
export const ROOM_H = 800;
export const WALL = 28;

// The Kissa — the hub / entrance + the heart of the hub-and-spoke. Keeps the deck,
// bar, the (now lighter) record column, the rave portal. THREE doors lead out:
//   • Garden  — engawa step-out on the lower-right wall (open below the pour-over bar)
//   • Omakase — a shoji in the back (top) wall, right of the big sign
//   • Berlin  — a side door on the lower-left wall, below the shelf column
const KISSA: RoomDef = {
  id: "kissa",
  name: "音楽喫茶 · KISSA",
  scene: "kissa",
  doors: [
    {
      to: "garden",
      x: ROOM_W - WALL - 10,
      y: 540,
      w: 20,
      h: 96,
      facing: "left", // approached from the room interior (its left)
      label: "the garden",
    },
    {
      to: "omakase",
      x: 818,
      y: 8,
      w: 104,
      h: 24,
      facing: "down", // set into the back wall, right of the sign; approach from below
      label: "the omakase counter",
    },
    {
      to: "berlin",
      x: WALL - 10,
      y: 360,
      w: 20,
      h: 96,
      facing: "right", // lower-left wall, below the shelves + above the rave portal
      label: "berlin",
    },
  ],
  spawns: {
    garden: { x: ROOM_W - WALL - 70, y: 560 },
    omakase: { x: 872, y: 120 },
    berlin: { x: 130, y: 430 },
  },
  defaultSpawn: { x: ROOM_W / 2, y: ROOM_H - 200 },
};

// The Garden — open-air courtyard at dusk. Calm/organic crates live here.
// Doors: back to the Kissa (left wall), and on to the Tea Room (right wall).
const GARDEN: RoomDef = {
  id: "garden",
  name: "庭 · THE GARDEN",
  scene: "garden",
  doors: [
    {
      to: "kissa",
      x: WALL - 10,
      y: 540,
      w: 20,
      h: 96,
      facing: "right",
      label: "back inside",
    },
    {
      to: "tearoom",
      x: ROOM_W - WALL - 10,
      y: 250,
      w: 20,
      h: 96,
      facing: "left",
      label: "the tea room",
    },
    {
      // up through the night sky into the cosmic terrace (earth → stars)
      to: "housemiam",
      x: 820,
      y: 8,
      w: 104,
      h: 24,
      facing: "down",
      label: "the cosmos",
    },
    {
      // down the dune path to the beach at dusk
      to: "playa",
      x: 518,
      y: ROOM_H - WALL - 16,
      w: 104,
      h: 24,
      facing: "up",
      label: "the beach",
    },
  ],
  spawns: {
    kissa: { x: WALL + 70, y: 560 },
    tearoom: { x: ROOM_W - WALL - 120, y: 300 },
    housemiam: { x: 872, y: 120 },
    playa: { x: 570, y: ROOM_H - 110 },
  },
  defaultSpawn: { x: ROOM_W / 2, y: ROOM_H - 220 },
};

// Houseum — a cosmic French-house lounge (a CURATOR tribute room; flavour lives in
// lib/bar/curators.ts). A terrace overlooking the stars: you walk the lower terrace,
// the cosmos fills the sky above a holo railing. Centerpiece is a gold "HOUSEUM"
// record (the attribution link). One door back down to the Garden.
const HOUSEMIAM: RoomDef = {
  id: "housemiam",
  name: "Houseum · 宇宙",
  scene: "curator",
  doors: [
    {
      to: "garden",
      x: 518,
      y: ROOM_H - WALL - 16,
      w: 104,
      h: 24,
      facing: "up",
      label: "back to the garden",
    },
  ],
  spawns: { garden: { x: 570, y: ROOM_H - 100 } },
  defaultSpawn: { x: ROOM_W / 2, y: ROOM_H - 120 },
};

// The Omakase — the selector's counter. Blonde-wood counter, one intimate row of
// seats, a glass neta case repurposed as a record display, precise lighting,
// indigo accents. A single door back to the Kissa on the bottom (south) wall —
// you arrive from the Kissa's back wall, so you emerge at the south end.
const OMAKASE: RoomDef = {
  id: "omakase",
  name: "御任せ · OMAKASE",
  scene: "omakase",
  doors: [
    {
      to: "kissa",
      x: 520,
      y: ROOM_H - WALL - 16,
      w: 104,
      h: 24,
      facing: "up",
      label: "back to the kissa",
    },
    {
      to: "archive",
      x: WALL - 10,
      y: 352,
      w: 20,
      h: 96,
      facing: "right",
      label: "the archive",
    },
  ],
  spawns: {
    kissa: { x: 572, y: ROOM_H - 110 },
    archive: { x: WALL + 110, y: 400 },
  },
  defaultSpawn: { x: ROOM_W / 2, y: 520 },
};

// Berlin — the Panorama-Bar room. Raw concrete + steel, cavernous and dim, fog, a
// single sweeping strobe, a hint of red light. DELIBERATELY breaks the Japanese
// palette — a different world. Door back to the Kissa on the right (east) wall.
const BERLIN: RoomDef = {
  id: "berlin",
  name: "BERLIN · 地下",
  scene: "berlin",
  doors: [
    {
      to: "kissa",
      x: ROOM_W - WALL - 10,
      y: 352,
      w: 20,
      h: 96,
      facing: "left",
      label: "back to the kissa",
    },
    {
      to: "warehouse",
      x: WALL - 10,
      y: 430,
      w: 20,
      h: 96,
      facing: "right",
      label: "the warehouse",
    },
  ],
  spawns: {
    kissa: { x: ROOM_W - WALL - 110, y: 400 },
    warehouse: { x: WALL + 110, y: 478 },
  },
  defaultSpawn: { x: ROOM_W / 2, y: 430 },
};

// The Tea Room — meditation / stillness. Tatami, a low chabudai tea table, a
// singing-bowl corner, incense, plants — the indoor-still counterpart to the
// Garden. Door back to the Garden on the left (west) wall.
const TEAROOM: RoomDef = {
  id: "tearoom",
  name: "茶室 · TEA ROOM",
  scene: "tearoom",
  doors: [
    {
      to: "garden",
      x: WALL - 10,
      y: 352,
      w: 20,
      h: 96,
      facing: "right",
      label: "to the garden",
    },
    {
      to: "labyrinth",
      x: 518,
      y: ROOM_H - WALL - 16,
      w: 104,
      h: 24,
      facing: "up",
      label: "the labyrinth",
    },
  ],
  spawns: {
    garden: { x: WALL + 110, y: 400 },
    labyrinth: { x: 570, y: ROOM_H - 110 },
  },
  defaultSpawn: { x: ROOM_W / 2, y: 640 },
};

/* ------------------------------------------------------------------ the maze
 * Six rooms turn the hub-and-spoke into a WEB: two big loops + a cross-link.
 *   kissa → berlin → warehouse → rooftop → labyrinth → tearoom → garden → kissa
 *   kissa → omakase → archive → mattarello → playa → garden → kissa
 *   labyrinth ↔ archive (the shortcut you only find from inside the maze)
 * The labyrinth also has REAL internal hedge walls (engine builds them from
 * LAB_GRID) with a hidden crate chamber at its centre. */

// Il Mattarello — a tribute trattoria. "Handmade. Unhurried. Baja." Terracotta,
// flour dust, a wood-fired oven, one long communal table, gallery walls. The
// framed piece on the easel IS the attribution link (ilmattarello.mx).
const MATTARELLO: RoomDef = {
  id: "mattarello",
  name: "IL MATTARELLO · 麺棒",
  scene: "trattoria",
  doors: [
    {
      to: "playa",
      x: WALL - 10,
      y: 420,
      w: 20,
      h: 96,
      facing: "right",
      label: "down to the beach",
    },
    {
      to: "archive",
      x: 518,
      y: 8,
      w: 104,
      h: 24,
      facing: "down",
      label: "the archive",
    },
  ],
  spawns: {
    playa: { x: WALL + 110, y: 470 },
    archive: { x: 570, y: 120 },
  },
  defaultSpawn: { x: ROOM_W / 2, y: 560 },
};

// La Playa — dusk beach club. Sand underfoot, the sea along the bottom, palms,
// a fire pit, torch light. The afro/melodic crates live here.
const PLAYA: RoomDef = {
  id: "playa",
  name: "LA PLAYA · 波",
  scene: "playa",
  doors: [
    {
      to: "garden",
      x: 518,
      y: 8,
      w: 104,
      h: 24,
      facing: "down",
      label: "up to the garden",
    },
    {
      to: "mattarello",
      x: ROOM_W - WALL - 10,
      y: 420,
      w: 20,
      h: 96,
      facing: "left",
      label: "il mattarello",
    },
  ],
  spawns: {
    garden: { x: 570, y: 120 },
    mattarello: { x: ROOM_W - WALL - 110, y: 470 },
  },
  defaultSpawn: { x: ROOM_W / 2, y: 400 },
};

// The Warehouse — Chicago, where house was born. Brick, steel, smoke, a wall of
// speakers, a 909 on a pedestal like a relic.
const WAREHOUSE: RoomDef = {
  id: "warehouse",
  name: "WAREHOUSE · 倉庫",
  scene: "warehouse",
  doors: [
    {
      to: "berlin",
      x: ROOM_W - WALL - 10,
      y: 430,
      w: 20,
      h: 96,
      facing: "left",
      label: "back to berlin",
    },
    {
      to: "rooftop",
      x: 518,
      y: 8,
      w: 104,
      h: 24,
      facing: "down",
      label: "stairs to the roof",
    },
  ],
  spawns: {
    berlin: { x: ROOM_W - WALL - 110, y: 478 },
    rooftop: { x: 570, y: 120 },
  },
  defaultSpawn: { x: ROOM_W / 2, y: 460 },
};

// The Rooftop — melodic deep house over a glowing skyline. String lights,
// planters, the city far below.
const ROOFTOP: RoomDef = {
  id: "rooftop",
  name: "SKYLINE · 空",
  scene: "rooftop",
  doors: [
    {
      to: "warehouse",
      x: 518,
      y: ROOM_H - WALL - 16,
      w: 104,
      h: 24,
      facing: "up",
      label: "down the stairs",
    },
    {
      to: "labyrinth",
      x: ROOM_W - WALL - 10,
      y: 400,
      w: 20,
      h: 96,
      facing: "left",
      label: "the labyrinth",
    },
  ],
  spawns: {
    warehouse: { x: 570, y: ROOM_H - 110 },
    labyrinth: { x: ROOM_W - WALL - 110, y: 448 },
  },
  defaultSpawn: { x: ROOM_W / 2, y: 520 },
};

// The Bamboo Labyrinth — a real maze (hedge solids from LAB_GRID in the engine).
// Three ways in, dead ends, and a hidden chamber at the centre holding a crate.
const LABYRINTH: RoomDef = {
  id: "labyrinth",
  name: "迷路 · THE LABYRINTH",
  scene: "labyrinth",
  doors: [
    {
      to: "tearoom",
      x: 518,
      y: 8,
      w: 104,
      h: 24,
      facing: "down",
      label: "the tea room",
    },
    {
      to: "rooftop",
      x: WALL - 10,
      y: 400,
      w: 20,
      h: 96,
      facing: "right",
      label: "the rooftop",
    },
    {
      to: "archive",
      x: 760,
      y: ROOM_H - WALL - 16,
      w: 104,
      h: 24,
      facing: "up",
      label: "the archive",
    },
  ],
  // Spawns sit at OPEN-CELL CENTRES of LAB_GRID (engine.ts) so a centred player
  // never clips a hedge corner (the bug that froze you at the tea-room entrance).
  // Verified by flood-fill: tearoom c6r0, rooftop c0r4, archive c8r6.
  spawns: {
    tearoom: { x: 615, y: 75 },
    rooftop: { x: 73, y: 447 },
    archive: { x: 796, y: 633 },
  },
  defaultSpawn: { x: 615, y: 75 },
};

// The Archive — the deep-history vault. Long stacks, card catalogue, banker's
// lamps. Where the classics rest.
const ARCHIVE: RoomDef = {
  id: "archive",
  name: "書庫 · THE ARCHIVE",
  scene: "archive",
  doors: [
    {
      to: "omakase",
      x: ROOM_W - WALL - 10,
      y: 352,
      w: 20,
      h: 96,
      facing: "left",
      label: "the omakase counter",
    },
    {
      to: "mattarello",
      x: 248,
      y: ROOM_H - WALL - 16,
      w: 104,
      h: 24,
      facing: "up",
      label: "il mattarello",
    },
    {
      to: "labyrinth",
      x: 760,
      y: 8,
      w: 104,
      h: 24,
      facing: "down",
      label: "the labyrinth",
    },
  ],
  spawns: {
    omakase: { x: ROOM_W - WALL - 110, y: 400 },
    mattarello: { x: 300, y: ROOM_H - 110 },
    labyrinth: { x: 812, y: 120 },
  },
  defaultSpawn: { x: ROOM_W / 2, y: 600 },
};

export const ROOMS: Record<string, RoomDef> = {
  kissa: KISSA,
  garden: GARDEN,
  omakase: OMAKASE,
  berlin: BERLIN,
  tearoom: TEAROOM,
  housemiam: HOUSEMIAM,
  mattarello: MATTARELLO,
  playa: PLAYA,
  warehouse: WAREHOUSE,
  rooftop: ROOFTOP,
  labyrinth: LABYRINTH,
  archive: ARCHIVE,
};

export const HUB_ROOM = "kissa";
