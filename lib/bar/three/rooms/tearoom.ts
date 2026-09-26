import * as THREE from "three";
import { ROOM, WALL, TEA } from "../../layout";
import type { FrameInfo, RoomBuilder } from "../types";
import { shell, WALL_H } from "../shared";
import {
  box, block, cyl, cone, lump, mat, ownMat, glowMat, glowPool, halo, lamp, panel, motes, rng, hex,
} from "../kit";

// THE TEA ROOM — meditation / stillness. A field of tatami on a dark-wood floor,
// warm clay walls with glowing shoji along the back and a tokonoma alcove (a
// hanging scroll + ikebana), the low chabudai with an iron tetsubin and two cups,
// a thread of incense, a singing bowl on its cushion that hums with a slow
// shimmer, potted ferns. The calmest room: nothing moves fast here.

const { table: tbl, bowl, plants } = TEA;
const MATS = { x: 210, y: 210, w: 720, h: 420 }; // tatami field (5×3)
const MAT_H = 3;

type Anim = (f: FrameInfo) => void;

/** straw weave — pale lines, tinted per mat by the material colour */
function weaveTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const x = c.getContext("2d")!;
  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, 64, 128);
  x.strokeStyle = "rgba(90,80,40,.22)";
  x.lineWidth = 1;
  for (let y = 2; y < 128; y += 4) {
    x.beginPath();
    x.moveTo(0, y);
    x.lineTo(64, y);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const onMats = (x: number, y: number) =>
  x > MATS.x && x < MATS.x + MATS.w && y > MATS.y && y < MATS.y + MATS.h;

export const buildTearoom: RoomBuilder = ({ room }) => {
  const g = new THREE.Group();
  const anim: Anim[] = [];
  const R = rng(33);
  const elev = (x: number, y: number) => (onMats(x, y) ? MAT_H : 0);

  /* ---------------- floor: dark polished boards around the tatami field */
  for (let y = 0, i = 0; y < ROOM.h; y += 40, i++) {
    const p = block({ x: 0, y: y + 1, w: ROOM.w, h: 38 }, 3, i % 2 ? "#3a2c1c" : "#34271a", -3);
    p.castShadow = false;
    g.add(p);
  }
  const under = box(ROOM.w, 3, ROOM.h, "#140e08");
  under.position.set(ROOM.w / 2, -6, ROOM.h / 2);
  under.castShadow = false;
  g.add(under);

  /* ---------------- the tatami field: 5×3 mats with dark cloth borders */
  const weave = weaveTexture();
  const matA = new THREE.MeshLambertMaterial({ color: hex("#c4bb84"), map: weave, flatShading: true });
  const matB = new THREE.MeshLambertMaterial({ color: hex("#b8ae78"), map: weave, flatShading: true });
  const cols = 5;
  const rows = 3;
  const mw = MATS.w / cols;
  const mh = MATS.h / rows;
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const m = block({ x: MATS.x + i * mw + 1, y: MATS.y + j * mh + 1, w: mw - 2, h: mh - 2 }, MAT_H, (i + j) % 2 ? matA : matB);
      m.castShadow = false;
      if ((i + j) % 2) m.rotation.y = 0; // weave runs the same way; tint alternates
      g.add(m);
      // heri — the dark cloth binding along the two long edges
      for (const yy of [MATS.y + j * mh, MATS.y + (j + 1) * mh - 4]) {
        const heri = block({ x: MATS.x + i * mw, y: yy, w: mw, h: 4 }, MAT_H + 0.4, "#2c2417");
        heri.castShadow = false;
        g.add(heri);
      }
    }
  // soft overhead light on the mats
  g.add(glowPool(ROOM.w / 2, 400, 380, "#ffdc96", 0.12));

  /* ---------------- walls: warm clay plaster, dark timber posts + nageshi rail */
  g.add(shell(room.doors, { floor: false, wall: "#6a543a", trim: "#1d150c" }));
  for (const x of [WALL + 6, 470, 670, ROOM.w - WALL - 6]) {
    const post = box(12, WALL_H, 8, "#1d150c");
    post.position.set(x, 0, WALL + 4);
    g.add(post);
  }
  const nageshi = box(ROOM.w - 2 * WALL, 7, 5, "#2a1d10");
  nageshi.position.set(ROOM.w / 2, 122, WALL + 2.5);
  g.add(nageshi);
  for (const x of [WALL + 3, ROOM.w - WALL - 3]) {
    // side-wall rails, skipping nothing (door frames sit in front of them)
    const rail = box(5, 7, ROOM.h - 2 * WALL, "#2a1d10");
    rail.position.set(x, 122, ROOM.h / 2);
    g.add(rail);
  }

  /* ---------------- shoji along the back wall, softly lit from outside */
  const paperM = ownMat("#f3e6c8", { emissive: "#f7dcaa", glow: 0.55 });
  const latM = mat("#3a2a18");
  const shoji = (x0: number, w: number) => {
    const H = 104;
    const y0 = 14;
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(w, H), paperM);
    paper.position.set(x0 + w / 2, y0 + H / 2, WALL + 0.8);
    g.add(paper);
    const frameT = box(w + 6, 5, 4, latM);
    frameT.position.set(x0 + w / 2, y0 + H - 1, WALL + 2);
    const frameB = box(w + 6, 8, 4, latM);
    frameB.position.set(x0 + w / 2, y0 - 6, WALL + 2);
    g.add(frameT, frameB);
    for (const xx of [x0 - 1.5, x0 + w + 1.5]) {
      const side = box(4, H, 4, latM);
      side.position.set(xx, y0, WALL + 2);
      g.add(side);
    }
    for (let k = 1; k < 3; k++) {
      const v = box(1.6, H, 2, latM);
      v.castShadow = false;
      v.position.set(x0 + (w * k) / 3, y0, WALL + 1.6);
      g.add(v);
    }
    for (let yy = y0 + 20; yy < y0 + H; yy += 21) {
      const hb = box(w, 1.6, 2, latM);
      hb.castShadow = false;
      hb.position.set(x0 + w / 2, yy, WALL + 1.6);
      g.add(hb);
    }
    // warm light spilling onto the boards in front
    g.add(glowPool(x0 + w / 2, WALL + 50, 70, "#ffd9a0", 0.12));
  };
  for (const x of [62, 162, 262, 362]) shoji(x, 84);
  for (const x of [694, 794, 894, 994]) shoji(x, 84);

  /* ---------------- tokonoma: the alcove, a hanging scroll, ikebana */
  {
    const ax = 488;
    const aw = 164;
    const alcove = box(aw, 118, 3, "#4a3a28");
    alcove.position.set(ax + aw / 2, 0, WALL + 0.4);
    g.add(alcove);
    const toko = block({ x: ax, y: WALL, w: aw, h: 12 }, 10, "#2a1d10");
    g.add(toko);
    const tokobashira = box(8, 118, 8, "#5a3a20"); // the natural-wood alcove post
    tokobashira.position.set(ax + aw + 3, 0, WALL + 6);
    g.add(tokobashira);
    const scroll = panel(46, 110, (c, w, h) => {
      c.fillStyle = "#2c3a2c";
      c.fillRect(0, 0, w, h);
      c.fillStyle = "#efe6d0";
      c.fillRect(5, 12, w - 10, h - 26);
      c.fillStyle = "#1a140c";
      c.font = "800 30px 'Shippori Mincho',serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("静", w / 2, h / 2 - 8);
      c.fillStyle = "#b8352a";
      c.fillRect(w / 2 - 3, h - 30, 6, 6); // the seal
      c.fillStyle = "#1a140c";
      c.fillRect(0, 0, w, 4);
      c.fillRect(0, h - 5, w, 5);
    }, 36, 3, true);
    scroll.position.set(ax + 56, 70, WALL + 2.4);
    g.add(scroll);
    const vase = cyl(5, 7, 16, 7, "#3a4a52");
    vase.position.set(ax + 116, 10, WALL + 7);
    g.add(vase);
    const branch = cyl(0.8, 1.2, 40, 4, "#4a3020");
    branch.rotation.z = -0.5;
    branch.position.set(ax + 116, 24, WALL + 7);
    g.add(branch);
    for (let i = 0; i < 4; i++) {
      const bl = lump(3.2, i % 2 ? "#f2c8d4" : "#e8a8bc", 700 + i, 0.2, 1, 1, 1, 0);
      bl.position.set(ax + 124 + i * 5, 44 + (i % 2) * 5, WALL + 7);
      g.add(bl);
    }
    const hengaku = panel(220, 38, (c, w, h) => {
      c.fillStyle = "#2a1d10";
      c.fillRect(0, 0, w, h);
      c.strokeStyle = "rgba(239,226,200,.3)";
      c.lineWidth = 2;
      c.strokeRect(3, 3, w - 6, h - 6);
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.font = "800 20px 'Shippori Mincho',serif";
      c.fillStyle = "#efe2c8";
      c.fillText("茶室 · TEA ROOM", w / 2, h / 2 + 1);
    }, 170, 3, true);
    hengaku.position.set(ax + aw / 2, 136, WALL + 1.2);
    g.add(hengaku);
  }

  /* ---------------- the low chabudai: iron tetsubin + two cups + incense */
  {
    const e = elev(tbl.x + 1, tbl.y + 1);
    const cx = tbl.x + tbl.w / 2;
    const cz = tbl.y + tbl.h / 2;
    g.add(block({ x: tbl.x, y: tbl.y, w: tbl.w, h: tbl.h }, 5, "#3a2817", e + 16));
    const inset = block({ x: tbl.x + 6, y: tbl.y + 6, w: tbl.w - 12, h: tbl.h - 12 }, 0.6, "#4a3420", e + 21);
    inset.castShadow = false;
    g.add(inset);
    for (const [lx, lz] of [[8, 8], [tbl.w - 8, 8], [8, tbl.h - 8], [tbl.w - 8, tbl.h - 8]]) {
      const leg = box(7, 16, 7, "#2a1d10");
      leg.position.set(tbl.x + lx, e, tbl.y + lz);
      g.add(leg);
    }
    const top = e + 21.6;
    const pot = new THREE.Mesh(new THREE.IcosahedronGeometry(11, 1), mat("#1c2a30"));
    pot.scale.set(1, 0.78, 1);
    pot.position.set(cx, top + 8, cz);
    pot.castShadow = true;
    const lid = cyl(5, 6, 3, 8, "#2c3a40");
    lid.position.set(cx, top + 15, cz);
    const spout = cyl(1.6, 2.6, 10, 5, "#1c2a30");
    spout.rotation.z = -1.0;
    spout.position.set(cx + 9, top + 6, cz);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(9, 1.1, 4, 10, Math.PI), mat("#2c3a40"));
    handle.position.set(cx, top + 16, cz);
    g.add(pot, lid, spout, handle);
    for (const [dx, dz] of [[-34, -6], [34, 8]]) {
      const cup = cyl(5, 4, 6, 7, "#d9cdb6");
      cup.position.set(cx + dx, top, cz + dz);
      const tea = cyl(4.2, 4.2, 0.6, 7, "#9aa85a");
      tea.position.set(cx + dx, top + 5.6, cz + dz);
      g.add(cup, tea);
    }
    // incense on the back-left corner of the table
    const holder = cyl(4, 5, 3, 6, "#5a4a3a");
    holder.position.set(tbl.x + 12, top, tbl.y + 10);
    const stick = cyl(0.5, 0.5, 18, 3, "#6a3a2a");
    stick.position.set(tbl.x + 12, top + 2, tbl.y + 10);
    stick.rotation.z = 0.15;
    const ember = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), glowMat("#ff7a3a"));
    ember.position.set(tbl.x + 14.6, top + 19.5, tbl.y + 10);
    g.add(holder, stick, ember);
    // smoke from the incense + steam from the spout, both drifting slowly up
    const N = 12;
    const smoke = motes(N, "#efe7d4", 8, 0.4);
    const steam = motes(8, "#ffffff", 10, 0.3);
    g.add(smoke, steam);
    const sp = Array.from({ length: N }, (_, i) => i / N);
    const st = Array.from({ length: 8 }, (_, i) => i / 8);
    anim.push((f) => {
      const p = smoke.geometry.attributes.position as THREE.BufferAttribute;
      sp.forEach((v, i) => {
        sp[i] = (v + f.dt * 0.12) % 1;
        const s = sp[i];
        p.setXYZ(i, tbl.x + 14.6 + Math.sin((s + i) * 5) * (3 + s * 8), top + 20 + s * 80, tbl.y + 10 + Math.cos(s * 4 + i) * 3);
      });
      p.needsUpdate = true;
      const q = steam.geometry.attributes.position as THREE.BufferAttribute;
      st.forEach((v, i) => {
        st[i] = (v + f.dt * 0.2) % 1;
        const s = st[i];
        q.setXYZ(i, cx + 15 + Math.sin((s + i) * 4) * 4 + s * 6, top + 10 + s * 40, cz + Math.cos(s * 6 + i) * 2);
      });
      q.needsUpdate = true;
      (ember.material as THREE.MeshBasicMaterial).color.setRGB(1, 0.42 + 0.12 * Math.sin(f.t * 2.3), 0.2);
    });
  }

  /* ---------------- zabuton flanking the table */
  for (const [cx, cy] of [[tbl.x - 70, tbl.y + tbl.h / 2], [tbl.x + tbl.w + 70, tbl.y + tbl.h / 2]]) {
    const z = box(44, 6, 32, "#7e6fb0");
    z.position.set(cx, elev(cx, cy), cy);
    g.add(z);
    const tuft = box(3, 1.5, 3, "#5a4a8a");
    tuft.position.set(cx, elev(cx, cy) + 6, cy);
    g.add(tuft);
  }

  /* ---------------- the singing-bowl corner: cushion, bronze bowl, slow shimmer */
  {
    const e = elev(bowl.x, bowl.y);
    const cushion = box(44, 7, 24, "#7a2f2f");
    cushion.position.set(bowl.x, e, bowl.y + 5);
    g.add(cushion);
    const bronze = mat("#caa44a", { side: THREE.DoubleSide });
    const b = new THREE.Mesh(new THREE.CylinderGeometry(19, 12, 12, 12, 1, true), bronze);
    b.position.set(bowl.x, e + 13, bowl.y + 4);
    b.castShadow = true;
    const inner = cyl(12, 12, 0.6, 12, "#8a6e2c");
    inner.position.set(bowl.x, e + 7.4, bowl.y + 4);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(19, 1.2, 4, 16), mat("#e0bc62"));
    lip.rotation.x = Math.PI / 2;
    lip.position.set(bowl.x, e + 19, bowl.y + 4);
    const mallet = cyl(1.6, 1.6, 26, 5, "#5a3a20");
    mallet.rotation.set(Math.PI / 2, 0, 0.9);
    mallet.position.set(bowl.x + 30, e + 3, bowl.y + 12);
    g.add(b, inner, lip, mallet);
    // the hum: a golden ring breathing outward + a warm glow
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.03, 3, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: hex("#ffe096"), transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    ring.position.set(bowl.x, e + 18, bowl.y + 4);
    const glow = halo(90, "#ffd070", 0.2);
    glow.position.set(bowl.x, e + 22, bowl.y + 4);
    g.add(ring, glow);
    const pool = glowPool(bowl.x, bowl.y + 4, 80, "#ffcf70", 0.12);
    g.add(pool);
    anim.push((f) => {
      const hum = 0.5 + 0.5 * Math.sin(f.t / 1.6);
      const r = 24 + hum * 12;
      ring.scale.set(r, 1, r);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.12 + hum * 0.3;
      (glow.material as THREE.SpriteMaterial).opacity = 0.12 + hum * 0.16;
      (pool.material as THREE.MeshBasicMaterial).opacity = 0.08 + hum * 0.08;
    });
  }

  /* ---------------- potted ferns (the solids) */
  plants.forEach((p, i) => {
    const e = elev(p.x, p.y);
    const pot = cyl(10, 8, 16, 7, "#3a2817");
    pot.position.set(p.x, e, p.y + 2);
    const soil = cyl(9, 9, 1, 7, "#1e160c");
    soil.position.set(p.x, e + 15.5, p.y + 2);
    g.add(pot, soil);
    for (let f = 0; f < 12; f++) {
      const a = (f / 12) * Math.PI * 2 + i;
      const frond = cone(4, 38 + (f % 3) * 7, 3, f % 2 ? "#5b7d3f" : "#6f944c");
      frond.scale.z = 0.35;
      frond.position.set(p.x, e + 15, p.y + 2);
      frond.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
      g.add(frond);
    }
  });

  /* ---------------- a paper lantern hung low over the table */
  {
    const lx = tbl.x + tbl.w / 2;
    const lz = tbl.y + tbl.h / 2 - 20;
    const lantern = cyl(11, 11, 22, 8, ownMat("#f4e2c0", { emissive: "#ffcf8a", glow: 0.7 }));
    lantern.position.set(lx, 128, lz);
    lantern.castShadow = false;
    const capT = cyl(6, 9, 3, 8, "#2a1d10");
    capT.position.set(lx, 150, lz);
    const cord = cyl(0.6, 0.6, 30, 3, "#140c06");
    cord.position.set(lx, 153, lz);
    const h = halo(120, "#ffd9a0", 0.35);
    h.position.set(lx, 139, lz);
    const l = lamp("#ffd6a0", 1.4, 420);
    l.position.set(lx, 120, lz);
    g.add(lantern, capT, cord, h, l);
  }
  // shoji daylight + the bowl corner — the other two lamps
  const back = lamp("#ffe8c4", 0.9, 520);
  back.position.set(ROOM.w / 2, 90, WALL + 60);
  const corner = lamp("#ffcf80", 0.6, 240);
  corner.position.set(bowl.x, 50, bowl.y + 20);
  g.add(back, corner);

  /* ---------------- stillness: a few motes floating in the lamp light */
  const DUST = 26;
  const dust = motes(DUST, "#ffe9c0", 4, 0.45);
  const dp = Array.from({ length: DUST }, () => [WALL + R() * (ROOM.w - 2 * WALL), R() * 130, WALL + R() * (ROOM.h - 2 * WALL), 1.5 + R() * 2.5]);
  g.add(dust);
  anim.push((f) => {
    const p = dust.geometry.attributes.position as THREE.BufferAttribute;
    dp.forEach((d, i) => {
      d[1] += d[3] * f.dt;
      if (d[1] > 140) d[1] = 0;
      p.setXYZ(i, d[0] + Math.sin(f.t * 0.2 + i) * 8, d[1], d[2]);
    });
    p.needsUpdate = true;
    paperM.emissiveIntensity = 0.52 + 0.04 * Math.sin(f.t * 0.4);
  });

  return {
    group: g,
    bg: "#0c0b07",
    light: { sky: "#ffe6c0", ground: "#2a2014", hemi: 1.05, key: "#fff0d8", keyI: 1.0 },
    floorAt: elev,
    update: (f) => anim.forEach((a) => a(f)),
  };
};
