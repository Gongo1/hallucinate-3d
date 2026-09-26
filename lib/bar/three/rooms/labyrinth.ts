import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ROOM, WALL, LAB_GRID, LAB_COLS, LAB_ROWS, LAB_CW, LAB_CH } from "../../layout";
import type { FrameInfo, RoomBuilder } from "../types";
import {
  box, cyl, cone, ico, lump, mat, ownMat, glowMat, glowPool, halo, lamp, panel, motes, rr, rng,
} from "../kit";

// THE LABYRINTH — a real bamboo-hedge maze. Every '#' in LAB_GRID is a hedge on
// exactly that cell's footprint (the engine's collision solids), so the walls you
// see are the walls you hit. Hedges stay low (the tilted camera must see into the
// corridors behind them) over pale raked gravel, with stone lanterns at a few
// turns, fireflies over the tops, and a lit stone circle round the hidden crate.

const HEDGE_H = 48; // maze hedges — low enough to see the corridor behind
const BORDER_H = 56; // the outer boundary hedge
const FRONT_H = 30; // the near edge stays low so it never hides the maze
const BODY = "#334527";
const CROWNS = ["#5d7a3c", "#63823f", "#587538"];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A lumpy, faceted hedge crown: a segmented box with its vertices nudged. */
function crownGeo(w: number, d: number, h: number, seed: number): THREE.BufferGeometry {
  const sx = Math.max(1, Math.round(w / 28));
  const sz = Math.max(1, Math.round(d / 28));
  let g: THREE.BufferGeometry = new THREE.BoxGeometry(w, h, d, sx, 2, sz);
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  g = mergeVertices(g);
  const R = rng(seed);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const ex = Math.abs(x) > w / 2 - 0.01;
    const ez = Math.abs(z) > d / 2 - 0.01;
    p.setXYZ(
      i,
      x + (ex ? (R() - 0.3) * 3 * Math.sign(x) : (R() - 0.5) * 5),
      y + (y > 0 ? R() * 5 : (R() - 0.5) * 2),
      z + (ez ? (R() - 0.3) * 3 * Math.sign(z) : (R() - 0.5) * 5)
    );
  }
  g.translate(0, h / 2, 0);
  g.computeVertexNormals();
  return g;
}

export const buildLabyrinth: RoomBuilder = ({ room }) => {
  const g = new THREE.Group();
  const anim: ((f: FrameInfo) => void)[] = [];
  const R = rng(31);

  /* ---------------- ground: pale raked gravel (light, so dark hedges read as walls) */
  const slab = box(ROOM.w, 6, ROOM.h, "#565a44");
  slab.position.set(ROOM.w / 2, -6, ROOM.h / 2);
  slab.castShadow = false;
  g.add(slab);
  const gravel = panel(ROOM.w, ROOM.h, (c, w, h) => {
    c.fillStyle = "#8d9274";
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "rgba(0,0,0,.09)";
    c.lineWidth = 1;
    for (let x = 0; x < w; x += 12) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, h);
      c.stroke();
    }
    c.strokeStyle = "rgba(255,255,255,.05)";
    for (let x = 6; x < w; x += 12) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, h);
      c.stroke();
    }
    const pr = rng(5);
    for (let i = 0; i < 900; i++) {
      c.fillStyle = pr() < 0.5 ? "rgba(255,255,255,.09)" : "rgba(0,0,0,.10)";
      c.fillRect(pr() * w, pr() * h, 1.5, 1.5);
    }
  }, ROOM.w, 1, true);
  gravel.rotation.x = -Math.PI / 2;
  gravel.position.set(ROOM.w / 2, 0.2, ROOM.h / 2);
  gravel.receiveShadow = true;
  g.add(gravel);

  /* ---------------- hedges: one body + lumpy crown per horizontal run */
  const bodyM = mat(BODY);

  const stalks: { x: number; z: number; h: number; light: boolean }[] = [];
  let seed = 100;
  const hedge = (r: Rect, H: number, withStalks = true) => {
    if (r.w <= 0.5 || r.h <= 0.5) return;
    const body = box(r.w, H - 8, r.h, bodyM);
    body.position.set(r.x + r.w / 2, 0, r.y + r.h / 2);
    g.add(body);
    const crown = new THREE.Mesh(crownGeo(r.w, r.h, 11, seed), mat(CROWNS[seed++ % CROWNS.length]));
    crown.castShadow = true;
    crown.receiveShadow = true;
    crown.position.set(r.x + r.w / 2, H - 10, r.y + r.h / 2);
    g.add(crown);
    // a few leafy tufts breaking the silhouette
    const n = Math.max(1, Math.round((r.w * r.h) / (LAB_CW * LAB_CH)));
    for (let i = 0; i < n; i++) {
      const t = lump(9 + R() * 6, R() < 0.5 ? "#6b8c45" : "#54703a", seed++, 0.3, 1, 0.6, 1, 0);
      t.position.set(r.x + 10 + R() * Math.max(0, r.w - 20), H + 1, r.y + 10 + R() * Math.max(0, r.h - 20));
      g.add(t);
    }
    // bamboo stalks along the face the camera sees (south)
    if (withStalks)
      for (let x = r.x + 7; x < r.x + r.w - 3; x += 7.5) {
        const light = Math.round((x - r.x) / 7.5) % 2 === 0;
        stalks.push({ x, z: r.y + r.h + 1.3, h: H - 8 - (light ? 0 : 3) + R() * 4, light });
      }
  };

  // maze hedges straight from the grid — horizontal runs merge (as the solids do)
  for (let r = 0; r < LAB_ROWS; r++) {
    let run = -1;
    for (let c = 0; c <= LAB_COLS; c++) {
      const isHedge = c < LAB_COLS && LAB_GRID[r][c] === "#";
      if (isHedge && run < 0) run = c;
      if (!isHedge && run >= 0) {
        hedge({ x: WALL + run * LAB_CW, y: WALL + r * LAB_CH, w: (c - run) * LAB_CW, h: LAB_CH }, HEDGE_H);
        run = -1;
      }
    }
  }

  // the outer boundary hedge, gapped wherever a door opens
  const gaps = (edge: "back" | "front" | "left" | "right") =>
    room.doors
      .filter((d) =>
        edge === "back"
          ? d.facing === "down"
          : edge === "front"
            ? d.facing === "up"
            : edge === "left"
              ? d.facing === "right"
              : d.facing === "left"
      )
      .map((d) => (edge === "back" || edge === "front" ? [d.x - 12, d.x + d.w + 12] : [d.y - 12, d.y + d.h + 12]))
      .sort((a, b) => a[0] - b[0]);
  const segs = (len: number, gs: number[][]) => {
    const out: [number, number][] = [];
    let s = 0;
    for (const [a, b] of gs) {
      if (a > s) out.push([s, a]);
      s = Math.max(s, b);
    }
    if (s < len) out.push([s, len]);
    return out;
  };
  for (const [a, b] of segs(ROOM.w, gaps("back"))) hedge({ x: a, y: 0, w: b - a, h: WALL }, BORDER_H);
  for (const [a, b] of segs(ROOM.w, gaps("front"))) hedge({ x: a, y: ROOM.h - WALL, w: b - a, h: WALL }, FRONT_H, false);
  for (const [a, b] of segs(ROOM.h, gaps("left"))) hedge({ x: 0, y: a, w: WALL, h: b - a }, BORDER_H, false);
  for (const [a, b] of segs(ROOM.h, gaps("right"))) hedge({ x: ROOM.w - WALL, y: a, w: WALL, h: b - a }, BORDER_H, false);

  // all bamboo stalks in two instanced draws (light + shadowed) + their nodes
  const m4 = new THREE.Matrix4();
  for (const light of [true, false]) {
    const list = stalks.filter((s) => s.light === light);
    const geo = new THREE.CylinderGeometry(1.7, 1.9, 1, 5);
    geo.translate(0, 0.5, 0);
    const im = new THREE.InstancedMesh(geo, ownMat(light ? "#96b96e" : "#2d3a1f"), list.length);
    list.forEach((s, i) => {
      m4.makeScale(1, s.h, 1).setPosition(s.x, 2, s.z);
      im.setMatrixAt(i, m4);
    });
    im.castShadow = false;
    im.receiveShadow = true;
    im.frustumCulled = false;
    g.add(im);
    if (light) {
      const nodes: [number, number, number][] = [];
      for (const s of list) for (let y = 14; y < s.h - 2; y += 13) nodes.push([s.x, y, s.z]);
      const nm = new THREE.InstancedMesh(new THREE.CylinderGeometry(2.3, 2.3, 1.4, 5), ownMat("#b8d488"), nodes.length);
      nodes.forEach(([x, y, z], i) => {
        m4.makeTranslation(x, y, z);
        nm.setMatrixAt(i, m4);
      });
      nm.castShadow = false;
      nm.frustumCulled = false;
      g.add(nm);
    }
  }

  /* ---------------- the hidden centre chamber (crate cell c4r4) */
  const ccx = WALL + 4.5 * LAB_CW;
  const ccy = WALL + 4.5 * LAB_CH;
  const pool = glowPool(ccx, ccy, 130, "#cfe8a8", 0.22);
  g.add(pool);
  const ringG = new THREE.RingGeometry(56, 63, 28);
  ringG.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(ringG, mat("#4a5436"));
  ring.position.set(ccx, 0.5, ccy);
  ring.receiveShadow = true;
  g.add(ring);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.2;
    const peb = lump(4 + R() * 2, "#b8b6a4", 300 + i, 0.3, 1, 0.45, 1, 0);
    peb.position.set(ccx + Math.cos(a) * 70, 1, ccy + Math.sin(a) * 70);
    peb.castShadow = false;
    g.add(peb);
  }
  // a few glinting motes rising off the crate — the treasure, found
  const SP = 10;
  const sparks = motes(SP, "#e8ffc0", 7, 0.9);
  const sp = Array.from({ length: SP }, () => [R(), R() * Math.PI * 2, 10 + R() * 30]);
  g.add(sparks);
  anim.push((f) => {
    const p = sparks.geometry.attributes.position as THREE.BufferAttribute;
    sp.forEach((s, i) => {
      s[0] = (s[0] + f.dt * 0.22) % 1;
      p.setXYZ(i, ccx + Math.cos(s[1] + f.t * 0.4) * s[2], 34 + s[0] * 60, ccy + Math.sin(s[1] + f.t * 0.4) * s[2] * 0.7);
    });
    p.needsUpdate = true;
    (sparks.material as THREE.PointsMaterial).opacity = 0.55 + 0.3 * Math.sin(f.t * 2.2);
    (pool.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.05 * Math.sin(f.t * 1.4);
  });

  /* ---------------- stone lanterns (tōrō), tucked against a hedge at a few turns.
     Each sits on the NORTH side of its corridor so no hedge hides it from camera. */
  const lanterns: [number, number][] = [
    [134, 42],
    [1004, 412],
    [460, 598],
    [668, 226],
  ];
  const stone = mat("#76766a");
  const stoneDark = mat("#5a5a50");
  const flame = glowMat("#ffd68c");
  for (const [x, y] of lanterns) {
    const t = new THREE.Group();
    const base = cyl(8, 9, 4, 6, stoneDark);
    const post = cyl(3.2, 3.8, 14, 6, stone);
    post.position.y = 4;
    const tray = cyl(8, 6, 3, 6, stoneDark);
    tray.position.y = 18;
    const fire = box(12, 10, 12, stone);
    fire.position.y = 21;
    const glassA = box(13, 5, 7, flame);
    glassA.position.y = 23.5;
    glassA.castShadow = false;
    const glassB = box(7, 5, 13, flame);
    glassB.position.y = 23.5;
    glassB.castShadow = false;
    const roof = cone(12, 7, 4, stoneDark);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 31;
    const fin = ico(2.4, stone);
    fin.position.y = 39.5;
    t.add(base, post, tray, fire, glassA, glassB, roof, fin);
    t.position.set(x, 0, y);
    t.scale.setScalar(1.25);
    g.add(t);
    const h = halo(60, "#ffc878", 0.4);
    h.position.set(x, 30, y + 2);
    g.add(h);
    const lp = glowPool(x, y + 16, 80, "#ffc878", 0.16);
    g.add(lp);
    const l = lamp("#ffc47a", 0.9, 230);
    l.position.set(x, 30, y + 10);
    g.add(l);
    anim.push((f) => {
      const lf = 0.6 + 0.4 * Math.sin(f.t / 0.7 + x);
      l.intensity = 0.65 + lf * 0.45;
      (h.material as THREE.SpriteMaterial).opacity = 0.25 + lf * 0.25;
      (lp.material as THREE.MeshBasicMaterial).opacity = 0.1 + lf * 0.08;
    });
  }

  /* ---------------- fireflies drifting over the hedge tops */
  const FF = 10;
  const ff = motes(FF, "#eaff9a", 9, 0.85);
  g.add(ff);
  anim.push((f) => {
    const p = ff.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < FF; i++) {
      const a = f.t / 2.6 + i * 1.7;
      p.setXYZ(
        i,
        ROOM.w / 2 + Math.cos(a + i) * (180 + i * 36),
        62 + Math.sin(a * 1.3 + i) * 14,
        ROOM.h / 2 + Math.sin(a * 0.8 + i * 2) * (140 + i * 22)
      );
    }
    p.needsUpdate = true;
    (ff.material as THREE.PointsMaterial).opacity = 0.55 + 0.35 * Math.abs(Math.sin(f.t * 0.9));
  });

  /* ---------------- the name board, staked into the front hedge row */
  const board = new THREE.Group();
  const plank = box(236, 30, 5, "#3a2a1a");
  plank.position.y = -15;
  const label = panel(236, 30, (c, w, h) => {
    c.fillStyle = "#3a2a1a";
    rr(c, 0, 0, w, h, 4);
    c.fill();
    c.strokeStyle = "rgba(207,232,168,.45)";
    c.lineWidth = 1.2;
    rr(c, 2, 2, w - 4, h - 4, 3);
    c.stroke();
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = "800 17px 'Shippori Mincho',serif";
    c.fillStyle = "#cfe8a8";
    c.shadowColor = "rgba(0,0,0,.5)";
    c.shadowBlur = 6;
    c.fillText("迷路 · THE LABYRINTH", w / 2, h / 2 + 1);
  }, 236);
  label.position.set(0, 0, 2.7);
  board.add(plank, label);
  for (const s of [-1, 1]) {
    const stake = box(4, 30, 4, "#2a1d12");
    stake.position.set(s * 96, -40, -1);
    board.add(stake);
  }
  board.position.set(ROOM.w / 2, HEDGE_H + 26, WALL + 7 * LAB_CH + 30);
  board.rotation.x = -0.35;
  g.add(board);

  return {
    group: g,
    bg: "#0a0f08",
    light: { sky: "#e6efd6", ground: "#2a331f", hemi: 1.0, key: "#fff0d2", keyI: 1.25 },
    update: (f) => anim.forEach((a) => a(f)),
  };
};
