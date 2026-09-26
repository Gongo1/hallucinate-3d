import * as THREE from "three";
import { ROOM, WALL, WAREHOUSE } from "../../layout";
import type { RoomDoor } from "../../rooms";
import type { FrameInfo, RoomBuilder } from "../types";
import { shell, DOOR_H } from "../shared";
import { box, block, cyl, mat, ownMat, glowMat, glowPool, halo, lamp, panel, shade, rng } from "../kit";

// WAREHOUSE — Chicago, where it began. Poured concrete + brick, steel pillars with
// hazard bands, a speaker wall of stacked cabinets along the back that pumps with
// the room, sodium light through drifting haze, and the TR-909 on a pedestal like
// a relic under its own spotlight.

const { stage: s, pillars, tr909: n } = WAREHOUSE;
const WALL_TALL = 168;
const STAGE_H = 22;
const CAB = { w: 70, h: 46, d: 46 };
const PILLAR_H = 120; // short of the dark above, so front pillars don't wall off the floor

/** A tiling brick texture (shared by every wall face in the room). */
function brickTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 320;
  c.height = 96;
  const x = c.getContext("2d")!;
  const R = rng(909);
  x.fillStyle = "#1c1411"; // mortar
  x.fillRect(0, 0, c.width, c.height);
  const tones = ["#3a2a24", "#442e26", "#4e3329", "#35251f", "#5a3a2e"];
  for (let row = 0; row < 4; row++) {
    const off = row % 2 ? 40 : 0;
    for (let col = -1; col < 5; col++) {
      x.fillStyle = tones[Math.floor(R() * tones.length)];
      x.fillRect(col * 80 + off + 2, row * 24 + 2, 76, 20);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Yellow/black hazard stripes for the pillar bands. */
function hazardTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 16;
  const x = c.getContext("2d")!;
  x.fillStyle = "#d6aa3c";
  x.fillRect(0, 0, 64, 16);
  x.fillStyle = "#1a1714";
  for (let i = -16; i < 64; i += 16) {
    x.beginPath();
    x.moveTo(i, 16);
    x.lineTo(i + 8, 16);
    x.lineTo(i + 16, 0);
    x.lineTo(i + 8, 0);
    x.closePath();
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Brick facing on the inside of the walls, split around the door gaps. */
function brickFacing(doors: RoomDoor[], m: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const face = (w: number, h: number) => {
    const geo = new THREE.PlaneGeometry(w, h);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 160, (uv.getY(i) * h) / 48);
    const me = new THREE.Mesh(geo, m);
    me.receiveShadow = true;
    return me;
  };
  const span = (edge: "back" | "left" | "right") => {
    const along = edge === "back" ? ROOM.w : ROOM.h;
    const lo = WALL;
    const hi = along - WALL;
    const gaps = doors
      .filter((d) => (edge === "back" ? d.facing === "down" : edge === "left" ? d.facing === "right" : d.facing === "left"))
      .map((d) => (edge === "back" ? [d.x - 12, d.x + d.w + 12] : [d.y - 12, d.y + d.h + 12]))
      .sort((a, b) => a[0] - b[0]);
    const put = (a: number, b: number, y0: number, y1: number) => {
      if (b - a < 1 || y1 - y0 < 1) return;
      const p = face(b - a, y1 - y0);
      const mid = (a + b) / 2;
      const my = (y0 + y1) / 2;
      if (edge === "back") p.position.set(mid, my, WALL + 0.4);
      else if (edge === "left") {
        p.rotation.y = Math.PI / 2;
        p.position.set(WALL + 0.4, my, mid);
      } else {
        p.rotation.y = -Math.PI / 2;
        p.position.set(ROOM.w - WALL - 0.4, my, mid);
      }
      g.add(p);
    };
    let cur = lo;
    for (const [a, b] of gaps) {
      put(cur, Math.max(cur, a), 0, WALL_TALL);
      put(Math.max(lo, a), Math.min(hi, b), DOOR_H + 8, WALL_TALL); // over the lintel
      cur = Math.max(cur, b);
    }
    put(cur, hi, 0, WALL_TALL);
  };
  span("back");
  span("left");
  span("right");
  return g;
}

/** playback-synced pulse (the 2D engine's playingPulse, in seconds) */
function playingPulse(playing: boolean, t: number, seed: number): number {
  if (!playing) return 0.15;
  return 0.5 + 0.5 * Math.sin(t / 0.18 + seed * 1.7);
}

export const buildWarehouse: RoomBuilder = ({ room }) => {
  const g = new THREE.Group();
  const anim: ((f: FrameInfo) => void)[] = [];
  const R = rng(86);

  /* ---------------- floor: poured-concrete slabs, joints, scuffs + oil */
  const joint = box(ROOM.w, 3, ROOM.h, "#0e0c0b");
  joint.position.set(ROOM.w / 2, -6, ROOM.h / 2);
  joint.castShadow = false;
  g.add(joint);
  const xs = [0, 160, 400, 640, 880, ROOM.w];
  const ys = [0, 200, 420, 640, ROOM.h];
  for (let i = 0; i < xs.length - 1; i++)
    for (let j = 0; j < ys.length - 1; j++) {
      const slab = block(
        { x: xs[i] + 1.5, y: ys[j] + 1.5, w: xs[i + 1] - xs[i] - 3, h: ys[j + 1] - ys[j] - 3 },
        3,
        shade("#262220", (R() - 0.5) * 10),
        -3
      );
      slab.castShadow = false;
      g.add(slab);
    }
  for (let i = 0; i < 4; i++) {
    // tire scuffs — flat dark arcs from forklifts long gone
    const arc = new THREE.Mesh(new THREE.TorusGeometry(70 + R() * 50, 1.6, 2, 18, 1.1), mat("#201c1a"));
    arc.rotation.x = -Math.PI / 2;
    arc.rotation.z = R() * Math.PI * 2;
    arc.position.set(200 + R() * 740, 0.25, 300 + R() * 380);
    g.add(arc);
  }
  for (let i = 0; i < 3; i++) {
    const oil = new THREE.Mesh(new THREE.CircleGeometry(1, 10), mat("#1d1a18"));
    oil.rotation.x = -Math.PI / 2;
    oil.scale.set(16 + R() * 20, 10 + R() * 12, 1);
    oil.position.set(380 + R() * 420, 0.3, 560 + R() * 150);
    g.add(oil);
  }

  /* ---------------- brick walls */
  g.add(shell(room.doors, { floor: false, wall: "#3a2a24", trim: "#2a1e1a", height: WALL_TALL }));
  const brickM = new THREE.MeshLambertMaterial({ map: brickTexture() });
  g.add(brickFacing(room.doors, brickM));
  // high steel-mullioned windows on the back wall — city night leaking in
  for (const wx of [210, 930]) {
    const frame = box(150, 56, 4, "#1c1a1a");
    frame.position.set(wx, 96, WALL + 1);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(142, 48), glowMat("#3a4a6a", 0.9));
    glass.position.set(wx, 124, WALL + 3.2);
    g.add(frame, glass);
    for (let k = 1; k < 5; k++) {
      const mv = box(2, 48, 2, "#1c1a1a");
      mv.position.set(wx - 71 + k * 28.4, 100, WALL + 3.6);
      mv.castShadow = false;
      g.add(mv);
    }
    const mh = box(142, 2, 2, "#1c1a1a");
    mh.position.set(wx, 123, WALL + 3.6);
    mh.castShadow = false;
    g.add(mh);
    const cool = halo(200, "#5a78a8", 0.12);
    cool.position.set(wx, 124, WALL + 10);
    g.add(cool);
  }

  /* ---------------- sodium light pool over the floor */
  g.add(glowPool(570, 420, 340, "#ffa03c", 0.14));

  /* ---------------- painted floor letters, half worn away */
  const letters = panel(700, 90, (ctx, w, h) => {
    ctx.font = "900 64px 'Anton',sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(216,170,60,.15)";
    ctx.fillText("HOUSE IS A FEELING", w / 2, h / 2 + 4);
    // wear: knock chunks out of the paint
    ctx.globalCompositeOperation = "destination-out";
    const W = rng(4);
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.3 + W() * 0.6})`;
      ctx.fillRect(W() * w, W() * h, 4 + W() * 26, 2 + W() * 7);
    }
    ctx.globalCompositeOperation = "source-over";
  }, 620, 2, true);
  letters.rotation.x = -Math.PI / 2;
  letters.position.set(570, 0.5, 470);
  g.add(letters);

  const plate = panel(420, 44, (ctx, w, h) => {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "800 26px 'Shippori Mincho',serif";
    ctx.fillStyle = "rgba(255,179,140,.6)";
    ctx.fillText("WAREHOUSE · 倉庫", w / 2, h / 2 + 1);
  }, 290, 3, true);
  plate.rotation.x = -Math.PI / 2;
  plate.position.set(ROOM.w / 2, 0.6, ROOM.h - 64);
  g.add(plate);

  /* ---------------- the speaker wall on its stage along the back */
  g.add(block(s, STAGE_H, "#1a1614"));
  const edgeTrim = block({ x: s.x - 2, y: s.y + s.h - 3, w: s.w + 4, h: 3 }, 3, "#4a4542", STAGE_H - 2);
  edgeTrim.castShadow = false;
  g.add(edgeTrim);
  const rings: { m: THREE.MeshBasicMaterial; r: THREE.Mesh; seed: number }[] = [];
  const cones: { c: THREE.Mesh; seed: number }[] = [];
  for (let i = 0; i < 5; i++)
    for (let j = 0; j < 2; j++) {
      const cx = s.x + 10 + i * 72 + CAB.w / 2;
      const cy = STAGE_H + j * CAB.h;
      const zf = s.y + 6 + CAB.d; // front face
      const cab = box(CAB.w, CAB.h - 1, CAB.d, "#141110");
      cab.position.set(cx, cy, s.y + 6 + CAB.d / 2);
      g.add(cab);
      const baffle = box(CAB.w - 6, CAB.h - 7, 1, "#0e0c0b");
      baffle.position.set(cx, cy + 3, zf + 0.5);
      baffle.castShadow = false;
      g.add(baffle);
      for (const [dx, r] of [[-13, 14], [18, 8.5]] as const) {
        const sur = new THREE.Mesh(new THREE.CylinderGeometry(r + 2, r + 2, 2, 12), mat("#2a2420"));
        sur.rotation.x = Math.PI / 2;
        sur.position.set(cx + dx, cy + CAB.h / 2, zf + 1.2);
        const cn = new THREE.Mesh(new THREE.ConeGeometry(r * 0.85, r * 0.55, 12), mat("#1e1a18"));
        cn.rotation.x = -Math.PI / 2;
        cn.position.set(cx + dx, cy + CAB.h / 2, zf + 1.6);
        const rm = glowMat("#ff8c50", 0.3, true);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 1.2, 0.9, 3, 16), rm);
        ring.position.set(cx + dx, cy + CAB.h / 2, zf + 2.4);
        g.add(sur, cn, ring);
        rings.push({ m: rm, r: ring, seed: i + j });
        cones.push({ c: cn, seed: i + j });
      }
    }
  const wallGlow = glowPool(s.x + s.w / 2, s.y + s.h + 30, 260, "#ff8c50", 0.08);
  g.add(wallGlow);
  anim.push((f) => {
    for (const r of rings) {
      const w = playingPulse(f.playing, f.t, r.seed);
      r.m.opacity = 0.25 + w * 0.45;
      r.r.scale.setScalar(1 + w * 0.12);
    }
    for (const c of cones) {
      const w = playingPulse(f.playing, f.t, c.seed);
      c.c.scale.set(1, 1 + (f.playing ? w * 0.8 : 0), 1);
    }
    (wallGlow.material as THREE.MeshBasicMaterial).opacity = f.playing ? 0.08 + 0.08 * playingPulse(true, f.t, 0) : 0.06;
  });

  /* ---------------- steel pillars with hazard bands (collision: 28×80) */
  const hazM = new THREE.MeshLambertMaterial({ map: hazardTexture() });
  for (const p of pillars) {
    g.add(block({ x: p.x - 14, y: p.y - 40, w: 28, h: 80 }, PILLAR_H, "#34302e"));
    const edge = box(1, PILLAR_H - 6, 78, "#4a4542");
    edge.position.set(p.x - 14.4, 4, p.y);
    edge.castShadow = false;
    g.add(edge);
    const band = block({ x: p.x - 15, y: p.y - 41, w: 30, h: 82 }, 12, hazM, 10);
    band.castShadow = false;
    g.add(band);
    // riveted base + cap plates
    g.add(block({ x: p.x - 19, y: p.y - 45, w: 38, h: 90 }, 4, "#2a2624"));
    g.add(block({ x: p.x - 19, y: p.y - 45, w: 38, h: 90 }, 5, "#2a2624", PILLAR_H));
  }

  /* ---------------- the TR-909 shrine: pedestal, the relic, one spotlight */
  const PED = 44;
  g.add(block({ x: n.x - 24, y: n.y - 16, w: 48, h: 36 }, PED, "#3a3430"));
  g.add(block({ x: n.x - 27, y: n.y - 19, w: 54, h: 42 }, 3, "#4a4440", PED));
  g.add(block({ x: n.x - 27, y: n.y - 19, w: 54, h: 42 }, 4, "#2a2622"));
  const plaque = panel(80, 22, (ctx, w, h) => {
    ctx.fillStyle = "#8a6a3a";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#1a130d";
    ctx.font = "700 11px 'DM Mono'";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("TR-909 · 1984", w / 2, h / 2 + 1);
  }, 34, 3, true);
  plaque.position.set(n.x, 26, n.y + 20.3);
  g.add(plaque);
  const unit = new THREE.Group();
  unit.add(box(44, 7, 28, "#d8d2c8"));
  const accent = box(12, 1, 5, "#e0763a");
  accent.position.set(-14, 7, -8);
  const knobs = box(36, 1.4, 8, "#9a948c");
  knobs.position.set(0, 7, -6);
  unit.add(accent, knobs);
  const stepCols = ["#c8302a", "#e0763a", "#e8c84a", "#f0ece0"];
  const leds: THREE.MeshBasicMaterial[] = [];
  for (let i = 0; i < 16; i++) {
    const key = box(2, 1.6, 3, stepCols[Math.floor(i / 4)]);
    key.position.set(-18.6 + i * 2.48, 7, 8);
    key.castShadow = false;
    const lm = glowMat("#ff3a2a", 0.15);
    const led = box(1, 1, 1, lm);
    led.castShadow = false;
    led.position.set(-18.6 + i * 2.48, 7.6, 4.8);
    unit.add(key, led);
    leds.push(lm);
  }
  unit.position.set(n.x, PED + 3, n.y + 2);
  unit.rotation.x = 0.22; // propped toward the room like a museum piece
  g.add(unit);
  g.add(glowPool(n.x, n.y - 8, 100, "#ffb45a", 0.26));
  const spotHalo = halo(120, "#ffb45a", 0.22);
  spotHalo.position.set(n.x, PED + 14, n.y);
  g.add(spotHalo);
  const spot = lamp("#ffb45a", 1.4, 220);
  spot.position.set(n.x, 150, n.y + 30);
  g.add(spot);
  anim.push((f) => {
    // the sequencer runs 16ths at the room's ~120 bpm while music plays
    const step = f.playing ? Math.floor(f.t * 8) % 16 : -1;
    leds.forEach((m, i) => {
      m.opacity = i === step ? 1 : f.playing && i % 4 === 0 ? 0.35 : 0.12;
    });
  });

  /* ---------------- sodium pendants, hung high */
  const domes: THREE.MeshLambertMaterial[] = [];
  for (const [lx, ly] of [[380, 400], [760, 400], [570, 620]] as const) {
    const cord = cyl(0.7, 0.7, 30, 3, "#0c0a09");
    cord.position.set(lx, 164, ly);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(16, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2), mat("#5a6a5a", { side: THREE.DoubleSide }));
    dome.position.set(lx, 150, ly);
    const bm = ownMat("#ffd08a", { emissive: "#ffa040", glow: 1 });
    const bulb = new THREE.Mesh(new THREE.IcosahedronGeometry(6, 0), bm);
    bulb.position.set(lx, 144, ly);
    const h = halo(110, "#ffa040", 0.3);
    h.position.set(lx, 144, ly);
    g.add(cord, dome, bulb, h);
    domes.push(bm);
  }
  for (const [lx, ly] of [[380, 400], [760, 400]] as const) {
    const l = lamp("#ff9a40", 1.25, 520);
    l.position.set(lx, 130, ly);
    g.add(l);
  }
  anim.push((f) => {
    // sodium lamps hum — a faint uneven flicker
    domes.forEach((m, i) => {
      m.emissiveIntensity = 0.9 + 0.08 * Math.sin(f.t * 11 + i * 3) * Math.sin(f.t * 0.7 + i);
    });
  });

  /* ---------------- drifting haze */
  const smoke = Array.from({ length: 14 }, (_, i) => {
    const sm = { x: R(), y: R(), sz: 60 + R() * 90, ph: R() * Math.PI * 2, h: 40 + R() * 60 };
    const sp = halo(sm.sz * 2.4, "#c8c2ba", 0.06);
    g.add(sp);
    return { sm, sp, i };
  });
  anim.push((f) => {
    for (const { sm, sp } of smoke) {
      const x = ((sm.x + f.t / 60) % 1) * ROOM.w;
      const y = WALL + sm.y * (ROOM.h - 2 * WALL);
      sp.position.set(x, sm.h, y);
      (sp.material as THREE.SpriteMaterial).opacity = 0.05 + 0.035 * Math.sin(f.t / 3 + sm.ph);
    }
  });

  return {
    group: g,
    bg: "#0b0807",
    fog: { color: "#0b0807", near: 1150, far: 3200 },
    light: { sky: "#ffc890", ground: "#1a1210", hemi: 0.78, key: "#ffcf9a", keyI: 0.85 },
    dancers: true,
    update: (f) => anim.forEach((a) => a(f)),
  };
};
