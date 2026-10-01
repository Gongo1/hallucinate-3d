import type { Shelf, RemotePlayer } from "./types";
import { ROOMS, HUB_ROOM, type RoomDef, type RoomDoor } from "./rooms";
import { CURATORS, type CuratorRoom } from "./curators";
import { SKINS, HATS, NECKS, EYES, parseGear, type Fit, type Hat, type Neck, type Eyes } from "./fits";
import {
  ROOM, WALL, KISSA, KISSA_SEATED, KISSA_MASTER, GARDEN, OMAKASE, BERLIN, TEA, CURATOR,
  PLAYA, WAREHOUSE, ROOFTOP, TRATTORIA, ARCHIVE, CHAMBER, LAB_GRID, LAB_COLS, LAB_ROWS, LAB_CW, LAB_CH,
  DIG_SPOTS, KISSA_FEATURED, KISSA_BOARD, KISSA_DROPBOX, type DigSpot,
} from "./layout";
import { World3D, type Actor, type ViewMode } from "./three/world";
import { DANCE_MOVES, DANCE_SECONDS, type DanceMove } from "./three/character";
import type { ActiveRef, BoardView, PickRef } from "./three/types";
import { REALMS, WANDER_CAT, secretsIn } from "./realms";

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
  // the weekly board on the back wall (kissa)
  | { type: "board"; cx: number; cy: number; r: number }
  // the drop box: suggest a record for review (kissa)
  | { type: "dropbox"; cx: number; cy: number; r: number }
  // Sombra Radio's home: the omakase counter explains who picks + how to add
  | { type: "radio"; cx: number; cy: number; r: number }
  | { type: "portal"; cx: number; cy: number; r: number }
  | { type: "goldrecord"; cx: number; cy: number; r: number; url: string; label?: string }
  | { type: "door"; cx: number; cy: number; r: number; door: RoomDoor }
  // the game layer (lib/bar/realms.ts): the realm's keeper, secret passages,
  // and the Kissa's lucky cat
  | { type: "keeper"; cx: number; cy: number; r: number }
  | { type: "secret"; cx: number; cy: number; r: number; id: string; name: string; to: string; spawn: { x: number; y: number } }
  | { type: "wander"; cx: number; cy: number; r: number };

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
  neck: Neck;
  eyes: Eyes;
  speed: number;
  r: number;
}

export interface EngineCallbacks {
  /** prompt text (HTML) to show near the player, or null to hide — fired only on change */
  onPrompt: (html: string | null) => void;
  onBrowseShelf: (shelf: Shelf) => void;
  onOpenIngest: () => void;
  onMastersPick: () => void;
  /** walked up to the weekly board (kissa) — zoom in on it */
  onOpenBoard?: () => void;
  /** the omakase counter: how Sombra Radio works */
  onOpenRadio?: () => void;
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
  /** talk to this realm's keeper */
  onTalk?: (roomId: string) => void;
  /** stepped into a secret passage (`firstTime` = just discovered it) */
  onSecret?: (secretId: string, firstTime: boolean) => void;
}

interface EngineOpts {
  canvas: HTMLCanvasElement;
  stick: HTMLElement;
  stickNub: HTMLElement;
  actBtn: HTMLElement;
  shelves: Shelf[];
  callbacks: EngineCallbacks;
}

/** the saved camera choice (v2: the old key could hold an accidental switch made
 *  by typing a link — everyone starts back in the close view once) */
const VIEW_KEY = "hallucinate-view-v2";
/** rave-portal pull-through charge length (ms) — explicit, cancelable intent */
const PORTAL_CHARGE_MS = 800;
/** pathfinding grid cell (world px) */
const CELL = 16;
const GW = Math.ceil(ROOM.w / CELL);
const GH = Math.ceil(ROOM.h / CELL);

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
    speed: 240, // a digger's pace (hold Shift to sprint)
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
  private pendingRoom: { id: string; fromDoor: string; spawn?: { x: number; y: number } } | null = null;
  private keys: Record<string, boolean> = {};
  private moveTarget: { x: number; y: number } | null = null;
  // click-to-walk follows a path around fixtures (grid A*), and a click on a thing
  // (crate, door, keeper, hatch…) walks you there and uses it on arrival
  private waypoints: { x: number; y: number }[] = [];
  private pendingZone: Zone | null = null;
  private stuck = { t: 0, x: 0, y: 0 };
  private grid: Uint8Array | null = null;
  private hover: PickRef | null = null;
  // the game layer — all client-local (your own save; see lib/bar/progress.ts)
  private secretsFound = new Set<string>();
  private talked = new Set<string>();
  // the 💃 button: a one-shot move (walking cancels it)
  private danceMove: { move: DanceMove; at: number } | null = null;
  private lastMove: DanceMove | null = null;
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
  private onCanvasHover!: (e: PointerEvent) => void;
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
    try {
      if (localStorage.getItem(VIEW_KEY) === "overview") this.view.setView("overview");
    } catch {}
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
    this.cv.removeEventListener("pointermove", this.onCanvasHover);
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

  /** Dance! A random house move — a different one each time — for two bars,
   *  then back to normal. Returns the move (the host broadcasts it). */
  dance(): DanceMove | null {
    if (!this.started || this.transitioning()) return null;
    const options = DANCE_MOVES.filter((m) => m !== this.lastMove);
    const move = options[Math.floor(Math.random() * options.length)];
    this.lastMove = move;
    this.stopWalking();
    this.danceMove = { move, at: performance.now() };
    return move;
  }

  /** This week's leaders for the whiteboard — view-only, passed to the 3D. */
  setBoard(b: BoardView) {
    this.view.setBoard(b);
  }

  /** The door ritual's camera dolly — passed straight to the view. */
  setArrival(mult: number, ms = 0) {
    this.view.setArrival(mult, ms);
  }

  /** Camera: the close over-the-shoulder view (default) or the high overview.
   *  Remembered on this device. */
  toggleView(): ViewMode {
    const next: ViewMode = this.view.view === "close" ? "overview" : "close";
    this.view.setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {}
    return next;
  }

  /** Fade-travel to a realm (the map's fast travel). Scenery only. */
  travelTo(roomId: string): boolean {
    if (!ROOMS[roomId] || roomId === this.room.id || this.transitioning()) return false;
    this.pendingRoom = { id: roomId, fromDoor: "travel" };
    this.fade = 0.0001;
    return true;
  }

  /** Wander to a random realm (the lucky cat / the map's dice). */
  wander(): string | null {
    // door-less rooms (the Chamber) are reached only by their secret hatch
    const ids = Object.keys(ROOMS).filter((r) => r !== this.room.id && ROOMS[r].doors.length > 0);
    const id = ids[Math.floor(Math.random() * ids.length)];
    return this.travelTo(id) ? id : null;
  }

  /** Which secret passages this player has found (from their local save). */
  setSecretsFound(ids: string[]) {
    this.secretsFound = new Set(ids);
  }
  /** Which keepers this player has talked to (the "!" goes quiet). */
  setTalked(rooms: string[]) {
    this.talked = new Set(rooms);
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
    this.grid = null;
    this.zones = this.zones.filter((z) => z.type !== "shelf");
    this.shelfObjs = [];

    const here = shelves.filter((s) => (s.room ?? "kissa") === this.room.id);
    // Every non-kissa scene lays its crates out as compact DIG SPOTS among the
    // scenery (not a wall column). Each scene's spot map keeps crates clear of
    // fixtures, doors, and the arrival spawn; cueing from any of them feeds the one
    // shared queue.
    const spots = DIG_SPOTS[this.room.scene];
    if (spots) return this.placeDigSpots(here, spots);

    // The featured crates (Gongo, Sombra Selection) sit front and centre under the
    // big sign. DETROIT gets a special home on the RIGHT wall, just above the
    // pour-over bar (per request). Everything else forms the left-wall column.
    const featured = here.filter((s) => s.slug && KISSA_FEATURED[s.slug]);
    for (const data of featured) {
      const sp = KISSA_FEATURED[data.slug!];
      const o: ShelfObj = { data, x: sp.x, y: sp.y, w: 100, h: 54, labelSide: sp.label };
      const r = this.solid(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h);
      r._shelf = true;
      this.shelfObjs.push(o);
      const zx = sp.label === "left" ? o.x - o.w / 2 - 30 : o.x + o.w / 2 + 30;
      this.zones.push({ type: "shelf", cx: zx, cy: o.y, r: 58, shelf: o });
    }
    const isRight = (s: Shelf) => /DETROIT/i.test(s.label);
    const rest = here.filter((s) => !featured.includes(s));
    const left = rest.filter((s) => !isRight(s));
    const right = rest.filter(isRight);

    // ----- left column (the main library) -----
    // It ends ABOVE the Berlin door (left wall, y≥360) — crates made through the
    // 新着 box land here, so extra ones shrink to fit instead of walling off the door.
    const top = WALL + 18;
    const bottom = 346;
    const slot = Math.min(96, (bottom - top) / Math.max(1, left.length));
    const boxW = 138;
    const boxH = Math.max(26, Math.min(72, slot - 20));
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
    this.grid = null;
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
    else if (this.room.scene === "chamber") this.buildChamberFixtures();

    this.buildGameZones();

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

  /** The keeper, secret hatches, the lucky cat (lib/bar/realms.ts). Hatches are
   *  flat (never solid); keepers + the cat are small solids. */
  private buildGameZones() {
    const realm = REALMS[this.room.id];
    if (realm) {
      const k = realm.keeper;
      if (k.solid !== false && k.kind !== "cat") this.solid(k.x - 12, k.y - 12, 24, 24);
      const z = k.zone ?? { x: k.x, y: k.y };
      this.zones.push({ type: "keeper", cx: z.x, cy: z.y, r: 68 });
    }
    for (const { secret, here, there } of secretsIn(this.room.id)) {
      this.zones.push({
        type: "secret",
        cx: here.x,
        cy: here.y,
        r: 46,
        id: secret.id,
        name: secret.name,
        to: there.room,
        // arrive just beside the far hatch (not on it — no bounce-back)
        spawn: { x: there.x, y: there.y - 48 },
      });
    }
    if (this.room.id === WANDER_CAT.room) {
      this.solid(WANDER_CAT.x - 16, WANDER_CAT.y - 12, 32, 26);
      this.zones.push({ type: "wander", cx: WANDER_CAT.zone.x, cy: WANDER_CAT.zone.y, r: 56 });
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
    // the weekly board: read it standing just in front (it's on the wall)
    this.zones.push({ type: "board", cx: KISSA_BOARD.x, cy: KISSA_BOARD.readY, r: 70 });
    // the drop box: a small solid you walk up to (suggest a record)
    this.solid(KISSA_DROPBOX.x - 19, KISSA_DROPBOX.y - 12, 38, 24);
    this.zones.push({ type: "dropbox", cx: KISSA_DROPBOX.x, cy: KISSA_DROPBOX.readY, r: 52 });
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
    this.zones.push({ type: "radio", cx: OMAKASE.radio.x, cy: OMAKASE.radio.y, r: 60 });
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

  private buildChamberFixtures() {
    // the stage is walkable (raised in 3D); the face behind it and the water
    // either side are not, so the stage is only reachable from the front
    const f = CHAMBER.face;
    this.solid(f.x, f.y, f.w, f.h);
    CHAMBER.water.forEach((w) => this.solid(w.x, w.y, w.w, w.h));
    CHAMBER.pillars.forEach((p) => this.solid(p.x - 20, p.y - 20, 40, 40));
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
    // …and the odd bit of gifted gear, so newcomers can see what's out there to earn
    const neck: Neck = Math.random() < 0.3 ? NECKS[1 + Math.floor(Math.random() * (NECKS.length - 1))] : "none";
    const eyes: Eyes = Math.random() < 0.25 ? EYES[1 + Math.floor(Math.random() * (EYES.length - 1))] : "none";
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
      neck,
      eyes,
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
      // …and any other text field (the 新着 paste box, shelf names): typing a
      // link must never fire hotkeys — "watch?v=" used to flip the camera
      const el = e.target as HTMLElement | null;
      const field = el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
      if (field) {
        // a field inside a closed (hidden) panel can keep focus — let it go, so
        // the keyboard comes straight back to the game
        const visible = el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
        if (!visible) el.blur();
        else if (e.key === "Escape") {
          el.blur(); // Esc still closes the panel you're typing in
          this.cb.onCloseOverlays();
          return;
        } else return;
      }
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)
      )
        e.preventDefault();
      const k = e.key.toLowerCase();
      this.keys[k] = true;
      if (k === "e") this.tryInteract();
      if (k === "v") this.toggleView();
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
      if (this.cb.isOverlayOpen() || !this.started || this.transitioning()) return;
      // click a THING (crate, door, keeper, hatch…) → walk there and use it;
      // click the floor → walk there. Either way the route goes around fixtures.
      const floor = this.view.screenToWorld(e.clientX, e.clientY);
      const z = this.zoneForPick(this.view.pick(e.clientX, e.clientY), floor);
      if (z) {
        this.pendingZone = z;
        this.walkTo({ x: z.cx, y: z.cy });
        // already standing in it? use it right away
        if (Math.hypot(this.player.x - z.cx, this.player.y - z.cy) < z.r * 0.85) this.arrive();
        return;
      }
      this.pendingZone = null;
      if (floor) this.walkTo(floor);
    };
    this.cv.addEventListener("pointerdown", this.onCanvasPointer);
    this.onCanvasHover = (e) => {
      if (e.pointerType !== "mouse") return;
      this.hover = this.cb.isOverlayOpen() ? null : this.view.pick(e.clientX, e.clientY);
      this.cv.style.cursor = this.hover ? "pointer" : "";
    };
    this.cv.addEventListener("pointermove", this.onCanvasHover);

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
    this.waypoints = [];
    this.pendingZone = null;
  }

  private tryInteract() {
    if (!this.started) return;
    if (this.cb.isOverlayOpen()) {
      this.cb.onCloseOverlays();
      return;
    }
    if (this.activeZone) this.interactZone(this.activeZone);
  }

  private interactZone(z: Zone) {
    if (this.transitioning()) return;
    if (z.type === "shelf") {
      if (z.shelf.data.ingest) this.cb.onOpenIngest();
      else this.cb.onBrowseShelf(z.shelf.data);
    } else if (z.type === "bar") {
      this.cb.onMastersPick();
    } else if (z.type === "board") {
      this.cb.onOpenBoard?.();
    } else if (z.type === "radio") {
      this.cb.onOpenRadio?.();
    } else if (z.type === "dropbox") {
      this.cb.onOpenIngest(); // the host decides: suggest (visitors) or add (owner)
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
      this.beginDoor(z.door.to);
    } else if (z.type === "keeper") {
      this.cb.onTalk?.(this.room.id);
    } else if (z.type === "secret") {
      const first = !this.secretsFound.has(z.id);
      this.secretsFound.add(z.id);
      this.cb.onSecret?.(z.id, first);
      if (this.fade === 0 && !this.pendingRoom) {
        this.pendingRoom = { id: z.to, fromDoor: "secret", spawn: z.spawn };
        this.fade = 0.0001;
      }
    } else if (z.type === "wander") {
      this.wander();
    }
  }

  /** Walk through a door: fade out, swap scenery at full dark, fade in. Audio is
   *  one shared stream and does NOT change. */
  private beginDoor(to: string) {
    if (this.fade === 0 && !this.pendingRoom) {
      this.pendingRoom = { id: to, fromDoor: this.room.id };
      this.fade = 0.0001; // begin fade-out
    }
  }

  private stopWalking() {
    this.moveTarget = null;
    this.waypoints = [];
    this.pendingZone = null;
  }

  /** Reached the thing you clicked — use it (the portal still wants its E). */
  private arrive() {
    const z = this.pendingZone;
    this.stopWalking();
    if (!z || z.type === "portal") return;
    this.interactZone(z);
  }

  /** What a click means: a picked 3D thing → its zone; else a floor point right
   *  on top of an interactive spot. */
  private zoneForPick(pick: PickRef | null, floor: { x: number; y: number } | null): Zone | null {
    if (pick) {
      const z = this.zones.find((z) => {
        if (z.type !== pick.kind) return false;
        if (z.type === "shelf") return z.shelf.data.id === pick.id;
        if (z.type === "door") return z.door.to === pick.id;
        if (z.type === "secret") return z.id === pick.id;
        return true;
      });
      if (z) return z;
    }
    if (!floor) return null;
    let best: Zone | null = null;
    let bd = 1e9;
    for (const z of this.zones) {
      if (z.type === "door" || z.type === "deck" || z.type === "bar" || z.type === "portal") continue;
      const d = Math.hypot(floor.x - z.cx, floor.y - z.cy);
      if (d < Math.min(z.r * 0.6, 40) && d < bd) {
        bd = d;
        best = z;
      }
    }
    return best;
  }

  /** Route to a floor point around the fixtures. */
  private walkTo(p: { x: number; y: number }) {
    const to = { x: clamp(p.x, WALL + 14, ROOM.w - WALL - 14), y: clamp(p.y, WALL + 14, ROOM.h - WALL - 14) };
    this.moveTarget = to;
    this.waypoints = this.findPath(this.player, to);
    this.stuck = { t: 0, x: this.player.x, y: this.player.y };
  }

  /* ----------------------------------------------------------- pathfinding */
  private buildGrid() {
    const g = new Uint8Array(GW * GH);
    const probe = { x: 0, y: 0, r: this.player.r + 5 };
    for (let j = 0; j < GH; j++)
      for (let i = 0; i < GW; i++) {
        probe.x = (i + 0.5) * CELL;
        probe.y = (j + 0.5) * CELL;
        for (const s of this.solids)
          if (this.circRect(probe, s)) {
            g[j * GW + i] = 1;
            break;
          }
      }
    this.grid = g;
  }

  /** true if the player could walk the straight segment a→b with `pad` px to spare */
  private clearLine(a: { x: number; y: number }, b: { x: number; y: number }, pad = 1): boolean {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(d / 6));
    const probe = { x: 0, y: 0, r: this.player.r + pad };
    for (let i = 1; i <= n; i++) {
      probe.x = a.x + ((b.x - a.x) * i) / n;
      probe.y = a.y + ((b.y - a.y) * i) / n;
      for (const s of this.solids) if (this.circRect(probe, s)) return false;
    }
    return true;
  }

  /** Grid A* (8-way, no corner cutting) → string-pulled waypoints. Falls back to
   *  a straight line when there's no route (you'll just bump into it). */
  private findPath(from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number }[] {
    const PAD = 7; // routes keep this far off corners — the walker drifts off the ideal line
    if (this.clearLine(from, to, PAD)) return [to];
    if (!this.grid) this.buildGrid();
    const g = this.grid!;
    const cell = (p: { x: number; y: number }) =>
      clamp(Math.floor(p.y / CELL), 0, GH - 1) * GW + clamp(Math.floor(p.x / CELL), 0, GW - 1);
    const free = (c: number) => {
      if (!g[c]) return c;
      // nearest open cell (small BFS) — e.g. you clicked on top of a fixture
      const seen = new Set([c]);
      const q = [c];
      while (q.length) {
        const k = q.shift()!;
        if (!g[k]) return k;
        const x = k % GW;
        const y = (k / GW) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
          const n = ny * GW + nx;
          if (!seen.has(n) && seen.size < 900) {
            seen.add(n);
            q.push(n);
          }
        }
      }
      return c;
    };
    const s0 = free(cell(from));
    const t0 = free(cell(to));
    const tx = t0 % GW;
    const ty = (t0 / GW) | 0;
    const h = (c: number) => {
      const dx = Math.abs((c % GW) - tx);
      const dy = Math.abs(((c / GW) | 0) - ty);
      return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
    };
    const gs = new Float32Array(GW * GH).fill(Infinity);
    const came = new Int32Array(GW * GH).fill(-1);
    const closed = new Uint8Array(GW * GH);
    // tiny binary heap of [f, cell]
    const heap: [number, number][] = [];
    const push = (f: number, c: number) => {
      heap.push([f, c]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    gs[s0] = 0;
    push(h(s0), s0);
    let found = false;
    while (heap.length) {
      const [, c] = pop();
      if (closed[c]) continue;
      closed[c] = 1;
      if (c === t0) {
        found = true;
        break;
      }
      const x = c % GW;
      const y = (c / GW) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
          const n = ny * GW + nx;
          if (g[n] || closed[n]) continue;
          if (dx && dy && (g[y * GW + nx] || g[ny * GW + x])) continue; // no corner cutting
          const ng = gs[c] + (dx && dy ? 1.414 : 1);
          if (ng < gs[n]) {
            gs[n] = ng;
            came[n] = c;
            push(ng + h(n), n);
          }
        }
    }
    if (!found) return [to];
    const cells: { x: number; y: number }[] = [];
    for (let c = t0; c !== -1 && c !== s0; c = came[c])
      cells.push({ x: ((c % GW) + 0.5) * CELL, y: (((c / GW) | 0) + 0.5) * CELL });
    cells.reverse();
    if (!g[cell(to)] && (!cells.length || this.clearLine(cells[cells.length - 1], to, PAD))) cells.push(to);
    // string-pull: keep only the corners you can't see past
    const out: { x: number; y: number }[] = [];
    let at: { x: number; y: number } = from;
    let i = 0;
    while (i < cells.length) {
      let j = cells.length - 1;
      while (j > i && !this.clearLine(at, cells[j], PAD)) j--;
      out.push(cells[j]);
      at = cells[j];
      i = j + 1;
    }
    return out.length ? out : [to];
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
      // a room change already under way finishes (a gift card that pops as you
      // take a passage greets you on arrival, it doesn't freeze the fade)
      this.updateTransition(dt);
      this.updatePrompt();
      return;
    }
    // while typing in chat or mid-room-transition, freeze the avatar (keep the
    // world alive). Transition freeze stops drifting through new walls.
    if (this.cb.isTyping() || this.transitioning()) {
      this.keys = {};
      this.stopWalking();
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
    if (kbMoving) this.stopWalking();
    if (kbMoving || this.moveTarget) this.danceMove = null; // walking off ends the move
    if (this.moveTarget) {
      // steer at the next waypoint; the last one is the target itself
      let wp = this.waypoints[0] ?? this.moveTarget;
      if (this.waypoints.length > 1 && Math.hypot(wp.x - this.player.x, wp.y - this.player.y) < 10) {
        this.waypoints.shift();
        wp = this.waypoints[0];
      }
      const dx = wp.x - this.player.x;
      const dy = wp.y - this.player.y;
      const d = Math.hypot(dx, dy);
      if (d > 6) {
        ix = dx / d;
        iy = dy / d;
      } else {
        this.moveTarget = null;
        this.waypoints = [];
      }
    }
    const m = Math.hypot(ix, iy) || 1;
    ix /= m;
    iy /= m;
    const moving =
      kbMoving || this.moveTarget || this.stickVec.x || this.stickVec.y;
    this.playerMoving = !!moving;
    // Shift sprints; a clicked route strides a little quicker than a stroll
    const sprint = k["shift"] ? 1.5 : this.moveTarget ? 1.3 : 1;
    const spd =
      (Math.hypot(this.stickVec.x, this.stickVec.y) || 1) * this.player.speed * sprint;
    this.moveEntity(this.player, ix * spd * dt, iy * spd * dt);
    if (ix) this.player.dir = ix > 0 ? 1 : -1;
    this.player.bob = moving ? this.player.bob + dt * 11 : 0;

    // clicked a thing: use it once you're standing in its zone
    const pz = this.pendingZone;
    if (pz && Math.hypot(this.player.x - pz.cx, this.player.y - pz.cy) < pz.r * 0.85) this.arrive();
    // a route that stopped making progress (blocked by a moving body) gives up
    if (this.moveTarget) {
      this.stuck.t += dt;
      if (this.stuck.t > 0.7) {
        if (Math.hypot(this.player.x - this.stuck.x, this.player.y - this.stuck.y) < 8) this.stopWalking();
        this.stuck = { t: 0, x: this.player.x, y: this.player.y };
      }
    }
    // walk INTO a doorway and you're through — no key needed
    if (moving) this.walkThroughDoors(ix, iy);

    this.npcs.forEach((n) => this.updateNpc(n, dt));
    this.updatePrompt();
    this.updatePortalCharge(dt);
    this.updateTransition(dt);
  }

  /** Pressed against a door frame while heading into it → step through. */
  private walkThroughDoors(ix: number, iy: number) {
    if (this.transitioning()) return;
    const probe = { x: this.player.x, y: this.player.y, r: this.player.r + 6 };
    for (const d of this.doors) {
      if (!this.circRect(probe, d)) continue;
      const [fx, fy] =
        d.facing === "left" ? [1, 0] : d.facing === "right" ? [-1, 0] : d.facing === "up" ? [0, 1] : [0, -1];
      if (ix * fx + iy * fy > 0.35) {
        this.beginDoor(d.to);
        return;
      }
    }
  }

  /**
   * Door fade/wipe transition. fade ramps 0→1 (out, screen darkens), the room
   * swaps at full dark, then 1→0 via a negative ramp (in). Music/sync are NEVER
   * touched here — only scenery + the player's room. Movement is frozen while the
   * screen is dark so you don't drift through the new room's walls.
   */
  private updateTransition(dt: number) {
    const RATE = 1 / 0.24; // ~240ms each way — quick, so moving between realms flows
    if (this.pendingRoom && this.fade > 0) {
      this.fade += dt * RATE;
      if (this.fade >= 1) {
        // mid-transition: actually enter the new room while fully dark
        this.enterRoom(this.pendingRoom.id, this.pendingRoom.fromDoor, this.pendingRoom.spawn);
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
  private enterRoom(roomId: string, fromRoom: string, spawn?: { x: number; y: number }) {
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
    const sp = this.freeSpot(spawn ?? next.spawns[fromRoom] ?? next.defaultSpawn);
    this.player.x = sp.x;
    this.player.y = sp.y;
    this.stopWalking();
    this.activeZone = null;
    this.lastPrompt = null;
    this.cb.onPrompt(null);
    this.cb.onRoomChange(next.id);
  }

  /** The nearest spot to `p` where the player fits (arrivals must never land
   *  inside a fixture — the collision resolver would freeze you there). */
  private freeSpot(p: { x: number; y: number }): { x: number; y: number } {
    const fits = (x: number, y: number) =>
      !this.solids.some((s) => this.circRect({ x, y, r: this.player.r + 2 }, s));
    if (fits(p.x, p.y)) return p;
    for (let r = 12; r <= 160; r += 12)
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const x = p.x + Math.cos(a) * r;
        const y = p.y + Math.sin(a) * r;
        if (fits(x, y)) return { x, y };
      }
    return p;
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
    if (roomId === "chamber") {
      // one listener pacing the front of the stage, clear of the water channels
      return [this.npc([{ x: 330, y: 420 }, { x: 810, y: 420 }, { x: 700, y: 560 }, { x: 440, y: 560 }], "#3a8a5a", "#15151a")];
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
          ? `Submit a record · <b>新着</b>`
          : `Dig through <b>${best.shelf.data.label}</b>`;
      if (best.type === "deck") s = `<b>Sombra Radio</b> · live on the deck`;
      if (best.type === "bar") s = `Talk to the <b>master</b> · who's leading this week`;
      if (best.type === "board") s = `Read <b>the board</b> · this week's diggers`;
      if (best.type === "dropbox") s = `Submit a record · <b>the drop box</b>`;
      if (best.type === "radio") s = `<b>Sombra Radio</b> · who picks the music`;
      if (best.type === "portal") s = `Enter the <b>rave</b>?`;
      if (best.type === "goldrecord")
        s = best.label ?? `Give <b>Houseum</b> their flowers — open their YouTube ↗`;
      if (best.type === "door") {
        // labels that already carry a direction ("back inside", "down to the
        // beach") read as "Head …"; plain destinations as "Step through to …"
        const l = best.door.label;
        s = /^(back|down|up|to)\b/.test(l) ? `Head <b>${l}</b>` : `Step through to <b>${l}</b>`;
      }
      if (best.type === "keeper") {
        const k = REALMS[this.room.id]?.keeper;
        s = k ? `Talk to <b>${k.name}</b> · ${k.title}` : "";
      }
      if (best.type === "secret")
        s = this.secretsFound.has(best.id)
          ? `Take <b>${best.name}</b> to ${REALMS[best.to]?.name ?? best.to}`
          : `Something hums under the floor… <b>look closer</b>`;
      if (best.type === "wander") s = `Rub the lucky cat — <b>wander somewhere random</b>`;
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
      { id: "player", x: this.player.x, y: this.player.y, fit: this.playerFit, moving, player: true, dance: this.danceNow() },
      ...this.npcs.map((n, i) => ({
        id: `npc:${this.room.id}:${i}`,
        x: n.x,
        y: n.y,
        fit: { skin: n.skin, body: n.color, hair: n.hair, hat: n.hat, neck: n.neck, eyes: n.eyes },
        moving: n.wait <= 0,
      })),
      ...this.remoteActors(), // other live listeners IN THIS ROOM (the lobby)
    ];
    // the realm's keeper (the cosmic cat keeper is part of the curator scenery)
    const keeper = REALMS[this.room.id]?.keeper;
    if (keeper && keeper.kind !== "cat") {
      const dx = this.player.x - keeper.x;
      const dy = this.player.y - keeper.y;
      actors.push({
        id: `keeper:${this.room.id}`,
        x: keeper.x,
        y: keeper.y,
        fit: keeper.fit,
        moving: false,
        // turns to greet you when you come close
        yaw: Math.hypot(dx, dy) < 190 ? Math.atan2(dx, dy) : 0,
        pick: { kind: "keeper" },
      });
    }
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
      speed: (Math.hypot(this.stickVec.x, this.stickVec.y) || 1) * (this.keys["shift"] ? 1.5 : 1),
      game: {
        realm: this.room.id,
        secretsFound: [...this.secretsFound],
        talked: this.talked.has(this.room.id),
        hover: this.hover,
      },
    });
  }

  /** The local dance move in progress, if any (ends itself after two bars). */
  private danceNow(): { move: DanceMove; t: number } | undefined {
    if (!this.danceMove) return undefined;
    const t = (performance.now() - this.danceMove.at) / 1000;
    if (t >= DANCE_SECONDS) {
      this.danceMove = null;
      return undefined;
    }
    return { move: this.danceMove.move, t };
  }

  /** The active zone as a plain reference the view can highlight. */
  private activeRef(): ActiveRef | null {
    const z = this.activeZone;
    if (!z) return null;
    if (z.type === "shelf") return { type: "shelf", id: z.shelf.data.id };
    if (z.type === "door") return { type: "door", to: z.door.to };
    if (z.type === "secret") return { type: "secret", id: z.id };
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
          fit: { skin: r.skin, body: r.color, hair: r.hair, hat: (r.hat as Hat) ?? "none", ...parseGear(r.gear) },
          moving: d > 0.8, // walk cycle only while closing distance
          // someone else's 💃 — played from when their broadcast landed
          dance:
            r.dance && performance.now() - r.dance.at < DANCE_SECONDS * 1000
              ? { move: r.dance.move as DanceMove, t: (performance.now() - r.dance.at) / 1000 }
              : undefined,
        };
      });
  }
}
