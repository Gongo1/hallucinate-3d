import * as THREE from "three";
import { ROOM, WALL, ROOFTOP } from "../../layout";
import type { FrameInfo, RoomBuilder } from "../types";
import { box, block, cyl, cone, lump, mat, ownMat, glowMat, glowPool, halo, lamp, panel, shade, rng } from "../kit";

// SKYLINE — the rooftop. A paved terrace with a parapet along the back; beyond it
// the city drops away far below (lit windows, street glow, blinking beacons).
// Two strings of bulbs swoop over the terrace, planters of night grasses, a
// little bar cart. Melodic deep at altitude.

const { railY, planters, cart } = ROOFTOP;
const PARA_H = 30; // parapet height

/** A box whose UVs are scaled to world size so a repeating window texture tiles
 *  at a constant density on every building. BOTTOM-pivoted. */
function towerGeo(w: number, h: number, d: number, cell: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // face order: +x, −x, +y, −y, +z, −z (4 verts each)
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++)
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / cell, (uv.getY(i) * dims[f][1]) / cell);
    }
  return g;
}

/** A tile of windows (a few lit, most dark) for the city's emissive map. */
function windowTexture(seed: number): THREE.CanvasTexture {
  const R = rng(seed);
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d")!;
  x.fillStyle = "#000";
  x.fillRect(0, 0, 128, 128);
  for (let wy = 4; wy < 128; wy += 16)
    for (let wx = 3; wx < 128; wx += 12) {
      const r = R();
      if (r < 0.2) x.fillStyle = r < 0.04 ? "#bfe0ff" : r < 0.07 ? "#ffe6c0" : "#ffd68c";
      else x.fillStyle = "#0a0c12";
      x.fillRect(wx, wy, 6, 9);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  return t;
}

let winTex: [THREE.CanvasTexture, THREE.CanvasTexture] | null = null;

export const buildRooftop: RoomBuilder = ({ room }) => {
  const g = new THREE.Group();
  const anim: ((f: FrameInfo) => void)[] = [];
  const R = rng(23);

  /* ---------------- terrace pavers (big slabs, 2px joints over a dark bed) */
  const bed = box(ROOM.w, 8, ROOM.h - railY + 10, "#1c2128");
  bed.position.set(ROOM.w / 2, -9, (railY - 10 + ROOM.h) / 2);
  bed.castShadow = false;
  g.add(bed);
  const xs = [0, 60, 190, 320, 450, 580, 710, 840, 970, 1100, ROOM.w];
  const zs = [railY - 8, railY + 80, railY + 190, railY + 300, railY + 410, ROOM.h];
  for (let i = 0; i < xs.length - 1; i++)
    for (let j = 0; j < zs.length - 1; j++) {
      const tone = shade("#3c444e", (R() - 0.5) * 22);
      const p = block({ x: xs[i] + 1, y: zs[j] + 1, w: xs[i + 1] - xs[i] - 2, h: zs[j + 1] - zs[j] - 2 }, 3, tone, -3);
      p.castShadow = false;
      g.add(p);
    }

  /* ---------------- parapet: the full back edge + the two sides (door gap on the right) */
  const paraM = mat("#2c3a4a");
  const capM = mat("#46586c");
  const para = (r: { x: number; y: number; w: number; h: number }) => {
    g.add(block(r, PARA_H, paraM));
    const cap = block({ x: r.x - 2, y: r.y - 2, w: r.w + 4, h: r.h + 4 }, 4, capM, PARA_H);
    cap.castShadow = false;
    g.add(cap);
  };
  para({ x: 0, y: railY - 9, w: ROOM.w, h: 18 });
  const sideGaps = (edge: "left" | "right") =>
    room.doors
      .filter((d) => (edge === "right" ? d.facing === "left" : d.facing === "right"))
      .map((d) => [d.y - 12, d.y + d.h + 12] as [number, number])
      .sort((a, b) => a[0] - b[0]);
  for (const edge of ["left", "right"] as const) {
    let s = railY + 9;
    const x = edge === "left" ? 0 : ROOM.w - WALL;
    for (const [a, b] of sideGaps(edge)) {
      if (a > s) para({ x, y: s, w: WALL, h: a - s });
      s = b;
    }
    if (s < ROOM.h) para({ x, y: s, w: WALL, h: ROOM.h - s });
  }
  // the near edge: a low kerb, split for the stairwell door
  const front = room.doors.filter((d) => d.facing === "up").map((d) => [d.x - 12, d.x + d.w + 12]);
  let fs = 0;
  for (const [a, b] of front) {
    g.add(block({ x: fs, y: ROOM.h - WALL, w: a - fs, h: WALL }, 16, paraM));
    fs = b;
  }
  g.add(block({ x: fs, y: ROOM.h - WALL, w: ROOM.w - fs, h: WALL }, 16, paraM));
  // our own building's face, dropping away below the parapet
  const facade = box(ROOM.w + 60, 900, 30, "#161c26");
  facade.position.set(ROOM.w / 2, -910, railY - 24);
  facade.castShadow = false;
  g.add(facade);

  /* ---------------- the city, far below and beyond */
  // window tiles are made once and kept (disposeTree frees .map, not emissiveMap)
  winTex ??= [windowTexture(5), windowTexture(9)];
  const [texA, texB] = winTex;
  const sideA = new THREE.MeshLambertMaterial({ color: "#121a2c", emissive: "#ffffff", emissiveMap: texA, emissiveIntensity: 0.9, flatShading: true });
  const sideB = new THREE.MeshLambertMaterial({ color: "#10182a", emissive: "#ffffff", emissiveMap: texB, emissiveIntensity: 0.9, flatShading: true });
  const roofM = mat("#141a26");
  const beacons: THREE.Mesh[] = [];
  const CELL = 64;
  let n = 0;
  for (let bz = railY - 150; bz > -1700; bz -= 150 + R() * 40) {
    for (let bx = -700 + R() * 60; bx < ROOM.w + 700; bx += 120 + R() * 70) {
      if (R() < 0.18) continue; // plazas + streets
      const w = 60 + R() * 70;
      const d = 60 + R() * 70;
      const far = Math.min(1, (railY - bz) / 1500);
      const top = -70 - R() * 260 - far * 120; // rooftops stay below the terrace
      const base = -1000;
      const h = top - base;
      const sm = n % 2 ? sideA : sideB;
      const tower = new THREE.Mesh(towerGeo(w, h, d, CELL), [sm, sm, roofM, roofM, sm, sm]);
      tower.position.set(bx, base, bz);
      g.add(tower);
      if (R() < 0.3) {
        // rooftop clutter: a water tank or a plant room
        const tank = R() < 0.5 ? cyl(10, 10, 16, 7, "#1e2636") : box(w * 0.4, 12, d * 0.3, "#1a2130");
        tank.position.set(bx + (R() - 0.5) * w * 0.4, top, bz + (R() - 0.5) * d * 0.4);
        tank.castShadow = false;
        g.add(tank);
      }
      if (top > -150 && R() < 0.5) {
        const b = new THREE.Mesh(new THREE.IcosahedronGeometry(3, 0), glowMat("#ff3a3a"));
        b.position.set(bx, top + 4, bz);
        g.add(b);
        beacons.push(b);
      }
      n++;
    }
  }
  // street glow down in the canyons
  for (let i = 0; i < 8; i++) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(2600, 16), glowMat("#ff9a4a", 0.35, true));
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(ROOM.w / 2, -995, railY - 80 - i * 190);
    g.add(strip);
  }
  const ground = box(3200, 4, 2400, "#07090f");
  ground.position.set(ROOM.w / 2, -1004, -800);
  ground.castShadow = false;
  g.add(ground);
  anim.push((f) => {
    sideA.emissiveIntensity = 0.82 + 0.12 * Math.sin(f.t * 0.9);
    sideB.emissiveIntensity = 0.82 + 0.12 * Math.sin(f.t * 0.7 + 2);
    beacons.forEach((b, i) => {
      b.visible = Math.sin(f.t * 2.2 + i * 1.3) > 0.2;
    });
  });

  /* ---------------- string lights swooping over the terrace, hung from four poles */
  const poleM = mat("#1e242c");
  for (const x of [70, ROOM.w - 70]) {
    const pole = cyl(2.5, 3, 150, 5, poleM);
    pole.position.set(x, PARA_H, railY);
    g.add(pole);
  }
  const bulbs: { m: THREE.MeshBasicMaterial; h: THREE.Sprite; k: number }[] = [];
  for (let k = 0; k < 2; k++) {
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(70, PARA_H + 146 - k * 10, railY),
      new THREE.Vector3(ROOM.w / 2, 70 - k * 8, railY + 180 + k * 70),
      new THREE.Vector3(ROOM.w - 70, PARA_H + 146 - k * 10, railY)
    );
    const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 30, 0.8, 3, false), mat("#141820"));
    g.add(wire);
    for (let i = 1; i < 16; i++) {
      const p = curve.getPoint(i / 16);
      const bm = glowMat("#ffd68c");
      const bulb = new THREE.Mesh(new THREE.IcosahedronGeometry(3.2, 0), bm);
      bulb.position.set(p.x, p.y - 4, p.z);
      const h = halo(34, "#ffc878", 0.4);
      h.position.copy(bulb.position);
      g.add(bulb, h);
      bulbs.push({ m: bm, h, k: i + k * 3 });
    }
    const l = lamp("#ffc070", 1.1, 420);
    const mid = curve.getPoint(0.5);
    l.position.set(mid.x + (k ? 200 : -200), mid.y, mid.z);
    g.add(l);
  }
  // their warm spill on the pavers
  g.add(glowPool(ROOM.w / 2, railY + 170, 380, "#ffc878", 0.09));
  anim.push((f) => {
    for (const b of bulbs) {
      const tw = 0.6 + 0.4 * Math.sin(f.t * 1.1 + b.k);
      b.m.color.setRGB(1, 0.72 + tw * 0.12, 0.42 + tw * 0.12, THREE.SRGBColorSpace);
      (b.h.material as THREE.SpriteMaterial).opacity = 0.22 + tw * 0.22;
    }
  });

  /* ---------------- planters of night grasses (footprint = the collision box) */
  planters.forEach((p, pi) => {
    const r = { x: p.x - 24, y: p.y - 14, w: 48, h: 30 };
    g.add(block(r, 24, "#26303a"));
    g.add(block({ x: r.x - 1.5, y: r.y - 1.5, w: r.w + 3, h: r.h + 3 }, 3, "#3a4654", 24));
    const soil = block({ x: r.x + 3, y: r.y + 3, w: r.w - 6, h: r.h - 6 }, 1, "#1e1a16", 24.5);
    soil.castShadow = false;
    g.add(soil);
    const blades: THREE.Mesh[] = [];
    for (let i = 0; i < 9; i++) {
      const b = cone(2.4, 26 + R() * 18, 3, i % 2 ? "#5a7a5a" : "#6e8e62");
      b.position.set(p.x - 18 + (i / 8) * 36, 25, p.y + 1 + (R() - 0.5) * 16);
      b.rotation.z = (i - 4) * 0.08;
      g.add(b);
      blades.push(b);
    }
    if (pi === 1) {
      // an olive tree in the biggest planter
      const trunk = cyl(2.4, 3.4, 34, 5, "#4a3a2a");
      trunk.position.set(p.x, 24, p.y + 1);
      g.add(trunk);
      for (let i = 0; i < 3; i++) {
        const fol = lump(12, "#5e7358", 70 + i, 0.3, 1.2, 0.7, 1, 0);
        fol.position.set(p.x + (i - 1) * 10, 62 + (i % 2) * 5, p.y + 1);
        g.add(fol);
      }
    }
    anim.push((f) => {
      blades.forEach((b, i) => {
        b.rotation.z = (i - 4) * 0.08 + Math.sin(f.t * 1.4 + i * 0.7 + pi) * 0.07;
      });
    });
  });

  /* ---------------- the bar cart */
  {
    const r = { x: cart.x - 26, y: cart.y - 14, w: 52, h: 30 };
    const steel = mat("#3e4a56");
    for (const [lx, lz] of [[r.x + 3, r.y + 3], [r.x + r.w - 3, r.y + 3], [r.x + 3, r.y + r.h - 3], [r.x + r.w - 3, r.y + r.h - 3]]) {
      const leg = cyl(1.4, 1.4, 34, 4, steel);
      leg.position.set(lx, 4, lz);
      g.add(leg);
    }
    for (const [wx, wz] of [[r.x + 4, r.y + r.h - 2], [r.x + r.w - 4, r.y + r.h - 2]]) {
      const wheel = cyl(4, 4, 2.4, 8, "#1a1e24");
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 4, wz + 1.2);
      g.add(wheel);
    }
    g.add(block(r, 2.5, steel, 12));
    g.add(block(r, 3, steel, 36));
    const handle = box(3, 3, r.h - 6, "#caa44a");
    handle.position.set(r.x - 3, 42, cart.y + 1);
    g.add(handle);
    const bottleCols = ["#caa44a", "#6e8a4a", "#8a2e3a", "#caa44a"];
    bottleCols.forEach((c, i) => {
      const bot = cyl(3, 3.4, 12 + (i % 2) * 3, 6, c);
      bot.position.set(r.x + 9 + i * 11, 39, cart.y - 4);
      const neck = cyl(1.2, 1.6, 5, 4, c);
      neck.position.set(r.x + 9 + i * 11, 51 + (i % 2) * 3, cart.y - 4);
      g.add(bot, neck);
    });
    for (let i = 0; i < 3; i++) {
      const glass = cyl(2.4, 1.8, 6, 6, ownMat("#bfe0ff", { opacity: 0.6 }));
      glass.position.set(r.x + 12 + i * 12, 39, cart.y + 8);
      glass.castShadow = false;
      g.add(glass);
    }
    const bottles = cyl(5, 5, 4, 7, "#5a6a7a");
    bottles.position.set(r.x + 14, 14.5, cart.y);
    g.add(bottles);
    g.add(glowPool(cart.x, cart.y + 6, 70, "#caa44a", 0.08));
  }

  /* ---------------- the name, painted on the pavers by the stairwell */
  const name = panel(280, 44, (c, w, h) => {
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = "800 26px 'Shippori Mincho',serif";
    c.fillStyle = "rgba(191,224,255,.5)";
    c.fillText("SKYLINE · 空", w / 2, h / 2);
  }, 210);
  name.rotation.x = -Math.PI / 2;
  name.position.set(860, 0.9, 650);
  (name.material as THREE.Material).depthWrite = false;
  g.add(name);

  return {
    group: g,
    bg: "#0a0e1a",
    fog: { color: "#0c1222", near: 1500, far: 3400 },
    light: { sky: "#a8bce6", ground: "#1a1e2a", hemi: 1.0, key: "#c4d2ff", keyI: 0.95, keyFrom: [-0.35, 1, 0.3] },
    update: (f) => anim.forEach((a) => a(f)),
  };
};
