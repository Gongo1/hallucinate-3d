import * as THREE from "three";
import { ROOM, WALL, TRATTORIA } from "../../layout";
import type { FrameInfo, RoomBuilder } from "../types";
import { shell } from "../shared";
import { box, block, cyl, cone, lump, mat, ownMat, glowMat, glowPool, halo, lamp, panel, billboard, motes, shade, rng, rr, hex } from "../kit";

// IL MATTARELLO — a tribute trattoria to ilmattarello.mx (a real La Ventana / Baja
// restaurant). "Handmade. Unhurried. Baja." Terracotta tile, warm plaster with a
// gallery wall, a wood-fired oven glowing in the corner, one long communal table
// under two pendant lamps, flour sacks + the namesake rolling pin at the pasta
// station. The framed piece on the easel IS the attribution link (the engine's
// "goldrecord" zone) — honest tribute, never a partnership.

const { oven, table, easel, flour } = TRATTORIA;

export const buildTrattoria: RoomBuilder = ({ room }) => {
  const g = new THREE.Group();
  const anim: ((f: FrameInfo) => void)[] = [];
  const R = rng(17);

  /* ---------------- terracotta tile floor (one instanced mesh, 86px tiles) */
  const TILE = 86;
  const under = box(ROOM.w, 4, ROOM.h, "#4a2c1c");
  under.position.set(ROOM.w / 2, -6, ROOM.h / 2);
  under.castShadow = false;
  g.add(under);
  const cols = Math.ceil(ROOM.w / TILE);
  const rows = Math.ceil(ROOM.h / TILE);
  const tileGeo = new THREE.BoxGeometry(1, 3, 1);
  tileGeo.translate(0, -1.5, 0);
  const tiles = new THREE.InstancedMesh(tileGeo, new THREE.MeshLambertMaterial({ flatShading: true }), cols * rows);
  const m4 = new THREE.Matrix4();
  const tc = new THREE.Color();
  let ti = 0;
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const x0 = i * TILE + 1.5;
      const z0 = j * TILE + 1.5;
      const w = Math.min(TILE, ROOM.w - i * TILE) - 3;
      const d = Math.min(TILE, ROOM.h - j * TILE) - 3;
      m4.makeScale(w, 1 + R() * 0.3, d).setPosition(x0 + w / 2, 0, z0 + d / 2);
      tiles.setMatrixAt(ti, m4);
      tiles.setColorAt(ti, tc.set(shade("#8a5638", (R() - 0.5) * 14)));
      ti++;
    }
  tiles.receiveShadow = true;
  g.add(tiles);
  // the warm wash where the candles live
  g.add(glowPool(570, 430, 380, "#ffbe78", 0.12));

  /* ---------------- plaster walls */
  g.add(shell(room.doors, { floor: false, wall: "#6e4c34", trim: "#3a2818" }));
  // a dark wainscot band along the back wall
  for (const [a, b] of [[0, 506], [634, ROOM.w]]) {
    const w = block({ x: a, y: WALL, w: b - a, h: 3 }, 34, "#4a3020");
    w.castShadow = false;
    g.add(w);
  }

  /* ---------------- GALLERY WALL — small canvases, each its own colour world */
  const art = ["#c97e5d", "#7e9b8a", "#d8b27a", "#5a86a8"];
  art.forEach((col, i) => {
    const ax = 120 + i * 110 + 28;
    const frame = box(64, 52, 4, "#1c130b");
    frame.position.set(ax, 70, WALL + 2);
    g.add(frame);
    const canvas = panel(56, 44, (c, w, h) => {
      c.fillStyle = col;
      c.fillRect(0, 0, w, h);
      c.fillStyle = "rgba(0,0,0,.25)";
      c.beginPath();
      c.arc(w / 2 + (i % 3) * 6 - 6, h / 2, 10 + (i % 2) * 6, 0, 7);
      c.fill();
      c.fillStyle = "rgba(255,255,255,.18)";
      c.fillRect(0, h * 0.62, w, 3);
    }, 56, 3, true);
    canvas.position.set(ax, 96, WALL + 4.2);
    g.add(canvas);
    const spot = glowPool(ax, WALL + 26, 46, "#ffd0a0", 0.08);
    g.add(spot);
  });
  // two more on the left wall, facing into the room
  (["#b06a52", "#cfc8b8"] as const).forEach((col, i) => {
    const z = 200 + i * 130;
    const frame = box(4, 46, 58, "#1c130b");
    frame.position.set(WALL + 2, 72, z);
    const art2 = panel(50, 40, (c, w, h) => {
      c.fillStyle = col;
      c.fillRect(0, 0, w, h);
      c.strokeStyle = "rgba(40,20,10,.4)";
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(4, h * 0.7);
      c.quadraticCurveTo(w / 2, h * 0.2, w - 4, h * 0.65);
      c.stroke();
    }, 50, 3, true);
    art2.rotation.y = Math.PI / 2;
    art2.position.set(WALL + 4.3, 95, z);
    g.add(frame, art2);
  });

  // the credo, hand-painted on the plaster (+ a tiny tribute credit under it)
  const credo = panel(300, 44, (c, w, h) => {
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = "600 22px 'Shippori Mincho',serif";
    c.fillStyle = "rgba(243,221,184,.92)";
    c.fillText("Handmade. Unhurried. Baja.", w / 2, h / 2 - 5);
    c.font = "8px 'DM Mono'";
    c.fillStyle = "rgba(243,201,168,.6)";
    c.fillText("A TRIBUTE TO IL MATTARELLO · LA VENTANA, BCS", w / 2, h - 6);
  }, 230, 3);
  credo.position.set(790, 118, WALL + 0.8);
  g.add(credo);

  /* ---------------- the wood-fired oven: brick base, dome, glowing mouth, chimney */
  const ocx = oven.x + oven.w / 2;
  const ocz = oven.y + oven.h / 2;
  g.add(block(oven, 34, "#5a3a28"));
  // brick coursing on the base's face
  for (let row = 0; row < 3; row++)
    for (let b = 0; b < 5; b++) {
      const br = box(24, 9, 2, (row + b) % 2 ? "#6e4632" : "#643e2c");
      br.position.set(oven.x + 14 + b * 25 + (row % 2) * 6, 3 + row * 10, oven.y + oven.h + 0.8);
      br.castShadow = false;
      g.add(br);
    }
  const domeGeo = new THREE.SphereGeometry(62, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  const dome = new THREE.Mesh(domeGeo, mat("#6e4a32"));
  dome.scale.set(1, 0.9, 0.78);
  dome.position.set(ocx, 34, ocz);
  dome.castShadow = true;
  dome.receiveShadow = true;
  g.add(dome);
  // the arched mouth facing into the room: dark opening + the ember bed inside
  const archShape = new THREE.Shape();
  archShape.moveTo(-26, 0);
  archShape.lineTo(-26, 12);
  archShape.absarc(0, 12, 26, Math.PI, 0, true);
  archShape.lineTo(26, 0);
  archShape.lineTo(-26, 0);
  const arch = new THREE.Mesh(new THREE.ShapeGeometry(archShape, 8), glowMat("#180c06"));
  arch.position.set(ocx, 36, oven.y + oven.h - 2);
  const emberM = glowMat("#ff8a3a");
  const embersShape = new THREE.Shape();
  embersShape.moveTo(-19, 0);
  embersShape.absarc(0, 0, 19, Math.PI, 0, true);
  embersShape.lineTo(-19, 0);
  const emberFace = new THREE.Mesh(new THREE.ShapeGeometry(embersShape, 8), emberM);
  emberFace.position.set(ocx, 36, oven.y + oven.h - 1.5);
  emberFace.scale.set(1, 0.7, 1);
  const lintel = box(66, 6, 8, "#4a3020");
  lintel.position.set(ocx, 72, oven.y + oven.h - 6);
  g.add(arch, emberFace, lintel);
  // a pizza peel stored paddle-up against the back wall, left of the oven
  const peel = new THREE.Group();
  const shaft = box(3, 70, 3, "#8a6a42");
  const paddle = box(26, 30, 2, "#a8804e");
  paddle.position.y = 68;
  peel.add(shaft, paddle);
  peel.position.set(oven.x - 12, 0, WALL + 14);
  peel.rotation.x = -0.1;
  g.add(peel);
  // the chimney up the wall + slow smoke
  const chim = cyl(9, 11, 90, 6, "#4a3020");
  chim.position.set(ocx, 80, oven.y + 18);
  g.add(chim);
  const smoke = motes(12, "#d8d2c8", 10, 0.35);
  const sm = Array.from({ length: 12 }, () => R());
  g.add(smoke);
  // log pile tucked beside the oven
  for (let i = 0; i < 6; i++) {
    const log = cyl(4.6, 4.6, 40, 6, i % 2 ? "#5a3a22" : "#6a4a2a");
    log.rotation.x = Math.PI / 2;
    log.position.set(oven.x + oven.w + 16 + (i % 3) * 9.5, 5 + Math.floor(i / 3) * 8.5, oven.y + 8);
    g.add(log);
  }
  const ovenPool = glowPool(ocx, oven.y + oven.h + 30, 130, "#ff9646", 0.2);
  const ovenHalo = halo(120, "#ff8a3a", 0.3);
  ovenHalo.position.set(ocx, 46, oven.y + oven.h + 6);
  const ovenLight = lamp("#ff8a40", 1.6, 360);
  ovenLight.position.set(ocx, 44, oven.y + oven.h + 26);
  g.add(ovenPool, ovenHalo, ovenLight);
  anim.push((f) => {
    const emb = 0.6 + 0.4 * Math.sin(f.t * 6.2) * (0.8 + 0.2 * Math.sin(f.t * 2.3));
    emberM.color.setRGB(1, (120 + emb * 80) / 255, 50 / 255, THREE.SRGBColorSpace);
    (ovenPool.material as THREE.MeshBasicMaterial).opacity = 0.16 + emb * 0.08;
    (ovenHalo.material as THREE.SpriteMaterial).opacity = 0.22 + emb * 0.14;
    ovenLight.intensity = 1.2 + emb * 0.6;
    const p = smoke.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < 12; i++) {
      sm[i] = (sm[i] + f.dt * 0.12) % 1;
      const s = sm[i];
      p.setXYZ(i, ocx + Math.sin((s + i) * 5) * 8, 172 + s * 70, oven.y + 18 + Math.cos(s * 4 + i) * 5);
    }
    p.needsUpdate = true;
  });

  /* ---------------- the long communal table: linen runner, plates, candles */
  const tcx = table.x + table.w / 2;
  const tcz = table.y + table.h / 2;
  g.add(block({ x: table.x - 4, y: table.y - 4, w: table.w + 8, h: table.h + 8 }, 5, "#6e4a2e", 30));
  for (const [lx, lz] of [[table.x + 10, table.y + 10], [table.x + table.w - 10, table.y + 10], [table.x + 10, table.y + table.h - 10], [table.x + table.w - 10, table.y + table.h - 10]]) {
    const leg = box(7, 30, 7, "#4e321e");
    leg.position.set(lx, 0, lz);
    g.add(leg);
  }
  // a stretcher so the footprint reads as solid from the camera
  g.add(block({ x: table.x + 10, y: tcz - 3, w: table.w - 20, h: 6 }, 5, "#4e321e", 10));
  const runner = block({ x: table.x + 14, y: table.y + 12, w: table.w - 28, h: table.h - 24 }, 0.8, "#efe2c8", 35);
  runner.castShadow = false;
  g.add(runner);
  for (let i = 0; i < 4; i++) {
    const px = table.x + 40 + i * 66;
    for (const pz of [table.y + 20, table.y + table.h - 20]) {
      const plate = cyl(10, 9, 1.6, 12, "#d8cdb8");
      plate.position.set(px, 35.8, pz);
      const well = cyl(5.5, 5.5, 1.8, 10, i % 2 ? "#c9a468" : "#b8a888");
      well.position.set(px, 35.9, pz);
      plate.castShadow = well.castShadow = false;
      g.add(plate, well);
    }
  }
  const glassM = ownMat("#e8b0a0", { opacity: 0.55 });
  for (let i = 0; i < 3; i++) {
    const wine = cyl(2.6, 2, 8, 6, glassM);
    wine.position.set(table.x + 72 + i * 70, 35.8, table.y + 18);
    wine.castShadow = false;
    g.add(wine);
  }
  const bottle = cyl(4, 4.6, 16, 7, "#3a4a2a");
  bottle.position.set(tcx + 22, 35.8, tcz);
  const neck = cyl(1.6, 2.2, 7, 5, "#3a4a2a");
  neck.position.set(tcx + 22, 51.8, tcz);
  g.add(bottle, neck);
  const candleFlames: { m: THREE.Mesh; h: THREE.Sprite; i: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const cx = table.x + 70 + i * 70;
    const cz = tcz + (i % 2 ? 6 : -6);
    const stick = cyl(2.2, 2.2, 12, 6, "#e8dcc8");
    stick.position.set(cx, 35.8, cz);
    const holder = cyl(4, 4.6, 2.4, 7, "#8a6a42");
    holder.position.set(cx, 35.8, cz);
    const flame = cone(2.4, 7, 5, glowMat("#ffc864"));
    flame.castShadow = false;
    flame.position.set(cx, 48, cz);
    const h = halo(40, "#ffbe6e", 0.35);
    h.position.set(cx, 52, cz);
    g.add(stick, holder, flame, h);
    candleFlames.push({ m: flame, h, i });
  }
  anim.push((f) => {
    for (const c of candleFlames) {
      const cf = 0.6 + 0.4 * Math.sin(f.t * 7.7 + c.i * 2.2);
      c.m.scale.set(1, 0.8 + cf * 0.45, 1);
      (c.h.material as THREE.SpriteMaterial).opacity = 0.24 + cf * 0.14;
    }
  });

  /* ---------------- two pendant lamps over the table */
  for (const px of [tcx - 70, tcx + 70]) {
    const cord = cyl(0.6, 0.6, 40, 3, "#1a120a");
    cord.position.set(px, 118, tcz);
    const shadeM = cone(15, 14, 8, ownMat("#c9783e", { emissive: "#ff9a50", glow: 0.35 }));
    shadeM.position.set(px, 106, tcz);
    const bulb = new THREE.Mesh(new THREE.IcosahedronGeometry(4, 0), glowMat("#ffe6b0"));
    bulb.position.set(px, 104, tcz);
    const h = halo(90, "#ffc07a", 0.3);
    h.position.set(px, 100, tcz);
    const l = lamp("#ffc07a", 1.2, 320);
    l.position.set(px, 96, tcz);
    g.add(cord, shadeM, bulb, h, l);
  }

  /* ---------------- pasta station: flour sacks, a floured board, THE rolling pin */
  flour.forEach((s, i) => {
    // a plump sack: squat body, a slumped shoulder, the gathered neck + tie
    const sack = cyl(13, 15.5, 20, 8, "#cfc4ac");
    sack.scale.z = 0.72;
    sack.position.set(s.x, 0, s.y + 2);
    const shoulder = lump(13, "#cfc4ac", 200 + i, 0.1, 1, 0.5, 0.72, 1);
    shoulder.position.set(s.x, 20, s.y + 2);
    const tie = cone(6, 10, 6, "#c2b69c");
    tie.position.set(s.x, 24, s.y + 2);
    const knot = cyl(3.2, 3.2, 2.4, 6, "#8a6a4a");
    knot.position.set(s.x, 29, s.y + 2);
    g.add(shoulder, knot);
    const band = box(22, 3.4, 1, "#8a6a4a");
    band.position.set(s.x, 13, s.y + 14);
    band.castShadow = false;
    const tipo = panel(40, 16, (c, w, h) => {
      c.fillStyle = "rgba(90,60,40,.8)";
      c.font = "700 10px 'DM Mono'";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("TIPO 00", w / 2, h / 2);
    }, 18);
    tipo.position.set(s.x, 19, s.y + 14.2);
    g.add(sack, tie, band, tipo);
  });
  const board = box(96, 3, 54, "#b08a5a");
  board.position.set(215, 0, 526);
  board.rotation.y = 0.3;
  g.add(board);
  const dusting = glowPool(212, 526, 44, "#f4ecdc", 0.12, 3.4);
  g.add(dusting);
  // il mattarello — long, pale wood, turned handles
  const pin = new THREE.Group();
  const barrel = cyl(5.2, 5.2, 64, 10, "#caa06a");
  barrel.geometry.translate(0, -32, 0);
  const handleM = mat("#a8804e");
  for (const s of [-1, 1]) {
    const hnd = cyl(3.2, 3.6, 14, 8, handleM);
    hnd.geometry.translate(0, -7, 0);
    hnd.position.y = s * 39;
    pin.add(hnd);
  }
  pin.add(barrel);
  pin.rotation.z = Math.PI / 2;
  pin.rotation.y = 0.5;
  pin.position.set(212, 8.4, 522);
  g.add(pin);
  const dough = lump(9, "#f0dcb0", 9, 0.12, 1, 0.55, 1, 1);
  dough.position.set(238, 6, 546);
  g.add(dough);
  // flour dust drifting in the light
  const FL = 16;
  const dust = motes(FL, "#fff6e6", 5, 0.5);
  const dp = Array.from({ length: FL }, () => [R(), R() * 6.28, R()]);
  g.add(dust);
  anim.push((f) => {
    const p = dust.geometry.attributes.position as THREE.BufferAttribute;
    dp.forEach((d, i) => {
      d[0] = (d[0] + f.dt * 0.08) % 1;
      p.setXYZ(i, 210 + Math.cos(d[1] + f.t * 0.3) * (20 + d[2] * 30), 6 + d[0] * 70, 540 + Math.sin(d[1] + f.t * 0.25) * (14 + d[2] * 20));
    });
    p.needsUpdate = true;
  });

  /* ---------------- the easel — the framed piece IS the attribution link */
  const ez = easel.y;
  const woodM = mat("#4a3424");
  const easelG = new THREE.Group();
  for (const s of [-1, 1]) {
    const leg = box(3.2, 86, 3.2, woodM);
    leg.position.set(easel.x + s * 18, 0, ez + 12);
    leg.rotation.z = s * 0.2;
    leg.rotation.x = -0.18;
    easelG.add(leg);
  }
  const back = box(3.2, 80, 3.2, woodM);
  back.position.set(easel.x, 0, ez - 12);
  back.rotation.x = 0.28;
  const ledge = box(50, 3, 8, woodM);
  ledge.position.set(easel.x, 32, ez + 8);
  easelG.add(back, ledge);
  // the framed painting: a Baja sun over the sea
  const frameM = ownMat("#1c130b", { emissive: "#f3c9a8", glow: 0 });
  const frame = box(52, 42, 4, frameM);
  frame.position.set(easel.x, 35, ez + 7);
  frame.rotation.x = -0.18;
  const painting = panel(44, 34, (c, w, h) => {
    const sun = c.createLinearGradient(0, 0, w, h);
    sun.addColorStop(0, "#e0875a");
    sun.addColorStop(1, "#f3ddb8");
    c.fillStyle = sun;
    c.fillRect(0, 0, w, h);
    c.fillStyle = "rgba(20,10,6,.5)";
    c.beginPath();
    c.arc(w / 2 + 6, h / 2 - 6, 6, 0, 7);
    c.fill();
    c.fillStyle = "rgba(90,134,168,.55)";
    c.fillRect(0, h * 0.72, w, h * 0.28);
  }, 44, 4, true);
  painting.position.set(easel.x, 56.6, ez + 9.5);
  painting.rotation.x = -0.18;
  easelG.add(frame, painting);
  // brass credit plate on the ledge (tribute — attribution only)
  const plate = panel(90, 14, (c, w, h) => {
    c.fillStyle = "#b8914a";
    rr(c, 0, 0, w, h, 3);
    c.fill();
    c.fillStyle = "#2a1c10";
    c.font = "700 8px 'DM Mono'";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("ilmattarello.mx ↗", w / 2, h / 2 + 0.5);
  }, 40);
  plate.position.set(easel.x, 33.6, ez + 12.2);
  plate.rotation.x = -0.5;
  easelG.add(plate);
  g.add(easelG);
  const easelPool = glowPool(easel.x, easel.y + 20, 80, "#ffbe78", 0.12);
  const easelSpot = lamp("#ffd8a8", 0.7, 180);
  easelSpot.position.set(easel.x, 110, easel.y + 60);
  const easelHalo = halo(120, "#ffcf8a", 0);
  easelHalo.position.set(easel.x, 56, ez + 12);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(58, 48, 6)),
    new THREE.LineBasicMaterial({ color: hex("#f3c9a8"), transparent: true, opacity: 0.9 })
  );
  edges.position.set(easel.x, 56, ez + 8);
  edges.rotation.x = -0.18;
  edges.visible = false;
  g.add(easelPool, easelSpot, easelHalo, edges);
  // a camera-facing tag so the link reads before you step up to it
  const tag = billboard(150, 24, (c, w, h) => {
    c.fillStyle = "rgba(14,11,8,.78)";
    rr(c, 1, 1, w - 2, h - 2, 6);
    c.fill();
    c.strokeStyle = "rgba(243,201,168,.55)";
    c.lineWidth = 1.2;
    rr(c, 1.5, 1.5, w - 3, h - 3, 6);
    c.stroke();
    c.fillStyle = "#f3c9a8";
    c.font = "700 9px 'DM Mono'";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("IL MATTARELLO · 麺棒  ↗", w / 2, h / 2 + 0.5);
  }, 120);
  tag.position.set(easel.x, 104, ez);
  g.add(tag);
  anim.push((f) => {
    const on = f.active?.type === "goldrecord";
    edges.visible = on;
    if (on) (edges.material as THREE.LineBasicMaterial).opacity = 0.6 + 0.4 * Math.sin(f.t * 5);
    frameM.emissiveIntensity = on ? 0.35 + 0.2 * Math.sin(f.t * 5) : 0;
    (easelHalo.material as THREE.SpriteMaterial).opacity = on ? 0.35 + 0.1 * Math.sin(f.t * 3) : 0;
    (easelPool.material as THREE.MeshBasicMaterial).opacity = on ? 0.3 : 0.12;
    easelSpot.intensity = on ? 1.3 : 0.7;
  });

  /* ---------------- a wall shelf of oil + jars, and a string of dried chiles */
  g.add(block({ x: WALL, y: 360, w: 14, h: 44 }, 3, "#4a3020", 64));
  for (let i = 0; i < 4; i++) {
    const jar = cyl(4, 4, 10 + (i % 2) * 5, 6, ["#c9a468", "#6e8a4a", "#e8dcc8", "#8a4a2a"][i]);
    jar.position.set(WALL + 7, 67, 366 + i * 10);
    g.add(jar);
  }
  for (const x of [498, 644]) {
    for (let k = 0; k < 7; k++) {
      const chile = cone(2.6, 9, 4, k % 2 ? "#b02a1e" : "#c0402a");
      chile.rotation.x = Math.PI;
      chile.position.set(x + (k % 2) * 2, 118 - k * 9, WALL + 5);
      g.add(chile);
    }
  }

  /* ---------------- the name, on a woven mat by the door */
  const mat0 = block({ x: ROOM.w / 2 - 120, y: ROOM.h - WALL - 60, w: 240, h: 46 }, 1.2, "#6a4a30");
  mat0.castShadow = false;
  g.add(mat0);
  const name = panel(340, 44, (c, w, h) => {
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = "800 24px 'Shippori Mincho',serif";
    c.fillStyle = "rgba(243,201,168,.85)";
    c.fillText("IL MATTARELLO · 麺棒", w / 2, h / 2);
  }, 230);
  name.rotation.x = -Math.PI / 2;
  name.position.set(ROOM.w / 2, 1.6, ROOM.h - WALL - 37);
  (name.material as THREE.Material).depthWrite = false;
  g.add(name);

  return {
    group: g,
    bg: "#140d08",
    light: { sky: "#ffd8b0", ground: "#3a2014", hemi: 1.0, key: "#ffe2bc", keyI: 1.15 },
    update: (f) => anim.forEach((a) => a(f)),
  };
};
