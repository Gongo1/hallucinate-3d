import type * as THREE from "three";
import type { RoomDef } from "../rooms";
import type { CuratorRoom } from "../curators";

/** What the engine's proximity zone currently points at (for highlights). */
export type ActiveRef =
  | { type: "shelf"; id: string }
  | { type: "door"; to: string }
  | { type: "pile"; idx: number }
  | { type: "secret"; id: string }
  | { type: "deck" | "bar" | "portal" | "goldrecord" | "keeper" | "wander" };

/** A clickable thing under the cursor (meshes carry this in userData.pick). */
export interface PickRef {
  kind: "shelf" | "door" | "keeper" | "pile" | "secret" | "deck" | "bar" | "portal" | "goldrecord" | "wander";
  id?: string;
}

/** The game layer's per-frame state (realms.ts data + your local progress). */
export interface GameFrame {
  realm: string;
  /** per dig pile: can it be dug right now */
  piles: { ready: boolean }[];
  /** a dig in progress (t 0..1) */
  dig: { idx: number; t: number } | null;
  secretsFound: string[];
  /** you've already talked to this realm's keeper */
  talked: boolean;
  hover: PickRef | null;
}

/** Per-frame read-only info a room's update() may use for its animation. */
export interface FrameInfo {
  /** seconds (performance clock) */
  t: number;
  dt: number;
  /** a track is audible — speakers pulse, turntables spin, listeners nod */
  playing: boolean;
  active: ActiveRef | null;
  /** rave-portal pull-through progress 0..1 (kissa only) */
  portalCharge: number;
  onAir: boolean;
  onAirDj: string | null;
  /** local player position (world px) */
  player: { x: number; y: number };
  camera: THREE.PerspectiveCamera;
  /** the clickable thing under the mouse (hover highlight) */
  hover: PickRef | null;
}

export interface RoomLight {
  /** hemisphere sky + ground colours and intensity (the fill) */
  sky: string;
  ground: string;
  hemi: number;
  /** key light (casts the shadows) — colour, intensity, direction it comes FROM */
  key: string;
  keyI: number;
  keyFrom?: [number, number, number];
}

/** What a room builder hands back to the world. */
export interface RoomView {
  group: THREE.Group;
  /** clear colour behind everything */
  bg: string;
  fog?: { color: string; near: number; far: number };
  light: RoomLight;
  /** NPCs here dance on the spot between strolls when music plays */
  dancers?: boolean;
  /** floor height under a point (raised platforms, stairs) — default 0 */
  floorAt?: (x: number, y: number) => number;
  update?: (f: FrameInfo) => void;
}

export interface BuildCtx {
  room: RoomDef;
  /** the curator config when this is a curator tribute room */
  curator?: CuratorRoom;
}

export type RoomBuilder = (ctx: BuildCtx) => RoomView;
