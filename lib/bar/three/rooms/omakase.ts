import * as THREE from "three";
import { ROOM, WALL, OMAKASE } from "../../layout";
import type { FrameInfo, RoomBuilder } from "../types";
import { shell } from "../shared";
import { box, block, cyl, cone, mat, ownMat, glowMat, glowPool, halo, lamp, panel, shade, rng } from "../kit";

// OMAKASE — the selector's counter. Dark polished wood, indigo noren strung along
// the back wall, one long blonde-wood counter with a lit glass neta case of record
// sleeves on it, a pendant spot over every stool. Precise, hushed, warm.

const { counter: c, stools } = OMAKASE;
const TOP = 44; // counter height

export const buildOmakase: RoomBuilder = ({ room }) => {
  const g = new THREE.Group();
  const anim: ((f: FrameInfo) => void)[] = [];
  const R = rng(31);

  /* ---------------- floor: dark polished planks (a tighter grain than the kissa) */
  for (let y = 0, i = 0; y < ROOM.h; y += 40, i++) {
    let x = -((i * 173) % 300);
    while (x < ROOM.w) {
      const len = 300 + R() * 220;
      const a = Math.max(0, x);
      const b = Math.min(ROOM.w, x + len);
      if (b - a > 4) {
        const tone = i % 2 ? "#2a1f15" : "#241a12";
        const p = block({ x: a + 1, y: y + 1, w: b - a - 2, h: 38 }, 3, shade(tone, (R() - 0.5) * 8), -3);
        p.castShadow = false;
        g.add(p);
      }
      x += len;
    }
  }
  const under = box(ROOM.w, 3, ROOM.h, "#0e0906");
  under.position.set(ROOM.w / 2, -6, ROOM.h / 2);
  under.castShadow = false;
  g.add(under);

  /* ---------------- walls: warm dark plaster */
  g.add(shell(room.doors, { floor: false, wall: "#1c140d", trim: "#120c07" }));

  /* ---------------- indigo noren strung across the back wall (the signature) */
  const rod = cyl(1.6, 1.6, 8 * 116, 5, "#3a2a1a");
  rod.rotation.z = Math.PI / 2; // bottom-pivoted, so it now extends toward −x
  rod.position.set(120 + 8 * 116 - 12, 131, WALL + 4);
  g.add(rod);
  for (let i = 0; i < 8; i++) {
    const x = 120 + i * 116 + 46;
    const cloth = box(92, 62, 2, i % 2 ? "#2e4476" : "#38528a");
    cloth.position.set(x, 68, WALL + 4);
    cloth.castShadow = false;
    g.add(cloth);
    // a dark split up the middle, like a real noren
    const split = box(2.2, 40, 2.4, "#1c140d");
    split.position.set(x, 68, WALL + 4.2);
    split.castShadow = false;
    g.add(split);
    anim.push((f) => {
      cloth.rotation.x = Math.sin(f.t * 0.9 + i * 0.8) * 0.03;
    });
  }
  const omakaseText = panel(160, 40, (ctx, w, h) => {
    ctx.fillStyle = "rgba(241,230,210,.92)";
    ctx.font = "800 24px 'Shippori Mincho',serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("おまかせ", w / 2, h / 2);
  }, 110);
  omakaseText.position.set(ROOM.w / 2, 100, WALL + 8); // hung just proud of the middle noren
  g.add(omakaseText);

  /* ---------------- precise light: a wash on the counter + a spot over every seat */
  g.add(glowPool(c.x + c.w / 2, c.y + 26, 380, "#ffd496", 0.14));
  for (const s of stools) g.add(glowPool(s.x, s.y - 26, 70, "#ffce8c", 0.26));

  /* ---------------- the blonde counter (the one solid back-fixture) */
  g.add(block(c, TOP - 5, "#b98e56"));
  // a slightly overhanging top slab + the lifted front edge that catches the light
  g.add(block({ x: c.x - 6, y: c.y - 4, w: c.w + 12, h: c.h + 10 }, 5, "#d8b27a", TOP - 5));
  const lip = block({ x: c.x - 6, y: c.y + c.h + 3, w: c.w + 12, h: 3 }, 7, "#e8c48c", TOP - 7);
  lip.castShadow = false;
  g.add(lip);
  // grain strips on the front face
  for (let gx = c.x + 30; gx < c.x + c.w; gx += 46) {
    const s = box(1.2, TOP - 12, 0.6, "#8a6436");
    s.position.set(gx, 4, c.y + c.h + 0.4);
    s.castShadow = false;
    g.add(s);
  }
  // a dark kick-plinth so the counter sits on the floor
  g.add(block({ x: c.x + 6, y: c.y + c.h - 6, w: c.w - 12, h: 6 }, 6, "#3a2a1a"));

  /* ---------------- the glass neta case: a lit display of standing sleeves */
  const caseX = c.x + 28;
  const caseW = c.w - 56;
  const caseD = 26;
  const caseH = 30;
  const caseZ = c.y + 2; // back half of the counter top
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(caseW, caseH, caseD),
    new THREE.MeshLambertMaterial({ color: new THREE.Color("#78a5cd"), transparent: true, opacity: 0.16, depthWrite: false })
  );
  glass.position.set(caseX + caseW / 2, TOP + caseH / 2, caseZ + caseD / 2);
  glass.renderOrder = 3;
  g.add(glass);
  const glassEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(caseW, caseH, caseD)),
    new THREE.LineBasicMaterial({ color: 0xb4d4f0, transparent: true, opacity: 0.55 })
  );
  glassEdges.position.copy(glass.position);
  g.add(glassEdges);
  const sleeveW = (caseW - 24) / 18 - 2;
  for (let i = 0; i < 18; i++) {
    const col = i % 3 === 0 ? "#5a86a8" : i % 3 === 1 ? "#caa06a" : "#9bb36b";
    const sl = box(sleeveW, 22, 2, ownMat(col, { emissive: col, glow: 0.18 }));
    sl.position.set(caseX + 12 + i * ((caseW - 24) / 18) + sleeveW / 2, TOP + 2, caseZ + caseD / 2);
    sl.rotation.x = -0.12;
    sl.rotation.z = -0.06;
    g.add(sl);
  }
  // the soft indigo glow line tracing the glass (breathes slowly)
  const glowLineM = glowMat("#7aa8d8", 0.8, true);
  const glowLine = box(caseW, 1.6, 1.6, glowLineM);
  glowLine.castShadow = false;
  glowLine.position.set(caseX + caseW / 2, TOP + caseH, caseZ + caseD);
  const caseHalo = halo(caseW, "#5a86a8", 0.16);
  caseHalo.scale.set(caseW * 1.15, 70, 1);
  caseHalo.position.set(caseX + caseW / 2, TOP + caseH / 2, caseZ + caseD / 2);
  g.add(glowLine, caseHalo);
  anim.push((f) => {
    const b = 0.5 + 0.5 * Math.sin(f.t / 0.7);
    glowLineM.opacity = 0.55 + 0.4 * b;
    (caseHalo.material as THREE.SpriteMaterial).opacity = 0.1 + 0.08 * b;
  });

  // a place setting in front of each seat: a hinoki tray with one chosen record
  stools.forEach((s, i) => {
    const z = c.y + c.h - 4;
    const tray = box(34, 3, 16, "#e0c08a");
    tray.position.set(s.x, TOP, z);
    const rec = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 1.2, 14), mat("#0c0c0e"));
    rec.position.set(s.x - 5, TOP + 3.6, z);
    const lab = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 1.4, 8), mat(["#5a86a8", "#caa06a", "#9bb36b"][i % 3]));
    lab.position.set(s.x - 5, TOP + 3.8, z);
    const cup = cyl(3.6, 2.8, 5, 7, "#e8ddcb");
    cup.position.set(s.x + 10, TOP + 3, z);
    g.add(tray, rec, lab, cup);
  });

  /* ---------------- counter stools (passable) */
  for (const s of stools) {
    const foot = cyl(10, 12, 3, 8, "#241a10");
    foot.position.set(s.x, 0, s.y);
    const post = cyl(2.4, 2.4, 22, 6, "#3a2a1a");
    post.position.set(s.x, 3, s.y);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(8, 1, 3, 10), mat("#3a2a1a"));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(s.x, 12, s.y);
    const seat = cyl(12, 11, 5, 10, "#4a3623");
    seat.position.set(s.x, 25, s.y);
    const cushion = cyl(10, 11, 2, 10, "#2c3a5a");
    cushion.position.set(s.x, 30, s.y);
    g.add(foot, post, ring, seat, cushion);
  }

  /* ---------------- pendant spots over every seat */
  const bulbs: THREE.Mesh[] = [];
  stools.forEach((s, i) => {
    const x = s.x;
    const y = c.y + c.h + 14;
    const H = 132;
    const cord = cyl(0.6, 0.6, 30, 3, "#0e0906");
    cord.position.set(x, H + 10, y);
    const shadeM = cone(11, 14, 8, "#caa06a");
    shadeM.position.set(x, H - 4, y);
    const bulb = new THREE.Mesh(new THREE.IcosahedronGeometry(4.2, 0), ownMat("#fff0d0", { emissive: "#ffd89a", glow: 1 }));
    bulb.position.set(x, H - 5, y);
    const h = halo(70, "#ffcf8a", 0.32);
    h.position.set(x, H - 8, y);
    g.add(cord, shadeM, bulb, h);
    bulbs.push(bulb);
    if (i === 1 || i === 3) {
      const l = lamp("#ffcf90", 1.2, 380);
      l.position.set(x, H - 20, y + 20);
      g.add(l);
    }
  });
  anim.push((f) => {
    bulbs.forEach((b, i) => {
      (b.material as THREE.MeshLambertMaterial).emissiveIntensity = 0.9 + 0.05 * Math.sin(f.t * 1.3 + i);
    });
  });

  /* ---------------- name plate, inlaid in the floor below the seats */
  const plate = panel(420, 44, (ctx, w, h) => {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "800 26px 'Shippori Mincho',serif";
    ctx.fillStyle = "rgba(233,217,189,.55)";
    ctx.fillText("御任せ · OMAKASE", w / 2, h / 2 + 1);
  }, 300, 3, true);
  plate.rotation.x = -Math.PI / 2;
  plate.position.set(ROOM.w / 2, 0.6, 640);
  g.add(plate);

  return {
    group: g,
    bg: "#0b0908",
    light: { sky: "#ffe2bc", ground: "#2a1a10", hemi: 0.85, key: "#ffe0b8", keyI: 1.0 },
    update: (f) => anim.forEach((a) => a(f)),
  };
};
