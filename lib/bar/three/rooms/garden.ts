import * as THREE from "three";
import type { RoomDoor } from "../../rooms";
import { ROOM, WALL, GARDEN } from "../../layout";
import type { FrameInfo, RoomBuilder } from "../types";
import { shell } from "../shared";
import {
  box, cyl, cone, lump, mat, ownMat, glowMat, glowPool, halo, lamp, panel, motes, rng,
  floorDisc, radialTexture, hex,
} from "../kit";

// THE GARDEN — an open-air Japanese courtyard at dusk. Plaster walls under dark
// tile roofs, a koi pond ringed with stones, raked karesansui gravel, a red maple,
// bamboo groves, stone lanterns glowing warm against the cool dusk, a tsukubai
// basin with a shishi-odoshi that tips + clacks, fireflies drifting through.
// Beyond the back wall: the dusk horizon, first stars, and the moon.

const { koi, gravel, maple, basin, lanterns, bamboo, cushions } = GARDEN;
const WALL_TOP = 88;

type Anim = (f: FrameInfo) => void;
type Edge = "back" | "front" | "left" | "right";

/** Solid wall runs along one edge, skipping door gaps (mirrors shell()). */
export function wallRuns(doors: RoomDoor[], edge: Edge): [number, number][] {
  const along = edge === "back" || edge === "front" ? ROOM.w : ROOM.h;
  const of = (d: RoomDoor): Edge =>
    d.facing === "down" ? "back" : d.facing === "up" ? "front" : d.facing === "right" ? "left" : "right";
  const gaps = doors
    .filter((d) => of(d) === edge)
    .map((d) => (edge === "back" || edge === "front" ? [d.x - 12, d.x + d.w + 12] : [d.y - 12, d.y + d.h + 12]))
    .sort((a, b) => a[0] - b[0]);
  let s = 0;
  const out: [number, number][] = [];
  for (const [a, b] of gaps) {
    if (a > s) out.push([s, a]);
    s = Math.max(s, b);
  }
  if (s < along) out.push([s, along]);
  return out;
}

/** A tile-roof ridge: triangular prism running along local X, centred. */
function roofPrism(len: number, width: number, height: number, color: string): THREE.Mesh {
  const sh = new THREE.Shape();
  sh.moveTo(-width / 2, 0);
  sh.lineTo(width / 2, 0);
  sh.lineTo(0, height);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false });
  g.translate(0, 0, -len / 2);
  g.rotateY(Math.PI / 2);
  const m = new THREE.Mesh(g, mat(color));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export const buildGarden: RoomBuilder = ({ room }) => {
  const g = new THREE.Group();
  const anim: Anim[] = [];
  const R = rng(21);

  /* ---------------- ground: mossy earth + dapples */
  const ground = box(ROOM.w, 6, ROOM.h, "#46553d");
  ground.position.set(ROOM.w / 2, -6, ROOM.h / 2);
  ground.castShadow = false;
  g.add(ground);
  // soft moss patches + little grass tufts (walk-through texture, ankle-high)
  for (let i = 0; i < 16; i++) {
    const mx = (i * 197) % ROOM.w;
    const my = 70 + ((i * 311) % (ROOM.h - 120));
    const d = floorDisc(mx, my, 34 + (i % 4) * 8, 22 + (i % 3) * 5, 14, i % 2 ? "#4b5c41" : "#425239", 0.25);
    d.rotation.y = i * 0.7;
    g.add(d);
  }
  for (let i = 0; i < 30; i++) {
    const tx = WALL + 20 + ((i * 263) % (ROOM.w - 2 * WALL - 40));
    const ty = 70 + ((i * 419) % (ROOM.h - 140));
    const inGravel = tx > gravel.x - 6 && tx < gravel.x + gravel.w + 6 && ty > gravel.y - 6 && ty < gravel.y + gravel.h + 6;
    const inPond = ((tx - koi.x) / (koi.r + 14)) ** 2 + ((ty - koi.y) / (koi.r * 0.7 + 14)) ** 2 < 1;
    if (inGravel || inPond) continue;
    for (let k = 0; k < 3; k++) {
      const blade = cone(2.2, 8 + k * 2, 3, k % 2 ? "#6a8a4a" : "#5a7a40");
      blade.castShadow = false;
      blade.position.set(tx + (k - 1) * 3, 0, ty + (k % 2) * 2);
      blade.rotation.z = (k - 1) * 0.35;
      g.add(blade);
    }
  }

  /* ---------------- the dusk horizon beyond the back wall (reads as sky) */
  const sky = new THREE.PlaneGeometry(ROOM.w + 1600, 700, 1, 6);
  sky.rotateX(-Math.PI / 2);
  const cols: number[] = [];
  const near = hex("#6b5448");
  const mid = hex("#4a3d68");
  const far = hex("#221c46");
  const pos = sky.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getZ(i) + 350) / 700; // 0 far … 1 near
    const c = t > 0.55 ? mid.clone().lerp(near, (t - 0.55) / 0.45) : far.clone().lerp(mid, t / 0.55);
    cols.push(c.r, c.g, c.b);
  }
  sky.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
  const skyM = new THREE.Mesh(sky, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  skyM.position.set(ROOM.w / 2, -60, -350);
  g.add(skyM);
  // first stars low over the horizon band + the moon
  const STARS = 40;
  const stars = motes(STARS, "#ffffff", 5, 0.8);
  const sp = stars.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < STARS; i++) sp.setXYZ(i, -200 + ((i * 137.5) % (ROOM.w + 400)), -50 + R() * 40, -60 - R() * 320);
  g.add(stars);
  const moon = new THREE.Mesh(new THREE.CircleGeometry(26, 16), glowMat("#fff4d8"));
  moon.rotation.x = -0.9;
  moon.position.set(ROOM.w - 150, -30, -170);
  const moonHalo = halo(180, "#fff0cc", 0.45);
  moonHalo.position.copy(moon.position);
  g.add(moon, moonHalo);
  anim.push((f) => {
    (stars.material as THREE.PointsMaterial).opacity = 0.55 + 0.25 * Math.sin(f.t * 1.4);
  });
  // silhouetted cedars just behind the back wall
  for (let x = -60; x < ROOM.w + 80; x += 64) {
    const hgt = 90 + R() * 70;
    const col = R() < 0.5 ? "#1c2a26" : "#22302a";
    const tree = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const tier = cone(30 - k * 7, hgt * 0.5, 6, col);
      tier.castShadow = false;
      tier.position.y = 30 + k * hgt * 0.22;
      tree.add(tier);
    }
    tree.position.set(x + R() * 30, 0, -34 - R() * 40);
    g.add(tree);
  }

  /* ---------------- walls: pale plaster under dark tile roofs (tsuiji-bei) */
  g.add(shell(room.doors, { floor: false, wall: "#a09078", trim: "#2e2a30", height: WALL_TOP, front: 18 }));
  for (const edge of ["back", "left", "right"] as const) {
    for (const [a, b] of wallRuns(room.doors, edge)) {
      const len = b - a;
      if (len < 4) continue;
      const roof = roofPrism(len + 8, WALL + 22, 14, "#34303a");
      const ridge = box(len + 8, 3, 6, "#24212a");
      if (edge === "back") {
        roof.position.set((a + b) / 2, WALL_TOP + 5, WALL / 2);
        ridge.position.set((a + b) / 2, WALL_TOP + 17, WALL / 2);
      } else {
        const x = edge === "left" ? WALL / 2 : ROOM.w - WALL / 2;
        roof.rotation.y = Math.PI / 2;
        ridge.rotation.y = Math.PI / 2;
        roof.position.set(x, WALL_TOP + 5, (a + b) / 2);
        ridge.position.set(x, WALL_TOP + 17, (a + b) / 2);
      }
      g.add(roof, ridge);
    }
  }
  // dark timber skirting along the back plaster
  for (const [a, b] of wallRuns(room.doors, "back")) {
    const skirt = box(b - a, 16, 2, "#4a3a22");
    skirt.position.set((a + b) / 2, 0, WALL + 1);
    skirt.castShadow = false;
    g.add(skirt);
  }

  // the name plate — a wooden board on the back wall
  const plate = panel(260, 44, (c, w, h) => {
    c.fillStyle = "#3a2817";
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "rgba(233,210,160,.35)";
    c.lineWidth = 2;
    c.strokeRect(3, 3, w - 6, h - 6);
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = "800 22px 'Shippori Mincho',serif";
    c.fillStyle = "#f1e6d2";
    c.fillText("庭 · THE GARDEN", w / 2, h / 2 + 1);
  }, 220, 3, true);
  plate.position.set(ROOM.w / 2 - 80, 52, WALL + 1.2);
  g.add(plate);

  /* ---------------- stepping-stone path from the kissa door toward the centre */
  const steps: [number, number][] = [
    [70, 560], [150, 540], [230, 520], [320, 500], [410, 470], [500, 440], [560, 410],
  ];
  steps.forEach(([sx, sy], i) => {
    const s = cyl(21, 23, 2.5, 8, i % 2 ? "#7f786c" : "#878073");
    s.scale.z = 0.62;
    s.rotation.y = ((i % 3) - 1) * 0.25; // long axis across the view, so they read flat
    s.position.set(sx, 0, sy);
    s.castShadow = false;
    g.add(s);
  });

  /* ---------------- karesansui: raked gravel with concentric rake lines */
  {
    const r = 12;
    const sh = new THREE.Shape();
    const { x, y, w, h } = gravel;
    sh.moveTo(x + r, y);
    sh.lineTo(x + w - r, y);
    sh.quadraticCurveTo(x + w, y, x + w, y + r);
    sh.lineTo(x + w, y + h - r);
    sh.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    sh.lineTo(x + r, y + h);
    sh.quadraticCurveTo(x, y + h, x, y + h - r);
    sh.lineTo(x, y + r);
    sh.quadraticCurveTo(x, y, x + r, y);
    const gg = new THREE.ShapeGeometry(sh, 3);
    gg.rotateX(Math.PI / 2); // shape Y → world Z (plan y)
    const bed = new THREE.Mesh(gg, mat("#cdc6b4", { side: THREE.DoubleSide }));
    bed.position.y = 0.6;
    bed.receiveShadow = true;
    g.add(bed);
    const cx = x + w / 2;
    const cy = y + h / 2;
    for (let rr = 24; rr <= 136; rr += 14) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.9, 3, 44), mat("#a89f88"));
      ring.rotation.x = -Math.PI / 2;
      ring.scale.y = 0.6;
      ring.position.set(cx, 0.9, cy);
      g.add(ring);
    }
    const stone = lump(13, "#6f6960", 5, 0.3, 1.3, 0.55, 0.95, 0);
    stone.position.set(cx, 4, cy);
    g.add(stone);
  }

  /* ---------------- koi pond: dark bed, koi, shimmering water, stone rim */
  {
    const bed = floorDisc(koi.x, koi.y, koi.r, koi.r * 0.7, 28, "#1a2c3a", 0.4);
    g.add(bed);
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2).scale(koi.r * 0.96, 1, koi.r * 0.7 * 0.96),
      new THREE.MeshLambertMaterial({ color: hex("#3a5a78"), transparent: true, opacity: 0.6, depthWrite: false, emissive: hex("#1c3448"), emissiveIntensity: 0.5 })
    );
    water.position.set(koi.x, 3.2, koi.y);
    water.renderOrder = 2;
    g.add(water);
    // two koi circling under the surface
    const fish: THREE.Group[] = [];
    for (const [k, col] of [[0, "#f2efe6"], [1, "#e7833f"]] as const) {
      const f = new THREE.Group();
      const body = new THREE.Mesh(new THREE.IcosahedronGeometry(5, 0), mat(col));
      body.scale.set(0.7, 0.45, 1.9);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(3.5, 6, 4), mat(col));
      tail.rotation.x = -Math.PI / 2;
      tail.position.z = -11;
      f.add(body, tail);
      if (k === 0) {
        const spot = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4, 0), mat("#d8452a"));
        spot.position.set(0, 1.4, 3);
        f.add(spot);
      }
      f.position.y = 1.8;
      g.add(f);
      fish.push(f);
    }
    // lily pads + one lotus
    for (const [dx, dy, r] of [[-50, -22, 11], [40, 30, 9], [62, -18, 8]] as const) {
      const pad = new THREE.Mesh(new THREE.CircleGeometry(r, 9, 0.4, Math.PI * 2 - 0.4).rotateX(-Math.PI / 2), mat("#4e7a3a", { side: THREE.DoubleSide }));
      pad.position.set(koi.x + dx, 3.6, koi.y + dy);
      g.add(pad);
    }
    const lotus = cone(4.5, 6, 6, "#f0a6b8");
    lotus.position.set(koi.x - 50, 3.8, koi.y - 22);
    g.add(lotus);
    // ripple rings drifting outward
    const ripples: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const rg = new THREE.Mesh(
        new THREE.TorusGeometry(1, 0.015, 3, 36).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: hex("#b4d2e6"), transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      rg.position.set(koi.x, 3.5, koi.y);
      g.add(rg);
      ripples.push(rg);
    }
    // stone rim around the ellipse + boulders filling the corners of the solid
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      const rk = lump(9 + R() * 5, R() < 0.5 ? "#7a746a" : "#6a655c", 80 + i, 0.35, 1.2, 0.6, 1, 0);
      rk.position.set(koi.x + Math.cos(a) * koi.r * 1.0, 3, koi.y + Math.sin(a) * koi.r * 0.72);
      rk.rotation.y = a;
      g.add(rk);
    }
    const corners: [number, number, number][] = [
      [koi.x - koi.r + 14, koi.y - koi.r * 0.7 + 12, 18], [koi.x + koi.r - 14, koi.y - koi.r * 0.7 + 12, 16],
      [koi.x - koi.r + 12, koi.y + koi.r * 0.7 - 12, 14], [koi.x + koi.r - 14, koi.y + koi.r * 0.7 - 12, 17],
    ];
    corners.forEach(([x, y, r], i) => {
      const b = lump(r, i % 2 ? "#6e685e" : "#5f5a52", 140 + i, 0.3, 1.1, 0.8, 1, 1);
      b.position.set(x, r * 0.5, y);
      g.add(b);
      const moss = lump(r * 0.7, "#4a6a38", 150 + i, 0.3, 1.2, 0.5, 1.1, 0);
      moss.position.set(x + 8, r * 0.9, y - 4);
      g.add(moss);
    });
    anim.push((f) => {
      fish.forEach((fi, k) => {
        const a = f.t / 2.6 + k * Math.PI;
        fi.position.x = koi.x + Math.cos(a) * koi.r * 0.45;
        fi.position.z = koi.y + Math.sin(a) * koi.r * 0.3;
        fi.rotation.y = -a; // swim tangent to the loop
        fi.children[1].rotation.y = Math.sin(f.t * 8 + k) * 0.4;
      });
      ripples.forEach((rg, i) => {
        const p = (f.t * 0.12 + i / 3) % 1;
        const r = 12 + p * koi.r * 0.85;
        rg.scale.set(r, 1, r * 0.7);
        (rg.material as THREE.MeshBasicMaterial).opacity = 0.35 * (1 - p);
      });
      (water.material as THREE.MeshLambertMaterial).emissiveIntensity = 0.45 + 0.1 * Math.sin(f.t * 0.9);
    });
  }

  /* ---------------- bamboo groves tight against the fence (swaying) */
  const stalks: { m: THREE.Group; ph: number }[] = [];
  for (const [i, b] of bamboo.entries()) {
    const bx = WALL + 12; // pressed against the left wall so the aisle stays open
    for (let k = 0; k < 4; k++) {
      const s = new THREE.Group();
      const hgt = 110 + R() * 50;
      const stalk = cyl(3, 3.6, hgt, 5, k % 2 ? "#5b7d3f" : "#6a8c48");
      s.add(stalk);
      for (let n = 1; n < 5; n++) {
        const node = cyl(4, 4, 1.8, 5, "#48662f");
        node.position.y = (n * hgt) / 5;
        s.add(node);
      }
      for (let l = 0; l < 4; l++) {
        const leaf = cone(3.2, 20, 4, "#7e9b5e");
        leaf.rotation.z = -Math.PI / 2 + (l % 2 ? 0.5 : -0.6) + (l % 2 ? 0 : Math.PI);
        leaf.position.y = hgt - 10 - l * 12;
        s.add(leaf);
      }
      s.position.set(bx - 6 + (k % 2) * 10, 0, b.y - 16 + k * 10 + (i === 2 ? 6 : 0));
      g.add(s);
      stalks.push({ m: s, ph: b.y * 0.01 + k });
    }
    const shrub = lump(15, "#3f5a32", 60 + i, 0.3, 1.2, 0.7, 1.4, 0);
    shrub.position.set(WALL + 6, 7, b.y);
    g.add(shrub);
  }
  anim.push((f) => {
    for (const s of stalks) s.m.rotation.z = Math.sin(f.t / 1.1 + s.ph) * 0.035;
  });

  /* ---------------- the red maple (trunk is the solid; canopy up high) */
  {
    const trunk = cyl(8, 12, 100, 6, "#3a2817");
    trunk.position.set(maple.x, 0, maple.y + 3);
    g.add(trunk);
    for (const [ry, rz, len] of [[0.6, 0.8, 50], [-2.2, 0.7, 44], [2.4, 0.9, 40]] as const) {
      const br = cyl(2.5, 4, len, 5, "#3a2817");
      br.position.set(maple.x, 70, maple.y + 3);
      br.rotation.set(0, ry, rz);
      g.add(br);
    }
    const leafCols = ["#c0432f", "#d96a2c", "#a8352a", "#e0783a"];
    // the canopy fades when you walk behind it, so the tree never hides you
    const canopyMats = leafCols.map((c) => ownMat(c));
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const rr = i === 0 ? 0 : 26 + (i % 3) * 10;
      const fol = lump(22 + (i % 3) * 5, leafCols[i % 4], 200 + i, 0.32, 1.1, 0.72, 1.1, 1);
      fol.material = canopyMats[i % 4];
      fol.position.set(maple.x + Math.cos(a) * rr, 110 + (i % 3) * 10 + (i === 0 ? 18 : 0), maple.y + Math.sin(a) * rr * 0.8);
      g.add(fol);
    }
    let fade = 1;
    anim.push((f) => {
      const behind = Math.abs(f.player.x - maple.x) < 80 && f.player.y < maple.y + 30 && f.player.y > maple.y - 190;
      fade += ((behind ? 0.3 : 1) - fade) * Math.min(1, f.dt * 6);
      for (const m of canopyMats) {
        m.transparent = fade < 0.99;
        m.opacity = fade;
        m.depthWrite = fade >= 0.99;
      }
    });
    g.add(glowPool(maple.x, maple.y + 10, 90, "#d9502c", 0.1));
    // a few leaves drifting down
    const leaves: { m: THREE.Mesh; o: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const lf = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), mat(leafCols[i % 4], { side: THREE.DoubleSide }));
      lf.castShadow = false;
      g.add(lf);
      leaves.push({ m: lf, o: i / 6 });
    }
    anim.push((f) => {
      leaves.forEach(({ m, o }, i) => {
        const p = (f.t * 0.07 + o) % 1;
        m.position.set(maple.x - 40 + i * 16 + Math.sin(f.t * 1.3 + i) * 14, 120 * (1 - p), maple.y + 20 + p * 60 + Math.cos(f.t + i) * 8);
        m.rotation.set(f.t * 2 + i, f.t * 1.4 + i, 0);
      });
    });
  }

  /* ---------------- stone lanterns (ishidoro) glowing warm */
  const fireboxes: THREE.Mesh[] = [];
  for (const l of lanterns) {
    const lg = new THREE.Group();
    lg.position.set(l.x, 0, l.y + 5);
    lg.scale.setScalar(1.3);
    g.add(lg);
    const z = 0; // local: centred on the 24×30 solid
    const base = cyl(10, 12, 7, 6, "#6b6258");
    const shaft = cyl(5, 6, 20, 6, "#6b6258");
    shaft.position.y = 7;
    const deck = box(22, 5, 22, "#5b534a");
    deck.position.y = 27;
    const fire = box(12, 13, 12, ownMat("#caa06a", { emissive: "#ffb35e", glow: 0.9 }));
    fire.position.y = 32;
    fire.castShadow = false;
    lg.add(base, shaft, deck, fire);
    // the firebox cage: four stone corner posts around the glowing core
    for (const [dx, dz] of [[-7.5, -7.5], [7.5, -7.5], [-7.5, 7.5], [7.5, 7.5]]) {
      const p = box(3.5, 14, 3.5, "#6b6258");
      p.position.set(dx, 32, z + dz);
      lg.add(p);
    }
    const roof = cone(19, 11, 4, "#5b534a");
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 46;
    const knob = new THREE.Mesh(new THREE.IcosahedronGeometry(3.4, 0), mat("#5b534a"));
    knob.position.y = 59;
    const h = halo(80, "#ffb060", 0.45);
    h.position.y = 39;
    lg.add(roof, knob, h);
    const lt = lamp("#ffa050", 1.5, 280);
    lt.position.set(l.x, 52, l.y + 22);
    g.add(lt, glowPool(l.x, l.y + 7, 90, "#ffaa50", 0.22));
    fireboxes.push(fire);
  }
  anim.push((f) => {
    fireboxes.forEach((b, i) => {
      (b.material as THREE.MeshLambertMaterial).emissiveIntensity = 0.85 + 0.12 * Math.sin(f.t * 3.1 + i * 2) * Math.sin(f.t * 1.7 + i);
    });
  });

  /* ---------------- tsukubai basin + shishi-odoshi (tips + clacks every ~6s) */
  {
    const stone = lump(16, "#667070", 33, 0.22, 1.05, 0.62, 1, 1);
    stone.position.set(basin.x, 8, basin.y + 1);
    const pool = floorDisc(basin.x, basin.y + 1, 9.5, 9.5, 12, glowMat("#3d6a80"), 16.5);
    g.add(stone, pool);
    // the kakei spout feeding it
    const spout = cyl(1.8, 1.8, 30, 6, "#8a6a3a");
    spout.rotation.z = Math.PI / 2;
    spout.position.set(basin.x - 12, 26, basin.y - 12);
    const spoutPost = cyl(2, 2, 26, 6, "#6a4a2a");
    spoutPost.position.set(basin.x - 26, 0, basin.y - 12);
    g.add(spout, spoutPost);
    // shishi-odoshi pivot behind the basin
    const px = basin.x + 20;
    const py = basin.y - 14;
    for (const s of [-1, 1]) {
      const post = cyl(1.8, 1.8, 20, 5, "#6a4a2a");
      post.position.set(px, 0, py + s * 5);
      g.add(post);
    }
    const tube = new THREE.Group();
    const bamboo2 = cyl(3.2, 3.2, 34, 6, "#8a7a3a");
    bamboo2.rotation.z = Math.PI / 2;
    bamboo2.position.x = -6;
    tube.add(bamboo2);
    tube.position.set(px, 20, py);
    g.add(tube);
    const drops = floorDisc(basin.x, basin.y + 1, 1, 1, 16, new THREE.MeshBasicMaterial({ color: hex("#bfe3f0"), transparent: true, opacity: 0, depthWrite: false }), 17);
    g.add(drops);
    let clock = R() * 4;
    let clack = 0;
    anim.push((f) => {
      clock += f.dt;
      if (clock > 6) {
        clock = 0;
        clack = 1;
      }
      if (clack > 0) clack = Math.max(0, clack - f.dt * 1.5);
      // resting: mouth up, slowly filling; clack: tips mouth-down into the basin
      const rest = -0.3 - Math.min(clock / 6, 1) * 0.12 + Math.sin(f.t / 1.4) * 0.02;
      tube.rotation.z = clack > 0 ? 0.5 * clack + rest * (1 - clack) : rest;
      const dm = drops.material as THREE.MeshBasicMaterial;
      dm.opacity = clack * 0.6;
      const s = 3 + (1 - clack) * 8;
      drops.scale.set(s, 1, s);
    });
  }

  /* ---------------- low listening cushions */
  for (const c of cushions) {
    const z = box(32, 5, 22, "#9a4b3a");
    z.position.set(c.x, 0, c.y);
    z.rotation.y = (R() - 0.5) * 0.3;
    g.add(z);
  }

  /* ---------------- low shrubs pressed against the walls (texture, not obstacles) */
  const shrubs: [number, number][] = [
    [300, WALL + 4], [420, WALL + 4], [700, WALL + 6], [1040, WALL + 4],
    [ROOM.w - WALL - 4, 470], [ROOM.w - WALL - 4, 660], [WALL + 4, 150], [WALL + 4, 430],
  ];
  shrubs.forEach(([x, y], i) => {
    const s = lump(15 + (i % 3) * 3, i % 2 ? "#3f5a32" : "#4a6a3a", 400 + i, 0.3, 1.3, 0.75, 1.1, 1);
    s.position.set(x, 9, y);
    g.add(s);
    if (i % 3 === 0) {
      const bloom = lump(5, "#e07aa0", 450 + i, 0.2, 1, 0.8, 1, 0);
      bloom.position.set(x + 5, 20, y + 6);
      g.add(bloom);
    }
  });

  /* ---------------- fireflies drifting through the dusk */
  const FF = 20;
  const ffGeo = new THREE.BufferGeometry();
  ffGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(FF * 3), 3));
  ffGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(FF * 3), 3));
  const ff = new THREE.Points(
    ffGeo,
    new THREE.PointsMaterial({
      size: 16, map: radialTexture(), vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false,
    })
  );
  ff.frustumCulled = false;
  g.add(ff);
  const flies = Array.from({ length: FF }, () => ({ x: R(), y: R(), h: 14 + R() * 60, ph: R() * 6.28, sp: 0.2 + R() * 0.5 }));
  const ffCol = hex("#eaff9a");
  anim.push((f) => {
    const p = ffGeo.attributes.position as THREE.BufferAttribute;
    const c = ffGeo.attributes.color as THREE.BufferAttribute;
    flies.forEach((fl, i) => {
      fl.ph += f.dt * fl.sp;
      fl.x = (fl.x + Math.cos(fl.ph) * 0.0006 + 1) % 1;
      fl.y = (fl.y + Math.sin(fl.ph * 1.3) * 0.0006 + 1) % 1;
      p.setXYZ(i, WALL + fl.x * (ROOM.w - 2 * WALL), fl.h + Math.sin(fl.ph * 2) * 6, 60 + fl.y * (ROOM.h - 120));
      const glow = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(fl.ph * 3));
      c.setXYZ(i, ffCol.r * glow, ffCol.g * glow, ffCol.b * glow);
    });
    p.needsUpdate = true;
    c.needsUpdate = true;
  });

  return {
    group: g,
    bg: "#1c1838",
    fog: { color: "#1c1838", near: 1600, far: 3400 },
    light: { sky: "#9a8cc8", ground: "#2c3824", hemi: 1.0, key: "#c8ccff", keyI: 0.9, keyFrom: [0.4, 1, 0.5] },
    update: (f) => anim.forEach((a) => a(f)),
  };
};
