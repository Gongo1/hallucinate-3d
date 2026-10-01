import * as THREE from "three";
import { ROOM, WALL, CHAMBER } from "../../layout";
import type { FrameInfo, RoomBuilder } from "../types";
import { shell } from "../shared";
import {
  box, block, cyl, cone, mat, glowMat, glowPool, halo, lamp, panel, motes, shade, rng,
} from "../kit";

// UNDERCROFT — a stone hall under the Archive. A giant carved face fills
// the back wall with a stage jutting out of its open mouth, a channel of dark
// green water down each side of the stage, serpent pillars lining the walkway,
// and candles floating overhead. The stage is walkable: floorAt lifts you onto it.

const { face, stage, stageH, water, pillars } = CHAMBER;
const STONE = "#2a302c";
const STONE_DK = "#1c211e";
const FACE_H = 168;
const PILLAR_H = 150;

export const buildChamber: RoomBuilder = ({ room }) => {
  const g = new THREE.Group();
  const anim: ((f: FrameInfo) => void)[] = [];
  const R = rng(37);

  /* ---------------- floor: big worn flagstones, each a slightly different tone */
  const TILE = 76;
  for (let y = 0; y < ROOM.h; y += TILE)
    for (let x = 0; x < ROOM.w; x += TILE) {
      const t = block({ x: x + 1.5, y: y + 1.5, w: TILE - 3, h: TILE - 3 }, 3, shade(STONE_DK, (R() - 0.5) * 12), -3);
      t.castShadow = false;
      g.add(t);
    }
  const under = box(ROOM.w, 3, ROOM.h, "#090b0a");
  under.position.set(ROOM.w / 2, -6, ROOM.h / 2);
  under.castShadow = false;
  g.add(under);

  /* ---------------- walls: dark wet stone with a mossy cap */
  g.add(shell(room.doors, { floor: false, wall: "#161b18", trim: "#24302a" }));

  /* ---------------- the carved face on the back wall */
  const cx = face.x + face.w / 2;
  const front = face.y + face.h; // the face's front plane (engine y → three z)
  const head = block({ x: face.x - 20, y: WALL - 4, w: face.w + 40, h: face.h + 4 }, FACE_H, STONE);
  g.add(head);
  // brow ridge + nose
  const brow = box(face.w - 30, 14, 14, shade(STONE, 10));
  brow.position.set(cx, 128, front + 4);
  const nose = box(40, 34, 18, shade(STONE, 6));
  nose.position.set(cx, 86, front + 6);
  g.add(brow, nose);
  // glowing serpent-green eyes
  const eyeM = glowMat("#7dffb0");
  for (const dx of [-62, 62]) {
    const eye = box(34, 10, 3, eyeM);
    eye.position.set(cx + dx, 108, front + 1.5);
    eye.castShadow = false;
    const eh = halo(90, "#4dff9a", 0.35);
    eh.position.set(cx + dx, 113, front + 6);
    g.add(eye, eh);
  }
  // the open mouth: a dark gap just above the stage, lit faintly from inside
  const mouth = box(130, 60, 4, "#030504");
  mouth.position.set(cx, stageH + 2, front + 0.5);
  mouth.castShadow = false;
  const throat = halo(170, "#2fd27a", 0.22);
  throat.position.set(cx, stageH + 34, front + 4);
  g.add(mouth, throat);
  // stone teeth along the top of the mouth
  for (let i = 0; i < 7; i++) {
    const tooth = cone(5, 12, 4, shade(STONE, 18));
    tooth.rotation.x = Math.PI;
    tooth.position.set(cx - 54 + i * 18, stageH + 62, front + 3);
    g.add(tooth);
  }
  // a long carved beard falling either side of the mouth
  for (const side of [-1, 1])
    for (let i = 0; i < 3; i++) {
      const strand = box(12, 70 - i * 12, 8, shade(STONE, -4 + i * 4));
      strand.position.set(cx + side * (80 + i * 16), stageH, front + 3);
      g.add(strand);
    }
  const mouthLight = lamp("#3fe08a", 1.2, 420);
  mouthLight.position.set(cx, stageH + 40, front + 30);
  g.add(mouthLight);
  anim.push((f) => {
    // the throat breathes slowly, faster while music plays
    const k = f.playing ? 2.2 : 0.8;
    (throat.material as THREE.SpriteMaterial).opacity = 0.18 + 0.08 * Math.sin(f.t * k);
    mouthLight.intensity = 1.0 + 0.3 * Math.sin(f.t * k);
  });

  /* ---------------- the stage, jutting out from the mouth */
  const stageTop = block(stage, stageH, shade(STONE, 8));
  g.add(stageTop);
  const edgeM = mat("#3a443e");
  const lip = block({ x: stage.x - 3, y: stage.y + stage.h - 6, w: stage.w + 6, h: 9 }, stageH + 2, edgeM);
  g.add(lip);
  // two shallow steps up from the floor in front
  const stepW = 120;
  g.add(block({ x: cx - stepW / 2, y: stage.y + stage.h + 3, w: stepW, h: 18 }, stageH * 0.66, shade(STONE, 2)));
  g.add(block({ x: cx - stepW / 2, y: stage.y + stage.h + 21, w: stepW, h: 16 }, stageH * 0.33, shade(STONE, -2)));
  // a coiled-serpent seal inlaid in the stage floor
  const seal = panel(200, 200, (c, w, h) => {
    c.strokeStyle = "rgba(125,255,176,.55)";
    c.lineWidth = 4;
    c.beginPath();
    for (let a = 0; a < Math.PI * 6; a += 0.05) {
      const r = 14 + a * 4.4;
      const x = w / 2 + Math.cos(a) * r;
      const y = h / 2 + Math.sin(a) * r;
      if (a === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
    c.fillStyle = "rgba(125,255,176,.7)";
    c.beginPath();
    c.arc(w / 2 + 14, h / 2, 6, 0, Math.PI * 2);
    c.fill();
  }, 150);
  seal.rotation.x = -Math.PI / 2;
  seal.position.set(cx, stageH + 0.6, stage.y + stage.h / 2 + 10);
  g.add(seal);
  g.add(glowPool(cx, stage.y + stage.h / 2, 190, "#2fd27a", 0.12, stageH + 0.8));

  /* ---------------- water channels down both sides of the stage */
  const waterM = new THREE.MeshLambertMaterial({
    color: new THREE.Color("#0f3a2a"),
    emissive: new THREE.Color("#06261a"),
    flatShading: true,
    transparent: true,
    opacity: 0.92,
  });
  const curbM = mat("#323a35");
  for (const w of water) {
    // a dark sunken bed, the rippling surface, and a stone curb round the edge
    const bed = block(w, 1, "#040806", -2);
    bed.castShadow = false;
    g.add(bed);
    const geo = new THREE.PlaneGeometry(w.w, w.h, 10, 14);
    geo.rotateX(-Math.PI / 2);
    geo.translate(w.x + w.w / 2, 0.8, w.y + w.h / 2);
    const surf = new THREE.Mesh(geo, waterM);
    surf.receiveShadow = true;
    g.add(surf);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    anim.push((f) => {
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        pos.setY(i, 0.8 + Math.sin(x / 40 + f.t * 0.9) * 1.2 + Math.sin(z / 30 - f.t * 1.3) * 1.2);
      }
      pos.needsUpdate = true;
    });
    // curbs on the open sides (the back wall closes the top)
    g.add(block({ x: w.x - 4, y: w.y, w: 6, h: w.h + 4 }, 5, curbM));
    g.add(block({ x: w.x + w.w - 2, y: w.y, w: 6, h: w.h + 4 }, 5, curbM));
    g.add(block({ x: w.x - 4, y: w.y + w.h - 2, w: w.w + 6, h: 6 }, 5, curbM));
    g.add(glowPool(w.x + w.w / 2, w.y + w.h / 2, 160, "#1f8a55", 0.1, 2));
  }

  // mist drifting low over the water
  const MIST = 40;
  const mist = motes(MIST, "#8fe8b4", 9, 0.35);
  const mp = Array.from({ length: MIST }, (_, i) => {
    const w = water[i % water.length];
    return [w.x + R() * w.w, 4 + R() * 14, w.y + R() * w.h, R() * 6];
  });
  g.add(mist);
  anim.push((f) => {
    const p = mist.geometry.attributes.position as THREE.BufferAttribute;
    mp.forEach((d, i) => {
      p.setXYZ(i, d[0] + Math.sin(f.t * 0.3 + d[3]) * 14, d[1] + Math.sin(f.t * 0.5 + d[3]) * 2, d[2] + Math.cos(f.t * 0.25 + d[3]) * 10);
    });
    p.needsUpdate = true;
  });

  /* ---------------- serpent pillars lining the walkway */
  const coilM = mat("#2f5a40");
  const scaleEyeM = glowMat("#7dffb0");
  for (const p of pillars) {
    const base = block({ x: p.x - 22, y: p.y - 22, w: 44, h: 44 }, 10, shade(STONE, 6));
    const shaft = cyl(15, 17, PILLAR_H - 20, 8, STONE);
    shaft.position.set(p.x, 10, p.y);
    const capital = block({ x: p.x - 22, y: p.y - 22, w: 44, h: 44 }, 10, shade(STONE, 6), PILLAR_H - 10);
    g.add(base, shaft, capital);
    // a stone serpent coiling up the shaft
    for (let i = 0; i < 4; i++) {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(17, 3.2, 4, 10), coilM);
      coil.rotation.x = Math.PI / 2 + 0.28;
      coil.rotation.z = i * 0.9;
      coil.position.set(p.x, 30 + i * 26, p.y);
      coil.castShadow = true;
      g.add(coil);
    }
    // its head reaching out toward the walkway, eyes lit
    const toward = p.x < ROOM.w / 2 ? 1 : -1;
    const headM = box(26, 12, 14, "#2f5a40");
    headM.position.set(p.x + toward * 22, PILLAR_H - 30, p.y);
    g.add(headM);
    for (const dz of [-4, 4]) {
      const e = box(2, 2.4, 2.4, scaleEyeM);
      e.position.set(p.x + toward * 35, PILLAR_H - 24, p.y + dz);
      e.castShadow = false;
      g.add(e);
    }
  }

  /* ---------------- floating candles: they bob and flicker overhead */
  const CANDLES = 46;
  const waxM = mat("#e8e0cc");
  const flameM = glowMat("#ffd27a");
  const candles: { obj: THREE.Group; glow: THREE.Sprite; y: number; ph: number }[] = [];
  for (let i = 0; i < CANDLES; i++) {
    const c = new THREE.Group();
    const len = 12 + R() * 10;
    const wax = cyl(2.6, 2.8, len, 6, waxM);
    wax.castShadow = false;
    const flame = cone(1.6, 4.5, 5, flameM);
    flame.position.y = len + 0.6;
    flame.castShadow = false;
    const glow = halo(26, "#ffcf7a", 0.6);
    glow.position.y = len + 3;
    c.add(wax, flame, glow);
    const x = 60 + R() * (ROOM.w - 120);
    const z = 50 + R() * (ROOM.h - 140);
    const y = 100 + R() * 45;
    c.position.set(x, y, z);
    g.add(c);
    candles.push({ obj: c, glow, y, ph: R() * Math.PI * 2 });
  }
  anim.push((f) => {
    for (const c of candles) {
      c.obj.position.y = c.y + Math.sin(f.t * 0.7 + c.ph) * 4;
      const fl = 0.5 + 0.15 * Math.sin(f.t * 9 + c.ph * 3) + 0.08 * Math.sin(f.t * 23 + c.ph);
      (c.glow.material as THREE.SpriteMaterial).opacity = fl;
      c.glow.scale.setScalar(22 + fl * 10);
    }
  });
  // a few warm lights so the candlelight actually lands on the room
  const candleLights: [number, number][] = [
    [300, 450],
    [840, 450],
    [570, 620],
  ];
  for (const [lx, lz] of candleLights) {
    const l = lamp("#ffc070", 0.8, 420);
    l.position.set(lx, 120, lz);
    g.add(l);
    g.add(glowPool(lx, lz, 220, "#ffc070", 0.06));
  }

  /* ---------------- the room's name, carved into the floor at the front */
  const plate = panel(460, 40, (c, w, h) => {
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = "800 22px 'Shippori Mincho',serif";
    c.fillStyle = "#b8e8c0";
    c.shadowColor = "rgba(0,0,0,.7)";
    c.shadowBlur = 8;
    c.fillText("秘密 · UNDERCROFT", w / 2, h / 2 + 1);
  }, 460);
  plate.rotation.x = -Math.PI / 2;
  plate.position.set(ROOM.w / 2, 0.6, ROOM.h - 52);
  g.add(plate);

  return {
    group: g,
    bg: "#040706",
    fog: { color: "#06100b", near: 1100, far: 2900 },
    light: { sky: "#9fd8b4", ground: "#0c120e", hemi: 0.75, key: "#d8f0e0", keyI: 0.8 },
    floorAt: (x, y) =>
      x > stage.x && x < stage.x + stage.w && y > stage.y && y < stage.y + stage.h ? stageH : 0,
    update: (f) => anim.forEach((a) => a(f)),
  };
};
