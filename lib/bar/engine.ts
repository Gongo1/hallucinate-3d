import type { Shelf, RemotePlayer } from "./types";
import { ROOMS, HUB_ROOM, type RoomDef, type RoomDoor } from "./rooms";
import { CURATORS, type CuratorRoom, type CuratorPalette } from "./curators";

// The whole canvas game, ported from prototype.html — room, fixtures, NPCs,
// particles, camera, input (WASD / click / joystick), zone proximity, and the
// rAF render loop. Framework-agnostic: it owns the canvas and never touches
// React. It talks to the UI through the callbacks below (overlays, prompts) and
// reads playback state via isPlaying() for the speaker/turntable animation.

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

function shade(hex: string, a: number): string {
  let c = hex.replace("#", "");
  if (c.length === 3)
    c = c
      .split("")
      .map((x) => x + x)
      .join("");
  const r = clamp(parseInt(c.slice(0, 2), 16) + a, 0, 255);
  const g = clamp(parseInt(c.slice(2, 4), 16) + a, 0, 255);
  const b = clamp(parseInt(c.slice(4, 6), 16) + a, 0, 255);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function hexRgb(hex: string): [number, number, number] {
  let c = hex.replace("#", "");
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}
/** hex → "rgba(r,g,b,a)" — for tinting pools/glows by a theme accent. */
function rgba(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  _shelf?: boolean;
}
interface ShelfObj {
  data: Shelf;
  x: number;
  y: number;
  w: number;
  h: number;
  /** which side the browse zone + label sit on (opposite the wall it leans on) */
  labelSide: "left" | "right";
}
type Zone =
  | { type: "shelf"; cx: number; cy: number; r: number; shelf: ShelfObj }
  | { type: "deck"; cx: number; cy: number; r: number }
  | { type: "bar"; cx: number; cy: number; r: number }
  | { type: "portal"; cx: number; cy: number; r: number }
  | { type: "goldrecord"; cx: number; cy: number; r: number; url: string; label?: string }
  | { type: "door"; cx: number; cy: number; r: number; door: RoomDoor };

interface Entity {
  x: number;
  y: number;
  r?: number;
  dir: number;
  bob: number;
}
interface Npc extends Entity {
  pts: { x: number; y: number }[];
  pi: number;
  wait: number;
  color: string;
  hair: string;
  speed: number;
  r: number;
}

export interface EngineCallbacks {
  /** prompt text (HTML) to show near the player, or null to hide — fired only on change */
  onPrompt: (html: string | null) => void;
  onBrowseShelf: (shelf: Shelf) => void;
  onOpenIngest: () => void;
  onMastersPick: () => void;
  onShowDeck: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onCloseOverlays: () => void;
  isOverlayOpen: () => boolean;
  isPlaying: () => boolean;
  /** true while the user is typing in chat — suppress movement/hotkeys */
  isTyping: () => boolean;
  /** the rave portal charge completed — open the rave (client-local; new tab) */
  onEnterRave: () => void;
  /** a curator-room link (e.g. the gold-record attribution) — open it in a new tab.
   *  Client-local navigation only; never touches audio/sync. */
  onOpenExternal: (url: string) => void;
  /** the player moved to another venue room (scenery only — audio is unchanged) */
  onRoomChange: (roomId: string) => void;
}

interface EngineOpts {
  canvas: HTMLCanvasElement;
  stick: HTMLElement;
  stickNub: HTMLElement;
  actBtn: HTMLElement;
  shelves: Shelf[];
  callbacks: EngineCallbacks;
}

const ROOM = { x: 0, y: 0, w: 1140, h: 800 };
const WALL = 28;
/** rave-portal pull-through charge length (ms) — explicit, cancelable intent */
const PORTAL_CHARGE_MS = 800;

/** a crate dig-spot: where a record-object sits + which side its browse zone is on */
interface DigSpot {
  x: number;
  y: number;
  label: "left" | "right";
}
// Per-scene crate placement (see placeDigSpots). Coords sit in walkable aisles,
// clear of each scene's fixtures/doors/spawn (verified by screenshot).
const GARDEN_SPOTS: DigSpot[] = [
  { x: 250, y: 600, label: "left" },
  { x: 880, y: 360, label: "right" },
  { x: 540, y: 420, label: "right" },
  { x: 980, y: 470, label: "left" },
];
// Omakase: in the aisle in front of the blonde counter (counter is the back fixture).
const OMAKASE_SPOTS: DigSpot[] = [
  { x: 430, y: 430, label: "right" },
  { x: 700, y: 430, label: "left" },
];
// Berlin: a lone crate against the left side of the cavern, off the dancefloor.
const BERLIN_SPOTS: DigSpot[] = [
  { x: 300, y: 430, label: "right" },
  { x: 300, y: 560, label: "right" },
];
// Tea Room: beside the chabudai, on the right (left wall holds the garden door).
const TEA_SPOTS: DigSpot[] = [
  { x: 800, y: 500, label: "left" },
  { x: 800, y: 360, label: "left" },
];
// La Playa: in the open sand between the palms, clear of the fire pit + shore.
const PLAYA_SPOTS: DigSpot[] = [
  { x: 360, y: 410, label: "right" },
  { x: 790, y: 380, label: "left" },
];
// Warehouse: against the left brick wall, off the floor (berlin door is right wall).
const WAREHOUSE_SPOTS: DigSpot[] = [
  { x: 270, y: 430, label: "right" },
  { x: 270, y: 560, label: "right" },
];
// Rooftop: on the terrace among the planters (railing above, stairs below).
const ROOFTOP_SPOTS: DigSpot[] = [
  { x: 400, y: 480, label: "right" },
  { x: 740, y: 560, label: "left" },
];
// Trattoria: by the flour station (left) and beside the communal table.
const MATTARELLO_SPOTS: DigSpot[] = [
  { x: 320, y: 290, label: "right" },
  { x: 660, y: 560, label: "left" },
];
// Archive: in the reading aisles between the stacks.
const ARCHIVE_SPOTS: DigSpot[] = [
  { x: 320, y: 430, label: "right" },
  { x: 640, y: 430, label: "left" },
  { x: 480, y: 650, label: "right" },
];
// Labyrinth: the hidden chamber at the maze's centre (LAB_GRID r4c5) — the
// treasure you earn by getting lost.
const LABYRINTH_SPOTS: DigSpot[] = [{ x: 540, y: 446, label: "right" }];

// THE MAZE. 12×8 cells over the room interior; '#' becomes a solid hedge block
// (and is drawn as bamboo hedge). Openings line up with the three doors: top
// (col 6), left (row 4), bottom (col 8). Centre chamber at r4c4-7 holds the
// hidden crate. Edited by hand — keep every row 12 chars and the door cells open.
const LAB_GRID = [
  "............",
  ".###.#.####.",
  ".#...#....#.",
  ".#.######.#.",
  "...#....#.#.",
  "##.#.##.#...",
  ".....#..###.",
  ".###.#.#....",
];
const LAB_COLS = 12;
const LAB_ROWS = 8;
const LAB_CW = (ROOM.w - 2 * WALL) / LAB_COLS;
const LAB_CH = (ROOM.h - 2 * WALL) / LAB_ROWS;

// Every door is themed to the room it LEADS to — a distinct colour, frame design,
// glimpse-beyond, and an always-visible name + vibe placard, so it reads at a glance
// as a gateway to a different world. Keyed by destination room id.
interface DoorTheme {
  name: string; // big label on the placard
  kanji: string; // a kanji tag for flavour
  vibe: string; // a one-line vibe tagline
  accent: string; // placard text / border
  glow: string; // doorway glimpse + floor-glow colour
  frame: string; // the door frame / posts
  style: "kissa" | "garden" | "omakase" | "berlin" | "tearoom" | "cosmic";
}
const DOOR_THEME: Record<string, DoorTheme> = {
  kissa: { name: "THE KISSA", kanji: "喫茶", vibe: "warm hinoki · the hub", accent: "#ffce8c", glow: "#ffb35e", frame: "#3a2817", style: "kissa" },
  garden: { name: "THE GARDEN", kanji: "庭", vibe: "open air · dusk & koi", accent: "#cfe8a8", glow: "#7e9b5e", frame: "#4a3a22", style: "garden" },
  omakase: { name: "OMAKASE", kanji: "御任せ", vibe: "selector's counter", accent: "#a9cde8", glow: "#5a86a8", frame: "#caa06a", style: "omakase" },
  berlin: { name: "BERLIN", kanji: "地下", vibe: "concrete · fog · 4am", accent: "#ff7a72", glow: "#e0433a", frame: "#26262b", style: "berlin" },
  tearoom: { name: "TEA ROOM", kanji: "茶室", vibe: "tatami · tea · calm", accent: "#d4ecc4", glow: "#9bbf8a", frame: "#5a4a32", style: "tearoom" },
  housemiam: { name: "HOUSEUM", kanji: "宇宙", vibe: "cosmic french house", accent: "#ff8ad6", glow: "#8a6cff", frame: "#2a1d5e", style: "cosmic" },
  // The maze wing. New door styles reuse the closest existing accent renderer —
  // the palette (accent/glow/frame) is what makes each gateway read differently.
  mattarello: { name: "IL MATTARELLO", kanji: "麺棒", vibe: "handmade · unhurried · baja", accent: "#f3c9a8", glow: "#e0875a", frame: "#7a4a2e", style: "omakase" },
  playa: { name: "LA PLAYA", kanji: "波", vibe: "dusk surf · fire · sand", accent: "#ffd9a8", glow: "#ff9e5e", frame: "#5a4630", style: "garden" },
  warehouse: { name: "WAREHOUSE", kanji: "倉庫", vibe: "chicago · where it began", accent: "#ffb38c", glow: "#d86a3a", frame: "#3a2a24", style: "berlin" },
  rooftop: { name: "SKYLINE", kanji: "空", vibe: "melodic · city far below", accent: "#bfe0ff", glow: "#7ab8d8", frame: "#2c3a4a", style: "cosmic" },
  labyrinth: { name: "LABYRINTH", kanji: "迷路", vibe: "get lost · find the centre", accent: "#cfe8a8", glow: "#86b86a", frame: "#3e4a2c", style: "garden" },
  archive: { name: "THE ARCHIVE", kanji: "書庫", vibe: "the deep history shelf", accent: "#c8e8c8", glow: "#3f7d5a", frame: "#33402e", style: "tearoom" },
};

// Crates lean into the room they sit in — the bin material, the disc-label colour,
// and the sleeve motif change per scene so records read as part of each world.
interface CrateStyle {
  bin: string; // crate body
  binEdge: string; // lit top edge
  disc: string; // the vinyl centre-label + accents
  motif: "moon" | "leaf" | "dot" | "bar" | "ripple" | "holo";
}
function crateStyleFor(scene: string): CrateStyle {
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

// HouseMiam: the Houseum crate on the terrace, left of the gold-record centerpiece.
const HOUSEMIAM_SPOTS: DigSpot[] = [
  { x: 250, y: 560, label: "right" },
  { x: 890, y: 560, label: "left" },
];

export class BarEngine {
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cb: EngineCallbacks;
  private stick: HTMLElement;
  private nub: HTMLElement;
  private actBtn: HTMLElement;

  private W = 0;
  private H = 0;
  private DPR = Math.min(window.devicePixelRatio || 1, 2);

  private shelves: Shelf[];
  private solids: Rect[] = [];
  private shelfObjs: ShelfObj[] = [];
  private zones: Zone[] = [];

  // fixtures
  // Listening DECK: a booth across the BOTTOM of the room (user's call). The
  // library is the left wall, the big sign + moon window own the top, the
  // pour-over bar is the right wall — so the bottom is the open spot. You walk
  // DOWN to the deck; its prompt zone sits ABOVE it (see buildStatics), since a
  // zone below would fall past the bottom wall off-screen. Speakers flank it.
  private deck = { x: 400, y: 648, w: 290, h: 112 };
  private speakers = [
    { x: 332, y: 658 },
    { x: 704, y: 658 },
  ];
  private spkBox = { w: 58, h: 84 };
  private bar = { x: ROOM.w - 156, y: 120, w: 116, h: 300 };
  private platform = { x: 430, y: 300, w: 300, h: 230 };

  // The RAVE PORTAL — the bar's back door. A torii doorway set into the lower-left
  // wall, below the shelf column (ends ~y514) and above the floor decor (~y662),
  // clear of the deck (x>=332). Its rift is "other": cool electric, vs the warm
  // hinoki. ENTIRELY CLIENT-LOCAL — never reads/writes room/presence/cue/skip/NPC
  // state. cx/cy is the rift centre; the charge zone sits in front of it (right).
  private portal = { cx: WALL + 36, cy: 600, w: 78, h: 132 };
  private decor = [
    // bamboo moved right (was x80) to clear the rave portal doorway on the lower-left wall
    { t: "bamboo", x: 230, y: ROOM.h - 120 },
    { t: "maple", x: ROOM.w - 100, y: ROOM.h - 130 },
    { t: "stone", x: 170, y: ROOM.h - 110 },
  ];

  // ----- GARDEN scene fixtures (outdoor courtyard at dusk) -----
  private gKoi = { x: 760, y: 470, r: 110 }; // koi pond (ellipse)
  private gGravel = { x: 250, y: 250, w: 300, h: 180 }; // karesansui raked gravel
  private gMaple = { x: 940, y: 250 }; // red maple
  private gBasin = { x: 430, y: 560 }; // tsukubai water basin (shishi-odoshi)
  private gLanterns = [
    { x: 150, y: 430 },
    { x: 980, y: 600 },
    { x: 560, y: 200 },
  ];
  private gBamboo = [
    { x: 90, y: 250 },
    { x: 90, y: 330 },
    { x: 120, y: 690 },
  ];
  private gCushions = [
    { x: 600, y: 640 },
    { x: 680, y: 660 },
  ];

  // ----- OMAKASE fixtures (the selector's counter) -----
  private oCounter = { x: 250, y: 300, w: 640, h: 64 }; // long blonde-wood counter
  private oStools: { x: number; y: number }[] = [
    { x: 360, y: 478 }, { x: 470, y: 478 }, { x: 580, y: 478 }, { x: 690, y: 478 }, { x: 800, y: 478 },
  ];

  // ----- BERLIN fixtures (Panorama-Bar room — breaks the Japanese palette) -----
  private bBooth = { x: ROOM.w / 2 - 110, y: 150, w: 220, h: 74 }; // DJ booth, far wall
  private bPillars: { x: number; y: number }[] = [
    { x: 250, y: 300 }, { x: 890, y: 300 }, { x: 250, y: 600 }, { x: 890, y: 600 },
  ];

  // ----- TEA ROOM fixtures (meditation / stillness) -----
  private tTable = { x: ROOM.w / 2 - 70, y: 430, w: 140, h: 84 }; // low chabudai
  private tBowl = { x: 250, y: 300 }; // singing-bowl corner
  private tPlants: { x: number; y: number }[] = [
    { x: 980, y: 250 }, { x: 980, y: 600 }, { x: 250, y: 620 },
  ];

  // ----- CURATOR (Houseum cosmic terrace) fixtures -----
  private cRailY = 320; // terrace edge: cosmos above, walkable terrace below
  private cRecord = { x: ROOM.w / 2, y: 462, r: 50 }; // the gold "HOUSEUM" centerpiece
  private cCat = { x: 690, y: 500 }; // the cosmic cat lounging beside it
  private cStars = Array.from({ length: 96 }, () => ({
    x: Math.random(),
    y: Math.random(),
    ph: Math.random() * Math.PI * 2,
    s: 0.6 + Math.random() * 1.5,
  }));

  // ----- LA PLAYA fixtures (dusk beach; sea along the BOTTOM of the room) -----
  private pShoreY = 620; // sand above, surf below (solid — you can't swim)
  private pFire = { x: 570, y: 460 }; // the fire pit everyone orbits
  private pPalms = [
    { x: 180, y: 300 },
    { x: 950, y: 270 },
    { x: 290, y: 560 },
    { x: 900, y: 540 },
  ];
  private pTorches = [
    { x: 460, y: 580 },
    { x: 690, y: 580 },
  ];

  // ----- WAREHOUSE fixtures (Chicago — brick, steel, the speaker wall) -----
  private wStage = { x: 380, y: 150, w: 380, h: 84 }; // speaker wall / stage, far wall
  private wPillars: { x: number; y: number }[] = [
    { x: 250, y: 330 },
    { x: 890, y: 330 },
    { x: 250, y: 620 },
    { x: 890, y: 620 },
  ];
  private w909 = { x: 950, y: 560 }; // the TR-909 on a pedestal, like a relic
  private wSmoke = Array.from({ length: 14 }, () => ({
    x: Math.random(),
    y: Math.random(),
    s: 60 + Math.random() * 90,
    ph: Math.random() * Math.PI * 2,
  }));

  // ----- ROOFTOP fixtures (melodic deep over the skyline) -----
  private rRailY = 300; // parapet: city sky above, terrace below
  private rPlanters: { x: number; y: number }[] = [
    { x: 250, y: 420 },
    { x: 890, y: 480 },
    { x: 480, y: 620 },
  ];
  private rCart = { x: 820, y: 380 }; // little terrace bar cart
  private rSky = Array.from({ length: 26 }, (_, i) => ({
    // skyline silhouette: pseudo-random but stable building strip
    w: 30 + ((i * 37) % 50),
    h: 60 + ((i * 53) % 120),
    win: (i * 7919) % 97,
  }));

  // ----- TRATTORIA (Il Mattarello) fixtures -----
  private mOven = { x: 920, y: 150, w: 130, h: 100 }; // wood-fired oven, top right
  private mTable = { x: 430, y: 400, w: 280, h: 74 }; // one long communal table
  private mEasel = { x: 850, y: 520 }; // the framed piece = the attribution link
  private mFlour = [
    { x: 180, y: 560 },
    { x: 238, y: 584 },
  ]; // flour sacks by the pasta station

  // ----- ARCHIVE fixtures (the deep-history vault) -----
  private aStacks = [
    { x: 200, y: 180, w: 600, h: 44 },
    { x: 200, y: 320, w: 600, h: 44 },
  ]; // long record stacks (aisles between)
  private aTable = { x: 420, y: 520, w: 300, h: 64 }; // reading table, banker's lamps
  private aCatalog = { x: 950, y: 600 }; // the card catalogue

  private player = {
    x: ROOM.w / 2,
    y: ROOM.h - 200, // open floor between the centre platform and the bottom deck
    r: 13,
    dir: 1,
    bob: 0,
    speed: 132, // relaxed but responsive — chill, not sluggish
  };
  private cam = { x: this.player.x, y: this.player.y };
  private npcs: Npc[] = [];
  private seated = [
    {
      x: this.platform.x + 70,
      y: this.platform.y + 150,
      bob: 0,
      t: Math.random() * 3,
      color: "#7e6fb0",
      hair: "#15151a",
    },
    {
      x: this.platform.x + 220,
      y: this.platform.y + 90,
      bob: 0,
      t: Math.random() * 3,
      color: "#9b7d4e",
      hair: "#241812",
    },
  ];
  private master = {
    x: this.bar.x + this.bar.w / 2,
    y: this.bar.y + this.bar.h / 2,
    bob: 0,
    t: 0,
    color: "#caa06a",
    hair: "#1c130b",
  };

  private dust = Array.from({ length: 48 }, () => ({
    x: Math.random() * ROOM.w,
    y: Math.random() * ROOM.h,
    vx: (Math.random() - 0.5) * 5,
    vy: -3 - Math.random() * 5,
    s: 0.6 + Math.random() * 1.5,
    a: Math.random() * 0.35,
  }));
  private incense = Array.from({ length: 12 }, () => ({ p: Math.random() }));
  // portal particles spiral INWARD: each has an angle, radius (1→0), speed.
  private portalBits = Array.from({ length: 22 }, () => ({
    a: Math.random() * Math.PI * 2,
    r: 0.4 + Math.random() * 0.6,
    spin: 0.6 + Math.random() * 0.9,
    fall: 0.18 + Math.random() * 0.22,
  }));

  // rave portal pull-through charge: 0 = idle, else ms elapsed (≤ PORTAL_CHARGE_MS).
  // Cancelable — aborts the moment the player leaves the portal zone or an overlay
  // opens. On completion it fires onEnterRave (a new-tab window.open in the host).
  private portalCharge = 0;

  // ----- venue rooms (scenery only — audio is one shared stream) -----
  private room: RoomDef = ROOMS[HUB_ROOM];
  private doors: RoomDoor[] = [];
  // door fade/wipe transition: 0 idle; >0 = fading OUT to the next room; <0 = fading IN.
  // pendingRoom holds the destination while the screen is dark.
  private fade = 0;
  private pendingRoom: { id: string; fromDoor: string } | null = null;
  // garden scene anim clocks (fireflies, shishi-odoshi)
  private fireflies = Array.from({ length: 18 }, () => ({
    x: Math.random(),
    y: Math.random(),
    ph: Math.random() * Math.PI * 2,
    sp: 0.2 + Math.random() * 0.5,
  }));
  private shishi = { t: Math.random() * 4, clack: 0 };

  private keys: Record<string, boolean> = {};
  private moveTarget: { x: number; y: number } | null = null;
  private stickVec = { x: 0, y: 0 };
  private stickId: number | null = null;
  private activeZone: Zone | null = null;
  private lastPrompt: string | null = null;

  // other live listeners (lobby). Pulled fresh each frame; interpolated here.
  private remoteGetter: (() => RemotePlayer[]) | null = null;
  private playerMoving = false;

  private started = false;
  private last = performance.now();
  private raf = 0;

  // bound handlers (kept for removal on destroy)
  private onResize = () => this.resize();
  private onKeyDown!: (e: KeyboardEvent) => void;
  private onKeyUp!: (e: KeyboardEvent) => void;
  private onCanvasPointer!: (e: PointerEvent) => void;
  private onStickDown!: (e: PointerEvent) => void;
  private onStickMove!: (e: PointerEvent) => void;
  private onStickUp!: () => void;
  private onActDown!: (e: PointerEvent) => void;

  constructor(opts: EngineOpts) {
    this.cv = opts.canvas;
    const ctx = this.cv.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
    this.cb = opts.callbacks;
    this.stick = opts.stick;
    this.nub = opts.stickNub;
    this.actBtn = opts.actBtn;
    this.shelves = opts.shelves;

    this.buildStatics();
    this.setShelves(opts.shelves);
    this.npcs = this.roomNpcs(this.room.id);

    this.resize();
    this.bindInput();
    this.raf = requestAnimationFrame(this.loop);
  }

  /* ----------------------------------------------------------- lifecycle */
  start() {
    this.started = true;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    removeEventListener("resize", this.onResize);
    removeEventListener("keydown", this.onKeyDown);
    removeEventListener("keyup", this.onKeyUp);
    this.cv.removeEventListener("pointerdown", this.onCanvasPointer);
    this.stick.removeEventListener("pointerdown", this.onStickDown);
    this.stick.removeEventListener("pointermove", this.onStickMove);
    this.stick.removeEventListener("pointerup", this.onStickUp);
    this.actBtn.removeEventListener("pointerdown", this.onActDown);
  }

  /** Feed the engine a live source of remote listeners to render (the lobby). */
  setRemoteSource(getter: (() => RemotePlayer[]) | null) {
    this.remoteGetter = getter;
  }

  /** Act on the nearest zone — the touch UI's tappable prompt pill ("E"). */
  interact() {
    this.tryInteract();
  }

  /** The local player's pose + current room, for presence broadcasting. The room
   *  is for per-room avatar RENDERING only — presence/listener-count stay venue-wide. */
  getPlayerPose() {
    return {
      x: Math.round(this.player.x),
      y: Math.round(this.player.y),
      dir: this.player.dir,
      moving: this.playerMoving,
      room: this.room.id,
    };
  }

  /** The room the local player is currently in (for filtering remote avatars). */
  currentRoom(): string {
    return this.room.id;
  }

  /** Instantly swap to another room (no door fade) — for deep-links / debugging.
   *  Scenery only, exactly like walking through a door; never touches audio/sync. */
  jumpToRoom(roomId: string) {
    if (ROOMS[roomId]) this.enterRoom(roomId, this.room.id);
  }

  // ON AIR state, pushed from the host's RoomState via Bar.tsx (the engine never
  // reads shared state directly — guardrail). Purely for the sign's appearance.
  private onAir = false;
  private onAirDj: string | null = null;
  setOnAir(live: boolean, dj: string | null) {
    this.onAir = live;
    this.onAirDj = dj;
  }

  // PHASE LIGHT — the global time-of-day layer (lib/bar/clock.ts), pushed from
  // Bar.tsx's VenueClock. Like setOnAir, this is a one-way push: the engine NEVER
  // reads the clock or any shared state — it only composites the eased light over
  // whatever scene it's drawing. `current` lerps toward `target` each frame so even
  // coarse ~1s pushes melt smoothly. Default mult alpha 0 = no tint before the
  // first push (no flash on the intro screen).
  private phaseMult: [number, number, number, number] = [255, 255, 255, 0];
  private phaseGlow: [number, number, number, number] = [0, 0, 0, 0];
  private phaseMultT: [number, number, number, number] = [255, 255, 255, 0];
  private phaseGlowT: [number, number, number, number] = [0, 0, 0, 0];
  setPhase(light: { mult: readonly number[]; glow: readonly number[] }) {
    const m = light.mult, g = light.glow;
    this.phaseMultT = [m[0], m[1], m[2], m[3]];
    this.phaseGlowT = [g[0], g[1], g[2], g[3]];
  }
  private updatePhaseLight(dt: number) {
    const k = Math.min(1, dt * 3); // ~0.3s to converge on a new phase value
    for (let i = 0; i < 4; i++) {
      this.phaseMult[i] += (this.phaseMultT[i] - this.phaseMult[i]) * k;
      this.phaseGlow[i] += (this.phaseGlowT[i] - this.phaseGlow[i]) * k;
    }
  }

  /** Rebuild shelf geometry + zones for the CURRENT room when the library or room
   *  changes. Shelves are filtered by `room` (default 'kissa') — every crate, in
   *  any room, cues into the one shared queue (the host owns that; this is only
   *  placement). */
  setShelves(shelves: Shelf[]) {
    this.shelves = shelves;
    for (let i = this.solids.length - 1; i >= 0; i--)
      if (this.solids[i]._shelf) this.solids.splice(i, 1);
    this.zones = this.zones.filter((z) => z.type !== "shelf");
    this.shelfObjs = [];

    const here = shelves.filter((s) => (s.room ?? "kissa") === this.room.id);
    // Every non-kissa scene lays its crates out as compact DIG SPOTS among the
    // scenery (not a wall column). Each scene's spot map keeps crates clear of
    // fixtures, doors, and the arrival spawn; cueing from any of them feeds the one
    // shared queue.
    if (this.room.scene === "garden") return this.placeDigSpots(here, GARDEN_SPOTS);
    if (this.room.scene === "omakase") return this.placeDigSpots(here, OMAKASE_SPOTS);
    if (this.room.scene === "berlin") return this.placeDigSpots(here, BERLIN_SPOTS);
    if (this.room.scene === "tearoom") return this.placeDigSpots(here, TEA_SPOTS);
    if (this.room.scene === "curator") return this.placeDigSpots(here, HOUSEMIAM_SPOTS);
    if (this.room.scene === "playa") return this.placeDigSpots(here, PLAYA_SPOTS);
    if (this.room.scene === "warehouse") return this.placeDigSpots(here, WAREHOUSE_SPOTS);
    if (this.room.scene === "rooftop") return this.placeDigSpots(here, ROOFTOP_SPOTS);
    if (this.room.scene === "trattoria") return this.placeDigSpots(here, MATTARELLO_SPOTS);
    if (this.room.scene === "archive") return this.placeDigSpots(here, ARCHIVE_SPOTS);
    if (this.room.scene === "labyrinth") return this.placeDigSpots(here, LABYRINTH_SPOTS);

    // DETROIT gets a special home on the RIGHT wall, just above the pour-over bar
    // (per request). Everything else forms the left-wall column.
    const isRight = (s: Shelf) => /DETROIT/i.test(s.label);
    const left = here.filter((s) => !isRight(s));
    const right = here.filter(isRight);

    // ----- left column (the main library) -----
    const top = WALL + 18;
    const bottom = ROOM.h - WALL - 18;
    const slot = Math.min(96, (bottom - top) / Math.max(1, left.length));
    const boxW = 138;
    const boxH = Math.min(72, slot - 20);
    const cx = WALL + 14 + boxW / 2;
    left.forEach((data, i) => {
      const cy = top + i * slot + slot / 2;
      const o: ShelfObj = { data, x: cx, y: cy, w: boxW, h: boxH, labelSide: "right" };
      const r = this.solid(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h);
      r._shelf = true;
      this.shelfObjs.push(o);
      this.zones.push({ type: "shelf", cx: o.x + o.w / 2 + 34, cy: o.y, r: 60, shelf: o });
    });

    // ----- right wall: Detroit, stacked upward just above the bar -----
    const rW = 120;
    const rH = 60;
    const rcx = ROOM.w - WALL - 14 - rW / 2;
    right.forEach((data, i) => {
      const cy = this.bar.y - 56 - i * (rH + 16);
      const o: ShelfObj = { data, x: rcx, y: cy, w: rW, h: rH, labelSide: "left" };
      const r = this.solid(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h);
      r._shelf = true;
      this.shelfObjs.push(o);
      this.zones.push({ type: "shelf", cx: o.x - o.w / 2 - 34, cy: o.y, r: 60, shelf: o });
    });
  }

  /** Place crates as compact record-objects (DIG SPOTS) among a scene's scenery,
   *  one per slot from the given map (wrapping if there are more crates than
   *  spots). Each is a solid; its browse zone sits on the open `labelSide`. Used
   *  by every non-kissa room (garden, omakase, berlin, tea). */
  private placeDigSpots(here: Shelf[], spots: DigSpot[]) {
    const bw = 96;
    const bh = 54;
    here.forEach((data, i) => {
      const sp = spots[i % spots.length];
      const o: ShelfObj = { data, x: sp.x, y: sp.y, w: bw, h: bh, labelSide: sp.label };
      const r = this.solid(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h);
      r._shelf = true;
      this.shelfObjs.push(o);
      const zx = sp.label === "left" ? o.x - o.w / 2 - 30 : o.x + o.w / 2 + 30;
      this.zones.push({ type: "shelf", cx: zx, cy: o.y, r: 58, shelf: o });
    });
  }

  /* ----------------------------------------------------------- world setup */
  private solid(x: number, y: number, w: number, h: number): Rect {
    const r: Rect = { x, y, w, h };
    this.solids.push(r);
    return r;
  }

  private buildStatics() {
    // walls (shared by every room)
    this.solid(-200, -200, ROOM.w + 400, 200 + WALL);
    this.solid(-200, ROOM.h - WALL, ROOM.w + 400, 200 + WALL);
    this.solid(-200, -200, 200 + WALL, ROOM.h + 400);
    this.solid(ROOM.w - WALL, -200, 200 + WALL, ROOM.h + 400);

    if (this.room.scene === "kissa") this.buildKissaFixtures();
    else if (this.room.scene === "garden") this.buildGardenFixtures();
    else if (this.room.scene === "omakase") this.buildOmakaseFixtures();
    else if (this.room.scene === "berlin") this.buildBerlinFixtures();
    else if (this.room.scene === "tearoom") this.buildTeaFixtures();
    else if (this.room.scene === "curator") this.buildCuratorFixtures();
    else if (this.room.scene === "playa") this.buildPlayaFixtures();
    else if (this.room.scene === "warehouse") this.buildWarehouseFixtures();
    else if (this.room.scene === "rooftop") this.buildRooftopFixtures();
    else if (this.room.scene === "trattoria") this.buildTrattoriaFixtures();
    else if (this.room.scene === "archive") this.buildArchiveFixtures();
    else if (this.room.scene === "labyrinth") this.buildLabyrinthFixtures();

    // doors out of this room (the door primitive — reused from the rave portal,
    // pointed inward). The frame is solid; the prompt/charge zone sits IN FRONT.
    this.doors = this.room.doors;
    for (const d of this.doors) {
      this.solid(d.x, d.y, d.w, d.h);
      const off = 40;
      const zx =
        d.facing === "left" ? d.x - off : d.facing === "right" ? d.x + d.w + off : d.x + d.w / 2;
      const zy =
        d.facing === "up" ? d.y - off : d.facing === "down" ? d.y + d.h + off : d.y + d.h / 2;
      this.zones.push({ type: "door", cx: zx, cy: zy, r: 64, door: d });
    }
  }

  private buildKissaFixtures() {
    this.solid(this.deck.x, this.deck.y, this.deck.w, this.deck.h);
    this.speakers.forEach((s) =>
      this.solid(s.x, s.y, this.spkBox.w, this.spkBox.h)
    );
    this.solid(this.bar.x, this.bar.y, this.bar.w, this.bar.h);
    this.decor.forEach((d) => this.solid(d.x - 18, d.y - 18, 36, 36));
    // non-shelf zones — the deck is along the bottom wall, so its prompt zone sits
    // ABOVE it (you approach the booth walking down from the room centre).
    this.zones.push({
      type: "deck",
      cx: this.deck.x + this.deck.w / 2,
      cy: this.deck.y - 34,
      r: 88,
    });
    this.zones.push({
      type: "bar",
      cx: this.bar.x - 26,
      cy: this.bar.y + this.bar.h / 2,
      r: 92,
    });
    // Rave portal: the doorway frame is solid (you can't walk into the wall); its
    // prompt/charge zone sits in FRONT of the rift (to the right, into the room),
    // so approach + explicit E is the only path — never a walk-through.
    this.solid(
      this.portal.cx - this.portal.w / 2,
      this.portal.cy - this.portal.h / 2,
      this.portal.w,
      this.portal.h
    );
    this.zones.push({
      type: "portal",
      cx: this.portal.cx + this.portal.w / 2 + 30,
      cy: this.portal.cy,
      r: 66,
    });
  }

  private buildGardenFixtures() {
    // Solid garden features (you can't walk through them). Koi pond, raked-gravel
    // patch, maple trunk, lanterns, tsukubai basin. Cushions/benches are passable.
    this.solid(this.gKoi.x - this.gKoi.r, this.gKoi.y - this.gKoi.r * 0.7, this.gKoi.r * 2, this.gKoi.r * 1.4);
    this.solid(this.gMaple.x - 14, this.gMaple.y - 6, 28, 26); // maple trunk
    this.solid(this.gBasin.x - 16, this.gBasin.y - 14, 32, 30); // tsukubai
    this.gLanterns.forEach((l) => this.solid(l.x - 12, l.y - 10, 24, 30));
  }

  private buildOmakaseFixtures() {
    // the blonde counter is the one solid back-fixture; stools + the glass neta
    // case are passable so the crates in front of the counter stay reachable.
    this.solid(this.oCounter.x, this.oCounter.y, this.oCounter.w, this.oCounter.h);
  }

  private buildBerlinFixtures() {
    this.solid(this.bBooth.x, this.bBooth.y, this.bBooth.w, this.bBooth.h); // DJ booth
    this.bPillars.forEach((p) => this.solid(p.x - 14, p.y - 40, 28, 80)); // concrete columns
  }

  private buildTeaFixtures() {
    this.solid(this.tTable.x, this.tTable.y, this.tTable.w, this.tTable.h); // chabudai
    this.tPlants.forEach((p) => this.solid(p.x - 13, p.y - 12, 26, 28)); // potted plants
  }

  private buildCuratorFixtures() {
    // the terrace railing — a full-width solid so you stay on the terrace (the cosmos
    // is beyond it, not walkable)
    this.solid(-40, this.cRailY - 9, ROOM.w + 80, 18);
    // the gold-record centerpiece is solid — you walk AROUND it
    const r = this.cRecord;
    this.solid(r.x - r.r * 0.82, r.y - r.r * 0.82, r.r * 1.64, r.r * 1.64);
    // its interaction zone sits in front (below) — E opens the curator's link (the
    // honest attribution). The url comes from the curator config (data, not hardcoded).
    this.zones.push({
      type: "goldrecord",
      cx: r.x,
      cy: r.y + r.r + 30,
      r: 76,
      url: this.curatorCfg()?.attribution.url ?? "",
    });
  }

  private buildPlayaFixtures() {
    // the sea is not walkable — one solid band below the shoreline
    this.solid(-40, this.pShoreY, ROOM.w + 80, ROOM.h - this.pShoreY + 40);
    this.pPalms.forEach((p) => this.solid(p.x - 12, p.y - 8, 24, 24)); // trunks
    this.pTorches.forEach((t) => this.solid(t.x - 8, t.y - 6, 16, 18));
    const f = this.pFire;
    this.solid(f.x - 26, f.y - 18, 52, 36); // fire pit ring
  }

  private buildWarehouseFixtures() {
    this.solid(this.wStage.x, this.wStage.y, this.wStage.w, this.wStage.h); // speaker wall
    this.wPillars.forEach((p) => this.solid(p.x - 14, p.y - 40, 28, 80));
    this.solid(this.w909.x - 24, this.w909.y - 16, 48, 36); // the 909 pedestal
  }

  private buildRooftopFixtures() {
    // the parapet — the city is far below, not walkable
    this.solid(-40, this.rRailY - 9, ROOM.w + 80, 18);
    this.rPlanters.forEach((p) => this.solid(p.x - 24, p.y - 14, 48, 30));
    this.solid(this.rCart.x - 26, this.rCart.y - 14, 52, 30);
  }

  private buildTrattoriaFixtures() {
    this.solid(this.mOven.x, this.mOven.y, this.mOven.w, this.mOven.h); // the oven
    this.solid(this.mTable.x, this.mTable.y, this.mTable.w, this.mTable.h); // long table
    this.mFlour.forEach((s) => this.solid(s.x - 16, s.y - 10, 32, 24));
    // the framed piece on the easel — the honest attribution; E opens their site
    const e = this.mEasel;
    this.solid(e.x - 20, e.y - 12, 40, 30);
    this.zones.push({
      type: "goldrecord",
      cx: e.x,
      cy: e.y + 44,
      r: 70,
      url: "https://www.ilmattarello.mx/",
      label: `See <b>Il Mattarello</b> — handmade · unhurried · Baja ↗`,
    });
  }

  private buildArchiveFixtures() {
    this.aStacks.forEach((s) => this.solid(s.x, s.y, s.w, s.h));
    this.solid(this.aTable.x, this.aTable.y, this.aTable.w, this.aTable.h);
    this.solid(this.aCatalog.x - 22, this.aCatalog.y - 16, 44, 36);
  }

  private buildLabyrinthFixtures() {
    // hedge solids straight from LAB_GRID — horizontal runs merge into one rect
    for (let r = 0; r < LAB_ROWS; r++) {
      let run = -1;
      for (let c = 0; c <= LAB_COLS; c++) {
        const hedge = c < LAB_COLS && LAB_GRID[r][c] === "#";
        if (hedge && run < 0) run = c;
        if (!hedge && run >= 0) {
          this.solid(WALL + run * LAB_CW, WALL + r * LAB_CH, (c - run) * LAB_CW, LAB_CH);
          run = -1;
        }
      }
    }
  }

  private npc(
    pts: { x: number; y: number }[],
    color: string,
    hair: string
  ): Npc {
    return {
      x: pts[0].x,
      y: pts[0].y,
      pts,
      pi: 0,
      wait: 0,
      dir: 1,
      bob: 0,
      color,
      hair,
      speed: 70 + Math.random() * 28,
      r: 12,
    };
  }

  private resize() {
    this.W = this.cv.clientWidth;
    this.H = this.cv.clientHeight;
    this.cv.width = this.W * this.DPR;
    this.cv.height = this.H * this.DPR;
    this.ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
  }

  /* ----------------------------------------------------------- input */
  private bindInput() {
    addEventListener("resize", this.onResize);

    this.onKeyDown = (e) => {
      if (this.cb.isTyping()) return; // let the chat input own the keyboard
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)
      )
        e.preventDefault();
      const k = e.key.toLowerCase();
      this.keys[k] = true;
      if (k === "e") this.tryInteract();
      if (k === "escape") this.cb.onCloseOverlays();
      if (this.cb.isOverlayOpen()) return;
      if (k === " ") this.cb.onTogglePlay();
      if (k === "n") this.cb.onNext();
    };
    this.onKeyUp = (e) => {
      this.keys[e.key.toLowerCase()] = false;
    };
    addEventListener("keydown", this.onKeyDown);
    addEventListener("keyup", this.onKeyUp);

    this.onCanvasPointer = (e) => {
      if (this.cb.isOverlayOpen() || !this.started) return;
      this.moveTarget = {
        x: e.clientX - this.W / 2 + this.cam.x,
        y: e.clientY - this.H / 2 + this.cam.y,
      };
    };
    this.cv.addEventListener("pointerdown", this.onCanvasPointer);

    this.onStickDown = (e) => {
      this.stickId = e.pointerId;
      this.stick.setPointerCapture(e.pointerId);
      this.moveStick(e);
    };
    this.onStickMove = (e) => {
      if (e.pointerId === this.stickId) this.moveStick(e);
    };
    this.onStickUp = () => {
      this.stickId = null;
      this.stickVec = { x: 0, y: 0 };
      this.nub.style.transform = "translate(0,0)";
    };
    this.stick.addEventListener("pointerdown", this.onStickDown);
    this.stick.addEventListener("pointermove", this.onStickMove);
    this.stick.addEventListener("pointerup", this.onStickUp);

    this.onActDown = (e) => {
      e.preventDefault();
      this.tryInteract();
    };
    this.actBtn.addEventListener("pointerdown", this.onActDown);
  }

  private moveStick(e: PointerEvent) {
    const b = this.stick.getBoundingClientRect();
    let dx = e.clientX - (b.left + b.width / 2);
    let dy = e.clientY - (b.top + b.height / 2);
    const m = Math.hypot(dx, dy);
    const max = 42;
    if (m > max) {
      dx = (dx / m) * max;
      dy = (dy / m) * max;
    }
    this.nub.style.transform = `translate(${dx}px,${dy}px)`;
    this.stickVec = { x: dx / max, y: dy / max };
    this.moveTarget = null;
  }

  private tryInteract() {
    if (!this.started) return;
    if (this.cb.isOverlayOpen()) {
      this.cb.onCloseOverlays();
      return;
    }
    const z = this.activeZone;
    if (!z) return;
    if (z.type === "shelf") {
      if (z.shelf.data.ingest) this.cb.onOpenIngest();
      else this.cb.onBrowseShelf(z.shelf.data);
    } else if (z.type === "bar") {
      this.cb.onMastersPick();
    } else if (z.type === "deck") {
      this.cb.onShowDeck();
    } else if (z.type === "portal") {
      // Begin the pull-through charge — does NOT navigate yet. The charge runs in
      // update(): it completes only if the player stays in the zone the whole time
      // (cancelable by walking out), then fires onEnterRave.
      if (this.portalCharge === 0) this.portalCharge = 0.0001;
    } else if (z.type === "goldrecord") {
      // the curator-room gold record IS the attribution link — open it (new tab,
      // client-local). Audio/sync are untouched.
      if (z.url) this.cb.onOpenExternal(z.url);
    } else if (z.type === "door") {
      // Walk through to the next venue room. Audio is one shared stream and does
      // NOT change — this only swaps scenery. Start a fade-out; the swap happens
      // at mid-fade (see updateTransition).
      if (this.fade === 0 && !this.pendingRoom) {
        this.pendingRoom = { id: z.door.to, fromDoor: this.room.id };
        this.fade = 0.0001; // begin fade-out
      }
    }
  }

  /* ----------------------------------------------------------- loop */
  private loop = (now: number) => {
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    if (this.started) this.update(dt);
    this.render();
    this.raf = requestAnimationFrame(this.loop);
  };

  private update(dt: number) {
    this.updatePhaseLight(dt); // keep the sky melting even with an overlay open
    if (this.cb.isOverlayOpen()) {
      this.updatePrompt();
      return;
    }
    // while typing in chat OR mid-room-transition, freeze the avatar (keep the
    // world alive). Transition freeze stops drifting through the new room's walls.
    if (this.cb.isTyping() || this.transitioning()) {
      this.keys = {};
      this.moveTarget = null;
      this.stickVec = { x: 0, y: 0 };
      this.playerMoving = false;
    }
    let ix = 0;
    let iy = 0;
    const k = this.keys;
    if (k["w"] || k["arrowup"]) iy--;
    if (k["s"] || k["arrowdown"]) iy++;
    if (k["a"] || k["arrowleft"]) ix--;
    if (k["d"] || k["arrowright"]) ix++;
    if (this.stickVec.x || this.stickVec.y) {
      ix = this.stickVec.x;
      iy = this.stickVec.y;
    }
    const kbMoving = ix || iy;
    if (kbMoving) this.moveTarget = null;
    if (this.moveTarget) {
      const dx = this.moveTarget.x - this.player.x;
      const dy = this.moveTarget.y - this.player.y;
      const d = Math.hypot(dx, dy);
      if (d > 6) {
        ix = dx / d;
        iy = dy / d;
      } else this.moveTarget = null;
    }
    const m = Math.hypot(ix, iy) || 1;
    ix /= m;
    iy /= m;
    const moving =
      kbMoving || this.moveTarget || this.stickVec.x || this.stickVec.y;
    this.playerMoving = !!moving;
    const spd =
      (Math.hypot(this.stickVec.x, this.stickVec.y) || 1) * this.player.speed;
    this.moveEntity(this.player, ix * spd * dt, iy * spd * dt);
    if (ix) this.player.dir = ix > 0 ? 1 : -1;
    this.player.bob = moving ? this.player.bob + dt * 11 : 0;

    this.cam.x += (this.player.x - this.cam.x) * Math.min(1, dt * 6);
    this.cam.y += (this.player.y - this.cam.y) * Math.min(1, dt * 6);
    this.cam.x = clamp(
      this.cam.x,
      Math.min(this.W / 2, ROOM.w / 2),
      Math.max(ROOM.w - this.W / 2, ROOM.w / 2)
    );
    this.cam.y = clamp(
      this.cam.y,
      Math.min(this.H / 2, ROOM.h / 2),
      Math.max(ROOM.h - this.H / 2, ROOM.h / 2)
    );

    this.npcs.forEach((n) => this.updateNpc(n, dt));
    this.seated.forEach((s) => {
      s.t += dt;
      s.bob = Math.abs(Math.sin(s.t * 3.4)) * 3;
    });
    this.master.t += dt;
    this.master.bob = Math.sin(this.master.t * 2) * 1.3;
    this.updatePrompt();
    this.updatePortalCharge(dt);
    this.updateTransition(dt);
    this.updateGarden(dt);
    this.updateParticles(dt);
  }

  /**
   * Door fade/wipe transition. fade ramps 0→1 (out, screen darkens), the room
   * swaps at full dark, then 1→0 via a negative ramp (in). Music/sync are NEVER
   * touched here — only scenery + the player's room. Movement is frozen while the
   * screen is dark so you don't drift through the new room's walls.
   */
  private updateTransition(dt: number) {
    const RATE = 1 / 0.32; // ~320ms each way
    if (this.pendingRoom && this.fade > 0) {
      this.fade += dt * RATE;
      if (this.fade >= 1) {
        // mid-transition: actually enter the new room while fully dark
        this.enterRoom(this.pendingRoom.id, this.pendingRoom.fromDoor);
        this.pendingRoom = null;
        this.fade = -1; // now fade back IN
      }
    } else if (this.fade < 0) {
      this.fade += dt * RATE;
      if (this.fade >= 0) this.fade = 0;
    }
  }

  /** True while the screen is dark enough to freeze input (mid-transition). */
  private transitioning(): boolean {
    return this.pendingRoom !== null || this.fade !== 0;
  }

  /** Swap to a room: reset solids/zones, rebuild fixtures + shelves, spawn the
   *  player at the incoming door, retarget NPCs. SCENERY ONLY. */
  private enterRoom(roomId: string, fromRoom: string) {
    const next = ROOMS[roomId];
    if (!next) return;
    this.room = next;
    this.solids = [];
    this.zones = [];
    this.shelfObjs = [];
    this.buildStatics();
    this.setShelves(this.shelves);
    this.npcs = this.roomNpcs(next.id);
    const sp = next.spawns[fromRoom] ?? next.defaultSpawn;
    this.player.x = sp.x;
    this.player.y = sp.y;
    this.cam.x = sp.x;
    this.cam.y = sp.y;
    this.moveTarget = null;
    this.activeZone = null;
    this.lastPrompt = null;
    this.cb.onPrompt(null);
    this.cb.onRoomChange(next.id);
  }

  /** Per-room ambient NPC paths (presence-driven listeners render separately). */
  private roomNpcs(roomId: string): Npc[] {
    if (roomId === "garden") {
      return [
        this.npc([{ x: 360, y: 360 }, { x: 600, y: 320 }, { x: 560, y: 600 }, { x: 320, y: 560 }], "#7e9b5e", "#241812"),
      ];
    }
    if (roomId === "omakase") {
      // one quiet patron drifting along the counter
      return [
        this.npc([{ x: 380, y: 520 }, { x: 720, y: 520 }, { x: 560, y: 600 }], "#6a6f9b", "#1c130b"),
      ];
    }
    if (roomId === "berlin") {
      // two dancers working the floor (faster, looser paths) — the cavern has bodies
      return [
        this.npc([{ x: 470, y: 430 }, { x: 700, y: 380 }, { x: 640, y: 560 }, { x: 440, y: 520 }], "#9aa0a8", "#0c0c0e"),
        this.npc([{ x: 700, y: 520 }, { x: 520, y: 480 }, { x: 600, y: 360 }], "#b0444a", "#0c0c0e"),
      ];
    }
    if (roomId === "tearoom") return []; // stillness — no wanderers
    if (this.room.scene === "curator") return []; // the cat is the resident, not a wanderer
    if (roomId === "playa") {
      // two dancers orbiting the fire pit in the sand
      return [
        this.npc([{ x: 470, y: 380 }, { x: 680, y: 400 }, { x: 660, y: 540 }, { x: 470, y: 530 }], "#d98a5f", "#241812"),
        this.npc([{ x: 700, y: 470 }, { x: 540, y: 560 }, { x: 440, y: 460 }], "#7e9b8a", "#15151a"),
      ];
    }
    if (roomId === "warehouse") {
      // bodies on the floor — the warehouse never really emptied since '86
      return [
        this.npc([{ x: 450, y: 360 }, { x: 700, y: 330 }, { x: 660, y: 540 }, { x: 430, y: 500 }], "#b08a52", "#0c0c0e"),
        this.npc([{ x: 760, y: 480 }, { x: 540, y: 430 }, { x: 620, y: 320 }], "#8a4a40", "#0c0c0e"),
      ];
    }
    if (roomId === "rooftop") {
      // one listener drifting the terrace edge, watching the city
      return [
        this.npc([{ x: 320, y: 380 }, { x: 760, y: 360 }, { x: 640, y: 560 }], "#7a8ab0", "#1b1b22"),
      ];
    }
    if (roomId === "mattarello") {
      // the host, making the rounds between the table and the oven
      return [
        this.npc([{ x: 560, y: 330 }, { x: 880, y: 300 }, { x: 760, y: 560 }, { x: 480, y: 540 }], "#c97e5d", "#1c130b"),
      ];
    }
    if (roomId === "archive") {
      // one digger working the aisles
      return [
        this.npc([{ x: 280, y: 270 }, { x: 740, y: 270 }, { x: 740, y: 430 }, { x: 280, y: 430 }], "#6a7d5a", "#241812"),
      ];
    }
    if (roomId === "labyrinth") {
      // a lone wanderer pacing the entry corridor — proof someone else is lost too
      return [this.npc([{ x: 140, y: 74 }, { x: 990, y: 74 }], "#86b86a", "#15151a")];
    }
    return [
      this.npc([{ x: 340, y: 250 }, { x: 900, y: 250 }, { x: 900, y: 560 }, { x: 340, y: 560 }], "#b06a52", "#2a1c12"),
      this.npc([{ x: 430, y: 610 }, { x: 760, y: 600 }, { x: 840, y: 430 }], "#56877e", "#1b1b22"),
    ];
  }

  /** Garden ambient clocks: shishi-odoshi clack + fireflies (in updateParticles). */
  private updateGarden(dt: number) {
    if (this.room.scene !== "garden") return;
    this.shishi.t += dt;
    if (this.shishi.t > 6) {
      this.shishi.t = 0;
      this.shishi.clack = 1; // tips + clacks
    }
    if (this.shishi.clack > 0) this.shishi.clack = Math.max(0, this.shishi.clack - dt * 1.5);
    for (const f of this.fireflies) f.ph += dt * f.sp;
  }

  /**
   * Advance the rave-portal pull-through charge. EXPLICIT INTENT ONLY: the charge
   * only runs while the player is standing in the portal zone; the moment they
   * walk out (activeZone is no longer the portal) it aborts. On completion it
   * fires onEnterRave exactly once (host opens hallucinate.site in a NEW TAB).
   * Purely client-local — reads nothing shared.
   */
  private updatePortalCharge(dt: number) {
    if (this.portalCharge === 0) return;
    const onPortal = this.activeZone?.type === "portal";
    if (!onPortal || this.cb.isOverlayOpen()) {
      this.portalCharge = 0; // cancel — walked out / opened an overlay
      return;
    }
    this.portalCharge += dt * 1000;
    if (this.portalCharge >= PORTAL_CHARGE_MS) {
      this.portalCharge = 0;
      this.cb.onEnterRave();
    }
  }

  /** 0..1 charge progress, for the UI/vignette during pull-through. */
  portalChargeT(): number {
    return clamp(this.portalCharge / PORTAL_CHARGE_MS, 0, 1);
  }

  private moveEntity(e: { x: number; y: number; r?: number }, dx: number, dy: number) {
    e.x += dx;
    for (const s of this.solids) {
      if (this.circRect(e, s)) {
        e.x -= dx;
        break;
      }
    }
    e.y += dy;
    for (const s of this.solids) {
      if (this.circRect(e, s)) {
        e.y -= dy;
        break;
      }
    }
  }

  private circRect(c: { x: number; y: number; r?: number }, r: Rect) {
    const cx = clamp(c.x, r.x, r.x + r.w);
    const cy = clamp(c.y, r.y, r.y + r.h);
    return (c.x - cx) ** 2 + (c.y - cy) ** 2 < (c.r || 12) ** 2;
  }

  private updateNpc(n: Npc, dt: number) {
    if (n.wait > 0) {
      n.wait -= dt;
      n.bob = 0;
      return;
    }
    const t = n.pts[n.pi];
    const dx = t.x - n.x;
    const dy = t.y - n.y;
    const d = Math.hypot(dx, dy);
    if (d < 8) {
      n.pi = (n.pi + 1) % n.pts.length;
      n.wait = 0.6 + Math.random() * 1.8;
      return;
    }
    this.moveEntity(n, (dx / d) * n.speed * dt, (dy / d) * n.speed * dt);
    n.dir = dx > 0 ? 1 : -1;
    n.bob += dt * 9;
  }

  private updatePrompt() {
    let best: Zone | null = null;
    let bd = 1e9;
    for (const z of this.zones) {
      const d = Math.hypot(this.player.x - z.cx, this.player.y - z.cy);
      if (d < z.r && d < bd) {
        bd = d;
        best = z;
      }
    }
    this.activeZone = best;
    let html: string | null = null;
    if (best && !this.cb.isOverlayOpen()) {
      let s = "";
      if (best.type === "shelf")
        s = best.shelf.data.ingest
          ? `Pour in new records <b>新着</b>`
          : `Browse <b>${best.shelf.data.label}</b>`;
      if (best.type === "deck") s = `Drop in on the <b>house radio</b>`;
      if (best.type === "bar") s = `Ask the master for a <b>pour &amp; a pick</b>`;
      if (best.type === "portal") s = `Enter the <b>rave</b>?`;
      if (best.type === "goldrecord")
        s = best.label ?? `Give <b>Houseum</b> their flowers — open their YouTube ↗`;
      if (best.type === "door") s = `Step through to <b>${best.door.label}</b>`;
      html = s + ` <span class="key">E</span>`;
    }
    if (html !== this.lastPrompt) {
      this.lastPrompt = html;
      this.cb.onPrompt(html);
    }
  }

  private updateParticles(dt: number) {
    for (const d of this.dust) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.y < -10) {
        d.y = ROOM.h + 10;
        d.x = Math.random() * ROOM.w;
      }
    }
    for (const s of this.incense) {
      s.p += dt * 0.3;
      if (s.p > 1) s.p -= 1;
    }
    // portal bits spiral inward; faster while charging — then respawn at the rim
    const boost = 1 + this.portalChargeT() * 2.5;
    for (const b of this.portalBits) {
      b.a += b.spin * dt * boost;
      b.r -= b.fall * dt * boost;
      if (b.r <= 0.04) {
        b.r = 0.5 + Math.random() * 0.5;
        b.a = Math.random() * Math.PI * 2;
      }
    }
    // garden fireflies drift (slow lissajous), only relevant in the garden scene
    for (const f of this.fireflies) {
      f.x += Math.cos(f.ph) * 0.0006;
      f.y += Math.sin(f.ph * 1.3) * 0.0006;
      if (f.x < 0) f.x += 1; else if (f.x > 1) f.x -= 1;
      if (f.y < 0) f.y += 1; else if (f.y > 1) f.y -= 1;
    }
  }

  /* ----------------------------------------------------------- render */
  private render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.fillStyle = this.sceneBg();
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.save();
    ctx.translate(this.W / 2 - this.cam.x, this.H / 2 - this.cam.y);

    const kissa = this.room.scene === "kissa";
    switch (this.room.scene) {
      case "kissa":
        this.drawFloor();
        this.drawPlatform();
        this.drawWalls();
        this.drawBeams();
        this.drawKumikoWall();
        this.drawMoonWindow();
        this.drawSign();
        this.drawShelves();
        this.drawDeck();
        this.drawOnAir();
        this.drawSpeakers();
        this.drawBar();
        this.drawDecor();
        this.drawPortal();
        this.drawLanterns();
        this.drawNoren();
        break;
      case "garden":
        this.drawGarden();
        this.drawShelves(); // garden crates = dig spots (placeDigSpots)
        break;
      case "omakase":
        this.drawOmakase();
        this.drawShelves();
        break;
      case "berlin":
        this.drawBerlin();
        this.drawShelves();
        break;
      case "tearoom":
        this.drawTea();
        this.drawShelves();
        break;
      case "curator":
        this.drawCuratorRoom();
        this.drawShelves();
        break;
      case "playa":
        this.drawPlaya();
        this.drawShelves();
        break;
      case "warehouse":
        this.drawWarehouse();
        this.drawShelves();
        break;
      case "rooftop":
        this.drawRooftop();
        this.drawShelves();
        break;
      case "trattoria":
        this.drawTrattoria();
        this.drawShelves();
        break;
      case "labyrinth":
        this.drawLabyrinth();
        this.drawShelves();
        break;
      case "archive":
        this.drawArchive();
        this.drawShelves();
        break;
    }
    this.drawDoors();

    // entities, depth-sorted. Kissa-only ambient (master + seated pair) render
    // only in the kissa; NPCs + remote listeners are per-room.
    const ents: { y: number; d: () => void }[] = [
      { y: this.player.y, d: () => this.person(this.player, "#ffcf6b", "#241812", true) },
      ...this.npcs.map((n) => ({ y: n.y, d: () => this.person(n, n.color, n.hair) })),
      ...this.remoteEntities(), // other live listeners IN THIS ROOM (the lobby)
    ];
    if (kissa) {
      ents.push({
        y: this.master.y,
        d: () =>
          this.person(
            { x: this.master.x, y: this.master.y - this.master.bob, dir: -1, bob: 0 },
            this.master.color,
            this.master.hair
          ),
      });
      for (const s of this.seated)
        ents.push({
          y: s.y,
          d: () =>
            this.person({ x: s.x, y: s.y - s.bob, dir: 1, bob: 0 }, s.color, s.hair, false, true),
        });
    }
    ents.sort((a, b) => a.y - b.y).forEach((e) => e.d());

    this.drawDust();
    ctx.restore();
    this.drawPhaseLight(); // global time-of-day wash over the whole room
    this.drawVignette();
    this.drawTransitionFade();
  }

  /** Per-scene base background fill (behind the world, before the phase light). */
  private sceneBg(): string {
    switch (this.room.scene) {
      case "garden": return "#0c1018";
      case "berlin": return "#070708"; // near-black concrete void
      case "omakase": return "#0b0908";
      case "tearoom": return "#0c0b07";
      case "curator": return this.curatorCfg()?.palette.terrace ?? "#0c0820"; // cosmic
      case "playa": return "#0e1220"; // dusk over the sea
      case "warehouse": return "#0b0807"; // sodium-lit brick dark
      case "rooftop": return "#0a0e1a"; // city night
      case "trattoria": return "#140d08"; // candle-lit plaster
      case "labyrinth": return "#0a0f08"; // deep hedge green-black
      case "archive": return "#0a0d09"; // vault green-black
      default: return "#0a0604"; // kissa
    }
  }

  /** The curator config (palette / attribution / mascot) for the current room, if it
   *  is a curator tribute room — see lib/bar/curators.ts. */
  private curatorCfg(): CuratorRoom | undefined {
    return CURATORS[this.room.id];
  }

  /**
   * Composite the eased phase light over the finished frame (screen space). A
   * `multiply` layer recolours + darkens the room toward the phase hue, then a
   * `screen` layer adds its glow (dawn gold, ember, neon). This is why every room
   * transforms across the day — Berlin near-black at Afterhours, the Garden golden
   * at Sunrise — all from one data-driven layer (lib/bar/clock.ts).
   */
  private drawPhaseLight() {
    const ctx = this.ctx;
    const [mr, mg, mb, ma] = this.phaseMult;
    if (ma > 0.002) {
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = `rgba(${mr | 0},${mg | 0},${mb | 0},${ma})`;
      ctx.fillRect(0, 0, this.W, this.H);
    }
    const [gr, gg, gb, ga] = this.phaseGlow;
    if (ga > 0.002) {
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = `rgba(${gr | 0},${gg | 0},${gb | 0},${ga})`;
      ctx.fillRect(0, 0, this.W, this.H);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  /** The door fade overlay — a cool dark wash at full opacity mid-transition. */
  private drawTransitionFade() {
    const a = Math.abs(this.fade);
    if (a <= 0) return;
    const ctx = this.ctx;
    ctx.fillStyle = `rgba(8,7,14,${Math.min(1, a)})`;
    ctx.fillRect(0, 0, this.W, this.H);
  }

  private pool(x: number, y: number, r: number, c: string) {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, c);
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  private drawFloor() {
    const ctx = this.ctx;
    ctx.fillStyle = "#a8814f";
    ctx.fillRect(0, 0, ROOM.w, ROOM.h);
    for (let y = 0; y < ROOM.h; y += 44) {
      ctx.fillStyle = (y / 44) % 2 ? "#b08a55" : "#a47d49";
      ctx.fillRect(0, y, ROOM.w, 44);
      ctx.strokeStyle = "rgba(60,38,18,.28)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(ROOM.w, y);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,225,170,.05)";
    for (let i = 0; i < 60; i++) {
      const yy = Math.random() * ROOM.h;
      ctx.beginPath();
      ctx.moveTo(Math.random() * ROOM.w, yy);
      ctx.lineTo(Math.random() * ROOM.w, yy);
      ctx.stroke();
    }
    this.pool(this.deck.x + this.deck.w / 2, this.deck.y + 40, 300, "rgba(255,180,90,.12)");
    this.pool(this.bar.x, this.bar.y + this.bar.h / 2, 240, "rgba(255,160,90,.08)");
    this.pool(
      this.platform.x + this.platform.w / 2,
      this.platform.y + this.platform.h / 2,
      300,
      "rgba(255,200,120,.07)"
    );
  }

  private drawPlatform() {
    const ctx = this.ctx;
    const platform = this.platform;
    ctx.fillStyle = "#8a6d3f";
    this.roundRect(platform.x, platform.y, platform.w, platform.h, 6);
    ctx.fill();
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 2; j++) {
        const tx = platform.x + 12 + (i * (platform.w - 24)) / 3;
        const ty = platform.y + 12 + (j * (platform.h - 24)) / 2;
        ctx.fillStyle = (i + j) % 2 ? "#c3b079" : "#b7a36c";
        this.roundRect(tx, ty, (platform.w - 24) / 3 - 6, (platform.h - 24) / 2 - 6, 2);
        ctx.fill();
        ctx.strokeStyle = "#2c3a5a";
        ctx.lineWidth = 2;
        ctx.strokeRect(tx, ty, (platform.w - 24) / 3 - 6, (platform.h - 24) / 2 - 6);
      }
    ctx.fillStyle = "#5b3f23";
    this.roundRect(
      platform.x + platform.w / 2 - 34,
      platform.y + platform.h / 2 - 22,
      68,
      44,
      5
    );
    ctx.fill();
    (
      [
        [60, 150],
        [220, 90],
        [150, 200],
      ] as [number, number][]
    ).forEach(([dx, dy]) => {
      ctx.fillStyle = "#9a4b3a";
      this.roundRect(platform.x + dx - 15, platform.y + dy - 12, 30, 24, 5);
      ctx.fill();
    });
  }

  private drawWalls() {
    const ctx = this.ctx;
    ctx.fillStyle = "#3a2817";
    ctx.fillRect(0, 0, ROOM.w, WALL);
    ctx.fillRect(0, ROOM.h - WALL, ROOM.w, WALL);
    ctx.fillRect(0, 0, WALL, ROOM.h);
    ctx.fillRect(ROOM.w - WALL, 0, WALL, ROOM.h);
    const g = ctx.createLinearGradient(0, WALL, 0, WALL + 40);
    g.addColorStop(0, "rgba(0,0,0,.4)");
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.fillRect(0, WALL, ROOM.w, 40);
  }

  private drawBeams() {
    const ctx = this.ctx;
    ctx.strokeStyle = "rgba(40,26,14,.32)";
    ctx.lineWidth = 10;
    for (let x = 180; x < ROOM.w; x += 260) {
      ctx.beginPath();
      ctx.moveTo(x, WALL);
      ctx.lineTo(x, ROOM.h - WALL);
      ctx.stroke();
    }
  }

  private drawKumikoWall() {
    const ctx = this.ctx;
    const y0 = WALL;
    const h = 78;
    const x0 = 40;
    const x1 = ROOM.w - 40;
    ctx.fillStyle = "#6e4d2c";
    ctx.fillRect(x0, y0, x1 - x0, h);
    ctx.strokeStyle = "rgba(202,164,114,.5)";
    ctx.lineWidth = 2;
    for (let x = x0; x <= x1; x += 22) {
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y0 + h);
      ctx.stroke();
    }
    for (let y = y0; y <= y0 + h; y += 22) {
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(202,164,114,.22)";
    for (let x = x0; x <= x1; x += 44) {
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x + 22, y0 + h);
      ctx.moveTo(x + 22, y0);
      ctx.lineTo(x, y0 + h);
      ctx.stroke();
    }
  }

  private drawMoonWindow() {
    const ctx = this.ctx;
    // moved off-centre (top-right) now that the big HALLUCINATE sign owns the
    // top-centre of the wall
    const x = ROOM.w - 96;
    const y = WALL + 40;
    const r = 28;
    const g = ctx.createRadialGradient(x, y, 2, x, y, r);
    g.addColorStop(0, "#ffe6b0");
    g.addColorStop(1, "#caa06a");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 7);
    ctx.fill();
    ctx.strokeStyle = "#3a2817";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 7);
    ctx.stroke();
    ctx.strokeStyle = "rgba(58,40,23,.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - r, y);
    ctx.lineTo(x + r, y);
    ctx.moveTo(x, y - r);
    ctx.lineTo(x, y + r);
    ctx.stroke();
  }

  private drawSign() {
    const ctx = this.ctx;
    const x = ROOM.w / 2;
    const y = WALL + 58;
    // a big, clear hanging sign across the top — the bar's tagline
    const w = 384;
    const h = 70;
    ctx.fillStyle = "#3f2c19";
    this.roundRect(x - w / 2, y - h / 2, w, h, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,179,94,.55)";
    ctx.lineWidth = 2;
    this.roundRect(x - w / 2, y - h / 2, w, h, 8);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "800 34px 'Shippori Mincho', serif";
    ctx.fillStyle = "#ffce8c";
    ctx.shadowColor = "rgba(255,179,94,.7)";
    ctx.shadowBlur = 16;
    ctx.fillText("HALLUCINATE", x, y - 8);
    ctx.shadowBlur = 0;
    ctx.font = "11px 'DM Mono'";
    ctx.fillStyle = "rgba(214,69,47,.95)";
    ctx.fillText("音楽喫茶 · ONGAKU KISSA · A LISTENING BAR", x, y + 20);
  }

  private drawShelves() {
    const ctx = this.ctx;
    const st = crateStyleFor(this.room.scene); // bin material + disc + motif per room
    this.shelfObjs.forEach((o) => {
      const d = o.data;
      const col = d.color;
      const active =
        this.activeZone?.type === "shelf" && this.activeZone.shelf === o;
      const x0 = o.x - o.w / 2;
      const y0 = o.y - o.h / 2;

      if (d.ingest) {
        this.drawIngestCrate(o, col, active);
        return;
      }

      // the bin — a record crate in this room's material, with a lit top lip
      ctx.fillStyle = st.bin;
      this.roundRect(x0, y0, o.w, o.h, 5);
      ctx.fill();
      ctx.fillStyle = st.binEdge;
      this.roundRect(x0, y0, o.w, 6, 5);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,.4)";
      ctx.lineWidth = 1.5;
      this.roundRect(x0, y0, o.w, o.h, 5);
      ctx.stroke();

      // a row of record TOPS peeking out (the spines you flip through)
      const pad = 9;
      const innerW = o.w - pad * 2;
      const n = Math.max(7, Math.min(16, d.records.length + 4));
      const slotW = innerW / n;
      for (let i = 0; i < n; i++) {
        ctx.save();
        ctx.translate(x0 + pad + i * slotW, y0 + 8);
        ctx.rotate(-0.05 + (i % 3) * 0.015);
        ctx.fillStyle = i % 2 ? shade(col, -36) : shade(col, 16);
        ctx.fillRect(0, 0, slotW - 1.4, o.h * 0.42);
        ctx.fillStyle = "rgba(255,255,255,.10)";
        ctx.fillRect(0, 0, slotW - 1.4, 2);
        ctx.restore();
      }

      // the HERO record pulled to the front — a sleeve + a vinyl disc sliding out,
      // stamped with this room's motif
      this.drawHeroRecord(o, col, st);

      // the genre tag (a little placard in the browse aisle)
      this.drawCrateTag(o, d, col);

      if (active) {
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.shadowColor = col;
        ctx.shadowBlur = 16;
        this.roundRect(x0 - 3, y0 - 3, o.w + 6, o.h + 6, 7);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    });
  }

  /** The featured record on the front of a crate: a tilted sleeve with a vinyl disc
   *  half-pulled-out and the room's motif stamped on it. */
  private drawHeroRecord(o: ShelfObj, col: string, st: CrateStyle) {
    const ctx = this.ctx;
    const s = Math.min(o.h - 14, o.w * 0.42, 50); // sleeve size
    ctx.save();
    ctx.translate(o.x - s * 0.12, o.y + o.h * 0.12);
    ctx.rotate(-0.07);
    // vinyl disc sliding out to the right of the sleeve
    const dx = s * 0.46;
    ctx.fillStyle = "#0c0c0e";
    ctx.beginPath();
    ctx.arc(dx, 0, s * 0.46, 0, 7);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.06)";
    ctx.lineWidth = 1;
    for (let r = s * 0.18; r < s * 0.45; r += 4) {
      ctx.beginPath();
      ctx.arc(dx, 0, r, 0, 7);
      ctx.stroke();
    }
    ctx.fillStyle = st.disc; // centre label in the room accent
    ctx.beginPath();
    ctx.arc(dx, 0, s * 0.14, 0, 7);
    ctx.fill();
    ctx.fillStyle = "#0c0c0e";
    ctx.beginPath();
    ctx.arc(dx, 0, 1.6, 0, 7);
    ctx.fill();
    // the sleeve (square, 2-tone) over the disc
    const grad = ctx.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2);
    grad.addColorStop(0, shade(col, 30));
    grad.addColorStop(1, shade(col, -54));
    ctx.fillStyle = grad;
    this.roundRect(-s / 2, -s / 2, s, s, 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.4)";
    ctx.lineWidth = 1;
    this.roundRect(-s / 2, -s / 2, s, s, 2);
    ctx.stroke();
    this.drawMotif(st.motif, s, col);
    ctx.restore();
  }

  /** A small graphic stamped on a sleeve, themed to the room (sleeve-local coords). */
  private drawMotif(motif: CrateStyle["motif"], s: number, col: string) {
    const ctx = this.ctx;
    const a = "rgba(255,255,255,.6)";
    const cy = -s * 0.13;
    if (motif === "moon") {
      ctx.fillStyle = a;
      ctx.beginPath();
      ctx.arc(0, cy, s * 0.16, 0, 7);
      ctx.fill();
      ctx.fillStyle = shade(col, -54);
      ctx.beginPath();
      ctx.arc(s * 0.07, cy - s * 0.04, s * 0.15, 0, 7);
      ctx.fill();
    } else if (motif === "leaf") {
      ctx.fillStyle = a;
      ctx.save();
      ctx.translate(0, cy);
      ctx.rotate(0.5);
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.08, s * 0.2, 0, 0, 7);
      ctx.fill();
      ctx.restore();
    } else if (motif === "dot") {
      ctx.strokeStyle = a;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, cy, s * 0.15, 0, 7);
      ctx.stroke();
      ctx.fillStyle = a;
      ctx.beginPath();
      ctx.arc(0, cy, s * 0.045, 0, 7);
      ctx.fill();
    } else if (motif === "bar") {
      ctx.fillStyle = a;
      ctx.fillRect(-s * 0.3, cy - s * 0.04, s * 0.6, s * 0.08);
    } else if (motif === "holo") {
      // iridescent prism — three chromatic diamonds, slightly offset
      const cols = ["rgba(255,138,214,.85)", "rgba(138,255,214,.85)", "rgba(138,156,255,.85)"];
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = cols[i];
        const o = (i - 1) * 2;
        ctx.beginPath();
        ctx.moveTo(-s * 0.18 + o, cy);
        ctx.lineTo(o, cy - s * 0.18);
        ctx.lineTo(s * 0.18 + o, cy);
        ctx.lineTo(o, cy + s * 0.18);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      // ripple
      ctx.strokeStyle = a;
      ctx.lineWidth = 1.2;
      for (let r = s * 0.07; r < s * 0.24; r += s * 0.075) {
        ctx.beginPath();
        ctx.arc(0, cy + s * 0.06, r, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
    }
  }

  /** Genre placard beside a crate — name + record count, accent spine. */
  private drawCrateTag(o: ShelfObj, d: Shelf, col: string) {
    const ctx = this.ctx;
    const labelLeft = o.labelSide === "left";
    const tw = 90;
    const th = 26;
    const tx = labelLeft ? o.x - o.w / 2 - 12 - tw : o.x + o.w / 2 + 12;
    const ty = o.y - th / 2;
    ctx.fillStyle = "rgba(14,11,8,.72)";
    this.roundRect(tx, ty, tw, th, 5);
    ctx.fill();
    ctx.fillStyle = col;
    ctx.fillRect(tx, ty, 3, th); // accent spine
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = col;
    ctx.font = "700 9px 'DM Mono'";
    ctx.fillText(d.label.replace(/·.*/, "").trim().slice(0, 14), tx + 10, ty + 9);
    ctx.fillStyle = "rgba(241,230,210,.45)";
    ctx.font = "8px 'DM Mono'";
    ctx.fillText(`${d.records.length} records`, tx + 10, ty + 19);
  }

  /** The 新着 NEW ARRIVALS paste crate — a pulsing "drop your links here" bin. */
  private drawIngestCrate(o: ShelfObj, col: string, active: boolean) {
    const ctx = this.ctx;
    const x0 = o.x - o.w / 2;
    const y0 = o.y - o.h / 2;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 600);
    this.pool(o.x, o.y, o.w * 0.7, rgba(col, 0.1 + pulse * 0.06));
    ctx.fillStyle = "#2a160f";
    this.roundRect(x0, y0, o.w, o.h, 5);
    ctx.fill();
    ctx.strokeStyle = rgba(col, 0.55 + pulse * 0.35);
    ctx.lineWidth = 2;
    if (active) {
      ctx.shadowColor = col;
      ctx.shadowBlur = 16;
    }
    this.roundRect(x0, y0, o.w, o.h, 5);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = col;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "900 18px 'Shippori Mincho',serif";
    ctx.fillText("新着", o.x, o.y - 6);
    ctx.font = "8px 'DM Mono'";
    ctx.fillStyle = "rgba(241,230,210,.7)";
    ctx.fillText("＋ DROP LINKS", o.x, o.y + 13);
  }

  private drawDeck() {
    const ctx = this.ctx;
    const deck = this.deck;
    const playing = this.cb.isPlaying();
    ctx.fillStyle = "#5b3f23";
    this.roundRect(deck.x, deck.y, deck.w, deck.h, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,179,94,.28)";
    ctx.lineWidth = 2;
    ctx.stroke();
    [deck.x + 64, deck.x + deck.w - 64].forEach((tx) => {
      const ty = deck.y + deck.h / 2;
      ctx.fillStyle = "#241812";
      ctx.beginPath();
      ctx.arc(tx, ty, 33, 0, 7);
      ctx.fill();
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(playing ? (performance.now() / 1000) * 2 : 0);
      ctx.fillStyle = "#0b0b0b";
      ctx.beginPath();
      ctx.arc(0, 0, 27, 0, 7);
      ctx.fill();
      ctx.fillStyle = playing ? "#ffb35e" : "#3a2a1e";
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, 7);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.05)";
      for (let i = 11; i < 27; i += 4) {
        ctx.beginPath();
        ctx.arc(0, 0, i, 0, 7);
        ctx.stroke();
      }
      ctx.restore();
    });
    ctx.fillStyle = "#1c1410";
    this.roundRect(deck.x + deck.w / 2 - 20, deck.y + deck.h / 2 - 20, 40, 40, 4);
    ctx.fill();
    ctx.fillStyle = "rgba(241,230,210,.5)";
    ctx.font = "9px 'DM Mono'";
    ctx.textAlign = "center";
    ctx.fillText("聴 LISTENING DECK", deck.x + deck.w / 2, deck.y + 14);
  }

  private drawSpeakers() {
    const ctx = this.ctx;
    const playing = this.cb.isPlaying();
    this.speakers.forEach((s) => {
      ctx.fillStyle = "#5b3f23";
      this.roundRect(s.x, s.y, this.spkBox.w, this.spkBox.h, 4);
      ctx.fill();
      ctx.strokeStyle = "rgba(40,26,14,.6)";
      ctx.lineWidth = 2;
      ctx.strokeRect(s.x, s.y, this.spkBox.w, this.spkBox.h);
      ctx.fillStyle = "#1b1410";
      ctx.beginPath();
      ctx.arc(s.x + this.spkBox.w / 2, s.y + 26, 16, 0, 7);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s.x + this.spkBox.w / 2, s.y + 58, 10, 0, 7);
      ctx.fill();
      if (playing) {
        ctx.strokeStyle =
          "rgba(255,179,94," +
          (0.2 + 0.2 * Math.abs(Math.sin(performance.now() / 200))) +
          ")";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(
          s.x + this.spkBox.w / 2,
          s.y + 26,
          16 + 3 * Math.abs(Math.sin(performance.now() / 200)),
          0,
          7
        );
        ctx.stroke();
      }
    });
  }

  private drawBar() {
    const ctx = this.ctx;
    const bar = this.bar;
    ctx.fillStyle = "#5b3f23";
    this.roundRect(bar.x, bar.y, bar.w, bar.h, 8);
    ctx.fill();
    ctx.fillStyle = "#6e4d2c";
    ctx.fillRect(bar.x, bar.y, bar.w, 12);
    ctx.strokeStyle = "rgba(255,160,90,.25)";
    ctx.lineWidth = 2;
    this.roundRect(bar.x, bar.y, bar.w, bar.h, 8);
    ctx.stroke();
    ctx.fillStyle = "#caa472";
    this.roundRect(bar.x + 22, bar.y + 44, 30, 8, 2);
    ctx.fill();
    ctx.fillStyle = "#e8ddcb";
    ctx.beginPath();
    ctx.moveTo(bar.x + 30, bar.y + 30);
    ctx.lineTo(bar.x + 44, bar.y + 30);
    ctx.lineTo(bar.x + 37, bar.y + 44);
    ctx.fill();
    ctx.fillStyle = "#2a2a30";
    this.roundRect(bar.x + 62, bar.y + 34, 30, 22, 4);
    ctx.fill();
    for (let kk = 0; kk < 3; kk++) {
      const s = this.incense[kk];
      ctx.globalAlpha = (1 - s.p) * 0.4;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(
        bar.x + 77 + Math.sin((s.p + kk) * 6) * 4,
        bar.y + 30 - s.p * 24,
        2 - s.p,
        0,
        7
      );
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    (
      [
        [34, 150],
        [70, 200],
        [44, 250],
      ] as [number, number][]
    ).forEach(([dx, dy]) => {
      ctx.fillStyle = "#dfe6cf";
      ctx.beginPath();
      ctx.arc(bar.x + dx, bar.y + dy, 8, 0, 7);
      ctx.fill();
      ctx.fillStyle = "#7e9b5e";
      ctx.beginPath();
      ctx.arc(bar.x + dx, bar.y + dy, 5, 0, 7);
      ctx.fill();
    });
    ctx.fillStyle = "rgba(241,230,210,.5)";
    ctx.font = "9px 'DM Mono'";
    ctx.textAlign = "center";
    ctx.fillText("喫茶 POUR-OVER", bar.x + bar.w / 2, bar.y - 8);
  }

  private drawDecor() {
    const ctx = this.ctx;
    this.decor.forEach((d) => {
      if (d.t === "bamboo") {
        for (let i = -1; i < 2; i++) {
          ctx.strokeStyle = "#5b7d3f";
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.moveTo(d.x + i * 9, d.y + 18);
          ctx.lineTo(d.x + i * 9, d.y - 46);
          ctx.stroke();
          ctx.fillStyle = "#7e9b5e";
          for (let l = 0; l < 3; l++) {
            ctx.save();
            ctx.translate(d.x + i * 9, d.y - 30 - l * 8);
            ctx.rotate(i * 0.5);
            ctx.beginPath();
            ctx.ellipse(8, 0, 11, 3, 0, 0, 7);
            ctx.fill();
            ctx.restore();
          }
        }
      } else if (d.t === "maple") {
        ctx.fillStyle = "#3a2817";
        this.roundRect(d.x - 6, d.y, 12, 18, 2);
        ctx.fill();
        ctx.fillStyle = "#c0432f";
        for (let i = 0; i < 6; i++) {
          ctx.save();
          ctx.translate(d.x, d.y - 12);
          ctx.rotate(i * 1.05);
          ctx.beginPath();
          ctx.ellipse(0, -13, 7, 11, 0, 0, 7);
          ctx.fill();
          ctx.restore();
        }
      } else {
        ctx.fillStyle = "rgba(220,210,190,.5)";
        ctx.beginPath();
        ctx.ellipse(d.x, d.y, 26, 18, 0, 0, 7);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.4)";
        ctx.lineWidth = 1;
        for (let r = 6; r < 24; r += 5) {
          ctx.beginPath();
          ctx.ellipse(d.x, d.y, r, r * 0.7, 0, 0, 7);
          ctx.stroke();
        }
        ctx.fillStyle = "#555";
        ctx.beginPath();
        ctx.ellipse(d.x, d.y, 7, 5, 0, 0, 7);
        ctx.fill();
      }
    });
  }

  /**
   * The rave portal — a torii doorway with a cool electric rift, against the warm
   * hinoki. Animated shimmer + slow strobe, particles spiralling inward, a beat
   * pulse while a track plays (simulated 4/4 from the clock — we can't read the
   * cross-origin iframe's audio), and it intensifies during the pull-through
   * charge. Purely cosmetic + client-local.
   */
  private drawPortal() {
    const ctx = this.ctx;
    const now = performance.now();
    const cx = this.portal.cx;
    const cy = this.portal.cy;
    const fw = this.portal.w;
    const fh = this.portal.h;
    const charge = this.portalChargeT();

    // beat: simulated four-on-the-floor (~120bpm = 2Hz) only while playing; the
    // portal breathes calmly when paused. NOT tied to the real track position.
    const playing = this.cb.isPlaying();
    const beatPhase = (now / 500) % 1; // 2 beats/sec
    const beat = playing ? Math.pow(1 - beatPhase, 2.2) : 0; // sharp attack, decay
    const slowStrobe = 0.5 + 0.5 * Math.sin(now / 230);
    const intensity = (playing ? 0.55 + 0.45 * beat : 0.4) + charge * 0.6;
    const rw = fw * 0.34 * (1 + beat * 0.06 + charge * 0.12);
    const rh = fh * 0.42 * (1 + beat * 0.06 + charge * 0.12);

    // floor glow pool spilling into the warm room
    this.pool(cx + 20, cy + 8, 150 + charge * 90, `rgba(150,90,255,${0.1 + intensity * 0.12})`);

    // torii / doorway frame (dark timber, cool-rimmed)
    ctx.fillStyle = "#241a2e";
    this.roundRect(cx - fw / 2, cy - fh / 2, fw, fh, 6);
    ctx.fill();
    ctx.fillStyle = "#1a1322";
    this.roundRect(cx - fw / 2 + 9, cy - fh / 2 + 12, fw - 18, fh - 24, 5);
    ctx.fill();
    // torii cross-beam at the top
    ctx.fillStyle = "#2e2236";
    ctx.fillRect(cx - fw / 2 - 8, cy - fh / 2 - 10, fw + 16, 12);
    ctx.fillStyle = "#3a2b46";
    ctx.fillRect(cx - fw / 2 - 8, cy - fh / 2 - 18, fw + 16, 8);

    // the rift — radial cool gradient (blue → violet → magenta), strobing
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, Math.max(rw, rh));
    g.addColorStop(0, `rgba(${200 + slowStrobe * 55 | 0},${120 + beat * 80 | 0},255,${0.85 * intensity + 0.15})`);
    g.addColorStop(0.45, `rgba(150,70,235,${0.7 * intensity})`);
    g.addColorStop(0.8, `rgba(60,40,170,${0.5 * intensity})`);
    g.addColorStop(1, "rgba(20,16,60,0)");
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rw / rh, 1);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rh, 0, 7);
    ctx.fill();
    ctx.restore();

    // inward-spiralling particles
    for (const b of this.portalBits) {
      const px = cx + Math.cos(b.a) * rw * b.r;
      const py = cy + Math.sin(b.a) * rh * b.r;
      ctx.globalAlpha = (1 - b.r) * (0.5 + 0.5 * intensity);
      ctx.fillStyle = b.r > 0.5 ? "#7be0ff" : "#e57bff";
      ctx.beginPath();
      ctx.arc(px, py, 1.4 + (1 - b.r) * 1.6, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // bright core ring on the beat
    ctx.strokeStyle = `rgba(230,170,255,${0.35 + beat * 0.5})`;
    ctx.lineWidth = 1.5 + beat * 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rw / rh, 1);
    ctx.beginPath();
    ctx.arc(0, 0, rh * 0.5, 0, 7);
    ctx.stroke();
    ctx.restore();

    // neon-style sign above the doorway
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(180,90,255,.9)";
    ctx.shadowBlur = 8 + slowStrobe * 8 + charge * 12;
    ctx.fillStyle = "#d9a8ff";
    ctx.font = "900 13px 'Shippori Mincho',serif";
    ctx.fillText("音 ⚡", cx, cy - fh / 2 - 30);
    ctx.font = "7px 'DM Mono'";
    ctx.fillStyle = "#b98cff";
    ctx.fillText("HALLUCINATE · THE RAVE", cx, cy - fh / 2 - 16);
    ctx.shadowBlur = 0;

    // active-zone hint ring (matches the shelf highlight idiom)
    if (this.activeZone?.type === "portal") {
      ctx.strokeStyle = "rgba(200,120,255,.8)";
      ctx.lineWidth = 2;
      ctx.shadowColor = "#c878ff";
      ctx.shadowBlur = 14;
      this.roundRect(cx - fw / 2 - 4, cy - fh / 2 - 4, fw + 8, fh + 8, 8);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  /** The GARDEN — an open-air Japanese courtyard at dusk. Twilight sky, koi pond,
   *  raked gravel, red maple, bamboo, stone lanterns, a tsukubai basin, moss,
   *  drifting fireflies. Calm + meditative. Pure scenery (no audio touched). */
  private drawGarden() {
    const ctx = this.ctx;
    const now = performance.now();

    // twilight sky gradient (cool dusk) covering the whole ground plane
    const sky = ctx.createLinearGradient(0, 0, 0, ROOM.h);
    sky.addColorStop(0, "#2a2350");
    sky.addColorStop(0.4, "#3b3766");
    sky.addColorStop(0.7, "#5b4a6e");
    sky.addColorStop(1, "#6b5448");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, ROOM.w, ROOM.h);

    // a few stars + soft moon up high
    ctx.fillStyle = "rgba(255,255,255,.7)";
    for (let i = 0; i < 26; i++) {
      const sx = (i * 137.5) % ROOM.w;
      const sy = (i * 53.3) % 180;
      const tw = 0.4 + 0.4 * Math.sin(now / 700 + i);
      ctx.globalAlpha = tw * 0.7;
      ctx.fillRect(sx, sy, 1.6, 1.6);
    }
    ctx.globalAlpha = 1;
    const moon = ctx.createRadialGradient(ROOM.w - 150, 90, 4, ROOM.w - 150, 90, 46);
    moon.addColorStop(0, "#fff7e0");
    moon.addColorStop(1, "rgba(255,247,224,0)");
    ctx.fillStyle = moon;
    ctx.beginPath();
    ctx.arc(ROOM.w - 150, 90, 46, 0, 7);
    ctx.fill();

    // ground: mossy earth with a meandering stone path
    ctx.fillStyle = "#3f4a3a";
    ctx.fillRect(0, 150, ROOM.w, ROOM.h - 150);
    // moss dapples
    for (let i = 0; i < 60; i++) {
      const mx = (i * 197) % ROOM.w;
      const my = 170 + ((i * 311) % (ROOM.h - 190));
      ctx.fillStyle = i % 2 ? "rgba(110,140,80,.25)" : "rgba(70,95,55,.3)";
      ctx.beginPath();
      ctx.ellipse(mx, my, 18, 12, 0, 0, 7);
      ctx.fill();
    }
    // stone path (engawa entrance at left → curves to centre)
    ctx.fillStyle = "#8d8576";
    const steps: [number, number][] = [
      [70, 560], [150, 540], [230, 520], [320, 500], [410, 470], [500, 440], [560, 410],
    ];
    for (const [sx, sy] of steps) {
      ctx.beginPath();
      ctx.ellipse(sx, sy, 26, 16, 0, 0, 7);
      ctx.fill();
    }

    // karesansui (raked gravel) patch with concentric rake lines
    const g = this.gGravel;
    ctx.fillStyle = "#cdc6b4";
    this.roundRect(g.x, g.y, g.w, g.h, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(120,110,90,.4)";
    ctx.lineWidth = 1;
    for (let r = 14; r < g.w; r += 14) {
      ctx.beginPath();
      ctx.ellipse(g.x + g.w / 2, g.y + g.h / 2, r, r * 0.6, 0, 0, 7);
      ctx.stroke();
    }
    // a placed stone in the gravel
    ctx.fillStyle = "#6f6960";
    ctx.beginPath();
    ctx.ellipse(g.x + g.w / 2, g.y + g.h / 2, 16, 11, 0, 0, 7);
    ctx.fill();

    // koi pond — water with a faint ripple + a couple of koi
    const p = this.gKoi;
    const water = ctx.createRadialGradient(p.x, p.y, 6, p.x, p.y, p.r);
    water.addColorStop(0, "#3a5570");
    water.addColorStop(1, "#22384e");
    ctx.fillStyle = water;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.r, p.r * 0.7, 0, 0, 7);
    ctx.fill();
    ctx.strokeStyle = "rgba(180,210,230,.18)";
    ctx.lineWidth = 1.5;
    for (let r = 18; r < p.r; r += 22) {
      const rr = r + (Math.sin(now / 900 + r) * 3);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, rr, rr * 0.7, 0, 0, 7);
      ctx.stroke();
    }
    [0, 1].forEach((k) => {
      const ka = now / 2600 + k * Math.PI;
      const kx = p.x + Math.cos(ka) * p.r * 0.4;
      const ky = p.y + Math.sin(ka) * p.r * 0.28;
      ctx.fillStyle = k ? "#e7833f" : "#f2efe6";
      ctx.beginPath();
      ctx.ellipse(kx, ky, 9, 4, ka, 0, 7);
      ctx.fill();
    });

    // bamboo clusters (swaying)
    for (const b of this.gBamboo) {
      const sway = Math.sin(now / 1100 + b.x) * 4;
      for (let i = -1; i < 2; i++) {
        ctx.strokeStyle = "#5b7d3f";
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(b.x + i * 10, b.y + 22);
        ctx.lineTo(b.x + i * 10 + sway, b.y - 70);
        ctx.stroke();
        ctx.fillStyle = "#7e9b5e";
        for (let l = 0; l < 3; l++) {
          ctx.save();
          ctx.translate(b.x + i * 10 + sway * 0.7, b.y - 50 - l * 12);
          ctx.rotate(i * 0.5 + Math.sin(now / 900 + l) * 0.1);
          ctx.beginPath();
          ctx.ellipse(9, 0, 12, 3, 0, 0, 7);
          ctx.fill();
          ctx.restore();
        }
      }
    }

    // red maple (trunk is solid; canopy of leaves, a few drifting)
    const mp = this.gMaple;
    ctx.fillStyle = "#3a2817";
    this.roundRect(mp.x - 8, mp.y - 6, 16, 60, 3);
    ctx.fill();
    for (let i = 0; i < 22; i++) {
      const la = (i / 22) * Math.PI * 2;
      const lr = 28 + (i % 3) * 12;
      ctx.fillStyle = i % 2 ? "#c0432f" : "#d96a2c";
      ctx.save();
      ctx.translate(mp.x + Math.cos(la) * lr, mp.y - 36 + Math.sin(la) * lr * 0.8);
      ctx.rotate(la);
      ctx.beginPath();
      ctx.ellipse(0, 0, 9, 5, 0, 0, 7);
      ctx.fill();
      ctx.restore();
    }

    // stone lanterns (ishidoro) with a warm glow against the cool dusk
    for (const l of this.gLanterns) {
      this.pool(l.x, l.y - 4, 70, "rgba(255,170,80,.18)");
      ctx.fillStyle = "#6b6258";
      this.roundRect(l.x - 12, l.y - 8, 24, 26, 3);
      ctx.fill();
      ctx.fillStyle = "#caa06a";
      this.roundRect(l.x - 7, l.y - 4, 14, 12, 2); // lit firebox
      ctx.fill();
      ctx.fillStyle = "#5b534a";
      ctx.fillRect(l.x - 16, l.y - 12, 32, 5); // cap
    }

    // tsukubai water basin + shishi-odoshi (bamboo tips when it clacks)
    const ts = this.gBasin;
    ctx.fillStyle = "#566";
    ctx.beginPath();
    ctx.arc(ts.x, ts.y, 15, 0, 7);
    ctx.fill();
    ctx.fillStyle = "#2f4a58";
    ctx.beginPath();
    ctx.arc(ts.x, ts.y, 10, 0, 7);
    ctx.fill();
    const tip = this.shishi.clack > 0 ? -0.5 : 0.3 + Math.sin(now / 1400) * 0.05;
    ctx.strokeStyle = "#7a5a32";
    ctx.lineWidth = 5;
    ctx.save();
    ctx.translate(ts.x + 14, ts.y - 10);
    ctx.rotate(tip);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(26, 0);
    ctx.stroke();
    ctx.restore();

    // low cushions for listening
    for (const c of this.gCushions) {
      ctx.fillStyle = "#9a4b3a";
      this.roundRect(c.x - 16, c.y - 11, 32, 22, 6);
      ctx.fill();
    }

    // drifting fireflies (dusk glow motes)
    for (const f of this.fireflies) {
      const fx = f.x * ROOM.w;
      const fy = 180 + f.y * (ROOM.h - 220);
      const glow = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(f.ph));
      ctx.globalAlpha = glow;
      ctx.fillStyle = "#eaff9a";
      ctx.beginPath();
      ctx.arc(fx, fy, 2, 0, 7);
      ctx.fill();
      ctx.globalAlpha = glow * 0.3;
      ctx.beginPath();
      ctx.arc(fx, fy, 5, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // garden name plate
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "800 22px 'Shippori Mincho',serif";
    ctx.fillStyle = "#f1e6d2";
    ctx.shadowColor = "rgba(0,0,0,.5)";
    ctx.shadowBlur = 8;
    ctx.fillText("庭 · THE GARDEN", ROOM.w / 2, 70);
    ctx.shadowBlur = 0;
  }

  /** OMAKASE — the selector's counter. A long blonde-wood counter, one intimate row
   *  of stools, a glass neta case repurposed as a record display, precise per-seat
   *  lighting, indigo accents. Refined + hushed (the high-end sushi-counter of crates). */
  private drawOmakase() {
    const ctx = this.ctx;
    const now = performance.now();
    const c = this.oCounter;

    // dark polished-wood floor, a tighter grain than the kissa
    for (let y = 0; y < ROOM.h; y += 40) {
      ctx.fillStyle = (y / 40) % 2 ? "#2a1f15" : "#241a12";
      ctx.fillRect(0, y, ROOM.w, 40);
    }
    // precise lighting — a wash on the counter + a tight spotlight over each seat
    this.pool(c.x + c.w / 2, c.y + 26, 380, "rgba(255,212,150,.10)");
    for (const s of this.oStools) this.pool(s.x, s.y - 26, 66, "rgba(255,206,140,.16)");

    // walls (warm dark plaster)
    ctx.fillStyle = "#1c140d";
    ctx.fillRect(0, 0, ROOM.w, WALL);
    ctx.fillRect(0, ROOM.h - WALL, ROOM.w, WALL);
    ctx.fillRect(0, 0, WALL, ROOM.h);
    ctx.fillRect(ROOM.w - WALL, 0, WALL, ROOM.h);
    // indigo noren panels strung across the back wall (the omakase signature accent)
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? "#2c3a5a" : "#34456a";
      this.roundRect(120 + i * 116, WALL + 4, 92, 84, 3);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(241,230,210,.5)";
    ctx.font = "12px 'Shippori Mincho',serif";
    ctx.textAlign = "center";
    ctx.fillText("おまかせ", ROOM.w / 2, WALL + 50);

    // the blonde counter — warm light caught on its lifted front edge
    ctx.fillStyle = "#b98e56";
    this.roundRect(c.x, c.y, c.w, c.h, 8);
    ctx.fill();
    ctx.fillStyle = "#d8b27a";
    this.roundRect(c.x, c.y + c.h - 14, c.w, 14, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(60,40,22,.4)";
    ctx.lineWidth = 1;
    for (let gx = c.x + 30; gx < c.x + c.w; gx += 46) {
      ctx.beginPath();
      ctx.moveTo(gx, c.y + 4);
      ctx.lineTo(gx, c.y + c.h - 6);
      ctx.stroke();
    }

    // the glass neta case on the counter — a lit display of standing record sleeves
    const caseX = c.x + 28;
    const caseW = c.w - 56;
    ctx.fillStyle = "rgba(120,165,205,.16)";
    this.roundRect(caseX, c.y - 30, caseW, 30, 4);
    ctx.fill();
    for (let i = 0; i < 18; i++) {
      const rx = caseX + 12 + i * ((caseW - 24) / 18);
      ctx.save();
      ctx.translate(rx, c.y - 26);
      ctx.rotate(-0.06);
      ctx.fillStyle = i % 3 === 0 ? "#5a86a8" : i % 3 === 1 ? "#caa06a" : "#9bb36b";
      ctx.fillRect(0, 0, (caseW - 24) / 18 - 2, 22);
      ctx.restore();
    }
    ctx.strokeStyle = "rgba(180,212,240,.45)";
    ctx.lineWidth = 1.5;
    this.roundRect(caseX, c.y - 30, caseW, 30, 4);
    ctx.stroke();
    // a soft indigo glow line tracing the glass
    ctx.shadowColor = "rgba(90,134,168,.7)";
    ctx.shadowBlur = 8 + 3 * Math.sin(now / 700);
    ctx.beginPath();
    ctx.moveTo(caseX, c.y - 30);
    ctx.lineTo(caseX + caseW, c.y - 30);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // counter stools (passable)
    for (const s of this.oStools) {
      ctx.fillStyle = "#3a2a1a";
      ctx.beginPath();
      ctx.arc(s.x, s.y, 12, 0, 7);
      ctx.fill();
      ctx.fillStyle = "#4a3623";
      ctx.beginPath();
      ctx.arc(s.x, s.y - 2, 9, 0, 7);
      ctx.fill();
    }

    // name plate
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "800 22px 'Shippori Mincho',serif";
    ctx.fillStyle = "#e9d9bd";
    ctx.shadowColor = "rgba(0,0,0,.5)";
    ctx.shadowBlur = 8;
    ctx.fillText("御任せ · OMAKASE", ROOM.w / 2, ROOM.h - 70);
    ctx.shadowBlur = 0;
  }

  /** BERLIN — the Panorama-Bar room. Raw concrete + steel, cavernous + dim, drifting
   *  fog, a single sweeping strobe, a hint of red. DELIBERATELY breaks the Japanese
   *  palette (a different world). Cold + charged; the music stays house. */
  private drawBerlin() {
    const ctx = this.ctx;
    const now = performance.now();

    // raw concrete floor with expansion joints
    ctx.fillStyle = "#141417";
    ctx.fillRect(0, 0, ROOM.w, ROOM.h);
    ctx.strokeStyle = "rgba(0,0,0,.55)";
    ctx.lineWidth = 2;
    for (let x = 190; x < ROOM.w; x += 190) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, ROOM.h);
      ctx.stroke();
    }
    for (let y = 190; y < ROOM.h; y += 190) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(ROOM.w, y);
      ctx.stroke();
    }
    // concrete walls
    ctx.fillStyle = "#202024";
    ctx.fillRect(0, 0, ROOM.w, WALL);
    ctx.fillRect(0, ROOM.h - WALL, ROOM.w, WALL);
    ctx.fillRect(0, 0, WALL, ROOM.h);
    ctx.fillRect(ROOM.w - WALL, 0, WALL, ROOM.h);

    // a low red light bleed from the booth wall (the "hint of red")
    this.pool(ROOM.w / 2, 180, 460, "rgba(190,40,30,.10)");

    // the single sweeping strobe — a translucent cone pivoting from the booth,
    // with a hard white stutter-flash a couple times a bar (simulated, not the
    // real track — the cross-origin iframe's audio isn't readable, see drawPortal).
    const playing = this.cb.isPlaying();
    const pivotX = ROOM.w / 2;
    const pivotY = this.bBooth.y + this.bBooth.h;
    const sweep = Math.sin(now / 1400) * 0.9; // radians off vertical
    ctx.save();
    ctx.translate(pivotX, pivotY);
    ctx.rotate(sweep);
    const cone = ctx.createLinearGradient(0, 0, 0, 620);
    cone.addColorStop(0, `rgba(220,230,255,${playing ? 0.16 : 0.07})`);
    cone.addColorStop(1, "rgba(220,230,255,0)");
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-150, 620);
    ctx.lineTo(150, 620);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    const flash = playing ? Math.pow(Math.max(0, Math.sin(now / 470)), 22) : 0;
    if (flash > 0.02) {
      ctx.fillStyle = `rgba(255,255,255,${flash * 0.42})`;
      ctx.fillRect(0, 0, ROOM.w, ROOM.h);
    }

    // concrete pillars (with a cast shadow base)
    for (const p of this.bPillars) {
      ctx.fillStyle = "rgba(0,0,0,.4)";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 42, 22, 8, 0, 0, 7);
      ctx.fill();
      ctx.fillStyle = "#2c2c31";
      this.roundRect(p.x - 14, p.y - 40, 28, 82, 2);
      ctx.fill();
      ctx.fillStyle = "#37373d";
      ctx.fillRect(p.x - 14, p.y - 40, 7, 82); // lit edge
    }

    // the DJ booth on the far wall (steel + two red CDJ glints)
    const b = this.bBooth;
    ctx.fillStyle = "#26262b";
    this.roundRect(b.x, b.y, b.w, b.h, 5);
    ctx.fill();
    ctx.fillStyle = "#3a3a42";
    ctx.fillRect(b.x, b.y, b.w, 12);
    [b.x + 56, b.x + b.w - 56].forEach((dx) => {
      ctx.fillStyle = "#0c0c0e";
      ctx.beginPath();
      ctx.arc(dx, b.y + 44, 18, 0, 7);
      ctx.fill();
      ctx.fillStyle = playing ? "#e0433a" : "#5a2420";
      ctx.beginPath();
      ctx.arc(dx, b.y + 44, 4, 0, 7);
      ctx.fill();
    });

    // drifting low fog (soft cold blobs creeping across the floor)
    for (let i = 0; i < 6; i++) {
      const fx = ((i * 251 + now * 0.018) % (ROOM.w + 360)) - 180;
      const fy = 540 + Math.sin(now / 2100 + i * 1.7) * 36;
      this.pool(fx, fy, 170, "rgba(120,132,156,.05)");
    }

    // red neon room sign
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "900 30px 'Anton',sans-serif";
    ctx.shadowColor = "rgba(224,60,52,.9)";
    ctx.shadowBlur = 16 + 6 * Math.sin(now / 300);
    ctx.fillStyle = "#e0433a";
    ctx.fillText("BERLIN", ROOM.w / 2, b.y - 34);
    ctx.shadowBlur = 0;
    ctx.font = "9px 'DM Mono'";
    ctx.fillStyle = "rgba(224,120,116,.7)";
    ctx.fillText("地下 · NO PHOTOS · HOUSE ONLY", ROOM.w / 2, b.y - 14);
  }

  /** TEA ROOM — meditation / stillness. Tatami, a low chabudai tea table, a
   *  singing-bowl corner, incense, plants. The calmest room; the indoor-still
   *  counterpart to the Garden. */
  private drawTea() {
    const ctx = this.ctx;
    const now = performance.now();

    // warm dark-wood floor surround
    ctx.fillStyle = "#2a2014";
    ctx.fillRect(0, 0, ROOM.w, ROOM.h);

    // tatami mat field (green-straw mats with dark cloth borders), 5×3
    const mat = { x: 210, y: 210, w: 720, h: 420 };
    const cols = 5;
    const rows = 3;
    const mw = mat.w / cols;
    const mh = mat.h / rows;
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        ctx.fillStyle = (i + j) % 2 ? "#bdb47e" : "#b2a973";
        ctx.fillRect(mat.x + i * mw, mat.y + j * mh, mw, mh);
        ctx.strokeStyle = "#2c2417";
        ctx.lineWidth = 3;
        ctx.strokeRect(mat.x + i * mw, mat.y + j * mh, mw, mh);
        // fine straw weave
        ctx.strokeStyle = "rgba(120,110,70,.18)";
        ctx.lineWidth = 1;
        for (let k = mat.y + j * mh + 6; k < mat.y + (j + 1) * mh; k += 6) {
          ctx.beginPath();
          ctx.moveTo(mat.x + i * mw + 2, k);
          ctx.lineTo(mat.x + (i + 1) * mw - 2, k);
          ctx.stroke();
        }
      }

    // soft overhead light pool
    this.pool(ROOM.w / 2, 380, 400, "rgba(255,222,150,.09)");

    // walls — warm plaster sides, a softly-glowing shoji on the back wall
    ctx.fillStyle = "#1d150c";
    ctx.fillRect(0, ROOM.h - WALL, ROOM.w, WALL);
    ctx.fillRect(0, 0, WALL, ROOM.h);
    ctx.fillRect(ROOM.w - WALL, 0, WALL, ROOM.h);
    const sh = ctx.createLinearGradient(0, 0, 0, WALL + 70);
    sh.addColorStop(0, "#3a3326");
    sh.addColorStop(1, "#2a2014");
    ctx.fillStyle = sh;
    ctx.fillRect(0, 0, ROOM.w, WALL + 6);
    ctx.fillStyle = "rgba(243,230,200,.5)";
    for (let x = 80; x < ROOM.w - 60; x += 96) {
      this.roundRect(x, WALL + 2, 78, 66, 3);
      ctx.fill();
    }

    // the low chabudai tea table + teapot + two cups
    const t = this.tTable;
    ctx.fillStyle = "#3a2817";
    this.roundRect(t.x, t.y, t.w, t.h, 8);
    ctx.fill();
    ctx.fillStyle = "#4a3420";
    this.roundRect(t.x + 6, t.y + 6, t.w - 12, t.h - 12, 6);
    ctx.fill();
    ctx.fillStyle = "#1c2a30"; // iron teapot
    ctx.beginPath();
    ctx.arc(t.x + t.w / 2, t.y + t.h / 2, 14, 0, 7);
    ctx.fill();
    ctx.strokeStyle = "#2c3a40";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(t.x + t.w / 2 + 16, t.y + t.h / 2, 6, -1, 1.4);
    ctx.stroke();
    [[-34, -6], [34, 8]].forEach(([dx, dy]) => {
      ctx.fillStyle = "#d9cdb6";
      ctx.beginPath();
      ctx.arc(t.x + t.w / 2 + dx, t.y + t.h / 2 + dy, 6, 0, 7);
      ctx.fill();
    });
    // a thread of incense smoke rising off the table corner
    for (let kk = 0; kk < 6; kk++) {
      const s = this.incense[kk];
      ctx.globalAlpha = (1 - s.p) * 0.4;
      ctx.fillStyle = "#efe7d4";
      ctx.beginPath();
      ctx.arc(t.x + 12 + Math.sin((s.p + kk) * 6) * 5, t.y - s.p * 60, 2.2 - s.p * 1.5, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // singing-bowl corner — a bronze bowl on a cushion with a slow ring shimmer
    const bw = this.tBowl;
    ctx.fillStyle = "#7a2f2f";
    this.roundRect(bw.x - 22, bw.y - 6, 44, 22, 8);
    ctx.fill(); // cushion
    ctx.fillStyle = "#caa44a";
    ctx.beginPath();
    ctx.ellipse(bw.x, bw.y, 20, 11, 0, 0, 7);
    ctx.fill();
    ctx.fillStyle = "#8a6e2c";
    ctx.beginPath();
    ctx.ellipse(bw.x, bw.y, 14, 7, 0, 0, 7);
    ctx.fill();
    const ring = 0.5 + 0.5 * Math.sin(now / 1600);
    ctx.strokeStyle = `rgba(255,224,150,${0.1 + ring * 0.25})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(bw.x, bw.y, 24 + ring * 8, 13 + ring * 4, 0, 0, 7);
    ctx.stroke();

    // potted plants (ferns)
    for (const p of this.tPlants) {
      ctx.fillStyle = "#3a2817";
      this.roundRect(p.x - 11, p.y, 22, 16, 3);
      ctx.fill();
      ctx.strokeStyle = "#5b7d3f";
      ctx.lineWidth = 2;
      for (let f = -2; f <= 2; f++) {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.quadraticCurveTo(p.x + f * 12, p.y - 22, p.x + f * 20, p.y - 30 + Math.abs(f) * 8);
        ctx.stroke();
      }
    }

    // zabuton cushions flanking the table
    [[t.x - 70, t.y + t.h / 2], [t.x + t.w + 70, t.y + t.h / 2]].forEach(([cx2, cy2]) => {
      ctx.fillStyle = "#7e6fb0";
      this.roundRect(cx2 - 22, cy2 - 16, 44, 32, 8);
      ctx.fill();
    });

    // name plate
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "800 22px 'Shippori Mincho',serif";
    ctx.fillStyle = "#efe2c8";
    ctx.shadowColor = "rgba(0,0,0,.5)";
    ctx.shadowBlur = 8;
    ctx.fillText("茶室 · TEA ROOM", ROOM.w / 2, ROOM.h - 64);
    ctx.shadowBlur = 0;
  }

  /** Shared name-plate at the bottom of a scene. */
  private namePlate(text: string, color = "#efe2c8") {
    const ctx = this.ctx;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "800 22px 'Shippori Mincho',serif";
    ctx.fillStyle = color;
    ctx.shadowColor = "rgba(0,0,0,.5)";
    ctx.shadowBlur = 8;
    ctx.fillText(text, ROOM.w / 2, ROOM.h - 64);
    ctx.shadowBlur = 0;
  }

  /** LA PLAYA — dusk beach. Sand field, palms, a fire pit, torches, and the sea
   *  rolling along the bottom of the room (animated surf foam). */
  private drawPlaya() {
    const ctx = this.ctx;
    const now = performance.now();

    // sand
    ctx.fillStyle = "#a8906a";
    ctx.fillRect(0, 0, ROOM.w, this.pShoreY);
    ctx.fillStyle = "rgba(0,0,0,.12)";
    for (let i = 0; i < 80; i++) {
      const sx = (i * 137) % ROOM.w;
      const sy = (i * 211) % this.pShoreY;
      ctx.fillRect(sx, sy, 2, 2); // sand speckle (stable pseudo-random)
    }
    // wet shoreline gradient + sea
    const sea = ctx.createLinearGradient(0, this.pShoreY - 40, 0, ROOM.h);
    sea.addColorStop(0, "#8a7a5c");
    sea.addColorStop(0.25, "#23405a");
    sea.addColorStop(1, "#0c1a2c");
    ctx.fillStyle = sea;
    ctx.fillRect(0, this.pShoreY - 40, ROOM.w, ROOM.h - this.pShoreY + 40);
    // three animated foam lines breathing up the beach
    for (let k = 0; k < 3; k++) {
      const ph = now / 2400 + k * 2.1;
      const rise = Math.sin(ph) * 14;
      ctx.strokeStyle = `rgba(235,242,240,${0.18 + 0.12 * Math.sin(ph + 1)})`;
      ctx.lineWidth = 2 + k;
      ctx.beginPath();
      for (let x = 0; x <= ROOM.w; x += 24) {
        const y = this.pShoreY - 6 + k * 16 + rise + Math.sin(x / 90 + ph * 2) * 5;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // moon glint path on the water
    this.pool(ROOM.w / 2 + 180, ROOM.h - 60, 180, "rgba(220,230,255,.08)");

    // palms — trunk + a crown of fronds
    for (const p of this.pPalms) {
      ctx.strokeStyle = "#5a4630";
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + 14);
      ctx.quadraticCurveTo(p.x + 10, p.y - 40, p.x + 4, p.y - 78);
      ctx.stroke();
      ctx.strokeStyle = "#3e6a44";
      ctx.lineWidth = 5;
      for (let f = 0; f < 6; f++) {
        const a = (f / 6) * Math.PI * 2 + Math.sin(now / 1800 + p.x) * 0.06;
        ctx.beginPath();
        ctx.moveTo(p.x + 4, p.y - 78);
        ctx.quadraticCurveTo(
          p.x + 4 + Math.cos(a) * 34,
          p.y - 78 + Math.sin(a) * 18 - 14,
          p.x + 4 + Math.cos(a) * 62,
          p.y - 78 + Math.sin(a) * 30 + 6
        );
        ctx.stroke();
      }
      this.pool(p.x, p.y + 10, 40, "rgba(0,0,0,.18)"); // ground shadow
    }

    // fire pit — stone ring + flicker + a big warm pool
    const f = this.pFire;
    const fl = 0.7 + 0.3 * Math.sin(now / 90) * Math.sin(now / 230);
    this.pool(f.x, f.y, 190 + fl * 26, `rgba(255,150,70,${0.16 + fl * 0.08})`);
    ctx.fillStyle = "#564a3e";
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(f.x + Math.cos(a) * 26, f.y + Math.sin(a) * 17, 6, 0, 7);
      ctx.fill();
    }
    ctx.fillStyle = `rgba(255,${140 + fl * 60},60,.9)`;
    ctx.beginPath();
    ctx.ellipse(f.x, f.y - 6 - fl * 6, 9, 14 + fl * 8, 0, 0, 7);
    ctx.fill();
    ctx.fillStyle = "rgba(255,235,170,.9)";
    ctx.beginPath();
    ctx.ellipse(f.x, f.y - 4, 4, 7 + fl * 4, 0, 0, 7);
    ctx.fill();

    // torches
    for (const t of this.pTorches) {
      ctx.fillStyle = "#4a3a26";
      ctx.fillRect(t.x - 3, t.y - 26, 6, 32);
      const tf = 0.6 + 0.4 * Math.sin(now / 140 + t.x);
      ctx.fillStyle = `rgba(255,${150 + tf * 70},70,.95)`;
      ctx.beginPath();
      ctx.ellipse(t.x, t.y - 32, 5, 9 + tf * 4, 0, 0, 7);
      ctx.fill();
      this.pool(t.x, t.y - 20, 70, `rgba(255,160,80,${0.10 + tf * 0.05})`);
    }

    // driftwood benches (passable)
    ctx.fillStyle = "#7a6a4e";
    this.roundRect(430, 540, 90, 14, 7);
    ctx.fill();
    this.roundRect(640, 530, 80, 14, 7);
    ctx.fill();

    this.namePlate("LA PLAYA · 波", "#ffd9a8");
  }

  /** WAREHOUSE — Chicago, where house was born. Brick, steel shutters, a wall of
   *  speakers, sodium light, drifting smoke, and a 909 on a pedestal. */
  private drawWarehouse() {
    const ctx = this.ctx;
    const now = performance.now();

    // poured-concrete floor with expansion joints + tire scuffs
    ctx.fillStyle = "#262220";
    ctx.fillRect(0, 0, ROOM.w, ROOM.h);
    ctx.strokeStyle = "rgba(0,0,0,.35)";
    ctx.lineWidth = 2;
    for (let x = 160; x < ROOM.w; x += 240) {
      ctx.beginPath();
      ctx.moveTo(x, WALL);
      ctx.lineTo(x, ROOM.h - WALL);
      ctx.stroke();
    }
    for (let y = 200; y < ROOM.h; y += 220) {
      ctx.beginPath();
      ctx.moveTo(WALL, y);
      ctx.lineTo(ROOM.w - WALL, y);
      ctx.stroke();
    }

    // brick walls
    ctx.fillStyle = "#3a2a24";
    ctx.fillRect(0, 0, ROOM.w, WALL + 40);
    ctx.fillRect(0, ROOM.h - WALL, ROOM.w, WALL);
    ctx.fillRect(0, 0, WALL, ROOM.h);
    ctx.fillRect(ROOM.w - WALL, 0, WALL, ROOM.h);
    ctx.strokeStyle = "rgba(0,0,0,.3)";
    ctx.lineWidth = 1;
    for (let y = 8; y < WALL + 40; y += 12)
      for (let x = (y % 24 ? 0 : 20); x < ROOM.w; x += 40)
        ctx.strokeRect(x, y, 40, 12);

    // the speaker wall / stage along the back
    const s = this.wStage;
    ctx.fillStyle = "#1a1614";
    ctx.fillRect(s.x, s.y, s.w, s.h);
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 2; j++) {
        const bx = s.x + 14 + i * 72;
        const by = s.y + 8 + j * 36;
        ctx.fillStyle = "#0e0c0b";
        ctx.fillRect(bx, by, 62, 30);
        const womp = this.playingPulse(now, i + j);
        ctx.strokeStyle = `rgba(255,140,80,${0.25 + womp * 0.45})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(bx + 20, by + 15, 8 + womp * 2, 0, 7);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(bx + 45, by + 15, 5 + womp * 1.5, 0, 7);
        ctx.stroke();
      }

    // steel pillars
    for (const p of this.wPillars) {
      ctx.fillStyle = "#34302e";
      ctx.fillRect(p.x - 14, p.y - 40, 28, 80);
      ctx.fillStyle = "#4a4542";
      ctx.fillRect(p.x - 14, p.y - 40, 6, 80);
      ctx.fillStyle = "rgba(214,170,60,.5)"; // hazard band
      ctx.fillRect(p.x - 14, p.y + 26, 28, 8);
    }

    // the TR-909 shrine — pedestal + the relic, one spotlight on it
    const n = this.w909;
    this.pool(n.x, n.y - 8, 90, "rgba(255,180,90,.14)");
    ctx.fillStyle = "#3a3430";
    ctx.fillRect(n.x - 24, n.y - 16, 48, 36);
    ctx.fillStyle = "#d8d2c8";
    ctx.fillRect(n.x - 20, n.y - 30, 40, 18);
    ctx.fillStyle = "#e0763a";
    ctx.fillRect(n.x - 18, n.y - 27, 10, 4);
    ctx.fillStyle = "#1a1a1a";
    for (let i = 0; i < 8; i++) ctx.fillRect(n.x - 18 + i * 4.6, n.y - 19, 3, 5);

    // sodium light pools + drifting smoke
    this.pool(570, 420, 320, "rgba(255,160,60,.07)");
    for (const sm of this.wSmoke) {
      const x = ((sm.x + now / 60000) % 1) * ROOM.w;
      const y = WALL + sm.y * (ROOM.h - 2 * WALL);
      ctx.globalAlpha = 0.05 + 0.04 * Math.sin(now / 3000 + sm.ph);
      ctx.fillStyle = "#c8c2ba";
      ctx.beginPath();
      ctx.arc(x, y, sm.s, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // painted floor letters, half worn away
    ctx.font = "900 64px 'Anton',sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(216,170,60,.10)";
    ctx.fillText("HOUSE IS A FEELING", 570, 470);

    this.namePlate("WAREHOUSE · 倉庫", "#ffb38c");
  }

  /** A small playback-synced pulse helper (mirrors the kissa speaker pulse). */
  private playingPulse(now: number, seed: number): number {
    if (!this.cb.isPlaying()) return 0.15;
    return 0.5 + 0.5 * Math.sin(now / 180 + seed * 1.7);
  }

  /** SKYLINE — the rooftop. City far below beyond the parapet, string lights,
   *  planters, a bar cart, melodic deep at altitude. */
  private drawRooftop() {
    const ctx = this.ctx;
    const now = performance.now();

    // night sky + skyline above the parapet
    const sky = ctx.createLinearGradient(0, 0, 0, this.rRailY);
    sky.addColorStop(0, "#0a0e1a");
    sky.addColorStop(0.7, "#16203a");
    sky.addColorStop(1, "#2a3050");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, ROOM.w, this.rRailY);
    for (const st of this.cStars.slice(0, 40)) {
      ctx.globalAlpha = 0.3 + 0.4 * Math.abs(Math.sin(now / 1400 + st.ph));
      ctx.fillStyle = "#cfe0ff";
      ctx.fillRect(st.x * ROOM.w, st.y * (this.rRailY - 90), st.s, st.s);
    }
    ctx.globalAlpha = 1;
    // buildings — stable pseudo-random strip with lit windows
    let bx = -10;
    for (const b of this.rSky) {
      const bh = b.h;
      ctx.fillStyle = "#0c1220";
      ctx.fillRect(bx, this.rRailY - bh, b.w, bh);
      ctx.fillStyle = "rgba(255,214,140,.55)";
      for (let wy = 8; wy < bh - 6; wy += 14)
        for (let wx = 4; wx < b.w - 6; wx += 12)
          if ((wx * 31 + wy * 17 + b.win) % 11 < 2) ctx.fillRect(bx + wx, this.rRailY - bh + wy, 4, 6);
      bx += b.w + 6;
      if (bx > ROOM.w) break;
    }

    // parapet
    ctx.fillStyle = "#2c3a4a";
    ctx.fillRect(-40, this.rRailY - 9, ROOM.w + 80, 18);
    ctx.fillStyle = "#46586c";
    ctx.fillRect(-40, this.rRailY - 9, ROOM.w + 80, 4);

    // terrace deck — big pavers
    ctx.fillStyle = "#333a42";
    ctx.fillRect(0, this.rRailY + 9, ROOM.w, ROOM.h - this.rRailY - 9);
    ctx.strokeStyle = "rgba(0,0,0,.3)";
    ctx.lineWidth = 2;
    for (let x = 60; x < ROOM.w; x += 130) {
      ctx.beginPath();
      ctx.moveTo(x, this.rRailY + 9);
      ctx.lineTo(x, ROOM.h - WALL);
      ctx.stroke();
    }
    for (let y = this.rRailY + 80; y < ROOM.h - WALL; y += 110) {
      ctx.beginPath();
      ctx.moveTo(WALL, y);
      ctx.lineTo(ROOM.w - WALL, y);
      ctx.stroke();
    }

    // two swooping strings of bulbs across the terrace
    for (let k = 0; k < 2; k++) {
      const y0 = this.rRailY + 40 + k * 26;
      ctx.strokeStyle = "rgba(20,24,30,.8)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(80, y0);
      ctx.quadraticCurveTo(ROOM.w / 2, y0 + 70, ROOM.w - 80, y0);
      ctx.stroke();
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const lx = 80 + (ROOM.w - 160) * t;
        const ly = y0 + 2 * (1 - t) * t * 2 * 70 + 6;
        const tw = 0.6 + 0.4 * Math.sin(now / 900 + i + k * 3);
        ctx.fillStyle = `rgba(255,214,140,${0.5 + tw * 0.4})`;
        ctx.beginPath();
        ctx.arc(lx, ly, 2.5, 0, 7);
        ctx.fill();
        this.pool(lx, ly, 26, `rgba(255,200,120,${0.04 + tw * 0.03})`);
      }
    }

    // planters with night grasses
    for (const p of this.rPlanters) {
      ctx.fillStyle = "#26303a";
      this.roundRect(p.x - 24, p.y - 14, 48, 30, 5);
      ctx.fill();
      ctx.strokeStyle = "#5a7a5a";
      ctx.lineWidth = 2;
      for (let g = -3; g <= 3; g++) {
        ctx.beginPath();
        ctx.moveTo(p.x + g * 5, p.y - 12);
        ctx.quadraticCurveTo(p.x + g * 9, p.y - 34, p.x + g * 12, p.y - 44 + Math.abs(g) * 4);
        ctx.stroke();
      }
    }

    // bar cart
    const c = this.rCart;
    ctx.fillStyle = "#3e4a56";
    this.roundRect(c.x - 26, c.y - 14, 52, 30, 5);
    ctx.fill();
    ctx.fillStyle = "#caa44a";
    ctx.fillRect(c.x - 18, c.y - 22, 8, 10);
    ctx.fillRect(c.x - 4, c.y - 24, 8, 12);
    ctx.fillRect(c.x + 10, c.y - 21, 8, 9);

    this.namePlate("SKYLINE · 空", "#bfe0ff");
  }

  /** IL MATTARELLO — the tribute trattoria. Terracotta tiles, gallery walls, a
   *  wood-fired oven, one long communal table, flour dust in the light.
   *  "Handmade. Unhurried. Baja." */
  private drawTrattoria() {
    const ctx = this.ctx;
    const now = performance.now();

    // terracotta tile floor
    ctx.fillStyle = "#8a5638";
    ctx.fillRect(0, 0, ROOM.w, ROOM.h);
    ctx.strokeStyle = "rgba(40,20,10,.35)";
    ctx.lineWidth = 2;
    const tile = 86;
    for (let x = 0; x < ROOM.w; x += tile) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, ROOM.h);
      ctx.stroke();
    }
    for (let y = 0; y < ROOM.h; y += tile) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(ROOM.w, y);
      ctx.stroke();
    }
    // warm wash where the candles live
    this.pool(570, 430, 380, "rgba(255,190,120,.10)");

    // plaster walls
    ctx.fillStyle = "#2a1c12";
    ctx.fillRect(0, ROOM.h - WALL, ROOM.w, WALL);
    ctx.fillRect(0, 0, WALL, ROOM.h);
    ctx.fillRect(ROOM.w - WALL, 0, WALL, ROOM.h);
    const pw = ctx.createLinearGradient(0, 0, 0, WALL + 92);
    pw.addColorStop(0, "#4a3424");
    pw.addColorStop(1, "#3a281a");
    ctx.fillStyle = pw;
    ctx.fillRect(0, 0, ROOM.w, WALL + 86);

    // GALLERY WALL — small canvases, each its own little colour world (art vibes)
    const art = ["#c97e5d", "#7e9b8a", "#d8b27a", "#5a86a8", "#b06a52", "#cfc8b8"];
    art.forEach((col, i) => {
      const ax = 120 + i * 110;
      if (ax > 470 && ax < 680) return; // leave room over the archive door
      ctx.fillStyle = "#1c130b";
      ctx.fillRect(ax - 3, WALL + 8 - 3, 62, 50);
      ctx.fillStyle = col;
      ctx.fillRect(ax, WALL + 8, 56, 44);
      ctx.fillStyle = "rgba(0,0,0,.25)";
      ctx.beginPath();
      ctx.arc(ax + 28 + (i % 3) * 6 - 6, WALL + 30, 10 + (i % 2) * 6, 0, 7);
      ctx.fill();
    });
    // the credo, hand-painted on the plaster
    ctx.font = "600 17px 'Shippori Mincho',serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(243,221,184,.85)";
    ctx.fillText("Handmade. Unhurried. Baja.", 820, WALL + 34);

    // the wood-fired oven — brick dome, ember mouth, slow smoke
    const o = this.mOven;
    ctx.fillStyle = "#5a3a28";
    this.roundRect(o.x, o.y + 24, o.w, o.h - 24, 8);
    ctx.fill();
    ctx.fillStyle = "#6e4a32";
    ctx.beginPath();
    ctx.ellipse(o.x + o.w / 2, o.y + 30, o.w / 2, 30, 0, Math.PI, 0);
    ctx.fill();
    const emb = 0.6 + 0.4 * Math.sin(now / 160);
    ctx.fillStyle = "#180c06";
    ctx.beginPath();
    ctx.ellipse(o.x + o.w / 2, o.y + 62, 26, 18, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = `rgba(255,${120 + emb * 80},50,.9)`;
    ctx.beginPath();
    ctx.ellipse(o.x + o.w / 2, o.y + 62, 18, 11, 0, Math.PI, 0);
    ctx.fill();
    this.pool(o.x + o.w / 2, o.y + 70, 110, `rgba(255,150,70,${0.12 + emb * 0.06})`);
    for (let kk = 0; kk < 4; kk++) {
      const sp = this.incense[kk + 6];
      ctx.globalAlpha = (1 - sp.p) * 0.3;
      ctx.fillStyle = "#d8d2c8";
      ctx.beginPath();
      ctx.arc(o.x + o.w / 2 + Math.sin((sp.p + kk) * 5) * 6, o.y + 14 - sp.p * 50, 2.4 - sp.p * 1.6, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // the long communal table — linen runner, candles, plates
    const t = this.mTable;
    ctx.fillStyle = "#6e4a2e";
    this.roundRect(t.x, t.y, t.w, t.h, 6);
    ctx.fill();
    ctx.fillStyle = "#efe2c8";
    ctx.fillRect(t.x + 14, t.y + 10, t.w - 28, t.h - 20);
    for (let i = 0; i < 4; i++) {
      const px = t.x + 40 + i * 66;
      ctx.fillStyle = "#d8cdb8";
      ctx.beginPath();
      ctx.arc(px, t.y + t.h / 2, 11, 0, 7);
      ctx.fill();
      ctx.fillStyle = "#b8a888";
      ctx.beginPath();
      ctx.arc(px, t.y + t.h / 2, 6, 0, 7);
      ctx.fill();
    }
    for (let i = 0; i < 3; i++) {
      const cxx = t.x + 70 + i * 70;
      const cf = 0.6 + 0.4 * Math.sin(now / 130 + i * 2.2);
      ctx.fillStyle = "#e8dcc8";
      ctx.fillRect(cxx - 2, t.y - 10, 4, 12);
      ctx.fillStyle = `rgba(255,${180 + cf * 60},90,.95)`;
      ctx.beginPath();
      ctx.ellipse(cxx, t.y - 14, 2.5, 5 + cf * 2, 0, 0, 7);
      ctx.fill();
      this.pool(cxx, t.y - 8, 46, `rgba(255,190,110,${0.08 + cf * 0.05})`);
    }

    // pasta station — flour sacks + the namesake rolling pin (il mattarello)
    for (const sft of this.mFlour) {
      ctx.fillStyle = "#cfc4ac";
      this.roundRect(sft.x - 16, sft.y - 10, 32, 24, 6);
      ctx.fill();
      ctx.fillStyle = "rgba(90,70,50,.5)";
      ctx.fillRect(sft.x - 9, sft.y - 4, 18, 3);
    }
    ctx.save();
    ctx.translate(210, 520);
    ctx.rotate(-0.5);
    ctx.fillStyle = "#caa06a";
    this.roundRect(-34, -5, 68, 10, 5);
    ctx.fill();
    ctx.fillStyle = "#a8804e";
    this.roundRect(-46, -4, 12, 8, 4);
    ctx.fill();
    this.roundRect(34, -4, 12, 8, 4);
    ctx.fill();
    ctx.restore();
    this.pool(210, 540, 60, "rgba(240,230,210,.05)"); // flour dust in the light

    // the easel — the framed piece IS the attribution link
    const e = this.mEasel;
    ctx.strokeStyle = "#4a3424";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(e.x - 16, e.y + 18);
    ctx.lineTo(e.x, e.y - 26);
    ctx.lineTo(e.x + 16, e.y + 18);
    ctx.moveTo(e.x, e.y - 10);
    ctx.lineTo(e.x, e.y + 18);
    ctx.stroke();
    ctx.fillStyle = "#1c130b";
    ctx.fillRect(e.x - 22, e.y - 24, 44, 34);
    const sun = ctx.createLinearGradient(e.x - 18, e.y - 20, e.x + 18, e.y + 6);
    sun.addColorStop(0, "#e0875a");
    sun.addColorStop(1, "#f3dDb8".toLowerCase());
    ctx.fillStyle = sun;
    ctx.fillRect(e.x - 18, e.y - 20, 36, 26);
    ctx.fillStyle = "rgba(20,10,6,.5)";
    ctx.beginPath();
    ctx.arc(e.x + 6, e.y - 12, 6, 0, 7); // a little Baja sun
    ctx.fill();
    this.pool(e.x, e.y, 70, "rgba(255,190,120,.08)");

    this.namePlate("IL MATTARELLO · 麺棒", "#f3c9a8");
  }

  /** THE LABYRINTH — a real bamboo-hedge maze grown from LAB_GRID. Lanterns at
   *  the turns, fireflies, and a stone circle at the hidden centre. */
  private drawLabyrinth() {
    const ctx = this.ctx;
    const now = performance.now();

    // mossy ground
    ctx.fillStyle = "#243020";
    ctx.fillRect(0, 0, ROOM.w, ROOM.h);
    ctx.fillStyle = "rgba(0,0,0,.14)";
    for (let i = 0; i < 90; i++) {
      const sx = (i * 173) % ROOM.w;
      const sy = (i * 257) % ROOM.h;
      ctx.fillRect(sx, sy, 3, 2);
    }
    ctx.fillStyle = "rgba(170,200,140,.05)";
    for (let i = 0; i < 50; i++) {
      const sx = (i * 311) % ROOM.w;
      const sy = (i * 197) % ROOM.h;
      ctx.fillRect(sx, sy, 2, 2);
    }

    // the stone circle of the hidden centre chamber
    ctx.strokeStyle = "rgba(200,210,180,.18)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(570, 446, 64, 0, 7);
    ctx.stroke();
    this.pool(570, 446, 120, "rgba(207,232,168,.07)");

    // hedge blocks straight from the grid — bamboo texture on each
    for (let r = 0; r < LAB_ROWS; r++)
      for (let c = 0; c < LAB_COLS; c++) {
        if (LAB_GRID[r][c] !== "#") continue;
        const x = WALL + c * LAB_CW;
        const y = WALL + r * LAB_CH;
        ctx.fillStyle = "#2c3a22";
        ctx.fillRect(x, y, LAB_CW + 1, LAB_CH + 1);
        // lit top edge so walls read in the dark
        ctx.fillStyle = "#42542e";
        ctx.fillRect(x, y, LAB_CW + 1, 6);
        // bamboo stalks
        ctx.strokeStyle = "rgba(120,150,90,.4)";
        ctx.lineWidth = 2;
        for (let bxx = x + 10; bxx < x + LAB_CW - 4; bxx += 14) {
          ctx.beginPath();
          ctx.moveTo(bxx, y + 6);
          ctx.lineTo(bxx, y + LAB_CH - 4);
          ctx.stroke();
          ctx.strokeStyle = "rgba(60,80,45,.5)";
          ctx.beginPath();
          ctx.moveTo(bxx, y + LAB_CH * 0.4);
          ctx.lineTo(bxx + 4, y + LAB_CH * 0.4);
          ctx.stroke();
          ctx.strokeStyle = "rgba(120,150,90,.4)";
        }
      }

    // small stone lanterns at chosen open turns
    const lanterns = [
      { x: 120, y: 74 },
      { x: 980, y: 446 },
      { x: 460, y: 632 },
      { x: 660, y: 260 },
    ];
    for (const l of lanterns) {
      const lf = 0.6 + 0.4 * Math.sin(now / 700 + l.x);
      ctx.fillStyle = "#5a5a52";
      ctx.fillRect(l.x - 6, l.y - 8, 12, 16);
      ctx.fillStyle = `rgba(255,214,140,${0.5 + lf * 0.4})`;
      ctx.fillRect(l.x - 3, l.y - 4, 6, 6);
      this.pool(l.x, l.y, 60, `rgba(255,200,120,${0.06 + lf * 0.04})`);
    }

    // fireflies drifting over the hedges
    ctx.fillStyle = "#eaff9a";
    for (let i = 0; i < 8; i++) {
      const a = now / 2600 + i * 1.7;
      ctx.globalAlpha = 0.25 + 0.4 * Math.abs(Math.sin(a * 1.3));
      ctx.beginPath();
      ctx.arc(
        ROOM.w / 2 + Math.cos(a + i) * (180 + i * 40),
        ROOM.h / 2 + Math.sin(a * 0.8 + i * 2) * (140 + i * 24),
        1.8,
        0,
        7
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    this.namePlate("迷路 · THE LABYRINTH", "#cfe8a8");
  }

  /** THE ARCHIVE — the deep-history vault. Long stacks of records, banker's
   *  lamps, a card catalogue: where the classics rest. */
  private drawArchive() {
    const ctx = this.ctx;
    const now = performance.now();

    // dark plank floor
    ctx.fillStyle = "#2a221a";
    ctx.fillRect(0, 0, ROOM.w, ROOM.h);
    ctx.strokeStyle = "rgba(0,0,0,.25)";
    ctx.lineWidth = 1.5;
    for (let y = 60; y < ROOM.h; y += 46) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(ROOM.w, y);
      ctx.stroke();
    }

    // walls with framed plaques (the lineage on the wall)
    ctx.fillStyle = "#1a140e";
    ctx.fillRect(0, ROOM.h - WALL, ROOM.w, WALL);
    ctx.fillRect(0, 0, WALL, ROOM.h);
    ctx.fillRect(ROOM.w - WALL, 0, WALL, ROOM.h);
    ctx.fillStyle = "#241c12";
    ctx.fillRect(0, 0, ROOM.w, WALL + 60);
    const years = ["1977", "1984", "1986", "1989", "1992", "1997"];
    years.forEach((yr, i) => {
      const ax = 130 + i * 150;
      if (ax > 700 && ax < 880) return; // clear of the labyrinth door
      ctx.fillStyle = "#0e0a06";
      ctx.fillRect(ax - 26, WALL + 8, 52, 38);
      ctx.strokeStyle = "#caa44a";
      ctx.lineWidth = 2;
      ctx.strokeRect(ax - 26, WALL + 8, 52, 38);
      ctx.fillStyle = "#caa44a";
      ctx.font = "700 13px 'DM Mono',monospace";
      ctx.textAlign = "center";
      ctx.fillText(yr, ax, WALL + 29);
    });

    // the long stacks — shelves of record spines, every sliver a different hue
    for (const st of this.aStacks) {
      ctx.fillStyle = "#33402e";
      ctx.fillRect(st.x - 6, st.y - 8, st.w + 12, st.h + 16);
      ctx.fillStyle = "#1c2418";
      ctx.fillRect(st.x, st.y, st.w, st.h);
      for (let x = st.x + 4; x < st.x + st.w - 4; x += 7) {
        const hch = (x * 2654435761) % 360;
        ctx.fillStyle = `hsl(${hch} 28% ${30 + ((x * 7) % 18)}%)`;
        ctx.fillRect(x, st.y + 4, 5, st.h - 8);
      }
      // a few pulled-out sleeves leaning on top
      ctx.fillStyle = "#caa44a";
      ctx.fillRect(st.x + 80, st.y - 6, 22, 4);
      ctx.fillStyle = "#5a86a8";
      ctx.fillRect(st.x + 320, st.y - 6, 22, 4);
    }

    // reading table with two banker's lamps (green glass pools)
    const t = this.aTable;
    ctx.fillStyle = "#3a2c1c";
    this.roundRect(t.x, t.y, t.w, t.h, 6);
    ctx.fill();
    ctx.fillStyle = "#4a3826";
    this.roundRect(t.x + 6, t.y + 6, t.w - 12, t.h - 12, 4);
    ctx.fill();
    [t.x + 70, t.x + t.w - 70].forEach((lx, i) => {
      const gl = 0.75 + 0.25 * Math.sin(now / 1200 + i * 2);
      ctx.fillStyle = "#2c2418";
      ctx.fillRect(lx - 2, t.y + 8, 4, 14);
      ctx.fillStyle = "#3f7d5a";
      this.roundRect(lx - 12, t.y + 2, 24, 9, 4);
      ctx.fill();
      this.pool(lx, t.y + 22, 64, `rgba(120,220,160,${0.07 + gl * 0.05})`);
    });
    // an open sleeve + 45 on the table
    ctx.fillStyle = "#d8cdb8";
    ctx.fillRect(t.x + 130, t.y + 18, 36, 28);
    ctx.fillStyle = "#181818";
    ctx.beginPath();
    ctx.arc(t.x + 186, t.y + 32, 13, 0, 7);
    ctx.fill();
    ctx.fillStyle = "#caa44a";
    ctx.beginPath();
    ctx.arc(t.x + 186, t.y + 32, 4, 0, 7);
    ctx.fill();

    // the card catalogue
    const cg = this.aCatalog;
    ctx.fillStyle = "#4a3826";
    ctx.fillRect(cg.x - 22, cg.y - 16, 44, 36);
    ctx.fillStyle = "#2c2014";
    for (let j = 0; j < 3; j++)
      for (let i = 0; i < 2; i++) {
        ctx.fillRect(cg.x - 18 + i * 20, cg.y - 12 + j * 11, 16, 8);
        ctx.fillStyle = "#caa44a";
        ctx.fillRect(cg.x - 12 + i * 20, cg.y - 9 + j * 11, 4, 2);
        ctx.fillStyle = "#2c2014";
      }

    // hanging cone lamps over the aisles
    [300, 570, 840].forEach((lx) => {
      this.pool(lx, 270, 150, "rgba(255,214,140,.07)");
      ctx.fillStyle = "#1c130b";
      ctx.beginPath();
      ctx.moveTo(lx - 12, 130);
      ctx.lineTo(lx + 12, 130);
      ctx.lineTo(lx + 7, 118);
      ctx.lineTo(lx - 7, 118);
      ctx.fill();
    });

    this.namePlate("書庫 · THE ARCHIVE", "#c8e8c8");
  }

  /** CURATOR ROOM — Houseum, a cosmic French-house lounge honouring Houseum. A
   *  terrace overlooking the stars: starfield + slow aurora "blue-lava" bands, a
   *  Parisian-cosmic skyline (Eiffel + observatory), neon French signage, a holo
   *  perspective floor, a chill cosmic cat, and a gold "HOUSEUM" record centerpiece
   *  that IS the attribution link. Palette + link come from lib/bar/curators.ts. */
  private drawCuratorRoom() {
    const ctx = this.ctx;
    const now = performance.now();
    const cfg = this.curatorCfg();
    const p: CuratorPalette = cfg?.palette ?? {
      skyTop: "#0c0628", skyBottom: "#241050", terrace: "#0e0a20", grid: "#6a44c8",
      aurora: ["#3a6ad6", "#7a3ad6", "#28d0c0"], neon: "#ff5ec6", neonAlt: "#5ee8ff",
      gold: "#ffd76a", holo: ["#ff8ad6", "#8affd6", "#8a9cff"],
    };
    const railY = this.cRailY;

    // SKY — deep cosmic gradient down to the terrace horizon
    const sky = ctx.createLinearGradient(0, 0, 0, railY);
    sky.addColorStop(0, p.skyTop);
    sky.addColorStop(1, p.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, ROOM.w, railY);

    // AURORA / blue-lava bands — slow translucent sine ribbons drifting across
    for (let b = 0; b < 3; b++) {
      ctx.globalAlpha = 0.13;
      ctx.fillStyle = p.aurora[b];
      ctx.beginPath();
      const baseY = 84 + b * 44;
      ctx.moveTo(0, baseY);
      for (let x = 0; x <= ROOM.w; x += 22)
        ctx.lineTo(x, baseY + Math.sin(x / 130 + now / (1700 + b * 420) + b) * 24);
      ctx.lineTo(ROOM.w, baseY + 64);
      ctx.lineTo(0, baseY + 64);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // STARS — twinkling across the sky
    for (const sct of this.cStars) {
      const sx = sct.x * ROOM.w;
      const sy = 8 + sct.y * (railY - 24);
      ctx.globalAlpha = 0.35 + 0.5 * (0.5 + 0.5 * Math.sin(now / 600 + sct.ph));
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(sx, sy, sct.s, sct.s);
    }
    ctx.globalAlpha = 1;

    // PARISIAN-COSMIC SKYLINE — an Eiffel silhouette + an observatory dome
    this.drawEiffel(250, railY, p);
    const ox = 930;
    ctx.fillStyle = "rgba(8,5,26,.9)";
    ctx.beginPath();
    ctx.arc(ox, railY, 40, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(ox - 42, railY - 3, 84, 5);
    ctx.strokeStyle = rgba(p.neonAlt, 0.4);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(ox, railY, 40, Math.PI, 0);
    ctx.stroke();
    ctx.strokeStyle = rgba(p.gold, 0.45);
    ctx.beginPath();
    ctx.moveTo(ox, railY - 40);
    ctx.lineTo(ox + 7, railY - 8);
    ctx.stroke();

    // NEON "HouseMiam" SIGN (French signage, flickering glow)
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const flick = 0.82 + 0.18 * Math.sin(now / 90) * Math.sin(now / 317);
    ctx.shadowColor = p.neon;
    ctx.shadowBlur = 16 + 7 * Math.sin(now / 380);
    ctx.fillStyle = rgba(p.neon, flick);
    ctx.font = "900 30px 'Anton',sans-serif";
    ctx.fillText("Houseum", ROOM.w / 2, 56);
    ctx.shadowBlur = 0;
    ctx.font = "9px 'DM Mono'";
    ctx.fillStyle = rgba(p.neonAlt, 0.8);
    ctx.fillText("COSMIC FRENCH HOUSE · 宇宙", ROOM.w / 2, 80);

    // the RAILING (terrace edge) — a glowing holo bar with posts
    ctx.fillStyle = rgba(p.holo[2], 0.55);
    ctx.fillRect(0, railY - 6, ROOM.w, 3);
    ctx.fillStyle = rgba(p.grid, 0.85);
    ctx.fillRect(0, railY - 2, ROOM.w, 4);
    for (let x = 36; x < ROOM.w; x += 78) {
      ctx.fillStyle = rgba(p.grid, 0.45);
      ctx.fillRect(x, railY - 13, 3, 12);
    }

    // TERRACE FLOOR — dark, with a synthwave holo perspective grid
    ctx.fillStyle = p.terrace;
    ctx.fillRect(0, railY, ROOM.w, ROOM.h - railY);
    ctx.strokeStyle = rgba(p.grid, 0.3);
    ctx.lineWidth = 1;
    const vanish = ROOM.w / 2;
    for (let i = -9; i <= 9; i++) {
      ctx.beginPath();
      ctx.moveTo(vanish + i * 58, railY);
      ctx.lineTo(vanish + i * 230, ROOM.h);
      ctx.stroke();
    }
    for (let gy = railY + 26, step = 22; gy < ROOM.h; step *= 1.32, gy += step) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(ROOM.w, gy);
      ctx.stroke();
    }

    // the GOLD RECORD centerpiece (+ the honest attribution CTA) and the cosmic cat
    this.drawGoldRecord(p, now);
    this.drawCosmicCat(now, p);

    // room tag
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "10px 'DM Mono'";
    ctx.fillStyle = rgba(p.holo[0], 0.55);
    ctx.fillText("a tribute lounge · the music is Houseum's", ROOM.w / 2, ROOM.h - 40);
  }

  /** A small Eiffel-tower silhouette against the stars (cosmic-Paris skyline touch). */
  private drawEiffel(x: number, baseY: number, p: CuratorPalette) {
    const ctx = this.ctx;
    const h = 156;
    const topY = baseY - h;
    ctx.fillStyle = "rgba(7,4,22,.9)";
    ctx.strokeStyle = rgba(p.neonAlt, 0.45);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(x - 30, baseY);
    ctx.quadraticCurveTo(x - 7, baseY - h * 0.52, x - 3, topY);
    ctx.lineTo(x + 3, topY);
    ctx.quadraticCurveTo(x + 7, baseY - h * 0.52, x + 30, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // first-platform arch
    ctx.beginPath();
    ctx.moveTo(x - 23, baseY - 34);
    ctx.quadraticCurveTo(x, baseY - 14, x + 23, baseY - 34);
    ctx.stroke();
    // platform crossbars
    for (const ph of [0.34, 0.64]) {
      const yy = topY + h * ph;
      const wd = 16 * (1 - ph) + 4;
      ctx.beginPath();
      ctx.moveTo(x - wd, yy);
      ctx.lineTo(x + wd, yy);
      ctx.stroke();
    }
    // beacon
    ctx.fillStyle = p.neon;
    ctx.beginPath();
    ctx.arc(x, topY - 2, 1.8, 0, 7);
    ctx.fill();
  }

  /** The gold "HOUSEUM" record — the room's focal point AND the attribution link.
   *  A mounted gold-record plaque with a holographic glint and a "find more ↗" CTA. */
  private drawGoldRecord(p: CuratorPalette, now: number) {
    const ctx = this.ctx;
    const { x, y, r } = this.cRecord;
    const onIt = this.activeZone?.type === "goldrecord";
    const cfg = this.curatorCfg();
    this.pool(x, y, r * 2.4 + (onIt ? 44 : 0), rgba(p.gold, onIt ? 0.26 : 0.15));

    // a holo plinth the plaque stands on
    ctx.fillStyle = rgba(p.grid, 0.5);
    this.roundRect(x - r * 0.7, y + r * 0.6, r * 1.4, 16, 4);
    ctx.fill();

    // outer plaque ring (the "gold record" frame)
    ctx.strokeStyle = rgba(p.gold, 0.8);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, r + 7, 0, 7);
    ctx.stroke();

    // the gold vinyl disc
    const g = ctx.createRadialGradient(x - r * 0.2, y - r * 0.2, 2, x, y, r);
    g.addColorStop(0, "#fff2c0");
    g.addColorStop(0.5, p.gold);
    g.addColorStop(1, "#9c7a2a");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 7);
    ctx.fill();
    ctx.strokeStyle = "rgba(120,90,20,.4)";
    ctx.lineWidth = 1;
    for (let rr = r * 0.44; rr < r; rr += 4) {
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, 7);
      ctx.stroke();
    }
    // a holographic glint sweeping across the disc
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 7);
    ctx.clip();
    const ga = (now / 1400) % (Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,.5)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(ga) * r, y + Math.sin(ga) * r);
    ctx.lineTo(x - Math.cos(ga) * r, y - Math.sin(ga) * r);
    ctx.stroke();
    ctx.restore();

    // center label — HOUSEUM (reads as giving them a gold record)
    ctx.fillStyle = "#1a1030";
    ctx.beginPath();
    ctx.arc(x, y, r * 0.4, 0, 7);
    ctx.fill();
    ctx.strokeStyle = rgba(p.gold, 0.85);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.4, 0, 7);
    ctx.stroke();
    ctx.fillStyle = p.gold;
    ctx.font = "900 9px 'Anton',sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("HOUSEUM", x, y - 1);
    ctx.fillStyle = "#1a1030";
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, 7);
    ctx.fill();

    // the CTA placard — the honest attribution + ↗ (NOT partnership language)
    const text = cfg?.attribution.text ?? "find more on YouTube ↗";
    const pw = 196;
    const ph = 24;
    const px = x - pw / 2;
    const py = y + r + 16;
    ctx.fillStyle = "rgba(10,6,24,.86)";
    this.roundRect(px, py, pw, ph, 6);
    ctx.fill();
    ctx.strokeStyle = rgba(p.gold, onIt ? 0.95 : 0.55);
    ctx.lineWidth = onIt ? 2 : 1.3;
    if (onIt) {
      ctx.shadowColor = p.gold;
      ctx.shadowBlur = 12;
    }
    this.roundRect(px, py, pw, ph, 6);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = p.gold;
    ctx.font = "9px 'DM Mono'";
    ctx.fillText(text, x, py + ph / 2);
  }

  /** A chill cosmic cat lounging by the centerpiece — ORIGINAL homage art (never a
   *  copy of any curator's mascot/logo). Built to host the room later; ambient now. */
  private drawCosmicCat(now: number, p: CuratorPalette) {
    const ctx = this.ctx;
    const { x, y } = this.cCat;
    const breath = Math.sin(now / 1400) * 1.1;
    // ground shadow
    ctx.fillStyle = "rgba(0,0,0,.3)";
    ctx.beginPath();
    ctx.ellipse(x, y + 13, 30, 8, 0, 0, 7);
    ctx.fill();
    // body (lounging) — deep cosmic with a faint holo sheen
    const bg = ctx.createLinearGradient(x - 30, y, x + 30, y);
    bg.addColorStop(0, "#181138");
    bg.addColorStop(0.5, "#2c1f64");
    bg.addColorStop(1, "#181138");
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.ellipse(x, y + breath, 31, 16, 0, 0, 7);
    ctx.fill();
    // tail curling forward
    ctx.strokeStyle = "#2c1f64";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x + 27, y + 2);
    ctx.quadraticCurveTo(x + 48, y + 6, x + 41, y - 13);
    ctx.stroke();
    ctx.lineCap = "butt";
    // star-fur sparkles
    ctx.fillStyle = rgba(p.holo[1], 0.9);
    for (const [dx, dy] of [[-12, -2], [2, -6], [14, 2], [-4, 5]] as [number, number][]) {
      ctx.beginPath();
      ctx.arc(x + dx, y + dy + breath, 0.9, 0, 7);
      ctx.fill();
    }
    // head resting, with ears
    const hx = x - 25;
    const hy = y - 5 + breath;
    ctx.fillStyle = "#2c1f64";
    ctx.beginPath();
    ctx.arc(hx, hy, 12, 0, 7);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(hx - 11, hy - 7);
    ctx.lineTo(hx - 13, hy - 18);
    ctx.lineTo(hx - 3, hy - 11);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(hx + 11, hy - 7);
    ctx.lineTo(hx + 13, hy - 18);
    ctx.lineTo(hx + 3, hy - 11);
    ctx.closePath();
    ctx.fill();
    // content closed eyes (a slow blink) + a tiny glowing nose
    ctx.strokeStyle = rgba(p.neonAlt, 0.9);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(hx - 7, hy - 1);
    ctx.quadraticCurveTo(hx - 4, hy + 1.5, hx - 1, hy - 1);
    ctx.moveTo(hx + 1, hy - 1);
    ctx.quadraticCurveTo(hx + 4, hy + 1.5, hx + 7, hy - 1);
    ctx.stroke();
    ctx.fillStyle = p.neon;
    ctx.beginPath();
    ctx.arc(hx, hy + 3.5, 1.4, 0, 7);
    ctx.fill();
    // whiskers
    ctx.strokeStyle = "rgba(255,255,255,.32)";
    ctx.lineWidth = 0.8;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(hx + s * 6, hy + 3);
      ctx.lineTo(hx + s * 17, hy + 1);
      ctx.moveTo(hx + s * 6, hy + 5);
      ctx.lineTo(hx + s * 17, hy + 6);
      ctx.stroke();
    }
  }

  /** ON AIR sign above the deck/booth. Dark by default; lights red + pulses when
   *  the owner takes the venue live (Part 3). State pushed via setOnAir(). */
  private drawOnAir() {
    const ctx = this.ctx;
    const x = this.deck.x + this.deck.w / 2;
    const y = this.deck.y - 70;
    const live = this.onAir;
    const pulse = live ? 0.6 + 0.4 * Math.abs(Math.sin(performance.now() / 500)) : 0;
    // housing
    ctx.fillStyle = "#1a1410";
    this.roundRect(x - 58, y - 16, 116, 30, 6);
    ctx.fill();
    ctx.strokeStyle = live ? `rgba(230,40,40,${0.6 + pulse * 0.4})` : "rgba(90,80,70,.5)";
    ctx.lineWidth = 2;
    this.roundRect(x - 58, y - 16, 116, 30, 6);
    ctx.stroke();
    // bulb
    ctx.fillStyle = live ? `rgba(255,40,40,${0.7 + pulse * 0.3})` : "#3a322c";
    if (live) {
      ctx.shadowColor = "rgba(255,40,40,.9)";
      ctx.shadowBlur = 12 + pulse * 14;
    }
    ctx.beginPath();
    ctx.arc(x - 42, y, 5, 0, 7);
    ctx.fill();
    ctx.shadowBlur = 0;
    // text
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "900 13px 'Anton',sans-serif";
    ctx.fillStyle = live ? "#ff5a5a" : "#5a524a";
    ctx.fillText("ON AIR", x + 6, y);
    if (live && this.onAirDj) {
      ctx.font = "8px 'DM Mono'";
      ctx.fillStyle = "rgba(255,160,160,.9)";
      ctx.fillText(`♪ ${this.onAirDj}`, x, y + 24);
    }
  }

  /** Doorways between rooms — each themed to the world it LEADS to: its own colour,
   *  frame design, glimpse-beyond, and an always-visible name + vibe placard, so a
   *  door reads at a glance as a gateway to a different vibe. */
  private drawDoors() {
    const now = performance.now();
    for (const d of this.doors) {
      const onIt = this.activeZone?.type === "door" && this.activeZone.door === d;
      const th = DOOR_THEME[d.to] ?? DOOR_THEME.kissa;
      const horiz = d.facing === "up" || d.facing === "down";
      const cx = d.x + d.w / 2;
      const cy = d.y + d.h / 2;
      // floor-glow spilling from the doorway — colour-codes the gateway, brighter near
      this.pool(cx, cy, (horiz ? 110 : 130) + (onIt ? 46 : 0), rgba(th.glow, onIt ? 0.32 : 0.17));
      this.drawDoorFrame(d, th, horiz, now);
      this.drawDoorSign(d, th, onIt);
    }
  }

  /** The themed frame + the glimpse beyond, distinct per destination style. */
  private drawDoorFrame(d: RoomDoor, th: DoorTheme, horiz: boolean, now: number) {
    const ctx = this.ctx;
    const { x, y, w, h } = d;
    const T = 7;
    const gx = x + w / 2;
    const gy = y + h / 2;

    // opening recess + the destination's light glimpsing through
    ctx.fillStyle = shade(th.frame, -16);
    ctx.fillRect(x, y, w, h);
    const rg = ctx.createRadialGradient(gx, gy, 1, gx, gy, Math.max(w, h) * 0.95);
    rg.addColorStop(0, rgba(th.glow, 0.85));
    rg.addColorStop(0.55, rgba(th.glow, 0.32));
    rg.addColorStop(1, rgba(th.glow, 0));
    ctx.fillStyle = rg;
    ctx.fillRect(x - 6, y - 6, w + 12, h + 12);

    // frame posts + lintel in the destination's frame timber/metal
    ctx.fillStyle = th.frame;
    if (horiz) {
      ctx.fillRect(x - 10, y - T, w + 20, T);
      ctx.fillRect(x - 10, y + h, w + 20, T);
      ctx.fillRect(x - 10, y - T, T, h + 2 * T);
      ctx.fillRect(x + w + 10 - T, y - T, T, h + 2 * T);
    } else {
      ctx.fillRect(x - T, y - 12, T, h + 24);
      ctx.fillRect(x + w, y - 12, T, h + 24);
      ctx.fillRect(x - T, y - 12, w + 2 * T, 8);
    }

    // per-style accent detail
    if (th.style === "berlin") {
      // pulsing red light strips down the posts + rivets + fog at the base
      const pulse = 0.5 + 0.5 * Math.sin(now / 240);
      ctx.fillStyle = rgba(th.glow, 0.5 + pulse * 0.4);
      if (horiz) {
        ctx.fillRect(x - 10, y - 2, w + 20, 2);
        ctx.fillRect(x - 10, y + h, w + 20, 2);
      } else {
        ctx.fillRect(x - 2, y - 12, 2, h + 24);
        ctx.fillRect(x + w, y - 12, 2, h + 24);
      }
      ctx.fillStyle = "#4a4a52";
      const span = horiz ? w : h;
      for (let i = 6; i < span; i += 26) {
        ctx.beginPath();
        if (horiz) ctx.arc(x + i, y - T / 2, 1.5, 0, 7);
        else ctx.arc(x - T / 2, y + i, 1.5, 0, 7);
        ctx.fill();
      }
      this.pool(gx, y + h, 38, "rgba(150,160,180,.10)");
    } else if (th.style === "garden") {
      // a little eave roof over the doorway + fireflies in the glimpse
      ctx.strokeStyle = "#3a2817";
      ctx.lineWidth = 3;
      ctx.beginPath();
      if (horiz) {
        ctx.moveTo(x - 16, y - T);
        ctx.lineTo(gx, y - T - 12);
        ctx.lineTo(x + w + 16, y - T);
      } else {
        ctx.moveTo(x - T - 8, y - 12);
        ctx.lineTo(gx, y - 26);
        ctx.lineTo(x + w + T + 8, y - 12);
      }
      ctx.stroke();
      ctx.fillStyle = "#eaff9a";
      for (let i = 0; i < 2; i++) {
        const a = now / 800 + i * 2.3;
        ctx.globalAlpha = 0.35 + 0.4 * Math.sin(a);
        ctx.beginPath();
        ctx.arc(gx + Math.cos(a) * w * 0.3, gy + Math.sin(a * 1.3) * h * 0.3, 1.6, 0, 7);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (th.style === "omakase") {
      // a short indigo noren hung over the top of the opening
      ctx.fillStyle = "#2c3a5a";
      if (horiz) ctx.fillRect(x, y, w, h * 0.42);
      else for (let i = 0; i < 2; i++) ctx.fillRect(x + i * (w / 2), y, w / 2 - 2, h * 0.45);
    } else if (th.style === "tearoom") {
      // a soft shoji grid in the opening + a faint rising steam wisp
      ctx.strokeStyle = rgba(th.glow, 0.5);
      ctx.lineWidth = 1;
      if (horiz) {
        for (let gx2 = x + 10; gx2 < x + w; gx2 += 16) {
          ctx.beginPath();
          ctx.moveTo(gx2, y);
          ctx.lineTo(gx2, y + h);
          ctx.stroke();
        }
      } else {
        for (let gy2 = y + 14; gy2 < y + h; gy2 += 16) {
          ctx.beginPath();
          ctx.moveTo(x, gy2);
          ctx.lineTo(x + w, gy2);
          ctx.stroke();
        }
      }
      this.pool(gx, gy - 8, 22, "rgba(222,236,200,.09)");
    } else if (th.style === "cosmic") {
      // a starry portal into the cosmos — drifting sparks in the opening
      ctx.fillStyle = "#ffffff";
      for (let i = 0; i < 7; i++) {
        const sx = x + ((i * 37 + now * 0.01) % Math.max(1, w));
        const sy = y + ((i * 53 + now * 0.02) % Math.max(1, h));
        ctx.globalAlpha = 0.4 + 0.5 * Math.sin(now / 500 + i);
        ctx.fillRect(sx, sy, 1.5, 1.5);
      }
      ctx.globalAlpha = 1;
    } else {
      // kissa — a noren with 音 + warm lantern glow
      ctx.fillStyle = "#2c3a5a";
      if (horiz) ctx.fillRect(x, y, w, h * 0.42);
      else for (let i = 0; i < 2; i++) ctx.fillRect(x + i * (w / 2), y, w / 2 - 2, h * 0.45);
      ctx.fillStyle = th.accent;
      ctx.font = "700 10px 'Shippori Mincho',serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("音", gx, horiz ? y + h * 0.2 : y + 8);
    }
  }

  /** Always-visible placard in front of a door: kanji + NAME + vibe, accent-coloured,
   *  glowing when you're standing in range. This is what makes a door unmistakable. */
  private drawDoorSign(d: RoomDoor, th: DoorTheme, onIt: boolean) {
    const ctx = this.ctx;
    const off = 18;
    const pw = 158;
    const ph = 42;
    // anchor the plaque in front of the door, by facing
    let px: number;
    let py: number;
    if (d.facing === "left") {
      px = d.x - off - pw;
      py = d.y + d.h / 2 - ph / 2;
    } else if (d.facing === "right") {
      px = d.x + d.w + off;
      py = d.y + d.h / 2 - ph / 2;
    } else if (d.facing === "up") {
      px = d.x + d.w / 2 - pw / 2;
      py = d.y - off - ph;
    } else {
      px = d.x + d.w / 2 - pw / 2;
      py = d.y + d.h + off;
    }

    ctx.fillStyle = "rgba(13,10,7,.84)";
    this.roundRect(px, py, pw, ph, 7);
    ctx.fill();
    ctx.strokeStyle = rgba(th.accent, onIt ? 0.95 : 0.5);
    ctx.lineWidth = onIt ? 2 : 1.3;
    if (onIt) {
      ctx.shadowColor = th.glow;
      ctx.shadowBlur = 14;
    }
    this.roundRect(px, py, pw, ph, 7);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // kanji chip
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillStyle = rgba(th.accent, 0.14);
    this.roundRect(px + 6, py + 6, 34, ph - 12, 4);
    ctx.fill();
    ctx.fillStyle = th.accent;
    ctx.font = "800 15px 'Shippori Mincho',serif";
    ctx.fillText(th.kanji.slice(0, 2), px + 23, py + ph / 2);

    // name + vibe
    ctx.textAlign = "left";
    ctx.fillStyle = th.accent;
    ctx.font = "900 13px 'Anton',sans-serif";
    ctx.fillText("→ " + th.name, px + 48, py + 15);
    ctx.fillStyle = "rgba(241,230,210,.62)";
    ctx.font = "8px 'DM Mono'";
    ctx.fillText(th.vibe, px + 48, py + 29);
  }

  private drawLanterns() {
    const ctx = this.ctx;
    const L: [number, number][] = [
      [this.deck.x + this.deck.w / 2, this.deck.y - 2],
      [this.bar.x + this.bar.w / 2, this.bar.y - 4],
      [this.platform.x + this.platform.w / 2, this.platform.y - 6],
      [ROOM.w / 2, WALL + 150],
    ];
    L.forEach(([x, y]) => {
      this.pool(x, y, 90, "rgba(255,160,80,.16)");
      ctx.fillStyle = "#e9683c";
      this.roundRect(x - 14, y - 18, 28, 32, 11);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,.25)";
      ctx.lineWidth = 1.5;
      for (let yy = -12; yy <= 10; yy += 6) {
        ctx.beginPath();
        ctx.moveTo(x - 13, y + yy);
        ctx.lineTo(x + 13, y + yy);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(255,220,160,.5)";
      ctx.beginPath();
      ctx.arc(x, y - 2, 5, 0, 7);
      ctx.fill();
    });
  }

  private drawNoren() {
    const ctx = this.ctx;
    const x = ROOM.w / 2;
    const y = ROOM.h - WALL;
    ctx.fillStyle = "#2c3a5a";
    for (let i = -1; i <= 1; i++) {
      this.roundRect(x + i * 30 - 13, y - 2, 26, 34, 2);
      ctx.fill();
    }
    ctx.fillStyle = "#f1e6d2";
    ctx.font = "700 14px 'Shippori Mincho',serif";
    ctx.textAlign = "center";
    ctx.fillText("音", x, y + 22);
  }

  private person(
    e: Entity,
    body: string,
    hair: string,
    isPlayer = false,
    sitting = false
  ) {
    const ctx = this.ctx;
    const x = e.x;
    const y = e.y;
    // Everyone FLOATS: no legs, lifted off the floor, gently hovering. A per-
    // character phase (from x) keeps them out of sync so the room breathes. The
    // shadow stays on the ground and shrinks with height to sell the levitation.
    // Seated patrons keep their grounded nod (their own s.bob animation).
    const t = performance.now() / 1000;
    const hover = sitting ? 0 : Math.sin(t * 1.5 + x * 0.045) * 2.6;
    const lift = sitting ? 0 : 10; // baseline height off the floor
    const bob = hover - lift; // negative = up; reused by body + head offsets below
    const shScale = sitting ? 1 : 0.62 - hover * 0.02; // smaller/softer when higher
    ctx.fillStyle = sitting ? "rgba(0,0,0,.28)" : "rgba(0,0,0,.20)";
    ctx.beginPath();
    ctx.ellipse(x, y + 13, 12 * shScale, 5 * shScale, 0, 0, 7);
    ctx.fill();
    ctx.fillStyle = body;
    this.roundRect(x - 9, y - 12 + bob, 18, sitting ? 15 : 20, 6);
    ctx.fill();
    ctx.fillStyle = "#e8c39a";
    ctx.beginPath();
    ctx.arc(x, y - 18 + bob, 8, 0, 7);
    ctx.fill();
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.arc(x, y - 20 + bob, 8, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();
    ctx.fillRect(x - 8, y - 21 + bob, 16, 4);
    ctx.fillStyle = "#1a130d";
    ctx.beginPath();
    ctx.arc(x + (e.dir > 0 ? 2.5 : -2.5), y - 17 + bob, 1.3, 0, 7);
    ctx.fill();
    if (isPlayer) {
      ctx.strokeStyle = "rgba(255,179,94,.5)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(x, y + 12, 15, 6, 0, 0, 7);
      ctx.stroke();
    }
  }

  /** Interpolate remote listeners toward their last broadcast pose, return draws. */
  private remoteEntities(): { y: number; d: () => void }[] {
    const remotes = this.remoteGetter?.() ?? [];
    // Presence is venue-wide (the listener COUNT is everyone), but each avatar
    // only renders in the room it's currently in — so you see the people sharing
    // your scenery. Default to the hub for older clients without a room field.
    return remotes
      .filter((r) => (r.room ?? HUB_ROOM) === this.room.id)
      .map((r) => {
        const dx = r.tx - r.x;
        const dy = r.ty - r.y;
        const d = Math.hypot(dx, dy);
        r.x += dx * 0.2;
        r.y += dy * 0.2;
        r.bob = d > 0.8 ? r.bob + 0.32 : 0; // walk-bob only while closing distance
        return { y: r.y, d: () => this.person(r, r.color, r.hair) };
      });
  }

  private drawDust() {
    const ctx = this.ctx;
    for (const d of this.dust) {
      ctx.globalAlpha = d.a;
      ctx.fillStyle = "#ffe6b8";
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.s, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawVignette() {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(
      this.W / 2,
      this.H / 2,
      Math.min(this.W, this.H) * 0.32,
      this.W / 2,
      this.H / 2,
      Math.max(this.W, this.H) * 0.74
    );
    g.addColorStop(0, "transparent");
    g.addColorStop(1, "rgba(0,0,0,.52)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);

    // pull-through charge: a cool vignette closes in toward the centre as the
    // ~800ms charge completes — the "tunnel in" before the rave opens.
    const t = this.portalChargeT();
    if (t > 0) {
      const cg = ctx.createRadialGradient(
        this.W / 2,
        this.H / 2,
        Math.max(this.W, this.H) * (0.6 - t * 0.5),
        this.W / 2,
        this.H / 2,
        Math.max(this.W, this.H) * (0.78 - t * 0.45)
      );
      cg.addColorStop(0, "transparent");
      cg.addColorStop(1, `rgba(90,40,200,${0.25 + t * 0.6})`);
      ctx.fillStyle = cg;
      ctx.fillRect(0, 0, this.W, this.H);
    }
  }
}
