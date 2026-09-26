import * as THREE from "three";
import { ROOM, WALL, PLAYA } from "../../layout";
import type { FrameInfo, RoomBuilder } from "../types";
import { box, block, cyl, cone, lump, mat, glowMat, glowPool, halo, lamp, panel, motes, shade, rng, floorRect } from "../kit";

// LA PLAYA — dusk beach club. Sand underfoot, a bamboo fence along the back and
// sides, palms, a fire pit everyone orbits, two tiki torches, and the sea rolling
// in along the front of the room (the shoreline is solid — you can't swim).
// Afro-melodic crates live in the sand between the palms.

const { shoreY, fire, palms, torches } = PLAYA;
const SAND = "#a8906a";

export const buildPlaya: RoomBuilder = ({ room }) => {
  const g = new THREE.Group();
  const anim: ((f: FrameInfo) => void)[] = [];
  const R = rng(41);

  /* ---------------- sand: a faceted slab up to the shoreline + a wet band */
  const sand = box(ROOM.w + 400, 8, shoreY + 260, SAND);
  sand.position.set(ROOM.w / 2, -8, (shoreY - 260) / 2);
  sand.castShadow = false;
  g.add(sand);
  g.add(floorRect({ x: -200, y: shoreY - 44, w: ROOM.w + 400, h: 60 }, "#8a7a5c", 0.3));
  // speckles + wind ripples (flat, passable)
  for (let i = 0; i < 70; i++) {
    const sp = box(3 + (i % 3), 0.6, 3, shade(SAND, -24 - (i % 4) * 6));
    sp.position.set((i * 137) % ROOM.w, 0, WALL + ((i * 211) % (shoreY - WALL - 50)));
    sp.castShadow = false;
    g.add(sp);
  }
  for (let i = 0; i < 9; i++) {
    const rip = box(40 + R() * 50, 0.8, 2.2, shade(SAND, 14));
    rip.position.set(80 + R() * (ROOM.w - 160), 0, 90 + R() * (shoreY - 200));
    rip.rotation.y = (R() - 0.5) * 0.4;
    rip.castShadow = false;
    g.add(rip);
  }

  /* ---------------- the fence: bamboo poles (one instanced mesh) + two rails */
  type Edge = "back" | "left" | "right";
  const doorGaps = room.doors.map((d) =>
    d.facing === "down"
      ? { edge: "back" as Edge, a: d.x - 14, b: d.x + d.w + 14 }
      : { edge: (d.facing === "left" ? "right" : "left") as Edge, a: d.y - 14, b: d.y + d.h + 14 }
  );
  const inGap = (edge: Edge, v: number) => doorGaps.some((d) => d.edge === edge && v > d.a && v < d.b);
  const poles: { x: number; z: number; h: number }[] = [];
  for (let x = 6; x < ROOM.w; x += 10) if (!inGap("back", x)) poles.push({ x, z: WALL / 2, h: 58 + R() * 16 });
  for (let z = WALL; z < shoreY - 10; z += 10) {
    if (!inGap("left", z)) poles.push({ x: WALL / 2, z, h: 54 + R() * 14 });
    if (!inGap("right", z)) poles.push({ x: ROOM.w - WALL / 2, z, h: 54 + R() * 14 });
  }
  const poleGeo = new THREE.CylinderGeometry(4.6, 5, 1, 5);
  poleGeo.translate(0, 0.5, 0);
  const fence = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ flatShading: true }), poles.length);
  const m4 = new THREE.Matrix4();
  const tones = ["#8a7650", "#7a6a4e", "#9a8458", "#6e5e42"].map((c) => new THREE.Color(c));
  poles.forEach((p, i) => {
    m4.makeScale(1, p.h, 1).setPosition(p.x, 0, p.z);
    fence.setMatrixAt(i, m4);
    fence.setColorAt(i, tones[i % tones.length]);
  });
  fence.castShadow = true;
  fence.receiveShadow = true;
  g.add(fence);
  const railM = mat("#5a4630");
  const rail = (edge: Edge, a: number, b: number) => {
    for (const y of [22, 46]) {
      const r =
        edge === "back"
          ? block({ x: a, y: WALL / 2 + 4, w: b - a, h: 4 }, 4, railM, y)
          : block({ x: edge === "left" ? WALL / 2 + 4 : ROOM.w - WALL / 2 - 8, y: a, w: 4, h: b - a }, 4, railM, y);
      r.castShadow = false;
      g.add(r);
    }
  };
  const runs = (edge: Edge, start: number, len: number) => {
    let s = start;
    for (const d of doorGaps.filter((q) => q.edge === edge).sort((p, q) => p.a - q.a)) {
      if (d.a > s) rail(edge, s, d.a);
      s = d.b;
    }
    if (s < len) rail(edge, s, len);
  };
  runs("back", 0, ROOM.w);
  runs("left", WALL, shoreY - 10);
  runs("right", WALL, shoreY - 10);

  /* ---------------- dunes + sea grass beyond the back fence */
  for (let i = 0; i < 9; i++) {
    const d = lump(90 + R() * 60, shade(SAND, -10 + R() * 20), 300 + i, 0.18, 1.6, 0.35, 0.9, 1);
    d.position.set(-60 + i * 150, -10, -70 - R() * 120);
    d.castShadow = false;
    g.add(d);
    for (let k = 0; k < 3; k++) {
      const blade = cone(2.2, 16 + R() * 12, 3, "#6e7a44");
      blade.position.set(d.position.x + (R() - 0.5) * 90, 14 + R() * 8, d.position.z + 60 + R() * 20);
      blade.rotation.z = (R() - 0.5) * 0.6;
      g.add(blade);
    }
  }
  // two surfboards leaning on the back fence
  (
    [
      ["#e0875a", 230],
      ["#5a86a8", 262],
    ] as const
  ).forEach(([c, x], i) => {
    const b = box(18, 70, 3.5, c);
    b.position.set(x, 0, WALL + 8);
    b.rotation.x = -0.18;
    b.rotation.z = (i - 0.5) * 0.12;
    const stripe = box(3, 70.5, 3.8, "#efe2c8");
    stripe.position.copy(b.position);
    stripe.rotation.copy(b.rotation);
    g.add(b, stripe);
  });

  /* ---------------- the sea: a faceted, rolling surface (shallow → deep) */
  const SEA_X = ROOM.w + 900;
  const SEA_Z = 720;
  const seaGeo = new THREE.PlaneGeometry(SEA_X, SEA_Z, 44, 16);
  seaGeo.rotateX(-Math.PI / 2);
  seaGeo.translate(ROOM.w / 2, 0, shoreY - 18 + SEA_Z / 2);
  const sp = seaGeo.attributes.position as THREE.BufferAttribute;
  const baseY = new Float32Array(sp.count);
  const cols = new Float32Array(sp.count * 3);
  const shallow = new THREE.Color("#3f8a96");
  const deep = new THREE.Color("#10284a");
  const tmp = new THREE.Color();
  for (let i = 0; i < sp.count; i++) {
    const k = Math.min(1, Math.max(0, (sp.getZ(i) - shoreY) / 220));
    tmp.copy(shallow).lerp(deep, k);
    cols.set([tmp.r, tmp.g, tmp.b], i * 3);
    baseY[i] = -3 - k * 4;
  }
  seaGeo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  const sea = new THREE.Mesh(seaGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  sea.receiveShadow = true;
  g.add(sea);
  const glint = glowPool(ROOM.w / 2 + 180, ROOM.h - 40, 200, "#dce6ff", 0.16, 2);
  g.add(glint);
  anim.push((f) => {
    for (let i = 0; i < sp.count; i++) {
      const x = sp.getX(i);
      const z = sp.getZ(i);
      const calm = z < shoreY + 10 ? 0.3 : 1;
      sp.setY(i, baseY[i] + calm * (Math.sin(x / 90 + f.t * 1.1) * 3 + Math.sin(z / 55 - f.t * 1.5 + x / 260) * 3.2));
    }
    sp.needsUpdate = true;
    (glint.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.05 * Math.sin(f.t * 0.8);
  });

  // three foam lines breathing up the beach
  const FOAM_N = 60;
  const foams: { geo: THREE.BufferGeometry; m: THREE.MeshBasicMaterial; k: number }[] = [];
  for (let k = 0; k < 3; k++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array((FOAM_N + 1) * 2 * 3), 3));
    const idx: number[] = [];
    for (let i = 0; i < FOAM_N; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    const m = glowMat("#f4faf8", 0.45);
    m.side = THREE.DoubleSide;
    const me = new THREE.Mesh(geo, m);
    me.frustumCulled = false;
    me.renderOrder = 2;
    g.add(me);
    foams.push({ geo, m, k });
  }
  anim.push((f) => {
    for (const { geo, m, k } of foams) {
      const ph = f.t / 2.4 + k * 2.1;
      const rise = Math.sin(ph) * 14;
      m.opacity = 0.45 + 0.2 * Math.sin(ph + 1);
      const p = geo.attributes.position as THREE.BufferAttribute;
      const w = 2 + k * 1.2;
      for (let i = 0; i <= FOAM_N; i++) {
        const x = -200 + ((ROOM.w + 400) * i) / FOAM_N;
        const z = shoreY - 6 + k * 16 - rise + Math.sin(x / 90 + ph * 2) * 5;
        p.setXYZ(i * 2, x, 1.4, z - w);
        p.setXYZ(i * 2 + 1, x, 1.4, z + w);
      }
      p.needsUpdate = true;
    }
  });

  /* ---------------- palms (trunk base = the collision footprint) */
  palms.forEach((p, pi) => {
    const front = p.y > 450;
    const H = front ? 88 : 112;
    const lean = (p.x < ROOM.w / 2 ? -1 : 1) * (front ? 0.22 : 0.14);
    const palm = new THREE.Group();
    palm.position.set(p.x, 0, p.y + 4);
    // ringed trunk: stacked, tapering, alternately toned segments bending outward
    const SEG = 7;
    let px = 0;
    let py = 0;
    for (let i = 0; i < SEG; i++) {
      const t = i / SEG;
      const hSeg = H / SEG;
      const a = lean * (0.4 + t);
      const s = cyl(5.4 - t * 2, 6.2 - t * 2, hSeg + 1.5, 6, i % 2 ? "#6a5238" : "#5a4630");
      s.position.set(px, py, 0);
      s.rotation.z = -a;
      palm.add(s);
      px += Math.sin(a) * hSeg;
      py += Math.cos(a) * hSeg;
    }
    const crown = new THREE.Group();
    crown.position.set(px, py, 0);
    for (let f = 0; f < 7; f++) {
      const frond = new THREE.Group();
      const leaf = cone(9, 64, 4, f % 2 ? "#3e6a44" : "#4a7a4e");
      leaf.scale.set(1, 1, 0.22);
      leaf.rotation.x = Math.PI / 2 + 0.55; // point outward, droop down
      leaf.position.z = 2;
      frond.add(leaf);
      frond.rotation.y = (f / 7) * Math.PI * 2 + pi;
      crown.add(frond);
    }
    for (let c = 0; c < 3; c++) {
      const nut = lump(3.6, "#4a3422", 90 + c, 0.2, 1, 1, 1, 0);
      nut.position.set(Math.cos(c * 2.1) * 5, -4, Math.sin(c * 2.1) * 5);
      crown.add(nut);
    }
    palm.add(crown);
    g.add(palm);
    anim.push((f) => {
      crown.rotation.z = Math.sin(f.t / 1.8 + p.x) * 0.05;
      crown.rotation.x = Math.sin(f.t / 2.3 + p.y) * 0.04;
    });
  });

  /* ---------------- the fire pit: stone ring, logs, flames, embers, a big warm pool */
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const st = lump(7.5, i % 2 ? "#564a3e" : "#6a5c4c", 60 + i, 0.3, 1.1, 0.8, 1, 0);
    st.position.set(fire.x + Math.cos(a) * 26, 4, fire.y + Math.sin(a) * 17);
    g.add(st);
  }
  for (let i = 0; i < 3; i++) {
    const log = cyl(3, 3.4, 34, 6, "#3a281a");
    log.geometry.translate(0, -17, 0);
    log.rotation.set(0, (i / 3) * Math.PI, Math.PI / 2 - 0.25);
    log.position.set(fire.x, 6, fire.y);
    g.add(log);
  }
  const flameOuter = cone(15, 46, 6, glowMat("#ff7a2e"));
  const flameMid = cone(10, 36, 6, glowMat("#ffb04a"));
  const flameCore = cone(5.5, 22, 5, glowMat("#fff0b0"));
  for (const fl of [flameOuter, flameMid, flameCore]) {
    fl.castShadow = false;
    fl.position.set(fire.x, 6, fire.y);
    g.add(fl);
  }
  const fireHalo = halo(190, "#ff9a40", 0.5);
  fireHalo.position.set(fire.x, 32, fire.y);
  const firePool = glowPool(fire.x, fire.y, 200, "#ff9646", 0.3);
  const fireLight = lamp("#ff8a40", 2.4, 460);
  fireLight.position.set(fire.x, 34, fire.y);
  g.add(fireHalo, firePool, fireLight);
  const EMB = 22;
  const embers = motes(EMB, "#ffb060", 5, 0.95);
  const eb = Array.from({ length: EMB }, () => ({ p: R(), a: R() * 6.28, r: R() * 10, s: 0.4 + R() * 0.5 }));
  g.add(embers);
  anim.push((f) => {
    const fl = 0.7 + 0.3 * Math.sin(f.t * 11) * Math.sin(f.t * 4.3);
    flameOuter.scale.set(1 + fl * 0.1, 0.75 + fl * 0.4, 1 + fl * 0.1);
    flameMid.scale.set(1, 0.8 + fl * 0.35 + Math.sin(f.t * 17) * 0.06, 1);
    flameCore.scale.set(1, 0.8 + fl * 0.3, 1);
    flameOuter.rotation.y = f.t * 1.3;
    flameMid.rotation.y = -f.t * 1.7;
    fireLight.intensity = 1.9 + fl * 0.9;
    (fireHalo.material as THREE.SpriteMaterial).opacity = 0.35 + fl * 0.2;
    (firePool.material as THREE.MeshBasicMaterial).opacity = 0.22 + fl * 0.1;
    firePool.scale.setScalar(1 + fl * 0.12);
    const p = embers.geometry.attributes.position as THREE.BufferAttribute;
    eb.forEach((e, i) => {
      e.p += f.dt * e.s;
      if (e.p > 1) {
        e.p = 0;
        e.a = R() * 6.28;
        e.r = R() * 10;
      }
      p.setXYZ(i, fire.x + Math.cos(e.a + e.p * 3) * (e.r + e.p * 14), 14 + e.p * 120, fire.y + Math.sin(e.a + e.p * 3) * (e.r * 0.7 + e.p * 8));
    });
    p.needsUpdate = true;
  });

  /* ---------------- tiki torches */
  torches.forEach((t, i) => {
    const pole = cyl(2.6, 3.4, 44, 5, "#4a3a26");
    pole.position.set(t.x, 0, t.y);
    const cup = cyl(6, 3.5, 8, 6, "#6a5238");
    cup.position.set(t.x, 44, t.y);
    for (const y of [12, 30]) {
      const bind = cyl(3.8, 3.8, 2, 5, "#2a1c10");
      bind.position.set(t.x, y, t.y);
      g.add(bind);
    }
    const base = lump(8, "#6a5c4c", 80 + i, 0.3, 1.2, 0.6, 1, 0);
    base.position.set(t.x, 2, t.y);
    const flame = cone(6.5, 24, 5, glowMat("#ffa040"));
    flame.castShadow = false;
    flame.position.set(t.x, 51, t.y);
    const core = cone(2.6, 10, 4, glowMat("#fff0b0"));
    core.castShadow = false;
    core.position.set(t.x, 51, t.y);
    const h = halo(80, "#ffa050", 0.4);
    h.position.set(t.x, 60, t.y);
    const pool = glowPool(t.x, t.y, 90, "#ffa050", 0.16);
    const l = lamp("#ffa050", 0.9, 240);
    l.position.set(t.x, 62, t.y);
    g.add(pole, cup, base, flame, core, h, pool, l);
    anim.push((f) => {
      const tf = 0.6 + 0.4 * Math.sin(f.t * 7.1 + t.x);
      flame.scale.set(1, 0.8 + tf * 0.45, 1);
      core.scale.set(1, 0.8 + tf * 0.4, 1);
      flame.rotation.y = f.t * 2 + i;
      l.intensity = 0.7 + tf * 0.4;
      (h.material as THREE.SpriteMaterial).opacity = 0.28 + tf * 0.16;
    });
  });

  /* ---------------- driftwood benches (passable) */
  for (const [x, y, w] of [
    [475, 547, 90],
    [680, 537, 80],
  ] as const) {
    const log = cyl(6.5, 7.5, w, 7, "#7a6a4e");
    log.geometry.translate(0, -w / 2, 0);
    log.rotation.z = Math.PI / 2;
    log.position.set(x, 6.5, y);
    const knot = lump(5, "#6a5a40", x, 0.3, 1, 1, 1, 0);
    knot.position.set(x + w / 2 - 6, 9, y - 3);
    g.add(log, knot);
  }
  // shells + pebbles along the waterline
  for (let i = 0; i < 12; i++) {
    const s = lump(2.2 + R() * 2.4, i % 3 ? "#e8dcc8" : "#c9b8a0", 120 + i, 0.3, 1.2, 0.5, 1, 0);
    s.position.set(40 + R() * (ROOM.w - 80), 1, shoreY - 50 + R() * 26);
    s.castShadow = false;
    g.add(s);
  }

  /* ---------------- the name, drawn in the wet sand between the torches */
  const name = panel(260, 40, (c, w, h) => {
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = "800 26px 'Shippori Mincho',serif";
    c.fillStyle = "rgba(255,217,168,.55)";
    c.fillText("LA PLAYA · 波", w / 2, h / 2);
  }, 200);
  name.rotation.x = -Math.PI / 2;
  name.position.set(ROOM.w / 2, 0.9, shoreY - 26);
  // no depth write: the torch/fire light pools below it must still glow through
  (name.material as THREE.Material).depthWrite = false;
  g.add(name);

  /* ---------------- drifting sand-sparkles in the dusk light */
  const SPK = 26;
  const sparks = motes(SPK, "#ffe0b0", 4, 0.5);
  const sk = Array.from({ length: SPK }, () => [R() * ROOM.w, 8 + R() * 60, WALL + R() * (shoreY - WALL), 10 + R() * 14]);
  g.add(sparks);
  anim.push((f) => {
    const p = sparks.geometry.attributes.position as THREE.BufferAttribute;
    sk.forEach((s, i) => {
      s[0] += s[3] * f.dt;
      if (s[0] > ROOM.w) s[0] = 0;
      p.setXYZ(i, s[0], s[1] + Math.sin(f.t + i) * 4, s[2]);
    });
    p.needsUpdate = true;
  });

  return {
    group: g,
    bg: "#0e1220",
    light: { sky: "#ffc8a8", ground: "#2e2436", hemi: 0.95, key: "#ffb488", keyI: 1.2, keyFrom: [0.5, 0.62, 0.95] },
    dancers: true,
    update: (f) => anim.forEach((a) => a(f)),
  };
};
