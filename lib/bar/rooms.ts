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
  scene: "kissa" | "garden" | "omakase" | "berlin" | "tearoom" | "curator";
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
  ],
  spawns: {
    kissa: { x: WALL + 70, y: 560 },
    tearoom: { x: ROOM_W - WALL - 120, y: 300 },
    housemiam: { x: 872, y: 120 },
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
  ],
  spawns: { kissa: { x: 572, y: ROOM_H - 110 } },
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
  ],
  spawns: { kissa: { x: ROOM_W - WALL - 110, y: 400 } },
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
  ],
  spawns: { garden: { x: WALL + 110, y: 400 } },
  defaultSpawn: { x: ROOM_W / 2, y: 640 },
};

export const ROOMS: Record<string, RoomDef> = {
  kissa: KISSA,
  garden: GARDEN,
  omakase: OMAKASE,
  berlin: BERLIN,
  tearoom: TEAROOM,
  housemiam: HOUSEMIAM,
};

export const HUB_ROOM = "kissa";
