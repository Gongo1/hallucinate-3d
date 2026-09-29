import * as THREE from "three";
import type { RoomDoor } from "../rooms";
import type { Shelf } from "../types";
import { ROOM, WALL, DOOR_THEME, type CrateStyle, type DoorTheme } from "../layout";
import {
  box, block, mat, ownMat, glowMat, shade, rgba, glowPool, billboard, panel, rr, halo,
  radialTexture, motes, hex,
} from "./kit";
import type { FrameInfo } from "./types";

// Pieces every room shares: the room shell (floor + walls with door gaps), the
// themed doorways, and the record crates. Rooms add their own scenery on top.

export const WALL_H = 150; // back + side walls
export const DOOR_H = 112; // doorway opening height
export const FRONT_H = 18; // the near wall stays low so it never hides the room

/* ------------------------------------------------------------ shell */

export interface ShellOpts {
  /** floor colour (a plain faceted slab) — or false to build your own floor */
  floor: string | false;
  wall: string;
  /** a contrasting cap/trim along the wall tops + skirting */
  trim?: string;
  height?: number;
  front?: number;
  /** which walls to build (outdoor rooms drop some) */
  back?: boolean;
  left?: boolean;
  right?: boolean;
  frontWall?: boolean;
}

type Edge = "back" | "front" | "left" | "right";
function edgeOf(d: RoomDoor): Edge {
  if (d.facing === "down") return "back";
  if (d.facing === "up") return "front";
  if (d.facing === "right") return "left";
  return "right";
}

/** Floor slab + walls with gaps cut wherever this room has a door. */
export function shell(doors: RoomDoor[], o: ShellOpts): THREE.Group {
  const g = new THREE.Group();
  const H = o.height ?? WALL_H;
  const FH = o.front ?? FRONT_H;
  const wallM = mat(o.wall);
  const trimM = mat(o.trim ?? shade(o.wall, -24));

  if (o.floor) {
    const f = box(ROOM.w, 6, ROOM.h, o.floor);
    f.position.set(ROOM.w / 2, -6, ROOM.h / 2);
    f.castShadow = false;
    g.add(f);
  }

  // one wall edge = solid runs between the door gaps along it
  const run = (edge: Edge, height: number) => {
    const along = edge === "back" || edge === "front" ? ROOM.w : ROOM.h;
    const gaps = doors
      .filter((d) => edgeOf(d) === edge)
      .map((d) =>
        edge === "back" || edge === "front" ? [d.x - 12, d.x + d.w + 12] : [d.y - 12, d.y + d.h + 12]
      )
      .sort((a, b) => a[0] - b[0]);
    let s = 0;
    const segs: [number, number][] = [];
    for (const [a, b] of gaps) {
      if (a > s) segs.push([s, a]);
      s = Math.max(s, b);
    }
    if (s < along) segs.push([s, along]);
    const piece = (a: number, b: number, h: number, elev: number) => {
      const len = b - a;
      if (len <= 0.5) return;
      let m: THREE.Mesh;
      if (edge === "back") m = block({ x: a, y: 0, w: len, h: WALL }, h, wallM, elev);
      else if (edge === "front") m = block({ x: a, y: ROOM.h - WALL, w: len, h: WALL }, h, wallM, elev);
      else if (edge === "left") m = block({ x: 0, y: a, w: WALL, h: len }, h, wallM, elev);
      else m = block({ x: ROOM.w - WALL, y: a, w: WALL, h: len }, h, wallM, elev);
      g.add(m);
    };
    for (const [a, b] of segs) piece(a, b, height, 0);
    // over each door: the wall continues above the lintel (tall walls only)
    if (height > DOOR_H + 8) for (const [a, b] of gaps) piece(a, b, height - DOOR_H - 8, DOOR_H + 8);
    // a trim cap along the top so the wall edge reads against the dark
    const cap = (a: number, b: number) => {
      const len = b - a;
      let m: THREE.Mesh;
      if (edge === "back") m = block({ x: a, y: -2, w: len, h: WALL + 4 }, 5, trimM, height);
      else if (edge === "front") m = block({ x: a, y: ROOM.h - WALL - 2, w: len, h: WALL + 4 }, 4, trimM, height);
      else if (edge === "left") m = block({ x: -2, y: a, w: WALL + 4, h: len }, 5, trimM, height);
      else m = block({ x: ROOM.w - WALL - 2, y: a, w: WALL + 4, h: len }, 5, trimM, height);
      m.castShadow = false;
      g.add(m);
    };
    if (height > DOOR_H + 8) cap(0, along);
    else for (const [a, b] of segs) cap(a, b);
  };

  if (o.back !== false) run("back", H);
  if (o.left !== false) run("left", H);
  if (o.right !== false) run("right", H);
  if (o.frontWall !== false) run("front", FH);
  return g;
}

/* ------------------------------------------------------------ doors */

export interface DoorView {
  group: THREE.Group;
  update: (f: FrameInfo) => void;
}

/** A themed doorway (frame + glimpse + floor glow + placard), built from a RoomDoor.
 *  Styled by the room it LEADS to (DOOR_THEME[d.to]). */
export function buildDoor(d: RoomDoor): DoorView {
  const th: DoorTheme = DOOR_THEME[d.to] ?? DOOR_THEME.kissa;
  const g = new THREE.Group();
  const edge = edgeOf(d);
  const horiz = edge === "back" || edge === "front";
  const low = edge === "front"; // the near wall is low → a low gate, not a doorway
  const H = low ? 46 : DOOR_H;
  const cx = d.x + d.w / 2;
  const cy = d.y + d.h / 2;
  const span = horiz ? d.w + 16 : d.h + 16; // clear opening width
  const frameM = mat(th.frame);

  // local frame: the opening spans X (−span/2..span/2), the doorway faces +Z into
  // the room. Rotate for side walls.
  const local = new THREE.Group();
  const anim: ((f: FrameInfo, on: boolean) => void)[] = [];
  let gm: THREE.MeshBasicMaterial | null = null;
  if (low) {
    // the near wall is knee-high, so a front-wall door is a GATE: two short posts
    // with lantern caps in the destination's glow, a lit threshold, and chevrons
    // drifting out of the room — nothing tall between you and the view
    const capM = ownMat(th.glow, { emissive: th.glow, glow: 0.85 });
    for (const s of [-1, 1]) {
      const post = box(10, 28, 14, frameM);
      post.position.set(s * (span / 2 + 6), 0, 0);
      const cap = box(14, 9, 16, capM);
      cap.position.set(s * (span / 2 + 6), 28, 0);
      cap.castShadow = false;
      local.add(post, cap);
    }
    const sill = new THREE.Mesh(new THREE.PlaneGeometry(span, WALL + 26), glowMat(th.glow, 0.3, true));
    sill.rotation.x = -Math.PI / 2;
    sill.position.set(0, 1.2, 6);
    local.add(sill);
    const chevM = glowMat(th.accent, 0.8, true);
    const chevs: THREE.Group[] = [];
    for (let i = 0; i < 2; i++) {
      const c = new THREE.Group();
      for (const s of [-1, 1]) {
        const arm = box(18, 1, 3, chevM);
        arm.castShadow = false;
        arm.rotation.y = s * 0.6;
        arm.position.set(s * 7, 1.5, 0);
        c.add(arm);
      }
      local.add(c);
      chevs.push(c);
    }
    anim.push((f) => {
      chevs.forEach((c, i) => {
        const k = (f.t * 0.6 + i * 0.5) % 1;
        c.position.z = 34 - k * 40; // slide out through the gate
        chevM.opacity = 0.7;
      });
      capM.emissiveIntensity = 0.7 + 0.2 * Math.sin(f.t * 2);
    });
  } else {
    const T = 9;
    for (const s of [-1, 1]) {
      const post = box(T, H, WALL + 6, frameM);
      post.position.set(s * (span / 2 + T / 2), 0, 0);
      local.add(post);
    }
    const lintel = box(span + T * 2 + 14, 9, WALL + 10, frameM);
    lintel.position.y = H;
    local.add(lintel);
    const lintel2 = box(span + T * 2, 6, WALL + 4, mat(shade(th.frame, 18)));
    lintel2.position.y = H - 10;
    local.add(lintel2);

    // the glimpse beyond — an unlit gradient of the destination's glow
    const glimpseTex = radialTexture();
    gm = new THREE.MeshBasicMaterial({
      map: glimpseTex,
      color: hex(th.glow),
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(span, H), new THREE.MeshBasicMaterial({ color: hex(shade(th.glow, -90)), fog: false }));
    back.position.set(0, H / 2, -WALL / 2 - 2);
    const glimpse = new THREE.Mesh(new THREE.PlaneGeometry(span * 1.5, H * 1.5), gm);
    glimpse.position.set(0, H / 2, -WALL / 2);
    glimpse.renderOrder = 2;
    local.add(back, glimpse);

    // per-style accent detail
    if (th.style === "kissa" || th.style === "omakase") {
      // an indigo noren hung in the top of the opening (split panels)
      const n = 3;
      const pw = span / n - 2;
      for (let i = 0; i < n; i++) {
        const cloth = box(pw, H * 0.42, 1.5, mat("#2c3a5a"));
        cloth.position.set(-span / 2 + (i + 0.5) * (span / n), H * 0.58 - 2, WALL / 2 - 2);
        cloth.castShadow = false;
        local.add(cloth);
        anim.push((f) => {
          cloth.rotation.x = Math.sin(f.t * 1.3 + i) * 0.05;
        });
      }
      if (th.style === "kissa") {
        const glyph = panel(40, 40, (c) => {
          c.fillStyle = th.accent;
          c.font = "700 26px 'Shippori Mincho',serif";
          c.textAlign = "center";
          c.textBaseline = "middle";
          c.fillText("音", 20, 21);
        }, 14);
        glyph.position.set(0, H * 0.75, WALL / 2 - 0.4);
        local.add(glyph);
      }
    } else if (th.style === "garden") {
      // a little gabled eave over the doorway + fireflies in the glimpse
      for (const s of [-1, 1]) {
        const eave = box((span + 40) / 2 + 6, 5, WALL + 20, mat("#3a2817"));
        eave.geometry.translate(0, 0, 0);
        eave.position.set(s * (span + 40) / 4, H + 12, 0);
        eave.rotation.z = -s * 0.32;
        local.add(eave);
      }
      const ff = motes(4, "#eaff9a", 7, 0.9);
      local.add(ff);
      anim.push((f) => {
        const p = ff.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < 4; i++) {
          const a = f.t * 0.9 + i * 1.7;
          p.setXYZ(i, Math.cos(a) * span * 0.3, H * 0.45 + Math.sin(a * 1.3) * H * 0.25, -4);
        }
        p.needsUpdate = true;
      });
    } else if (th.style === "berlin") {
      // pulsing red light strips down the posts
      const stripM = glowMat(th.glow, 1);
      for (const s of [-1, 1]) {
        const strip = box(2.5, H - 6, 2.5, stripM);
        strip.castShadow = false;
        strip.position.set(s * (span / 2 + 1), 3, WALL / 2 + 3);
        local.add(strip);
      }
      const fog = halo(90, "#9aa0b4", 0.18);
      fog.position.set(0, 10, WALL / 2 + 16);
      local.add(fog);
      anim.push((f) => {
        stripM.opacity = 0.55 + 0.45 * Math.sin(f.t * 4.2);
        stripM.transparent = true;
      });
    } else if (th.style === "tearoom") {
      // a soft shoji lattice across the opening
      const lat = mat(shade(th.frame, 30));
      for (let x = -span / 2 + 14; x < span / 2; x += 18) {
        const v = box(1.6, H - 4, 1.6, lat);
        v.castShadow = false;
        v.position.set(x, 2, WALL / 2 - 4);
        local.add(v);
      }
      for (let y = 14; y < H; y += 20) {
        const hbar = box(span, 1.6, 1.6, lat);
        hbar.castShadow = false;
        hbar.position.set(0, y, WALL / 2 - 4);
        local.add(hbar);
      }
      const paper = new THREE.Mesh(new THREE.PlaneGeometry(span, H), glowMat("#f4ecd8", 0.18));
      paper.position.set(0, H / 2, WALL / 2 - 5);
      local.add(paper);
    } else if (th.style === "cosmic") {
      // a starry portal into the cosmos — drifting sparks in the opening
      const st = motes(14, "#ffffff", 4, 0.9);
      local.add(st);
      const seeds = Array.from({ length: 14 }, (_, i) => [((i * 37) % 97) / 97, ((i * 53) % 89) / 89, i]);
      anim.push((f) => {
        const p = st.geometry.attributes.position as THREE.BufferAttribute;
        seeds.forEach(([sx, sy, i], k) => {
          const x = ((sx + f.t * 0.02 * (1 + (i % 3))) % 1) - 0.5;
          const y = (sy + f.t * 0.03) % 1;
          p.setXYZ(k, x * span, y * H, -2);
        });
        p.needsUpdate = true;
      });
    }
  }

  // orient: back-wall doors face +Z already; side doors turn to face the room
  if (edge === "left") local.rotation.y = Math.PI / 2;
  else if (edge === "right") local.rotation.y = -Math.PI / 2;
  else if (edge === "front") local.rotation.y = Math.PI;
  const wx = edge === "left" ? WALL / 2 : edge === "right" ? ROOM.w - WALL / 2 : cx;
  const wy = edge === "back" ? WALL / 2 : edge === "front" ? ROOM.h - WALL / 2 : cy;
  local.position.set(wx, 0, wy);
  g.add(local);

  // floor glow spilling into the room (colour-codes the gateway; brighter near)
  const zx = edge === "left" ? WALL + 40 : edge === "right" ? ROOM.w - WALL - 40 : cx;
  const zy = edge === "back" ? WALL + 36 : edge === "front" ? ROOM.h - WALL - 36 : cy;
  const pool = glowPool(zx, zy, horiz ? 120 : 130, th.glow, 0.3);
  g.add(pool);

  // the always-visible placard: kanji chip + → NAME + vibe
  const drawSign = (on: boolean) => (c: CanvasRenderingContext2D, w: number, h: number) => {
    c.fillStyle = "rgba(13,10,7,.86)";
    rr(c, 2, 2, w - 4, h - 4, 8);
    c.fill();
    c.strokeStyle = rgba(th.accent, on ? 0.95 : 0.5);
    c.lineWidth = on ? 2.2 : 1.3;
    if (on) {
      c.shadowColor = th.glow;
      c.shadowBlur = 12;
    }
    rr(c, 2, 2, w - 4, h - 4, 8);
    c.stroke();
    c.shadowBlur = 0;
    c.fillStyle = rgba(th.accent, 0.14);
    rr(c, 8, 8, 34, h - 16, 4);
    c.fill();
    c.textBaseline = "middle";
    c.textAlign = "center";
    c.fillStyle = th.accent;
    c.font = "800 15px 'Shippori Mincho',serif";
    c.fillText(th.kanji.slice(0, 2), 25, h / 2);
    c.textAlign = "left";
    c.font = "900 13px 'Anton',sans-serif";
    c.fillText("→ " + th.name, 50, 17);
    c.fillStyle = "rgba(241,230,210,.66)";
    c.font = "8px 'DM Mono'";
    c.fillText(th.vibe, 50, 31);
  };
  const sign = billboard(162, 46, drawSign(false), 150);
  // Where the plaque hangs. Doorways: on the wall just above the lintel, leaning
  // into the room — never on the floor, where you spawn / stand to use the door.
  // Gates (knee-high front wall): beside the gate, toward the room's middle.
  let px: number, py: number, pz: number;
  if (low) {
    const side = cx < ROOM.w / 2 ? 1 : -1;
    px = cx + side * (d.w / 2 + 96);
    py = d.y - 12;
    pz = 44;
    // reads over hedges / low fixtures in front of the gate
    (sign.material as THREE.SpriteMaterial).depthTest = false;
  } else {
    px = edge === "left" ? WALL + 34 : edge === "right" ? ROOM.w - WALL - 34 : cx;
    py = edge === "back" ? WALL + 26 : cy;
    pz = DOOR_H + 30;
  }
  sign.position.set(px, pz, py);
  g.add(sign);

  let wasOn = false;
  const poolM = pool.material as THREE.MeshBasicMaterial;
  return {
    group: g,
    update: (f) => {
      const on =
        (f.active?.type === "door" && f.active.to === d.to) || (f.hover?.kind === "door" && f.hover.id === d.to);
      if (on !== wasOn) {
        wasOn = on;
        sign.label.redraw(drawSign(on));
        poolM.opacity = on ? 0.55 : 0.3;
        pool.scale.setScalar(on ? 1.35 : 1);
      }
      if (gm) gm.opacity = 0.8 + 0.2 * Math.sin(f.t * 1.6);
      for (const a of anim) a(f, on);
    },
  };
}

/* ------------------------------------------------------------ crates */

export interface CrateObj {
  data: Shelf;
  x: number;
  y: number;
  w: number;
  h: number;
  labelSide: "left" | "right";
}

export interface CrateView {
  group: THREE.Group;
  id: string;
  update: (f: FrameInfo) => void;
}

const CRATE_H = 30;

/** A record crate: a bin in the room's material, records standing inside, the
 *  hero sleeve + vinyl pulled to the front, and a genre tag beside it. */
export function buildCrate(o: CrateObj, st: CrateStyle): CrateView {
  const g = new THREE.Group();
  const d = o.data;
  const col = d.color;
  const x0 = o.x - o.w / 2;
  const y0 = o.y - o.h / 2;

  if (d.ingest) return buildIngestCrate(o);

  // the bin: floor, four walls, a lit lip
  const binM = mat(st.bin);
  const edgeM = mat(st.binEdge);
  const wallT = 5;
  g.add(block({ x: x0, y: y0, w: o.w, h: o.h }, 4, binM));
  g.add(block({ x: x0, y: y0, w: o.w, h: wallT }, CRATE_H, binM));
  g.add(block({ x: x0, y: y0 + o.h - wallT, w: o.w, h: wallT }, CRATE_H - 6, binM));
  g.add(block({ x: x0, y: y0, w: wallT, h: o.h }, CRATE_H, binM));
  g.add(block({ x: x0 + o.w - wallT, y: y0, w: wallT, h: o.h }, CRATE_H, binM));
  const lip = block({ x: x0 - 1, y: y0 - 1, w: o.w + 2, h: 4 }, 3, edgeM, CRATE_H);
  lip.castShadow = false;
  g.add(lip);
  // a hand-hold slot on the near face
  const slot = box(o.w * 0.3, 5, 1, mat("#140e09"));
  slot.position.set(o.x, CRATE_H - 14, y0 + o.h + 0.2);
  slot.castShadow = false;
  g.add(slot);

  // records standing in the bin — the spines you flip through
  const pad = 9;
  const innerW = o.w - pad * 2;
  const n = Math.max(7, Math.min(16, d.records.length + 4));
  const slotW = innerW / n;
  const recA = mat(shade(col, 16));
  const recB = mat(shade(col, -36));
  for (let i = 0; i < n; i++) {
    const r = box(Math.max(1.2, slotW - 1.4), CRATE_H + 8 - (i % 3) * 2, o.h - wallT * 2 - 4, i % 2 ? recB : recA);
    r.position.set(x0 + pad + (i + 0.5) * slotW, 3, o.y);
    r.rotation.z = -0.12 + (i % 3) * 0.05;
    g.add(r);
  }

  // the HERO record, pulled to the front and leaning — sleeve + vinyl + motif
  const s = Math.min(o.h - 14, o.w * 0.42, 44);
  const hero = new THREE.Group();
  const sleeve = panel(64, 64, (c, w, h) => {
    const grad = c.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, shade(col, 30));
    grad.addColorStop(1, shade(col, -54));
    c.fillStyle = grad;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "rgba(0,0,0,.4)";
    c.lineWidth = 2;
    c.strokeRect(1, 1, w - 2, h - 2);
    drawMotif(c, st.motif, w, col);
  }, s, 3, true);
  sleeve.position.set(0, s / 2, 0.8);
  const vinyl = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.46, s * 0.46, 1, 16), mat("#0c0c0e"));
  vinyl.rotation.x = Math.PI / 2;
  vinyl.position.set(s * 0.42, s / 2, 0);
  const label = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.14, s * 0.14, 1.4, 10), mat(st.disc));
  label.rotation.x = Math.PI / 2;
  label.position.set(s * 0.42, s / 2, 0);
  hero.add(vinyl, label, sleeve);
  hero.position.set(o.x - s * 0.18, 2, y0 + o.h + 2);
  hero.rotation.x = -0.22;
  hero.rotation.z = -0.05;
  g.add(hero);

  // the genre tag — a camera-facing placard on the open (browse) side
  const labelLeft = o.labelSide === "left";
  const tag = billboard(108, 30, (c, w, h) => {
    c.fillStyle = "rgba(14,11,8,.78)";
    rr(c, 1, 1, w - 2, h - 2, 5);
    c.fill();
    c.fillStyle = col;
    c.fillRect(1, 1, 3.5, h - 2);
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.font = "700 10px 'DM Mono'";
    c.fillText(d.label.replace(/·.*/, "").trim().slice(0, 17), 11, 11);
    c.fillStyle = "rgba(241,230,210,.55)";
    c.font = "8.5px 'DM Mono'";
    c.fillText(`${d.records.length} records`, 11, 22);
  }, 94);
  tag.position.set(labelLeft ? x0 - 54 : x0 + o.w + 54, 40, o.y);
  g.add(tag);

  // active highlight: glowing edges + a pool of the crate colour
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(o.w + 8, CRATE_H + 10, o.h + 8)),
    new THREE.LineBasicMaterial({ color: hex(col), transparent: true, opacity: 0.9 })
  );
  edges.position.set(o.x, (CRATE_H + 10) / 2 - 2, o.y);
  edges.visible = false;
  const pool = glowPool(o.x, o.y, o.w * 0.95, col, 0.35);
  pool.visible = false;
  g.add(edges, pool);

  return {
    group: g,
    id: d.id,
    update: (f) => {
      const on =
        (f.active?.type === "shelf" && f.active.id === d.id) || (f.hover?.kind === "shelf" && f.hover.id === d.id);
      edges.visible = on;
      pool.visible = on;
      if (on) (edges.material as THREE.LineBasicMaterial).opacity = 0.6 + 0.4 * Math.sin(f.t * 5);
      hero.position.y = 2 + (on ? 4 + Math.sin(f.t * 3) * 1.5 : 0); // the record lifts to greet you
    },
  };
}

/** The 新着 NEW ARRIVALS paste crate — a pulsing "drop your links here" bin. */
function buildIngestCrate(o: CrateObj): CrateView {
  const g = new THREE.Group();
  const col = o.data.color;
  const x0 = o.x - o.w / 2;
  const y0 = o.y - o.h / 2;
  const binM = mat("#2a160f");
  g.add(block({ x: x0, y: y0, w: o.w, h: o.h }, CRATE_H, binM));
  // a glowing rim around the open top (four bars — the paste slot stays open)
  const rimM = ownMat(col, { emissive: col, glow: 0.8 });
  for (const r of [
    { x: x0 - 2, y: y0 - 2, w: o.w + 4, h: 4 },
    { x: x0 - 2, y: y0 + o.h - 2, w: o.w + 4, h: 4 },
    { x: x0 - 2, y: y0 - 2, w: 4, h: o.h + 4 },
    { x: x0 + o.w - 2, y: y0 - 2, w: 4, h: o.h + 4 },
  ]) {
    const bar = block(r, 3, rimM, CRATE_H);
    bar.castShadow = false;
    g.add(bar);
  }
  const face = panel(120, 56, (c, w, h) => {
    c.fillStyle = col;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = "900 26px 'Shippori Mincho',serif";
    c.fillText("新着", w / 2, h / 2 - 8);
    c.font = "10px 'DM Mono'";
    c.fillStyle = "rgba(241,230,210,.8)";
    c.fillText("＋ DROP LINKS", w / 2, h / 2 + 16);
  }, Math.min(o.w - 8, 100));
  face.rotation.x = -Math.PI / 2;
  face.position.set(o.x, CRATE_H + 0.8, o.y);
  g.add(face);
  const pool = glowPool(o.x, o.y, o.w * 0.8, col, 0.2);
  g.add(pool);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(o.w + 8, CRATE_H + 10, o.h + 8)),
    new THREE.LineBasicMaterial({ color: hex(col), transparent: true, opacity: 0.9 })
  );
  edges.position.set(o.x, (CRATE_H + 10) / 2 - 2, o.y);
  edges.visible = false;
  g.add(edges);
  const pm = pool.material as THREE.MeshBasicMaterial;
  return {
    group: g,
    id: o.data.id,
    update: (f) => {
      const pulse = 0.5 + 0.5 * Math.sin(f.t / 0.6);
      rimM.emissiveIntensity = 0.5 + pulse * 0.7;
      pm.opacity = 0.14 + pulse * 0.12;
      edges.visible =
        (f.active?.type === "shelf" && f.active.id === o.data.id) ||
        (f.hover?.kind === "shelf" && f.hover.id === o.data.id);
    },
  };
}

/** A small graphic stamped on a sleeve, themed to the room (canvas coords). */
function drawMotif(c: CanvasRenderingContext2D, motif: CrateStyle["motif"], s: number, col: string) {
  const a = "rgba(255,255,255,.6)";
  c.save();
  c.translate(s / 2, s / 2);
  const cy = -s * 0.13;
  if (motif === "moon") {
    c.fillStyle = a;
    c.beginPath();
    c.arc(0, cy, s * 0.16, 0, 7);
    c.fill();
    c.fillStyle = shade(col, -54);
    c.beginPath();
    c.arc(s * 0.07, cy - s * 0.04, s * 0.15, 0, 7);
    c.fill();
  } else if (motif === "leaf") {
    c.fillStyle = a;
    c.translate(0, cy);
    c.rotate(0.5);
    c.beginPath();
    c.ellipse(0, 0, s * 0.08, s * 0.2, 0, 0, 7);
    c.fill();
  } else if (motif === "dot") {
    c.strokeStyle = a;
    c.lineWidth = 2;
    c.beginPath();
    c.arc(0, cy, s * 0.15, 0, 7);
    c.stroke();
    c.fillStyle = a;
    c.beginPath();
    c.arc(0, cy, s * 0.045, 0, 7);
    c.fill();
  } else if (motif === "bar") {
    c.fillStyle = a;
    c.fillRect(-s * 0.3, cy - s * 0.04, s * 0.6, s * 0.08);
  } else if (motif === "holo") {
    const cols = ["rgba(255,138,214,.85)", "rgba(138,255,214,.85)", "rgba(138,156,255,.85)"];
    for (let i = 0; i < 3; i++) {
      c.fillStyle = cols[i];
      const o = (i - 1) * 3;
      c.beginPath();
      c.moveTo(-s * 0.18 + o, cy);
      c.lineTo(o, cy - s * 0.18);
      c.lineTo(s * 0.18 + o, cy);
      c.lineTo(o, cy + s * 0.18);
      c.closePath();
      c.fill();
    }
  } else {
    c.strokeStyle = a;
    c.lineWidth = 1.8;
    for (let r = s * 0.07; r < s * 0.24; r += s * 0.075) {
      c.beginPath();
      c.arc(0, cy + s * 0.06, r, Math.PI * 1.15, Math.PI * 1.85);
      c.stroke();
    }
  }
  c.restore();
}
