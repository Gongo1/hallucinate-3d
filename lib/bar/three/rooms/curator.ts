import * as THREE from "three";
import type { CuratorPalette } from "../../curators";
import { ROOM, WALL, CURATOR } from "../../layout";
import type { FrameInfo, RoomBuilder } from "../types";
import {
  box, block, cyl, cone, lump, mat, ownMat, glowMat, glowPool, halo, lamp, billboard, panel, motes,
  rng, hex, rgba, rr,
} from "../kit";
import { wallRuns } from "./garden";

// HOUSEUM — the curator tribute terrace (room id `housemiam`, scene "curator").
// A glowing terrace floating in deep space: a synthwave holo grid underfoot, a
// holo railing at the edge, and beyond it the cosmos — twinkling stars far below,
// aurora curtains drifting, a Parisian-cosmic skyline (an Eiffel silhouette and an
// observatory on floating islands), flickering neon French signage. The gold
// "HOUSEUM" record is the centrepiece AND the honest attribution link; a chill
// cosmic cat (ORIGINAL homage art — never a copy of any curator mascot) lounges
// beside it. Palette + link come from lib/bar/curators.ts.

const { railY, record: REC, cat: CAT } = CURATOR;
type Anim = (f: FrameInfo) => void;

const FALLBACK: CuratorPalette = {
  skyTop: "#0c0628", skyBottom: "#241050", terrace: "#0e0a20", grid: "#6a44c8",
  aurora: ["#3a6ad6", "#7a3ad6", "#28d0c0"], neon: "#ff5ec6", neonAlt: "#5ee8ff",
  gold: "#ffd76a", holo: ["#ff8ad6", "#8affd6", "#8a9cff"],
};

/** the terrace grid: dark tiles + glowing seams (map) and the seams alone (emissive) */
function gridTextures(p: CuratorPalette) {
  const mk = (bg: string, line: string) => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d")!;
    x.fillStyle = bg;
    x.fillRect(0, 0, 64, 64);
    x.fillStyle = line;
    x.fillRect(0, 0, 64, 2);
    x.fillRect(0, 0, 2, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  };
  return { map: mk(p.terrace, p.grid), glow: mk("#000000", "#ffffff") };
}

/** A dark silhouette with glowing edges — the cosmic-skyline look. */
function neonSolid(geo: THREE.BufferGeometry, edge: string, body = "#16103a"): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.Mesh(geo, mat(body));
  m.castShadow = false;
  const e = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo, 20),
    new THREE.LineBasicMaterial({ color: hex(edge), transparent: true, opacity: 0.85, fog: false })
  );
  g.add(m, e);
  return g;
}

/** A floating rock island (flat top at y=0, tapering to a point below). */
function island(r: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const top = cyl(r, r * 0.9, 8, 7, "#2a1f4a");
  top.position.y = -8;
  const under = cone(r * 0.9, r * 1.6, 7, "#1a1236");
  under.rotation.x = Math.PI;
  under.position.y = -8;
  const chunk = lump(r * 0.5, "#231a40", seed, 0.35, 1, 1.4, 1, 0);
  chunk.position.set(r * 0.3, -r * 0.9, 0);
  g.add(top, under, chunk);
  return g;
}

export const buildCurator: RoomBuilder = ({ room, curator }) => {
  const p = curator?.palette ?? FALLBACK;
  const g = new THREE.Group();
  const anim: Anim[] = [];
  const R = rng(55);

  /* ---------------- the terrace: a floating slab with a glowing holo grid */
  const tH = ROOM.h - railY + 20;
  const tex = gridTextures(p);
  const cells = 48;
  for (const t of [tex.map, tex.glow]) t.repeat.set(ROOM.w / cells, tH / cells);
  const floorM = new THREE.MeshLambertMaterial({
    map: tex.map,
    emissive: hex(p.grid),
    emissiveMap: tex.glow,
    emissiveIntensity: 0.3,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, tH).rotateX(-Math.PI / 2), floorM);
  floor.position.set(ROOM.w / 2, 0, railY - 20 + tH / 2);
  floor.receiveShadow = true;
  g.add(floor);
  const slab = block({ x: 0, y: railY - 20, w: ROOM.w, h: tH }, 26, "#120c2a", -27);
  slab.castShadow = false;
  g.add(slab);
  // a glowing fascia along the slab's far lip (where the terrace ends in space)
  const lipM = glowMat(p.holo[2], 0.8);
  const lip = box(ROOM.w, 3, 3, lipM);
  lip.position.set(ROOM.w / 2, -4, railY - 21);
  g.add(lip);
  anim.push((f) => {
    // a slow synthwave breath through the seams
    floorM.emissiveIntensity = 0.26 + 0.08 * Math.sin(f.t * 0.8);
  });

  /* ---------------- the cosmos beyond: stars far below + around */
  const starLayer = (n: number, seed: number, size: number) => {
    const s = motes(n, "#ffffff", size, 0.8);
    const r2 = rng(seed);
    const pp = s.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      // a shell of space: behind the rail, below and beside the terrace
      const x = -700 + r2() * (ROOM.w + 1400);
      const z = -900 + r2() * (railY + 900 + 300);
      const behind = z < railY - 30;
      const y = behind ? -700 + r2() * 760 : -700 + r2() * 640;
      const side = x < -20 || x > ROOM.w + 20;
      if (!behind && !side) pp.setXYZ(i, x < ROOM.w / 2 ? -60 - r2() * 500 : ROOM.w + 60 + r2() * 500, y, z);
      else pp.setXYZ(i, x, y, z);
    }
    g.add(s);
    return s;
  };
  const starsA = starLayer(320, 1, 11);
  const starsB = starLayer(200, 2, 17);
  anim.push((f) => {
    (starsA.material as THREE.PointsMaterial).opacity = 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(f.t / 0.6));
    (starsB.material as THREE.PointsMaterial).opacity = 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(f.t / 0.6 + 2.1));
  });
  // a distant ringed planet + a violet nebula glow, far below the rail
  const planet = new THREE.Mesh(new THREE.IcosahedronGeometry(46, 1), ownMat("#5a3aa8", { emissive: "#2a1a60", glow: 0.6 }));
  planet.position.set(ROOM.w - 170, -150, -120);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(74, 3, 3, 30), glowMat(p.holo[0], 0.55));
  ring.rotation.set(Math.PI / 2 - 0.35, 0.2, 0);
  ring.position.copy(planet.position);
  const neb1 = halo(700, p.aurora[1], 0.22);
  neb1.position.set(360, -260, -200);
  const neb2 = halo(560, p.aurora[0], 0.18);
  neb2.position.set(900, -300, -40);
  g.add(planet, ring, neb1, neb2);
  anim.push((f) => {
    planet.rotation.y = f.t * 0.08;
  });

  /* ---------------- aurora curtains drifting beyond the rail */
  const bands: { mesh: THREE.Mesh; base: Float32Array; b: number }[] = [];
  for (let b = 0; b < 3; b++) {
    const geo = new THREE.PlaneGeometry(ROOM.w + 400, 90, 48, 1);
    const m = new THREE.MeshBasicMaterial({
      color: hex(p.aurora[b]), transparent: true, opacity: 0.2, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(ROOM.w / 2, -10 + b * 22, 70 + b * 70);
    mesh.rotation.x = -0.35;
    mesh.renderOrder = 1;
    g.add(mesh);
    bands.push({ mesh, base: (geo.attributes.position.array as Float32Array).slice(), b });
  }
  anim.push((f) => {
    for (const { mesh, base, b } of bands) {
      const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3];
        const y = base[i * 3 + 1];
        pos.setY(i, y + Math.sin(x / 130 + f.t / (1.7 + b * 0.42) + b) * 22);
        pos.setZ(i, Math.sin(x / 210 + f.t / 3 + b) * 18);
      }
      pos.needsUpdate = true;
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.16 + 0.06 * Math.sin(f.t * 0.5 + b * 2);
    }
  });

  /* ---------------- the Parisian-cosmic skyline, on floating islands */
  {
    // an Eiffel silhouette, stacked 4-sided frustums with glowing edges
    const e = new THREE.Group();
    const tiers: [number, number, number, number][] = [
      [34, 17, 52, 0], [15, 8, 60, 58], [7, 1.6, 74, 124],
    ];
    for (const [rb, rt, h, y] of tiers) {
      const geo = new THREE.CylinderGeometry(rt, rb, h, 4, 1, true);
      geo.translate(0, h / 2, 0);
      const t = neonSolid(geo, p.neonAlt);
      t.position.y = y;
      t.rotation.y = Math.PI / 4;
      e.add(t);
    }
    for (const [y, w] of [[52, 40], [118, 22]]) {
      const plat = box(w, 4, w, "#0a0620");
      plat.position.y = y;
      plat.rotation.y = Math.PI / 4;
      e.add(plat);
    }
    const arch = new THREE.Mesh(new THREE.TorusGeometry(20, 1.4, 3, 12, Math.PI), glowMat(p.neonAlt, 0.5));
    arch.position.set(0, 16, 24);
    e.add(arch);
    const beacon = halo(34, p.neon, 0.9);
    beacon.position.y = 202;
    const bulb = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4, 0), glowMat(p.neon));
    bulb.position.y = 200;
    e.add(beacon, bulb);
    const isl = island(62, 7);
    e.scale.setScalar(0.78);
    isl.add(e);
    isl.position.set(250, -30, 150);
    g.add(isl);
    anim.push((f) => {
      (beacon.material as THREE.SpriteMaterial).opacity = 0.5 + 0.5 * Math.abs(Math.sin(f.t * 1.6));
      isl.position.y = -30 + Math.sin(f.t * 0.5) * 4;
    });

    // an observatory: drum + faceted dome with a gold slit + telescope
    const o = new THREE.Group();
    const drum = neonSolid(new THREE.CylinderGeometry(36, 38, 22, 10).translate(0, 11, 0), p.neonAlt);
    const dome = neonSolid(new THREE.SphereGeometry(36, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 22, 0), p.neonAlt);
    const slit = box(6, 38, 3, glowMat(p.gold, 0.8));
    slit.position.set(0, 26, 34);
    slit.rotation.x = -0.5;
    const scope = cyl(3, 4.5, 34, 7, ownMat(p.gold, { emissive: p.gold, glow: 0.4 }));
    scope.position.set(0, 44, 12);
    scope.rotation.x = 0.7;
    o.add(drum, dome, slit, scope);
    const isl2 = island(58, 9);
    isl2.add(o);
    isl2.position.set(930, -40, 180);
    g.add(isl2);
    anim.push((f) => {
      isl2.position.y = -40 + Math.sin(f.t * 0.45 + 1.7) * 4;
      scope.rotation.z = Math.sin(f.t * 0.2) * 0.25;
    });
  }

  /* ---------------- the neon sign: Houseum / COSMIC FRENCH HOUSE · 宇宙 */
  const tag = "a tribute lounge · the music is Houseum's";
  const sign = billboard(340, 110, (c, w) => {
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.shadowColor = p.neon;
    c.shadowBlur = 16;
    c.fillStyle = p.neon;
    c.font = "900 44px 'Anton',sans-serif";
    c.fillText(curator?.displayName ?? "Houseum", w / 2, 38);
    c.shadowColor = p.neonAlt;
    c.shadowBlur = 8;
    c.font = "12px 'DM Mono'";
    c.fillStyle = rgba(p.neonAlt, 0.95);
    c.fillText("COSMIC FRENCH HOUSE · 宇宙", w / 2, 74);
    c.shadowBlur = 0;
    c.font = "10px 'DM Mono'";
    c.fillStyle = rgba(p.holo[0], 0.7);
    c.fillText(tag, w / 2, 96);
  }, 300);
  sign.position.set(ROOM.w / 2, 46, 215);
  const signGlow = halo(420, p.neon, 0.16);
  signGlow.scale.set(420, 160, 1);
  signGlow.position.set(ROOM.w / 2, 46, 205);
  g.add(signGlow, sign);
  anim.push((f) => {
    const flick = 0.82 + 0.18 * Math.sin(f.t / 0.09) * Math.sin(f.t / 0.317);
    (sign.material as THREE.SpriteMaterial).opacity = flick;
    (signGlow.material as THREE.SpriteMaterial).opacity = 0.1 + 0.08 * flick;
    sign.position.y = 46 + Math.sin(f.t * 0.7) * 3;
  });

  /* ---------------- the holo railing at the terrace edge (the solid band) */
  {
    const topM = ownMat(p.holo[2], { emissive: p.holo[2], glow: 0.9 });
    const top = box(ROOM.w + 60, 4, 6, topM);
    top.position.set(ROOM.w / 2, 34, railY);
    const low = box(ROOM.w + 60, 3, 4, glowMat(p.grid, 0.9));
    low.position.set(ROOM.w / 2, 12, railY);
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM.w + 60, 30),
      new THREE.MeshBasicMaterial({ color: hex(p.holo[2]), transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })
    );
    glass.position.set(ROOM.w / 2, 18, railY);
    g.add(top, low, glass);
    for (let x = 36; x < ROOM.w; x += 78) {
      const post = box(4, 34, 4, "#2a1d5e");
      post.position.set(x, 0, railY);
      g.add(post);
    }
    // the iridescent top bar drifts through the holo palette
    const hc = p.holo.map((c) => hex(c));
    anim.push((f) => {
      const k = (f.t * 0.12) % 3;
      const i = Math.floor(k);
      const c = hc[i].clone().lerp(hc[(i + 1) % 3], k - i);
      topM.color.copy(c);
      topM.emissive.copy(c);
    });
    // side + front edges of the terrace: low holo rails over the edge solids
    const sideM = glowMat(p.grid, 0.75);
    for (const x of [WALL / 2, ROOM.w - WALL / 2]) {
      const rail = box(4, 4, ROOM.h - railY, sideM);
      rail.position.set(x, 30, (railY + ROOM.h) / 2);
      g.add(rail);
      for (let y = railY + 40; y < ROOM.h; y += 78) {
        const post = box(4, 30, 4, "#2a1d5e");
        post.position.set(x, 0, y);
        g.add(post);
      }
      const edge = block({ x: x - WALL / 2, y: railY, w: WALL, h: ROOM.h - railY }, 6, "#1a1238");
      edge.castShadow = false;
      g.add(edge);
    }
    for (const [a, b] of wallRuns(room.doors, "front")) {
      const ledge = block({ x: a, y: ROOM.h - WALL, w: b - a, h: WALL }, 12, "#1a1238");
      g.add(ledge);
      const glow = box(b - a, 2, 2, sideM);
      glow.position.set((a + b) / 2, 12, ROOM.h - WALL);
      g.add(glow);
    }
  }

  /* ---------------- the GOLD RECORD centrepiece (+ the honest attribution) */
  {
    const { x, y, r } = REC;
    const s = r * 0.82; // the solid half-width
    // holo plinth on the solid's footprint
    const plinthM = new THREE.MeshLambertMaterial({ color: hex(p.grid), transparent: true, opacity: 0.55, emissive: hex(p.grid), emissiveIntensity: 0.35 });
    const plinth = block({ x: x - s, y: y - s, w: s * 2, h: s * 2 }, 14, plinthM);
    const plinthEdge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(s * 2, 14, s * 2)),
      new THREE.LineBasicMaterial({ color: hex(p.neonAlt), transparent: true, opacity: 0.7 })
    );
    plinthEdge.position.set(x, 7, y);
    const cap = block({ x: x - s + 6, y: y - s + 6, w: s * 2 - 12, h: s * 2 - 12 }, 3, "#1a1030", 14);
    g.add(plinth, plinthEdge, cap);

    // the stand: the disc leans back a touch so it faces the camera
    const stand = new THREE.Group();
    stand.position.set(x, 17 + r + 8, y);
    stand.rotation.x = -0.42;
    g.add(stand);
    const frameM = ownMat(p.gold, { emissive: p.gold, glow: 0.25 });
    const frame = new THREE.Mesh(new THREE.TorusGeometry(r + 7, 3.2, 5, 28), frameM);
    frame.castShadow = true;
    stand.add(frame);
    const spin = new THREE.Group(); // the disc turns slowly on its spindle
    stand.add(spin);
    const discM = ownMat(p.gold, { emissive: "#9c7a2a", glow: 0.35 });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 3, 28), discM);
    disc.rotation.x = Math.PI / 2;
    disc.castShadow = true;
    spin.add(disc);
    for (let k = r * 0.5; k < r; k += 5) {
      const groove = new THREE.Mesh(new THREE.TorusGeometry(k, 0.5, 3, 28), mat("#b8912e"));
      groove.position.z = 1.6;
      spin.add(groove);
    }
    const label = panel(128, 128, (c, w, h) => {
      c.beginPath();
      c.arc(w / 2, h / 2, w / 2 - 1, 0, 7);
      c.fillStyle = "#1a1030";
      c.fill();
      c.strokeStyle = rgba(p.gold, 0.9);
      c.lineWidth = 4;
      c.stroke();
      c.fillStyle = p.gold;
      c.font = "900 30px 'Anton',sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("HOUSEUM", w / 2, h / 2 - 12);
      c.font = "10px 'DM Mono'";
      c.fillStyle = rgba(p.holo[1], 0.9);
      c.fillText("宇宙 · GOLD", w / 2, h / 2 + 16);
      c.beginPath();
      c.arc(w / 2, h / 2 + 32, 3, 0, 7);
      c.fillStyle = "#000";
      c.fill();
    }, r * 0.95);
    label.position.z = 1.8;
    spin.add(label);
    // a holographic glint sweeping across the face
    const glint = new THREE.Mesh(
      new THREE.PlaneGeometry(r * 1.9, 4),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    glint.position.z = 2.2;
    stand.add(glint);
    // struts behind the disc down to the plinth
    for (const sx of [-1, 1]) {
      const strut = cyl(1.6, 1.6, r + 20, 5, ownMat(p.gold, { emissive: p.gold, glow: 0.15 }));
      strut.position.set(x + sx * 18, 14, y - 12);
      strut.rotation.x = -0.3;
      g.add(strut);
    }
    const aura = halo(r * 4, p.gold, 0.22);
    aura.position.set(x, 17 + r + 8, y - 6);
    g.add(aura);
    const pool = glowPool(x, y + 20, r * 2.6, p.gold, 0.2);
    g.add(pool);
    const gl = lamp(p.gold, 1.4, 320);
    gl.position.set(x, 90, y + 60);
    g.add(gl);

    // the CTA — honest attribution (NOT partnership language), floating above
    const text = curator?.attribution.text ?? "find more on YouTube ↗";
    const drawCta = (on: boolean) => (c: CanvasRenderingContext2D, w: number, h: number) => {
      c.fillStyle = "rgba(10,6,24,.88)";
      rr(c, 2, 2, w - 4, h - 4, 7);
      c.fill();
      c.strokeStyle = rgba(p.gold, on ? 0.95 : 0.55);
      c.lineWidth = on ? 2.4 : 1.4;
      if (on) {
        c.shadowColor = p.gold;
        c.shadowBlur = 12;
      }
      rr(c, 2, 2, w - 4, h - 4, 7);
      c.stroke();
      c.shadowBlur = 0;
      c.fillStyle = p.gold;
      c.font = "10px 'DM Mono'";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(text, w / 2, h / 2 + 1);
    };
    const cta = billboard(230, 30, drawCta(false), 200);
    cta.position.set(x, 17 + r * 2 + 44, y);
    g.add(cta);
    const hiEdge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(s * 2 + 10, 20, s * 2 + 10)),
      new THREE.LineBasicMaterial({ color: hex(p.gold), transparent: true, opacity: 0.9 })
    );
    hiEdge.position.set(x, 9, y);
    hiEdge.visible = false;
    g.add(hiEdge);

    let wasOn = false;
    anim.push((f) => {
      const on = f.active?.type === "goldrecord";
      if (on !== wasOn) {
        wasOn = on;
        cta.label.redraw(drawCta(on));
      }
      spin.rotation.z -= f.dt * (f.playing ? 0.9 : 0.3);
      const ga = (f.t / 1.4) % (Math.PI * 2);
      glint.rotation.z = ga;
      (glint.material as THREE.MeshBasicMaterial).opacity = 0.2 + 0.25 * Math.abs(Math.sin(f.t * 0.9));
      frameM.emissiveIntensity = on ? 0.55 + 0.3 * Math.sin(f.t * 5) : 0.25;
      discM.emissiveIntensity = on ? 0.55 : 0.35;
      (pool.material as THREE.MeshBasicMaterial).opacity = on ? 0.34 : 0.2;
      pool.scale.setScalar(on ? 1.25 : 1);
      (aura.material as THREE.SpriteMaterial).opacity = on ? 0.34 : 0.2;
      hiEdge.visible = on;
      if (on) (hiEdge.material as THREE.LineBasicMaterial).opacity = 0.55 + 0.45 * Math.sin(f.t * 6);
      cta.position.y = 17 + r * 2 + 44 + Math.sin(f.t * 1.2) * 2;
      plinthEdge.material.opacity = 0.5 + 0.25 * Math.sin(f.t * 1.5);
    });
  }

  /* ---------------- the cosmic cat, lounging beside the record (original art) */
  {
    const c = new THREE.Group();
    c.position.set(CAT.x, 0, CAT.y);
    c.scale.setScalar(1.3);
    g.add(c);
    const furM = ownMat("#44359a", { emissive: "#2a1f6a", glow: 0.7 });
    const body = lump(16, "#2c1f64", 91, 0.08, 2.0, 0.85, 1.05, 1);
    body.material = furM;
    body.position.set(0, 12, 0);
    c.add(body);
    const head = new THREE.Group();
    head.position.set(-30, 18, 4);
    c.add(head);
    // the head is modelled facing +Z (the camera), then turned toward the record
    const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(11, 1), furM);
    skull.scale.set(1.1, 0.95, 1);
    skull.castShadow = true;
    head.add(skull);
    const muzzle = new THREE.Mesh(new THREE.IcosahedronGeometry(5, 0), ownMat("#6a58c0", { emissive: "#3a2c80", glow: 0.5 }));
    muzzle.scale.set(1.3, 0.8, 0.8);
    muzzle.position.set(0, -3.5, 8.5);
    head.add(muzzle);
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(5, 12, 4), furM);
      ear.position.set(sx * 6.5, 12, -1);
      ear.rotation.z = -sx * 0.35;
      head.add(ear);
      const inner = new THREE.Mesh(new THREE.ConeGeometry(2.6, 7, 4), glowMat(p.holo[0], 0.85));
      inner.position.set(sx * 6.3, 11.5, 1.6);
      inner.rotation.z = -sx * 0.35;
      head.add(inner);
    }
    // content closed eyes (glowing ∪ arcs), a neon nose, faint whiskers
    const eyeM = glowMat(p.neonAlt);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.7, 3, 8, Math.PI), eyeM);
      eye.rotation.z = Math.PI;
      eye.position.set(sx * 4.4, 2.5, 10.2);
      head.add(eye);
      for (const wy of [-3, -5]) {
        const wh = box(11, 0.5, 0.5, glowMat("#ffffff", 0.45));
        wh.castShadow = false;
        wh.position.set(sx * 9, wy, 8);
        wh.rotation.z = sx * (wy === -3 ? 0.12 : -0.1);
        head.add(wh);
      }
    }
    const nose = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 0), glowMat(p.neon));
    nose.position.set(0, -1.6, 12.4);
    head.add(nose);
    head.rotation.y = -0.45; // gazing past the camera toward the record
    // front paws tucked forward
    for (const sz of [-1, 1]) {
      const paw = new THREE.Mesh(new THREE.IcosahedronGeometry(4, 0), furM);
      paw.scale.set(1.6, 0.7, 1);
      paw.position.set(-26, 3, sz * 7 + 8);
      c.add(paw);
    }
    // the tail: a chain of segments curling up at the end
    const tail: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const seg = new THREE.Mesh(new THREE.IcosahedronGeometry(4.2 - i * 0.35, 0), furM);
      c.add(seg);
      tail.push(seg);
    }
    // star-fur sparkles
    const sparkM = glowMat(p.holo[1], 0.9);
    const sparks: THREE.Mesh[] = [];
    for (const [dx, dy, dz] of [[-12, 20, 6], [2, 23, -4], [14, 19, 8], [-4, 21, -9], [22, 16, 2]]) {
      const sp = new THREE.Mesh(new THREE.OctahedronGeometry(2, 0), sparkM);
      sp.position.set(dx, dy, dz);
      c.add(sp);
      sparks.push(sp);
    }
    g.add(glowPool(CAT.x, CAT.y, 60, p.holo[2], 0.12));
    anim.push((f) => {
      const breath = Math.sin(f.t / 1.4);
      body.scale.set(1, 1 + breath * 0.04, 1 + breath * 0.02);
      head.position.y = 18 + breath * 0.8;
      tail.forEach((seg, i) => {
        const k = i / 5;
        const sway = Math.sin(f.t * 1.1 - i * 0.5) * 0.35 * k;
        seg.position.set(26 + i * 6 - k * k * 10, 6 + k * k * 22, 4 + Math.sin(sway) * 14 * k + k * 8);
      });
      sparks.forEach((sp, i) => {
        const tw = 0.5 + 0.5 * Math.sin(f.t * 2 + i * 1.7);
        sp.scale.setScalar(0.5 + tw);
        sp.rotation.y = f.t + i;
      });
    });
  }

  /* ---------------- holo motes drifting over the terrace */
  const MN = 34;
  const drift = motes(MN, p.holo[1], 6, 0.6);
  const dm = Array.from({ length: MN }, () => [WALL + R() * (ROOM.w - 2 * WALL), R() * 120, railY + 20 + R() * (ROOM.h - railY - 60), 2 + R() * 4]);
  g.add(drift);
  anim.push((f) => {
    const pp = drift.geometry.attributes.position as THREE.BufferAttribute;
    dm.forEach((d, i) => {
      d[1] += d[3] * f.dt;
      if (d[1] > 130) d[1] = 0;
      pp.setXYZ(i, d[0] + Math.sin(f.t * 0.4 + i) * 10, d[1], d[2] + Math.cos(f.t * 0.3 + i) * 6);
    });
    pp.needsUpdate = true;
  });

  // neon washes: magenta over the terrace, cyan from the right
  const mag = lamp(p.neon, 0.9, 700);
  mag.position.set(ROOM.w / 2 - 200, 110, railY + 90);
  const cyan = lamp(p.neonAlt, 0.7, 560);
  cyan.position.set(ROOM.w - 160, 90, 640);
  g.add(mag, cyan);

  return {
    group: g,
    bg: p.skyTop,
    light: { sky: "#8a78e8", ground: "#140c30", hemi: 0.95, key: "#c8b8ff", keyI: 0.75, keyFrom: [-0.3, 1, 0.6] },
    update: (f) => anim.forEach((a) => a(f)),
  };
};
