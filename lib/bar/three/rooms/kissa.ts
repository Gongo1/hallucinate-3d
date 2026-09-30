import * as THREE from "three";
import { ROOM, WALL, KISSA, KISSA_FEATURED, KISSA_BOARD, KISSA_DROPBOX } from "../../layout";
import type { BoardView, RoomBuilder } from "../types";
import { shell, WALL_H } from "../shared";
import {
  box, block, cyl, cone, lump, mat, ownMat, glowMat, glowPool, halo, lamp, panel, billboard,
  motes, rr, shade, rng,
} from "../kit";

// THE KISSA — the hub. Warm hinoki, a kumiko-lattice back wall with the big
// HALLUCINATE sign and the moon window, the tatami platform, the listening deck +
// speakers along the front, the pour-over bar down the right wall, and the rave
// portal: a torii rift set into the lower-left wall.

const { deck, speakers, spkBox, bar, platform, table, portal, decor } = KISSA;
const PLAT_H = 7;

export const buildKissa: RoomBuilder = ({ room }) => {
  const g = new THREE.Group();
  const anim: ((f: import("../types").FrameInfo) => void)[] = [];
  const R = rng(7);

  /* ---------------- floor: hinoki planks (rows of 44, alternating tone) */
  for (let y = 0, i = 0; y < ROOM.h; y += 44, i++) {
    // planks are staggered lengths so the floor reads as boards, not stripes
    let x = -((i * 137) % 260);
    while (x < ROOM.w) {
      const len = 220 + R() * 160;
      const a = Math.max(0, x);
      const b = Math.min(ROOM.w, x + len);
      if (b - a > 4) {
        const tone = i % 2 ? "#b08a55" : "#a47d49";
        const p = block({ x: a + 1, y: y + 1, w: b - a - 2, h: 42 }, 3, shade(tone, (R() - 0.5) * 14), -3);
        p.castShadow = false;
        g.add(p);
      }
      x += len;
    }
  }
  const under = box(ROOM.w, 3, ROOM.h, "#3c2814");
  under.position.set(ROOM.w / 2, -6, ROOM.h / 2);
  under.castShadow = false;
  g.add(under);

  /* ---------------- walls: dark timber + posts, kumiko lattice across the back */
  g.add(shell(room.doors, { floor: false, wall: "#3a2817", trim: "#241810" }));
  for (let x = 180; x < ROOM.w; x += 260) {
    const post = box(18, WALL_H, 10, "#2a1c10");
    post.position.set(x, 0, WALL + 5);
    g.add(post);
  }
  const kumiko = panel(530, 40, (c, w, h) => {
    c.fillStyle = "#6e4d2c";
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "rgba(202,164,114,.55)";
    c.lineWidth = 1;
    for (let x = 0; x <= w; x += 11) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, h);
      c.stroke();
    }
    for (let y = 0; y <= h; y += 11) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
    }
    c.strokeStyle = "rgba(202,164,114,.25)";
    for (let x = 0; x <= w; x += 22) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x + 11, h);
      c.moveTo(x + 11, 0);
      c.lineTo(x, h);
      c.stroke();
    }
  }, ROOM.w - 80, 3, true);
  kumiko.position.set(ROOM.w / 2, 30 + (ROOM.w - 80) * (40 / 530) / 2, WALL + 0.6);
  g.add(kumiko);

  /* ---------------- moon window (top-right of the back wall) */
  const mx = ROOM.w - 96;
  const moon = new THREE.Mesh(new THREE.CircleGeometry(30, 20), glowMat("#ffe0a6"));
  moon.position.set(mx, 104, WALL + 1.2);
  const moonRing = new THREE.Mesh(new THREE.TorusGeometry(31, 4.5, 5, 20), mat("#2a1c10"));
  moonRing.position.copy(moon.position);
  moonRing.position.z += 1;
  const mull1 = box(60, 2.5, 2, "#3a2817");
  mull1.position.set(mx, 104 - 1.2, WALL + 2);
  const mull2 = box(2.5, 60, 2, "#3a2817");
  mull2.position.set(mx, 74, WALL + 2);
  const moonGlow = halo(150, "#ffcf8a", 0.35);
  moonGlow.position.set(mx, 104, WALL + 6);
  g.add(moon, moonRing, mull1, mull2, moonGlow);

  /* ---------------- the room's big sign, hanging over the back wall */
  const sign = panel(384, 70, (c, w, h) => {
    c.fillStyle = "#3f2c19";
    rr(c, 1, 1, w - 2, h - 2, 8);
    c.fill();
    c.strokeStyle = "rgba(255,179,94,.6)";
    c.lineWidth = 2;
    rr(c, 2, 2, w - 4, h - 4, 8);
    c.stroke();
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = "800 25px 'Shippori Mincho', serif";
    c.fillStyle = "#ffce8c";
    c.shadowColor = "rgba(255,179,94,.8)";
    c.shadowBlur = 14;
    c.fillText("SOMBRA LISTENING ROOM", w / 2, h / 2 - 8);
    c.shadowBlur = 0;
    c.font = "11px 'DM Mono'";
    c.fillStyle = "rgba(214,69,47,.95)";
    c.fillText("☉☽ · HALLUCINATE · 音楽喫茶 · A LISTENING BAR", w / 2, h / 2 + 20);
  }, 384);
  const signBoard = box(392, 76, 6, "#2a1c10");
  const signY = 96;
  signBoard.position.set(ROOM.w / 2, signY - 38, WALL + 14);
  sign.position.set(ROOM.w / 2, signY, WALL + 17.2);
  g.add(signBoard, sign);
  for (const s of [-1, 1]) {
    const chain = cyl(1, 1, WALL_H - signY - 38, 4, "#1a120a");
    chain.position.set(ROOM.w / 2 + s * 170, signY + 38, WALL + 14);
    g.add(chain);
  }
  const signGlow = halo(520, "#ffb35e", 0.16);
  signGlow.scale.set(520, 170, 1);
  signGlow.position.set(ROOM.w / 2, signY, WALL + 30);
  g.add(signGlow);

  /* ---------------- the weekly board: chalk on slate, left of the sign.
     Redrawn with this week's leaders (setBoard); walk up + E to zoom in. */
  const B = KISSA_BOARD;
  let boardData: BoardView = { diggers: [], collectors: [] };
  const drawBoard = (c: CanvasRenderingContext2D, w: number, h: number) => {
    c.fillStyle = "#1d2621";
    c.fillRect(0, 0, w, h);
    // old chalk dust, never quite wiped
    c.fillStyle = "rgba(235,235,225,.05)";
    for (let i = 0; i < 9; i++) c.fillRect(12 + i * 26, 18 + (i % 3) * 30, 30, 10);
    const chalk = "rgba(240,238,228,.92)";
    c.textBaseline = "alphabetic";
    c.fillStyle = chalk;
    c.font = "800 15px 'Shippori Mincho', serif";
    c.textAlign = "center";
    c.fillText("THIS WEEK · 今週", w / 2, 20);
    c.strokeStyle = "rgba(240,238,228,.35)";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(w / 2, 32);
    c.lineTo(w / 2, h - 10);
    c.stroke();
    const col = (x: number, head: string, rows: [string, number][], empty: string) => {
      c.textAlign = "left";
      c.font = "500 9px 'DM Mono', monospace";
      c.fillStyle = "rgba(255,179,94,.9)";
      c.fillText(head, x, 44);
      c.font = "500 12px 'DM Mono', monospace";
      c.fillStyle = chalk;
      if (!rows.length) {
        c.font = "9px 'DM Mono', monospace";
        c.fillStyle = "rgba(240,238,228,.55)";
        c.fillText(empty, x, 64);
        return;
      }
      rows.slice(0, 3).forEach(([tag, n], i) => {
        c.fillText(`${i + 1}. ${tag}`, x, 64 + i * 19);
        c.textAlign = "right";
        c.fillText(String(n), x + w / 2 - 26, 64 + i * 19);
        c.textAlign = "left";
      });
    };
    col(12, "DIGGERS · kept", boardData.diggers, "open a crate…");
    col(w / 2 + 12, "TRINKETS", boardData.collectors, "nobody yet");
    c.textAlign = "center";
    c.font = "8px 'DM Mono', monospace";
    c.fillStyle = "rgba(240,238,228,.5)";
    c.fillText("E · read the board", w / 2, h - 6);
  };
  const board = panel(B.w - 14, B.h - 14, drawBoard, B.w - 14, 3, true);
  const boardFrame = box(B.w, B.h, 5, "#5b3f23");
  const boardY = 92;
  boardFrame.position.set(B.x, boardY, WALL + 12);
  board.position.set(B.x, boardY, WALL + 14.8);
  const ledge = box(B.w - 20, 4, 8, "#4f3720"); // the chalk ledge
  ledge.position.set(B.x, boardY - B.h / 2 - 2, WALL + 17);
  const chalkStick = box(10, 2.5, 2.5, "#f1ece0");
  chalkStick.position.set(B.x + 60, boardY - B.h / 2 + 1, WALL + 18);
  boardFrame.userData.pick = { kind: "board" };
  board.userData.pick = { kind: "board" };
  g.add(boardFrame, board, ledge, chalkStick);

  /* ---------------- the drop box: suggest a record (reviewed weekly into
     THIS WEEK / the Sombra Selection). A little post box beside THIS WEEK. */
  const D = KISSA_DROPBOX;
  const drop = new THREE.Group();
  drop.position.set(D.x, 0, D.y);
  const dBody = box(30, 44, 22, "#6e4d2c");
  dBody.position.y = 22;
  const dFace = box(24, 30, 1.5, "#c0432f"); // vermilion front
  dFace.position.set(0, 26, 11.5);
  const dSlot = box(16, 2.2, 1, "#1a120a");
  dSlot.position.set(0, 34, 12.4);
  const dCap = box(34, 4, 26, "#4f3720");
  dCap.position.y = 46;
  const dLabel = billboard(96, 30, (c, w, h) => {
    c.fillStyle = "rgba(26,18,10,.88)";
    rr(c, 1, 1, w - 2, h - 2, 6);
    c.fill();
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillStyle = "#ffce8c";
    c.font = "500 10px 'DM Mono', monospace";
    c.fillText("ADD RECORDS", w / 2, 11);
    c.fillStyle = "rgba(241,230,210,.7)";
    c.font = "8px 'DM Mono', monospace";
    c.fillText("投函 · reviewed weekly", w / 2, 22);
  }, 60);
  dLabel.position.y = 64;
  drop.add(dBody, dFace, dSlot, dCap, dLabel);
  drop.userData.pick = { kind: "dropbox" };
  g.add(drop);

  /* ---------------- tatami platform (walkable, raised a step) */
  const pf = platform;
  g.add(block(pf, PLAT_H, "#8a6d3f"));
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 2; j++) {
      const tw = (pf.w - 24) / 3 - 6;
      const th = (pf.h - 24) / 2 - 6;
      const tx = pf.x + 12 + (i * (pf.w - 24)) / 3;
      const ty = pf.y + 12 + (j * (pf.h - 24)) / 2;
      const mat1 = block({ x: tx, y: ty, w: tw, h: th }, 2, (i + j) % 2 ? "#c3b079" : "#b7a36c", PLAT_H);
      mat1.castShadow = false;
      g.add(mat1);
      // tatami edge binding (the dark blue heri)
      for (const [bx, by, bw, bh] of [
        [tx, ty, tw, 3], [tx, ty + th - 3, tw, 3], [tx, ty, 3, th], [tx + tw - 3, ty, 3, th],
      ])
        g.add(block({ x: bx, y: by, w: bw, h: bh }, 2.6, "#2c3a5a", PLAT_H));
    }
  // low chabudai in the centre + zabuton cushions
  // the chabudai sits on its collision footprint (layout KISSA.table)
  const tcx = table.x + table.w / 2;
  const tcy = table.y + table.h / 2;
  g.add(block(table, 5, "#5b3f23", PLAT_H + 11));
  for (const [lx, ly] of [[-28, -16], [28, -16], [-28, 16], [28, 16]]) {
    const leg = box(5, 11, 5, "#3e2a17");
    leg.position.set(tcx + lx, PLAT_H + 2, tcy + ly);
    g.add(leg);
  }
  const tea = cyl(5, 4, 6, 7, "#dfe6cf");
  tea.position.set(tcx + 8, PLAT_H + 16, tcy - 4);
  g.add(tea);
  for (const [dx, dy] of [[60, 150], [220, 90], [150, 200]]) {
    const z = box(30, 5, 26, "#9a4b3a");
    z.position.set(pf.x + dx, PLAT_H + 2, pf.y + dy);
    z.rotation.y = (R() - 0.5) * 0.3;
    g.add(z);
  }

  /* ---------------- the featured crates get their own warm spot */
  for (const sp of Object.values(KISSA_FEATURED)) g.add(glowPool(sp.x, sp.y, 110, "#ffcf7a", 0.24));

  /* ---------------- warm floor pools */
  g.add(glowPool(deck.x + deck.w / 2, deck.y + 30, 300, "#ffb45a", 0.16));
  g.add(glowPool(bar.x, bar.y + bar.h / 2, 240, "#ffa05a", 0.12));
  g.add(glowPool(pf.x + pf.w / 2, pf.y + pf.h / 2, 300, "#ffc878", 0.1));

  /* ---------------- listening deck (front) */
  const deckBody = block(deck, 34, "#5b3f23");
  deckBody.userData.pick = { kind: "deck" };
  g.add(deckBody);
  const deckTop = block({ x: deck.x - 3, y: deck.y - 3, w: deck.w + 6, h: deck.h + 6 }, 4, "#6e4d2c", 34);
  g.add(deckTop);
  const deckLabel = panel(160, 16, (c, w, h) => {
    c.fillStyle = "rgba(241,230,210,.62)";
    c.font = "10px 'DM Mono'";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("聴 LISTENING DECK", w / 2, h / 2);
  }, 120);
  deckLabel.rotation.x = -Math.PI / 2;
  deckLabel.position.set(deck.x + deck.w / 2, 38.4, deck.y + 12);
  g.add(deckLabel);
  const platters: THREE.Group[] = [];
  const centres: THREE.Mesh[] = [];
  for (const tx of [deck.x + 64, deck.x + deck.w - 64]) {
    const ty = deck.y + deck.h / 2 + 6;
    const base = cyl(33, 33, 4, 16, "#241812");
    base.position.set(tx, 38, ty);
    const platter = new THREE.Group();
    const vinyl = cyl(27, 27, 2.5, 18, "#0b0b0b");
    const grooveM = mat("#1c1c1c");
    const groove = cyl(20, 20, 2.8, 18, grooveM);
    const centre = cyl(8, 8, 3.2, 10, ownMat("#3a2a1e", { emissive: "#ffb35e", glow: 0 }));
    const marker = box(2, 3.4, 10, "#ffe6b8");
    marker.position.set(0, 0, 14);
    platter.add(vinyl, groove, centre, marker);
    platter.position.set(tx, 42, ty);
    const arm = box(4, 4, 40, "#c8c0b0");
    arm.position.set(tx + 30, 44, ty - 10);
    arm.rotation.y = 0.35;
    g.add(base, platter, arm);
    platters.push(platter);
    centres.push(centre);
  }
  g.add(block({ x: deck.x + deck.w / 2 - 22, y: deck.y + deck.h / 2 - 16, w: 44, h: 44 }, 8, "#1c1410", 38));
  const knobs: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const kn = cyl(2.6, 2.6, 4, 6, ownMat("#caa472", { emissive: "#ff9a3a", glow: 0 }));
    kn.position.set(deck.x + deck.w / 2 - 12 + (i % 2) * 24, 46, deck.y + deck.h / 2 - 4 + Math.floor(i / 2) * 18);
    g.add(kn);
    knobs.push(kn);
  }
  anim.push((f) => {
    for (const p of platters) if (f.playing) p.rotation.y -= f.dt * 3.5;
    for (const c of centres) (c.material as THREE.MeshLambertMaterial).emissiveIntensity = f.playing ? 0.9 : 0;
    knobs.forEach((k, i) => {
      (k.material as THREE.MeshLambertMaterial).emissiveIntensity = f.playing ? 0.3 + 0.3 * Math.sin(f.t * 4 + i) : 0;
    });
  });

  /* ---------------- ON AIR lightbox, floating over the back edge of the deck */
  const drawOnAir = (live: boolean, dj: string | null, pulse: number) => (c: CanvasRenderingContext2D, w: number, h: number) => {
    c.fillStyle = "#1a1410";
    rr(c, 1, 1, w - 2, h - 2, 6);
    c.fill();
    c.strokeStyle = live ? `rgba(230,40,40,${0.6 + pulse * 0.4})` : "rgba(90,80,70,.5)";
    c.lineWidth = 2;
    rr(c, 2, 2, w - 4, h - 4, 6);
    c.stroke();
    c.fillStyle = live ? "#ff3a3a" : "#3a322c";
    if (live) {
      c.shadowColor = "rgba(255,40,40,.9)";
      c.shadowBlur = 12;
    }
    c.beginPath();
    c.arc(18, dj && live ? 14 : h / 2, 5, 0, 7);
    c.fill();
    c.shadowBlur = 0;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = "900 15px 'Anton',sans-serif";
    c.fillStyle = live ? "#ff5a5a" : "#5a524a";
    c.fillText("ON AIR", w / 2 + 6, dj && live ? 14 : h / 2);
    if (live && dj) {
      c.font = "8px 'DM Mono'";
      c.fillStyle = "rgba(255,160,160,.9)";
      c.fillText(`♪ ${dj}`.slice(0, 22), w / 2, 29);
    }
  };
  // a camera-facing sign so it reads from any angle (the booth sits at the near edge)
  const onAirFace = billboard(120, 36, drawOnAir(false, null, 0), 104);
  onAirFace.position.set(deck.x + deck.w / 2, 74, deck.y + 6);
  const onAirGlow = halo(170, "#ff3030", 0);
  onAirGlow.position.set(deck.x + deck.w / 2, 74, deck.y + 4);
  g.add(onAirFace, onAirGlow);
  let lastAir = "";
  anim.push((f) => {
    const key = `${f.onAir}|${f.onAirDj}`;
    if (key !== lastAir) {
      lastAir = key;
      onAirFace.label.redraw(drawOnAir(f.onAir, f.onAirDj, 1));
    }
    (onAirGlow.material as THREE.SpriteMaterial).opacity = f.onAir ? 0.25 + 0.2 * Math.abs(Math.sin(f.t * 2)) : 0;
  });

  /* ---------------- speakers flanking the deck (woofers breathe with the music) */
  const cones: THREE.Mesh[] = [];
  const rings: THREE.Mesh[] = [];
  for (const s of speakers) {
    const cab = block({ x: s.x, y: s.y, w: spkBox.w, h: spkBox.h }, 96, "#5b3f23");
    g.add(cab);
    const face = box(spkBox.w - 8, 88, 2, "#3e2a17");
    face.position.set(s.x + spkBox.w / 2, 4, s.y + spkBox.h + 0.6);
    g.add(face);
    for (const [cy, r] of [[62, 17], [26, 11]] as const) {
      const surround = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 2, 14), mat("#1b1410"));
      surround.rotation.x = Math.PI / 2;
      surround.position.set(s.x + spkBox.w / 2, cy, s.y + spkBox.h + 2);
      const cn = new THREE.Mesh(new THREE.ConeGeometry(r * 0.72, r * 0.5, 12), mat("#2a211b"));
      cn.rotation.x = -Math.PI / 2;
      cn.position.set(s.x + spkBox.w / 2, cy, s.y + spkBox.h + 2);
      g.add(surround, cn);
      if (r > 12) {
        cones.push(cn);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 1, 1.2, 4, 18), glowMat("#ffb35e", 0, true));
        ring.position.set(s.x + spkBox.w / 2, cy, s.y + spkBox.h + 3);
        g.add(ring);
        rings.push(ring);
      }
    }
  }
  anim.push((f) => {
    const kick = f.playing ? Math.pow(1 - ((f.t * 2) % 1), 3) : 0;
    for (const cn of cones) cn.scale.set(1 + kick * 0.14, 1 + kick * 0.9, 1 + kick * 0.14);
    for (const r of rings) {
      (r.material as THREE.MeshBasicMaterial).opacity = f.playing ? 0.25 + kick * 0.5 : 0;
      r.scale.setScalar(1 + kick * 0.18);
    }
  });

  /* ---------------- the pour-over bar (right wall) + the master's back shelf */
  const counter = { x: bar.x, y: bar.y, w: 44, h: bar.h };
  const counterBody = block(counter, 42, "#5b3f23");
  counterBody.userData.pick = { kind: "bar" };
  g.add(counterBody);
  g.add(block({ x: counter.x - 4, y: counter.y - 4, w: counter.w + 8, h: counter.h + 8 }, 5, "#7a5634", 42));
  g.add(block({ x: bar.x + bar.w - 18, y: bar.y - 10, w: 30, h: bar.h + 20 }, 96, "#3e2a17"));
  for (const sy of [36, 64]) g.add(block({ x: bar.x + bar.w - 24, y: bar.y, w: 12, h: bar.h }, 3, "#6e4d2c", sy));
  // jars + bottles on the back shelf
  for (let i = 0; i < 9; i++) {
    const jar = cyl(4.5, 4.5, 11 + (i % 3) * 4, 6, ["#caa472", "#7e9b5e", "#a8452f", "#e8ddcb"][i % 4]);
    jar.position.set(bar.x + bar.w - 17, 39 + (i % 2) * 28, bar.y + 20 + i * 31);
    g.add(jar);
  }
  // kettle, dripper, incense, three matcha bowls along the counter top
  const top = 47;
  const kettle = cyl(7, 9, 12, 8, "#caa472");
  kettle.position.set(bar.x + 22, top, bar.y + 40);
  const spout = box(2.5, 2.5, 14, "#caa472");
  spout.position.set(bar.x + 14, top + 8, bar.y + 34);
  spout.rotation.x = -0.6;
  spout.rotation.y = -0.6;
  const dripper = cone(9, 12, 8, "#e8ddcb");
  dripper.rotation.x = Math.PI;
  dripper.position.set(bar.x + 22, top + 30, bar.y + 78);
  const server = cyl(7, 7, 12, 8, glowMat("#7a4a2a", 0.7));
  server.position.set(bar.x + 22, top, bar.y + 78);
  const burner = cyl(6, 7, 7, 6, "#2a2a30");
  burner.position.set(bar.x + 22, top, bar.y + 120);
  g.add(kettle, spout, dripper, server, burner);
  for (const dy of [150, 200, 250]) {
    const bowl = cyl(7, 5, 6, 8, "#dfe6cf");
    bowl.position.set(bar.x + 22, top, bar.y + dy);
    const matcha = cyl(5.5, 5.5, 1, 8, "#7e9b5e");
    matcha.position.set(bar.x + 22, top + 5.2, bar.y + dy);
    g.add(bowl, matcha);
  }
  const smoke = motes(10, "#ffffff", 7, 0.45);
  g.add(smoke);
  const smokeP = Array.from({ length: 10 }, () => R());
  anim.push((f) => {
    const p = smoke.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < 10; i++) {
      smokeP[i] = (smokeP[i] + f.dt * 0.28) % 1;
      const s = smokeP[i];
      p.setXYZ(i, bar.x + 22 + Math.sin((s + i) * 6) * 4, top + 8 + s * 50, bar.y + 120 + Math.cos(s * 5 + i) * 3);
    }
    p.needsUpdate = true;
    (smoke.material as THREE.PointsMaterial).opacity = 0.35;
  });
  const barSign = billboard(120, 22, (c, w, h) => {
    c.fillStyle = "rgba(14,11,8,.7)";
    rr(c, 1, 1, w - 2, h - 2, 5);
    c.fill();
    c.fillStyle = "rgba(241,230,210,.75)";
    c.font = "10px 'DM Mono'";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("喫茶 POUR-OVER", w / 2, h / 2);
  }, 104);
  barSign.position.set(bar.x + bar.w / 2 - 20, 110, bar.y - 6);
  g.add(barSign);

  /* ---------------- decor: bamboo, a potted red maple, a raked stone dish */
  for (const d of decor) {
    if (d.t === "bamboo") {
      const pot = cyl(20, 16, 12, 8, "#3e2a17");
      pot.position.set(d.x, 0, d.y);
      g.add(pot);
      for (let i = -1; i < 2; i++) {
        const hgt = 76 + i * 10 + R() * 12;
        const stalk = cyl(2.6, 3, hgt, 5, "#5b7d3f");
        stalk.position.set(d.x + i * 8, 10, d.y + (i % 2) * 4);
        g.add(stalk);
        for (let n = 1; n < 4; n++) {
          const node = cyl(3.4, 3.4, 1.6, 5, "#48662f");
          node.position.set(d.x + i * 8, 10 + (n * hgt) / 4, d.y + (i % 2) * 4);
          g.add(node);
        }
        for (let l = 0; l < 3; l++) {
          const leaf = cone(3, 16, 4, "#7e9b5e");
          leaf.rotation.z = -Math.PI / 2 + (i - 0.5) * 0.9 + l * 0.4;
          leaf.position.set(d.x + i * 8, 10 + hgt - 6 - l * 11, d.y + (i % 2) * 4);
          g.add(leaf);
        }
      }
    } else if (d.t === "maple") {
      const pot = cyl(16, 12, 14, 8, "#2a2a30");
      pot.position.set(d.x, 0, d.y);
      const trunk = cyl(2.6, 4, 36, 5, "#3a2817");
      trunk.position.set(d.x, 12, d.y);
      g.add(pot, trunk);
      for (let i = 0; i < 5; i++) {
        const fol = lump(13 + R() * 6, i % 2 ? "#c0432f" : "#a8352a", 40 + i, 0.3, 1, 0.75, 1, 0);
        fol.position.set(d.x + Math.cos(i * 1.3) * 12, 50 + (i % 3) * 7, d.y + Math.sin(i * 1.3) * 10);
        g.add(fol);
      }
    } else {
      const dish = cyl(26, 24, 5, 12, "#d8cfbd");
      dish.scale.z = 0.72;
      dish.position.set(d.x, 0, d.y);
      g.add(dish);
      for (let r = 7; r < 24; r += 5) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.7, 3, 20), mat("#efe8da"));
        ring.rotation.x = -Math.PI / 2;
        ring.scale.y = 0.72;
        ring.position.set(d.x, 5.2, d.y);
        g.add(ring);
      }
      const rock = lump(8, "#6a6660", 12, 0.35, 1.1, 0.8, 0.9, 0);
      rock.position.set(d.x, 8, d.y);
      g.add(rock);
    }
  }

  /* ---------------- paper lanterns (hung from the dark above) */
  const L: [number, number, number][] = [
    [deck.x + deck.w / 2 - 110, deck.y - 30, 118],
    [bar.x + 20, bar.y + 40, 120],
    // off the centre line, so they don't hang in front of the big sign
    [pf.x + 36, pf.y - 6, 124],
    [ROOM.w / 2 + 250, WALL + 150, 130],
  ];
  const lanterns: THREE.Mesh[] = [];
  L.forEach(([x, y, hgt], i) => {
    const body = cyl(12, 12, 26, 8, ownMat("#e9683c", { emissive: "#ff7a3a", glow: 0.55 }));
    body.position.set(x, hgt - 13, y);
    body.castShadow = false;
    const capT = cyl(8, 11, 3, 8, "#2a1c10");
    capT.position.set(x, hgt + 13, y);
    const capB = cyl(11, 8, 3, 8, "#2a1c10");
    capB.position.set(x, hgt - 16, y);
    const cord = cyl(0.6, 0.6, 34, 3, "#140c06");
    cord.position.set(x, hgt + 16, y);
    for (let r = -8; r <= 8; r += 6) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(12.2, 0.6, 3, 8), mat("#8a3a1e"));
      rib.rotation.x = Math.PI / 2;
      rib.position.set(x, hgt + r, y);
      g.add(rib);
    }
    const h = halo(110, "#ff9a50", 0.3);
    h.position.set(x, hgt, y);
    g.add(body, capT, capB, cord, h);
    g.add(glowPool(x, y + 20, 110, "#ffa050", 0.14));
    if (i < 3) {
      const l = lamp("#ff9a50", 1.3, 340);
      l.position.set(x, hgt - 20, y + 10);
      g.add(l);
    }
    lanterns.push(body);
  });
  anim.push((f) => {
    lanterns.forEach((b, i) => {
      (b.material as THREE.MeshLambertMaterial).emissiveIntensity = 0.5 + 0.06 * Math.sin(f.t * 1.7 + i * 2);
    });
  });

  /* ---------------- the noren over the front entrance */
  const nx = ROOM.w / 2;
  for (const s of [-1, 1]) {
    const p = box(4, 58, 4, "#2a1c10");
    p.position.set(nx + s * 52, 0, ROOM.h - WALL + 6);
    g.add(p);
  }
  const rod = box(112, 3, 3, "#2a1c10");
  rod.position.set(nx, 56, ROOM.h - WALL + 6);
  g.add(rod);
  for (let i = -1; i <= 1; i++) {
    const cl = box(30, 26, 1.4, "#2c3a5a");
    cl.position.set(nx + i * 33, 30, ROOM.h - WALL + 7);
    cl.castShadow = false;
    g.add(cl);
  }
  const noren = panel(40, 30, (c, w, h) => {
    c.fillStyle = "#f1e6d2";
    c.font = "700 20px 'Shippori Mincho',serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("音", w / 2, h / 2 + 1);
  }, 20);
  noren.position.set(nx, 43, ROOM.h - WALL + 8);
  g.add(noren);

  /* ---------------- the RAVE PORTAL: a torii rift in the lower-left wall */
  g.add(buildPortal(anim));

  /* ---------------- dust motes drifting through the lantern light */
  const DUST = 60;
  const dust = motes(DUST, "#ffe6b8", 5, 0.5);
  const dp = Array.from({ length: DUST }, () => [R() * ROOM.w, R() * 140, R() * ROOM.h, 3 + R() * 5]);
  g.add(dust);
  anim.push((f) => {
    const p = dust.geometry.attributes.position as THREE.BufferAttribute;
    dp.forEach((d, i) => {
      d[1] += d[3] * f.dt;
      if (d[1] > 150) d[1] = 0;
      p.setXYZ(i, d[0] + Math.sin(f.t * 0.3 + i) * 6, d[1], d[2]);
    });
    p.needsUpdate = true;
  });

  return {
    group: g,
    bg: "#0a0604",
    light: { sky: "#ffd9a8", ground: "#3a2414", hemi: 1.05, key: "#ffe0b0", keyI: 1.35 },
    floorAt: (x, y) =>
      x > pf.x && x < pf.x + pf.w && y > pf.y && y < pf.y + pf.h ? PLAT_H : 0,
    update: (f) => anim.forEach((a) => a(f)),
    setBoard: (b) => {
      boardData = b;
      board.label.redraw(drawBoard);
    },
  };
};

/** The torii rift: cool electric blue → violet → magenta against the warm hinoki.
 *  Breathes on a simulated 4/4 when music plays, spirals particles inward, and
 *  swells through the ~800ms pull-through charge. Purely cosmetic. */
function buildPortal(anim: ((f: import("../types").FrameInfo) => void)[]): THREE.Group {
  const g = new THREE.Group();
  const { cx, cy, w, h } = portal;
  // local: the torii faces +X (into the room); its width runs along Z
  const t = new THREE.Group();
  const H = 128;
  const postM = mat("#241a2e");
  for (const s of [-1, 1]) {
    const post = cyl(6, 7, H, 7, postM);
    post.position.set(0, 0, s * (h / 2 - 8));
    t.add(post);
  }
  const kasagi = box(22, 10, h + 40, "#3a2b46");
  kasagi.position.set(0, H + 4, 0);
  const shimaki = box(18, 8, h + 20, "#2e2236");
  shimaki.position.set(0, H - 8, 0);
  const nuki = box(12, 7, h + 10, "#2e2236");
  nuki.position.set(0, H - 34, 0);
  t.add(kasagi, shimaki, nuki);

  // the rift itself — an animated shader ellipse between the posts
  const riftM = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 }, uI: { value: 0.4 }, uBeat: { value: 0 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `
      varying vec2 vUv; uniform float uT; uniform float uI; uniform float uBeat;
      void main(){
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        float a = atan(p.y, p.x);
        float swirl = 0.5 + 0.5 * sin(a * 3.0 - uT * 3.0 + r * 9.0);
        float strobe = 0.5 + 0.5 * sin(uT * 4.35);
        vec3 core = vec3((200.0 + strobe * 55.0) / 255.0, (120.0 + uBeat * 80.0) / 255.0, 1.0);
        vec3 mid = vec3(150.0, 70.0, 235.0) / 255.0;
        vec3 edge = vec3(60.0, 40.0, 170.0) / 255.0;
        vec3 col = r < 0.45 ? mix(core, mid, r / 0.45) : mix(mid, edge, (r - 0.45) / 0.55);
        float alpha = (1.0 - smoothstep(0.55, 1.0, r)) * (0.65 * uI + 0.25) * (0.75 + 0.25 * swirl);
        float ring = smoothstep(0.03, 0.0, abs(r - 0.5)) * (0.35 + uBeat * 0.6);
        gl_FragColor = vec4(col * alpha + vec3(0.9, 0.67, 1.0) * ring, 1.0);
      }`,
  });
  const rift = new THREE.Mesh(new THREE.PlaneGeometry(h * 0.85, H * 0.86), riftM);
  rift.rotation.y = Math.PI / 2;
  rift.position.set(2, H * 0.46, 0);
  t.add(rift);
  const riftHalo = halo(220, "#9a5aff", 0.35);
  riftHalo.position.set(10, H * 0.46, 0);
  t.add(riftHalo);

  // inward-spiralling sparks
  const N = 26;
  const bits = motes(N, "#c89aff", 6, 0.9);
  const bs = Array.from({ length: N }, (_, i) => ({ a: i * 2.4, r: 0.3 + ((i * 37) % 70) / 100, spin: 0.6 + ((i * 13) % 9) / 10, fall: 0.18 + ((i * 7) % 5) / 20 }));
  t.add(bits);

  // neon sign above: 音 ⚡ / HALLUCINATE · THE RAVE
  const neon = billboard(150, 44, (c, w, hh) => {
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.shadowColor = "rgba(180,90,255,.95)";
    c.shadowBlur = 12;
    c.fillStyle = "#e0b4ff";
    c.font = "900 20px 'Shippori Mincho',serif";
    c.fillText("音 ⚡", w / 2, 15);
    c.font = "9px 'DM Mono'";
    c.fillStyle = "#c8a0ff";
    c.fillText("HALLUCINATE · THE RAVE", w / 2, hh - 10);
  }, 120);
  neon.position.set(18, H + 34, 0);
  t.add(neon);

  // the active-zone frame glow
  const frame = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(24, H + 10, h + 8)),
    new THREE.LineBasicMaterial({ color: 0xc878ff, transparent: true, opacity: 0.9 })
  );
  frame.position.set(4, (H + 10) / 2, 0);
  frame.visible = false;
  t.add(frame);

  t.position.set(cx - w / 2 + 16, 0, cy);
  t.userData.pick = { kind: "portal" }; // click walks you up to it — the charge still wants E
  g.add(t);
  const pool = glowPool(cx + 30, cy, 170, "#965aff", 0.3);
  g.add(pool);
  const pl = lamp("#9a5aff", 1.2, 260);
  pl.position.set(cx + 20, 60, cy);
  g.add(pl);

  anim.push((f) => {
    const charge = f.portalCharge;
    const beatPhase = (f.t * 2) % 1;
    const beat = f.playing ? Math.pow(1 - beatPhase, 2.2) : 0;
    const intensity = (f.playing ? 0.55 + 0.45 * beat : 0.4) + charge * 0.6;
    riftM.uniforms.uT.value = f.t;
    riftM.uniforms.uI.value = intensity;
    riftM.uniforms.uBeat.value = beat;
    const sc = 1 + beat * 0.06 + charge * 0.14;
    rift.scale.set(sc, sc, 1);
    (riftHalo.material as THREE.SpriteMaterial).opacity = 0.25 + intensity * 0.25;
    riftHalo.scale.setScalar(200 + charge * 140);
    (pool.material as THREE.MeshBasicMaterial).opacity = 0.18 + intensity * 0.18;
    pool.scale.setScalar(1 + charge * 0.6);
    pl.intensity = 0.8 + intensity * 1.2;
    const boost = 1 + charge * 2.5;
    const p = bits.geometry.attributes.position as THREE.BufferAttribute;
    bs.forEach((b, i) => {
      b.a += b.spin * f.dt * boost;
      b.r -= b.fall * f.dt * boost;
      if (b.r <= 0.04) {
        b.r = 0.5 + ((i * 17 + f.t * 10) % 50) / 100;
        b.a = (i * 1.7 + f.t) % (Math.PI * 2);
      }
      p.setXYZ(i, 6, H * 0.46 + Math.sin(b.a) * H * 0.4 * b.r, Math.cos(b.a) * h * 0.36 * b.r);
    });
    p.needsUpdate = true;
    const on = f.active?.type === "portal";
    frame.visible = on;
    if (on) (frame.material as THREE.LineBasicMaterial).opacity = 0.55 + 0.45 * Math.sin(f.t * 6);
  });
  return g;
}
