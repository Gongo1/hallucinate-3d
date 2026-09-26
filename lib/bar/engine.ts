import type { Shelf, RemotePlayer } from "./types";
import { ROOMS, HUB_ROOM, type RoomDef, type RoomDoor } from "./rooms";
import { CURATORS, type CuratorRoom } from "./curators";
import { SKINS, HATS, type Fit, type Hat } from "./fits";
import {
  ROOM, WALL, KISSA, KISSA_SEATED, KISSA_MASTER, GARDEN, OMAKASE, BERLIN, TEA, CURATOR,
  PLAYA, WAREHOUSE, ROOFTOP, TRATTORIA, ARCHIVE, LAB_GRID, LAB_COLS, LAB_ROWS, LAB_CW, LAB_CH,
  DIG_SPOTS, type DigSpot,
} from "./layout";
import { World3D, type Actor } from "./three/world";
import type { ActiveRef } from "./three/types";

// The whole game, ported from prototype.html — rooms, fixtures, NPCs, input
// (WASD / click / joystick), collision, zone proximity, and the rAF loop.
// Framework-agnostic: it owns the canvas and never touches React. It talks to
// the UI through the callbacks below (overlays, prompts) and reads playback state
// via isPlaying() for the speaker/turntable animation.
//
// Drawing is delegated to the low-poly 3D view (lib/bar/three/world.ts): every
// frame the engine hands it a read-only snapshot. The engine still thinks in the
// same 2D floor plan (world px) — the view lifts it into 3D.

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

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
  skin: string;
  hat: Hat;
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

/** rave-portal pull-through charge length (ms) — explicit, cancelable intent */
const PORTAL_CHARGE_MS = 800;

// the ambient kissa regulars (fixed looks — the seated pair + the master)
const SEATED_FITS: Fit[] = [
  { skin: "#e6b184", body: "#7e6fb0", hair: "#15151a", hat: "none" },
  { skin: "#e6b184", body: "#9b7d4e", hair: "#241812", hat: "none" },
];
const MASTER_FIT: Fit = { skin: "#cf9268", body: "#caa06a", hair: "#1c130b", hat: "none" };

export class BarEngine {
  private cv: HTMLCanvasElement;
  private view: World3D;
  private cb: EngineCallbacks;
  private stick: HTMLElement;
  private nub: HTMLElement;
  private actBtn: HTMLElement;

  private shelves: Shelf[];
  private solids: Rect[] = [];
  private shelfObjs: ShelfObj[] = [];
  private zones: Zone[] = [];

  private player = {
    x: ROOM.w / 2,
    y: ROOM.h - 200, // open floor between the centre platform and the bottom deck
    r: 13,
    dir: 1,
    bob: 0,
    speed: 168, // a touch quicker — responsive without losing the stroll
  };
  private npcs: Npc[] = [];
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
    this.view = new World3D(this.cv);
    this.cb = opts.callbacks;
    this.stick = opts.stick;
    this.nub = opts.stickNub;
    this.actBtn = opts.actBtn;
    this.shelves = opts.shelves;

    this.buildStatics();
    this.view.setRoom(this.room);
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
    this.view.dispose();
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

  // the local player's fit (skin / outfit / hair / hat). Set from Bar.tsx once the
  // saved/picked fit is known; defaults to the kissa-warm look until then.
  private playerFit: Fit = { skin: "#f4cda3", body: "#ffcf6b", hair: "#241812", hat: "none" };
  setPlayerFit(fit: Fit) {
    this.playerFit = fit;
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
    this.layoutShelves(shelves);
    this.view.setCrates(this.shelfObjs, this.room.scene);
  }

  private layoutShelves(shelves: Shelf[]) {
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
    const spots = DIG_SPOTS[this.room.scene];
    if (spots) return this.placeDigSpots(here, spots);

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
      const cy = KISSA.bar.y - 56 - i * (rH + 16);
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
    this.solid(KISSA.deck.x, KISSA.deck.y, KISSA.deck.w, KISSA.deck.h);
    KISSA.speakers.forEach((s) =>
      this.solid(s.x, s.y, KISSA.spkBox.w, KISSA.spkBox.h)
    );
    this.solid(KISSA.bar.x, KISSA.bar.y, KISSA.bar.w, KISSA.bar.h);
    this.solid(KISSA.table.x, KISSA.table.y, KISSA.table.w, KISSA.table.h);
    KISSA.decor.forEach((d) => this.solid(d.x - 18, d.y - 18, 36, 36));
    // non-shelf zones — the deck is along the bottom wall, so its prompt zone sits
    // ABOVE it (you approach the booth walking down from the room centre).
    this.zones.push({
      type: "deck",
      cx: KISSA.deck.x + KISSA.deck.w / 2,
      cy: KISSA.deck.y - 34,
      r: 88,
    });
    this.zones.push({
      type: "bar",
      cx: KISSA.bar.x - 26,
      cy: KISSA.bar.y + KISSA.bar.h / 2,
      r: 92,
    });
    // Rave portal: the doorway frame is solid (you can't walk into the wall); its
    // prompt/charge zone sits in FRONT of the rift (to the right, into the room),
    // so approach + explicit E is the only path — never a walk-through.
    this.solid(
      KISSA.portal.cx - KISSA.portal.w / 2,
      KISSA.portal.cy - KISSA.portal.h / 2,
      KISSA.portal.w,
      KISSA.portal.h
    );
    this.zones.push({
      type: "portal",
      cx: KISSA.portal.cx + KISSA.portal.w / 2 + 30,
      cy: KISSA.portal.cy,
      r: 66,
    });
  }

  private buildGardenFixtures() {
    // Solid garden features (you can't walk through them). Koi pond, raked-gravel
    // patch, maple trunk, lanterns, tsukubai basin. Cushions/benches are passable.
    this.solid(GARDEN.koi.x - GARDEN.koi.r, GARDEN.koi.y - GARDEN.koi.r * 0.7, GARDEN.koi.r * 2, GARDEN.koi.r * 1.4);
    this.solid(GARDEN.maple.x - 14, GARDEN.maple.y - 6, 28, 26); // maple trunk
    this.solid(GARDEN.basin.x - 16, GARDEN.basin.y - 14, 32, 30); // tsukubai
    GARDEN.lanterns.forEach((l) => this.solid(l.x - 12, l.y - 10, 24, 30));
  }

  private buildOmakaseFixtures() {
    // the blonde counter is the one solid back-fixture; stools + the glass neta
    // case are passable so the crates in front of the counter stay reachable.
    this.solid(OMAKASE.counter.x, OMAKASE.counter.y, OMAKASE.counter.w, OMAKASE.counter.h);
  }

  private buildBerlinFixtures() {
    this.solid(BERLIN.booth.x, BERLIN.booth.y, BERLIN.booth.w, BERLIN.booth.h); // DJ booth
    BERLIN.pillars.forEach((p) => this.solid(p.x - 14, p.y - 40, 28, 80)); // concrete columns
  }

  private buildTeaFixtures() {
    this.solid(TEA.table.x, TEA.table.y, TEA.table.w, TEA.table.h); // chabudai
    TEA.plants.forEach((p) => this.solid(p.x - 13, p.y - 12, 26, 28)); // potted plants
  }

  private buildCuratorFixtures() {
    // the terrace railing — a full-width solid so you stay on the terrace (the cosmos
    // is beyond it, not walkable)
    this.solid(-40, CURATOR.railY - 9, ROOM.w + 80, 18);
    // the gold-record centerpiece is solid — you walk AROUND it
    const r = CURATOR.record;
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
    this.solid(-40, PLAYA.shoreY, ROOM.w + 80, ROOM.h - PLAYA.shoreY + 40);
    PLAYA.palms.forEach((p) => this.solid(p.x - 12, p.y - 8, 24, 24)); // trunks
    PLAYA.torches.forEach((t) => this.solid(t.x - 8, t.y - 6, 16, 18));
    const f = PLAYA.fire;
    this.solid(f.x - 26, f.y - 18, 52, 36); // fire pit ring
  }

  private buildWarehouseFixtures() {
    this.solid(WAREHOUSE.stage.x, WAREHOUSE.stage.y, WAREHOUSE.stage.w, WAREHOUSE.stage.h); // speaker wall
    WAREHOUSE.pillars.forEach((p) => this.solid(p.x - 14, p.y - 40, 28, 80));
    this.solid(WAREHOUSE.tr909.x - 24, WAREHOUSE.tr909.y - 16, 48, 36); // the 909 pedestal
  }

  private buildRooftopFixtures() {
    // the parapet — the city is far below, not walkable
    this.solid(-40, ROOFTOP.railY - 9, ROOM.w + 80, 18);
    ROOFTOP.planters.forEach((p) => this.solid(p.x - 24, p.y - 14, 48, 30));
    this.solid(ROOFTOP.cart.x - 26, ROOFTOP.cart.y - 14, 52, 30);
  }

  private buildTrattoriaFixtures() {
    this.solid(TRATTORIA.oven.x, TRATTORIA.oven.y, TRATTORIA.oven.w, TRATTORIA.oven.h); // the oven
    this.solid(TRATTORIA.table.x, TRATTORIA.table.y, TRATTORIA.table.w, TRATTORIA.table.h); // long table
    TRATTORIA.flour.forEach((s) => this.solid(s.x - 16, s.y - 10, 32, 24));
    // the framed piece on the easel — the honest attribution; E opens their site
    const e = TRATTORIA.easel;
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
    ARCHIVE.stacks.forEach((s) => this.solid(s.x, s.y, s.w, s.h));
    this.solid(ARCHIVE.table.x, ARCHIVE.table.y, ARCHIVE.table.w, ARCHIVE.table.h);
    this.solid(ARCHIVE.catalog.x - 22, ARCHIVE.catalog.y - 16, 44, 36);
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
    // give the room's regulars some variety in their fits too — a random skin and
    // an occasional hat, so the crowd doesn't all look identical.
    const skin = SKINS[Math.floor(Math.random() * SKINS.length)];
    const hat: Hat =
      Math.random() < 0.4 ? HATS[1 + Math.floor(Math.random() * (HATS.length - 1))] : "none";
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
      skin,
      hat,
      speed: 70 + Math.random() * 28,
      r: 12,
    };
  }

  private resize() {
    this.view.resize();
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
      // click-to-walk: the view turns the screen point into a floor point
      const p = this.view.screenToWorld(e.clientX, e.clientY);
      if (p) this.moveTarget = p;
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
    this.render(dt);
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

    this.npcs.forEach((n) => this.updateNpc(n, dt));
    this.updatePrompt();
    this.updatePortalCharge(dt);
    this.updateTransition(dt);
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
    this.view.setRoom(next);
    this.setShelves(this.shelves);
    this.npcs = this.roomNpcs(next.id);
    const sp = next.spawns[fromRoom] ?? next.defaultSpawn;
    this.player.x = sp.x;
    this.player.y = sp.y;
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
      // a lone wanderer pacing the open top corridor (cols 4–10, row0) — proof
      // someone else is lost too. Stays in open cells so it never jams a hedge.
      return [this.npc([{ x: 450, y: 74 }, { x: 930, y: 74 }], "#86b86a", "#15151a")];
    }
    return [
      this.npc([{ x: 340, y: 250 }, { x: 900, y: 250 }, { x: 900, y: 560 }, { x: 340, y: 560 }], "#b06a52", "#2a1c12"),
      this.npc([{ x: 430, y: 610 }, { x: 760, y: 600 }, { x: 840, y: 430 }], "#56877e", "#1b1b22"),
    ];
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
      if (best.type === "door") {
        // labels that already carry a direction ("back inside", "down to the
        // beach") read as "Head …"; plain destinations as "Step through to …"
        const l = best.door.label;
        s = /^(back|down|up|to)\b/.test(l) ? `Head <b>${l}</b>` : `Step through to <b>${l}</b>`;
      }
      html = s + ` <span class="key">E</span>`;
    }
    if (html !== this.lastPrompt) {
      this.lastPrompt = html;
      this.cb.onPrompt(html);
    }
  }

  /* ----------------------------------------------------------- render */
  /** Hand the 3D view this frame's snapshot. Read-only: nothing here mutates game
   *  state except the remote-avatar interpolation (a pure presentation lerp). */
  private render(dt: number) {
    const moving = this.playerMoving;
    const actors: Actor[] = [
      { id: "player", x: this.player.x, y: this.player.y, fit: this.playerFit, moving, player: true },
      ...this.npcs.map((n, i) => ({
        id: `npc:${this.room.id}:${i}`,
        x: n.x,
        y: n.y,
        fit: { skin: n.skin, body: n.color, hair: n.hair, hat: n.hat },
        moving: n.wait <= 0,
      })),
      ...this.remoteActors(), // other live listeners IN THIS ROOM (the lobby)
    ];
    // kissa-only ambient: the master behind the bar + the seated pair on the tatami
    if (this.room.scene === "kissa") {
      actors.push({ id: "master", x: KISSA_MASTER.x, y: KISSA_MASTER.y, fit: MASTER_FIT, moving: false, yaw: -Math.PI / 2 });
      KISSA_SEATED.forEach((s, i) =>
        actors.push({ id: `seat:${i}`, x: s.x, y: s.y, fit: SEATED_FITS[i], moving: false, sitting: true, yaw: i ? -0.5 : 0.4 })
      );
    }
    this.view.frame({
      t: performance.now() / 1000,
      dt,
      actors,
      playing: this.cb.isPlaying(),
      active: this.activeRef(),
      portalCharge: this.portalChargeT(),
      onAir: this.onAir,
      onAirDj: this.onAirDj,
      fade: Math.abs(this.fade),
      phaseMult: this.phaseMult,
      phaseGlow: this.phaseGlow,
      speed: Math.hypot(this.stickVec.x, this.stickVec.y) || 1,
    });
  }

  /** The active zone as a plain reference the view can highlight. */
  private activeRef(): ActiveRef | null {
    const z = this.activeZone;
    if (!z) return null;
    if (z.type === "shelf") return { type: "shelf", id: z.shelf.data.id };
    if (z.type === "door") return { type: "door", to: z.door.to };
    return { type: z.type };
  }

  /** The curator config (palette / attribution / mascot) for the current room, if it
   *  is a curator tribute room — see lib/bar/curators.ts. */
  private curatorCfg(): CuratorRoom | undefined {
    return CURATORS[this.room.id];
  }

  /** Interpolate remote listeners toward their last broadcast pose. */
  private remoteActors(): Actor[] {
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
        return {
          id: `r:${r.id}`,
          x: r.x,
          y: r.y,
          fit: { skin: r.skin, body: r.color, hair: r.hair, hat: (r.hat as Hat) ?? "none" },
          moving: d > 0.8, // walk cycle only while closing distance
        };
      });
  }
}
