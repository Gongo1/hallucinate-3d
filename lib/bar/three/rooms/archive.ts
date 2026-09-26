import * as THREE from "three";
import { ROOM, WALL, ARCHIVE } from "../../layout";
import type { FrameInfo, RoomBuilder } from "../types";
import { shell, WALL_H } from "../shared";
import {
  box, block, cyl, cone, mat, ownMat, glowMat, glowPool, halo, lamp, panel, motes, shade, rng,
} from "../kit";

// THE ARCHIVE — the deep-history vault. Two long record stacks (every spine a
// different muted hue), a reading table under a pair of green-glass banker's
// lamps, a card catalogue, gold-framed year plaques on the back wall (the
// lineage), cone pendants over the aisle, and dust hanging in the lamplight.

const { stacks, table, catalog } = ARCHIVE;
const STACK_H = 76;
const PLAQUES: [number, string][] = [
  [130, "1977"],
  [280, "1984"],
  [430, "1986"],
  [580, "1989"],
  [960, "1992"],
  [1060, "1997"],
];

export const buildArchive: RoomBuilder = ({ room }) => {
  const g = new THREE.Group();
  const anim: ((f: FrameInfo) => void)[] = [];
  const R = rng(19);

  /* ---------------- floor: dark planks (rows of 46) */
  for (let y = 14, i = 0; y < ROOM.h; y += 46, i++) {
    let x = -((i * 173) % 240);
    while (x < ROOM.w) {
      const len = 200 + R() * 170;
      const a = Math.max(0, x);
      const b = Math.min(ROOM.w, x + len);
      if (b - a > 4) {
        const tone = i % 2 ? "#30271d" : "#2a221a";
        const p = block({ x: a + 1, y: y + 1, w: b - a - 2, h: 44 }, 3, shade(tone, (R() - 0.5) * 10), -3);
        p.castShadow = false;
        g.add(p);
      }
      x += len;
    }
  }
  const top = block({ x: 0, y: 0, w: ROOM.w, h: 15 }, 3, "#2a221a", -3);
  top.castShadow = false;
  g.add(top);
  const under = box(ROOM.w, 3, ROOM.h, "#140f0a");
  under.position.set(ROOM.w / 2, -6, ROOM.h / 2);
  under.castShadow = false;
  g.add(under);

  /* ---------------- walls: dark timber, a vault-green dado + wainscot on the back */
  g.add(shell(room.doors, { floor: false, wall: "#1a140e", trim: "#33402e" }));
  const doorGaps = room.doors.filter((d) => d.facing === "down").map((d) => [d.x - 22, d.x + d.w + 22]);
  const backRuns: [number, number][] = [];
  let s0 = WALL;
  for (const [a, b] of doorGaps.sort((p, q) => p[0] - q[0])) {
    if (a > s0) backRuns.push([s0, a]);
    s0 = Math.max(s0, b);
  }
  if (s0 < ROOM.w - WALL) backRuns.push([s0, ROOM.w - WALL]);
  for (const [a, b] of backRuns) {
    const wains = box(b - a, WALL_H - 10, 3, "#241c12");
    wains.position.set((a + b) / 2, 0, WALL + 1.5);
    wains.castShadow = false;
    const dado = box(b - a, 4, 5, "#33402e");
    dado.position.set((a + b) / 2, 58, WALL + 2.5);
    const skirt = box(b - a, 9, 5, "#33402e");
    skirt.position.set((a + b) / 2, 0, WALL + 2.5);
    g.add(wains, dado, skirt);
  }

  // gold-framed year plaques — the lineage on the wall
  for (const [ax, yr] of PLAQUES) {
    const back = box(58, 44, 3, "#caa44a");
    back.position.set(ax, 78, WALL + 4);
    const face = panel(52, 38, (c, w, h) => {
      c.fillStyle = "#0e0a06";
      c.fillRect(0, 0, w, h);
      c.strokeStyle = "rgba(202,164,74,.55)";
      c.lineWidth = 1;
      c.strokeRect(3, 3, w - 6, h - 6);
      c.fillStyle = "#caa44a";
      c.font = "700 13px 'DM Mono',monospace";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(yr, w / 2, h / 2 + 1);
    }, 52);
    face.position.set(ax, 100, WALL + 5.6);
    const glow = halo(90, "#ffd89a", 0.12);
    glow.position.set(ax, 100, WALL + 14);
    g.add(back, face, glow);
  }

  /* ---------------- the long stacks: open shelving, record spines in every hue */
  const carcass = mat("#33402e");
  const shelfM = mat("#2a3526");
  const innerM = mat("#1c2418");
  type Spine = { x: number; y: number; z: number; h: number; d: number; tilt: number; col: THREE.Color };
  const spines: Spine[] = [];
  const tiers: [number, number][] = [
    [6, 26],
    [29, 50],
    [53, STACK_H - 5],
  ];
  for (const st of stacks) {
    // plinth, the long back board down the middle, three shelf boards, the top
    g.add(block({ x: st.x, y: st.y, w: st.w, h: st.h }, 6, carcass));
    const spine = box(st.w - 8, STACK_H - 6, 4, innerM);
    spine.position.set(st.x + st.w / 2, 6, st.y + st.h / 2);
    g.add(spine);
    for (const [, tt] of tiers.slice(0, 2)) g.add(block({ x: st.x + 3, y: st.y, w: st.w - 6, h: st.h }, 3, shelfM, tt));
    const cap = block({ x: st.x - 3, y: st.y - 3, w: st.w + 6, h: st.h + 6 }, 5, carcass, STACK_H - 5);
    g.add(cap);
    for (const ex of [st.x, st.x + st.w - 7]) g.add(block({ x: ex, y: st.y, w: 7, h: st.h }, STACK_H - 5, carcass));
    // records on both faces (the camera sees the south; the north shows from the aisle)
    for (const [z0, z1] of [
      [st.y + st.h / 2 + 2, st.y + st.h - 1],
      [st.y + 1, st.y + st.h / 2 - 2],
    ])
      for (const [lo, hi] of tiers)
        for (let x = st.x + 10; x < st.x + st.w - 12; x += 7) {
          const hch = ((x * 2654435761) % 360) / 360;
          const light = (30 + ((x * 7 + lo) % 18)) / 100;
          const hh = hi - lo - 2 - ((x * 13 + lo) % 5);
          spines.push({
            x,
            y: lo,
            z: (z0 + z1) / 2,
            h: hh,
            d: z1 - z0,
            tilt: (x * 31 + lo) % 11 === 0 ? 0.18 : 0,
            col: new THREE.Color().setHSL(hch, 0.28, light),
          });
        }
    // a few sleeves pulled out, leaning on top
    for (const [dx, col] of [
      [80, "#caa44a"],
      [320, "#5a86a8"],
      [470, "#a8452f"],
    ] as [number, string][]) {
      const sl = box(24, 24, 1.6, col);
      sl.position.set(st.x + dx, STACK_H, st.y + st.h / 2 + 4);
      sl.rotation.x = -0.35;
      g.add(sl);
    }
  }
  const spineM = ownMat("#ffffff");
  const spineG = new THREE.BoxGeometry(5, 1, 1);
  spineG.translate(0, 0.5, 0);
  const im = new THREE.InstancedMesh(spineG, spineM, spines.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  spines.forEach((sp, i) => {
    q.setFromAxisAngle(zAxis, sp.tilt);
    m4.compose(new THREE.Vector3(sp.x, sp.y, sp.z), q, new THREE.Vector3(1, sp.h, sp.d));
    im.setMatrixAt(i, m4);
    im.setColorAt(i, sp.col);
  });
  im.castShadow = true;
  im.receiveShadow = true;
  im.frustumCulled = false;
  g.add(im);

  /* ---------------- a worn vault-green runner under the reading table (walkable) */
  const rug = block({ x: 360, y: 470, w: 420, h: 170 }, 1, "#26382c", 0);
  rug.castShadow = false;
  const rugBorder = block({ x: 352, y: 462, w: 436, h: 186 }, 0.8, "#6a5a2e", 0);
  rugBorder.castShadow = false;
  g.add(rugBorder, rug);

  /* ---------------- reading table + two green-glass banker's lamps */
  const t = table;
  const tableTop = block({ x: t.x, y: t.y, w: t.w, h: t.h }, 6, "#3a2c1c", 28);
  const inset = block({ x: t.x + 6, y: t.y + 6, w: t.w - 12, h: t.h - 12 }, 1.2, "#4a3826", 34);
  inset.castShadow = false;
  g.add(tableTop, inset);
  for (const [lx, ly] of [
    [t.x + 8, t.y + 8],
    [t.x + t.w - 8, t.y + 8],
    [t.x + 8, t.y + t.h - 8],
    [t.x + t.w - 8, t.y + t.h - 8],
  ]) {
    const leg = box(8, 28, 8, "#2c2418");
    leg.position.set(lx, 0, ly);
    g.add(leg);
  }
  const apron = block({ x: t.x + 4, y: t.y + 4, w: t.w - 8, h: t.h - 8 }, 6, "#2c2418", 22);
  g.add(apron);
  const tableY = 35.2;
  const bankers: { shade: THREE.MeshLambertMaterial; pool: THREE.Mesh; tp: THREE.Mesh; h: THREE.Sprite; l: THREE.PointLight }[] = [];
  [t.x + 70, t.x + t.w - 70].forEach((lx) => {
    const ly = t.y + 16;
    const base = cyl(8, 9, 3, 8, "#8a6a3a");
    base.position.set(lx, tableY, ly);
    const stem = cyl(1.4, 1.4, 16, 5, "#8a6a3a");
    stem.position.set(lx, tableY + 3, ly);
    const shadeM = ownMat("#3f7d5a", { emissive: "#3f9d6a", glow: 0.45 });
    const sg = new THREE.CylinderGeometry(7, 7, 28, 8, 1, false, 0, Math.PI);
    sg.rotateZ(Math.PI / 2);
    const lampShade = new THREE.Mesh(sg, shadeM);
    lampShade.rotation.x = -0.35; // opening tipped toward the reader
    lampShade.position.set(lx, tableY + 18, ly + 2);
    lampShade.castShadow = true;
    const bulb = cyl(2.6, 2.6, 20, 6, glowMat("#fff0c8"));
    bulb.rotation.z = Math.PI / 2;
    bulb.position.set(lx + 10, tableY + 16, ly + 3); // bottom-pivoted: spans lx−10..lx+10
    bulb.castShadow = false;
    const tp = glowPool(lx, t.y + 34, 58, "#ffe6a8", 0.3, tableY + 0.4);
    const pool = glowPool(lx, t.y + t.h + 30, 110, "#78dca0", 0.14);
    const h = halo(80, "#b8f0c8", 0.28);
    h.position.set(lx, tableY + 18, ly + 8);
    const l = lamp("#ffe6b8", 1.1, 260);
    l.position.set(lx, tableY + 14, ly + 12);
    g.add(base, stem, lampShade, bulb, tp, pool, h, l);
    bankers.push({ shade: shadeM, pool, tp, h, l });
  });
  anim.push((f) => {
    bankers.forEach((b, i) => {
      const gl = 0.75 + 0.25 * Math.sin(f.t / 1.2 + i * 2);
      b.shade.emissiveIntensity = 0.35 + gl * 0.2;
      (b.pool.material as THREE.MeshBasicMaterial).opacity = 0.08 + gl * 0.07;
      (b.tp.material as THREE.MeshBasicMaterial).opacity = 0.2 + gl * 0.12;
      (b.h.material as THREE.SpriteMaterial).opacity = 0.18 + gl * 0.12;
      b.l.intensity = 0.8 + gl * 0.4;
    });
  });
  // an open sleeve + a 45 out on the table
  const sleeve = box(36, 1.2, 28, "#d8cdb8");
  sleeve.position.set(t.x + 148, tableY, t.y + 34);
  sleeve.rotation.y = 0.12;
  const single = cyl(13, 13, 1, 16, "#181818");
  single.position.set(t.x + 186, tableY, t.y + 34);
  const sLabel = cyl(4, 4, 1.4, 10, "#caa44a");
  sLabel.position.set(t.x + 186, tableY, t.y + 34);
  const pile = box(30, 5, 30, "#4a3a2a");
  pile.position.set(t.x + t.w - 130, tableY, t.y + 36);
  pile.rotation.y = -0.2;
  const pileTop = box(30, 1.2, 30, "#a8452f");
  pileTop.position.set(t.x + t.w - 130, tableY + 5, t.y + 36);
  pileTop.rotation.y = -0.1;
  g.add(sleeve, single, sLabel, pile, pileTop);

  /* ---------------- the card catalogue (drawers face the room) */
  const cg = catalog;
  const cab = block({ x: cg.x - 22, y: cg.y - 16, w: 44, h: 36 }, 52, "#4a3826");
  const cabTop = block({ x: cg.x - 24, y: cg.y - 18, w: 48, h: 40 }, 4, "#5a4430", 52);
  g.add(cab, cabTop);
  const drawerM = mat("#2c2014");
  const pullM = mat("#caa44a");
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 2; i++) {
      const dr = box(17, 9, 2, drawerM);
      dr.position.set(cg.x - 10 + i * 20, 6 + j * 11.5, cg.y + 20.5);
      const pull = box(5, 2, 1.6, pullM);
      pull.position.set(cg.x - 10 + i * 20, 10 + j * 11.5, cg.y + 21.8);
      dr.castShadow = pull.castShadow = false;
      g.add(dr, pull);
    }
  const cardHalo = halo(60, "#ffd89a", 0.1);
  cardHalo.position.set(cg.x, 60, cg.y);
  g.add(cardHalo);

  /* ---------------- cone pendants hung over the aisle between the stacks */
  const pendants = [300, 570, 840];
  pendants.forEach((lx, i) => {
    const py = 270;
    const hh = 128;
    const cord = cyl(0.6, 0.6, 40, 3, "#0e0a06");
    cord.position.set(lx, hh + 10, py);
    const shadeC = cone(13, 12, 8, ownMat("#5a4a2a", { emissive: "#ffb860", glow: 0.18 }));
    shadeC.position.set(lx, hh - 2, py);
    const shadeIn = new THREE.Mesh(new THREE.CircleGeometry(12, 8), glowMat("#ffe0a0"));
    shadeIn.rotation.x = Math.PI / 2;
    shadeIn.position.set(lx, hh - 2.1, py);
    const h = halo(150, "#ffd690", 0.38);
    h.position.set(lx, hh - 6, py);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(12.5, 1.1, 3, 10), glowMat("#ffe0a0"));
    rim.rotation.x = Math.PI / 2;
    rim.position.set(lx, hh - 2, py);
    g.add(rim);
    const pool = glowPool(lx, py, 150, "#ffd68c", 0.14);
    g.add(cord, shadeC, shadeIn, h, pool);
    if (i !== 1) {
      const l = lamp("#ffd8a0", 1.0, 330);
      l.position.set(lx, hh - 14, py);
      g.add(l);
    }
  });

  /* ---------------- the room's name, inlaid in brass in the floor */
  const plate = panel(420, 40, (c, w, h) => {
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = "800 22px 'Shippori Mincho',serif";
    c.fillStyle = "#c8e8c8";
    c.shadowColor = "rgba(0,0,0,.6)";
    c.shadowBlur = 8;
    c.fillText("書庫 · THE ARCHIVE", w / 2, h / 2 + 1);
  }, 420);
  plate.rotation.x = -Math.PI / 2;
  plate.position.set(ROOM.w / 2, 0.6, ROOM.h - 64);
  g.add(plate);

  /* ---------------- dust hanging in the lamplight */
  const DUST = 56;
  const dust = motes(DUST, "#ffe6b8", 5, 0.55);
  const sources: [number, number][] = [
    [300, 270],
    [570, 270],
    [840, 270],
    [t.x + 70, t.y + 30],
    [t.x + t.w - 70, t.y + 30],
  ];
  const dp = Array.from({ length: DUST }, (_, i) => {
    const [sx, sy] = sources[i % sources.length];
    return [sx + (R() - 0.5) * 150, R() * 130, sy + (R() - 0.5) * 110, 2 + R() * 4, R() * 6];
  });
  g.add(dust);
  anim.push((f) => {
    const p = dust.geometry.attributes.position as THREE.BufferAttribute;
    dp.forEach((d, i) => {
      d[1] += d[3] * f.dt;
      if (d[1] > 135) d[1] = 4;
      p.setXYZ(i, d[0] + Math.sin(f.t * 0.25 + d[4]) * 10, d[1], d[2] + Math.cos(f.t * 0.2 + d[4]) * 6);
    });
    p.needsUpdate = true;
  });

  return {
    group: g,
    bg: "#0a0d09",
    light: { sky: "#e4ecd8", ground: "#241a10", hemi: 1.05, key: "#ffe4b8", keyI: 1.15 },
    update: (f) => anim.forEach((a) => a(f)),
  };
};
