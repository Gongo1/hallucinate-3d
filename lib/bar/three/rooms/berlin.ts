import * as THREE from "three";
import { ROOM, WALL, BERLIN } from "../../layout";
import type { FrameInfo, RoomBuilder } from "../types";
import { shell } from "../shared";
import { box, block, cyl, mat, ownMat, glowMat, glowPool, halo, lamp, panel, shade, rng } from "../kit";

// BERLIN — the Panorama-Bar room. Raw concrete + steel, cavernous and dim, low fog
// creeping over the floor, one sweeping strobe beam from the booth with a hard
// white stutter a couple of times a bar, and a hint of red. DELIBERATELY breaks the
// Japanese palette (a different world). Cold + charged; the music stays house.

const { booth: b, pillars } = BERLIN;
const WALL_TALL = 176;
const BOOTH_H = 46;
const BEAM_LEN = 560;
// columns stop short of the dark above (a full-height slab near the camera would
// wall off the dancefloor behind it)
const PILLAR_H = 112;

export const buildBerlin: RoomBuilder = ({ room }) => {
  const g = new THREE.Group();
  const anim: ((f: FrameInfo) => void)[] = [];
  const R = rng(19);

  /* ---------------- floor: raw concrete slabs with expansion joints (every 190) */
  const joint = box(ROOM.w, 3, ROOM.h, "#050506");
  joint.position.set(ROOM.w / 2, -6, ROOM.h / 2);
  joint.castShadow = false;
  g.add(joint);
  for (let x = 0; x < ROOM.w; x += 190)
    for (let y = 0; y < ROOM.h; y += 190) {
      const w = Math.min(190, ROOM.w - x);
      const h = Math.min(190, ROOM.h - y);
      const slab = block({ x: x + 1.5, y: y + 1.5, w: w - 3, h: h - 3 }, 3, shade("#141417", (R() - 0.5) * 8), -3);
      slab.castShadow = false;
      g.add(slab);
    }

  /* ---------------- walls: tall concrete */
  g.add(shell(room.doors, { floor: false, wall: "#202024", trim: "#16161a", height: WALL_TALL }));
  // formwork seams on the back wall — the poured-concrete tell
  for (let x = 120; x < ROOM.w; x += 180) {
    const seam = box(2, WALL_TALL - 6, 1, "#17171b");
    seam.position.set(x, 0, WALL + 0.5);
    seam.castShadow = false;
    g.add(seam);
  }
  for (const y of [58, 118]) {
    const seam = box(ROOM.w - 2 * WALL, 1.6, 1, "#17171b");
    seam.position.set(ROOM.w / 2, y, WALL + 0.5);
    seam.castShadow = false;
    g.add(seam);
  }

  /* ---------------- the hint of red bleeding from the booth wall */
  g.add(glowPool(ROOM.w / 2, 180, 460, "#be281e", 0.13));
  const redLamp = lamp("#e0332a", 0.9, 560);
  redLamp.position.set(ROOM.w / 2, 90, b.y + b.h + 20);
  g.add(redLamp);

  /* ---------------- concrete pillars (the collision footprints: 28×80) */
  const pillarM = mat("#2c2c31");
  const capM = mat("#34343a");
  for (const p of pillars) {
    g.add(block({ x: p.x - 14, y: p.y - 40, w: 28, h: 80 }, PILLAR_H, pillarM));
    g.add(block({ x: p.x - 18, y: p.y - 44, w: 36, h: 88 }, 8, capM, PILLAR_H));
    g.add(block({ x: p.x - 17, y: p.y - 43, w: 34, h: 86 }, 6, capM));
    // the lit edge (left face catches the booth side light) + formwork bands
    const edge = box(1, PILLAR_H - 8, 78, "#3c3c43");
    edge.position.set(p.x - 14.4, 6, p.y);
    edge.castShadow = false;
    g.add(edge);
    for (const y of [40, 80]) {
      const band = block({ x: p.x - 14.5, y: p.y - 40.5, w: 29, h: 81 }, 1.4, "#232327", y);
      band.castShadow = false;
      g.add(band);
    }
    // a scrap of paste-up poster on the room-facing side
    const poster = box(18, 26, 0.8, ["#b0444a", "#d8d2c8", "#3a3a42", "#e0433a"][(p.x + p.y) % 4]);
    poster.position.set(p.x + ((p.x * 7) % 5) - 2, 56, p.y + 40.5);
    poster.rotation.z = ((p.y % 3) - 1) * 0.06;
    poster.castShadow = false;
    g.add(poster);
  }

  /* ---------------- the DJ booth on the far wall (steel + two red CDJ glints) */
  g.add(block(b, BOOTH_H - 4, "#26262b"));
  g.add(block({ x: b.x - 4, y: b.y - 4, w: b.w + 8, h: b.h + 8 }, 4, "#3a3a42", BOOTH_H - 4));
  // steel ribs on the front face + a red LED strip along its foot
  for (let i = 1; i < 5; i++) {
    const rib = box(b.w, 1.6, 1.2, "#34343b");
    rib.position.set(b.x + b.w / 2, i * 8, b.y + b.h + 0.6);
    rib.castShadow = false;
    g.add(rib);
  }
  const ledM = glowMat("#e0433a", 0.9);
  const led = box(b.w - 8, 2, 2, ledM);
  led.castShadow = false;
  led.position.set(b.x + b.w / 2, 1.5, b.y + b.h + 2);
  g.add(led);
  const glints: THREE.Mesh[] = [];
  const jogs: THREE.Mesh[] = [];
  for (const dx of [b.x + 56, b.x + b.w - 56]) {
    const unit = block({ x: dx - 24, y: b.y + 18, w: 48, h: 50 }, 7, "#141418", BOOTH_H);
    const jog = new THREE.Mesh(new THREE.CylinderGeometry(18, 18, 3, 16), mat("#0c0c0e"));
    jog.position.set(dx, BOOTH_H + 8.5, b.y + 44);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(18, 1, 3, 16), mat("#3a3a42"));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(dx, BOOTH_H + 10, b.y + 44);
    const glint = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 3.6, 8), ownMat("#5a2420", { emissive: "#e0433a", glow: 0 }));
    glint.position.set(dx, BOOTH_H + 8.6, b.y + 44);
    const screen = box(26, 1, 8, glowMat("#3a6ad6", 0.8));
    screen.position.set(dx, BOOTH_H + 7, b.y + 24);
    g.add(unit, jog, ring, glint, screen);
    glints.push(glint);
    jogs.push(jog);
  }
  // the mixer between them — a row of meter LEDs that bounce with the beat
  g.add(block({ x: b.x + b.w / 2 - 20, y: b.y + 16, w: 40, h: 50 }, 8, "#101014", BOOTH_H));
  const meters: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const m = box(3, 1, 18, glowMat(i < 2 ? "#5ee87a" : "#e0433a", 0.9));
    m.castShadow = false;
    m.position.set(b.x + b.w / 2 - 12 + i * 8, BOOTH_H + 8.2, b.y + 36);
    g.add(m);
    meters.push(m);
  }

  /* ---------------- flown speaker arrays either side, hung above head height */
  for (const sx of [b.x - 110, b.x + b.w + 110]) {
    for (let k = 0; k < 3; k++) {
      const cab = box(64, 22, 26, "#1a1a1e");
      cab.position.set(sx, 150 - k * 23, WALL + 16 + k * 3);
      cab.rotation.x = 0.12 + k * 0.08;
      const grille = box(58, 16, 1, "#0a0a0c");
      grille.position.set(sx, 153 - k * 23, WALL + 29.5 + k * 5);
      grille.rotation.x = 0.12 + k * 0.08;
      grille.castShadow = false;
      g.add(cab, grille);
    }
    const chain = cyl(0.8, 0.8, 30, 3, "#101012");
    chain.position.set(sx, 170, WALL + 16);
    g.add(chain);
  }

  /* ---------------- a steel truss over the booth with four small heads */
  const truss = box(b.w + 120, 6, 6, "#3a3a42");
  truss.position.set(ROOM.w / 2, 156, WALL + 44);
  g.add(truss);
  const truss2 = box(b.w + 120, 6, 6, "#3a3a42");
  truss2.position.set(ROOM.w / 2, 156, WALL + 60);
  g.add(truss2);
  const heads: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const hx = ROOM.w / 2 - 105 + i * 70;
    const yoke = box(10, 10, 10, "#1e1e22");
    yoke.position.set(hx, 142, WALL + 52);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 2, 8), glowMat(i % 2 ? "#ffffff" : "#e0433a", 0.3));
    lens.rotation.x = Math.PI / 2 - 0.6;
    lens.position.set(hx, 145, WALL + 58);
    g.add(yoke, lens);
    heads.push(lens);
  }

  /* ---------------- the red neon room sign on the back wall */
  const sign = panel(320, 90, (ctx, w) => {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "900 46px 'Anton',sans-serif";
    ctx.shadowColor = "rgba(224,60,52,.95)";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "#ff5a50";
    ctx.fillText("BERLIN", w / 2, 36);
    ctx.shadowBlur = 0;
    ctx.font = "12px 'DM Mono'";
    ctx.fillStyle = "rgba(240,140,134,.85)";
    ctx.fillText("地下 · NO PHOTOS · HOUSE ONLY", w / 2, 74);
  }, 240);
  sign.position.set(ROOM.w / 2, 96, WALL + 1.5);
  const signGlow = halo(300, "#e0433a", 0.3);
  signGlow.scale.set(320, 120, 1);
  signGlow.position.set(ROOM.w / 2, 100, WALL + 8);
  g.add(sign, signGlow);

  /* ---------------- the single sweeping strobe beam from the booth */
  const beamGeo = new THREE.ConeGeometry(150, BEAM_LEN, 20, 1, true);
  beamGeo.translate(0, -BEAM_LEN / 2, 0); // apex at the origin, opening down −Y
  const beamM = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uI: { value: 0.07 }, uColor: { value: new THREE.Color("#dce6ff") } },
    vertexShader: `
      varying float vK; varying vec3 vN; varying vec3 vV;
      void main() {
        vK = -position.y / ${BEAM_LEN.toFixed(1)};
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vK; varying vec3 vN; varying vec3 vV;
      uniform float uI; uniform vec3 uColor;
      void main() {
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.4);
        float a = uI * (1.0 - vK) * edge;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
  });
  const beam = new THREE.Mesh(beamGeo, beamM);
  beam.renderOrder = 4;
  const pivot = new THREE.Vector3(ROOM.w / 2, 150, WALL + 56);
  beam.position.copy(pivot);
  g.add(beam);
  const spot = glowPool(ROOM.w / 2, 500, 150, "#dce6ff", 0.1);
  g.add(spot);
  const flashLamp = lamp("#ffffff", 0, 1500);
  flashLamp.position.set(ROOM.w / 2, 300, 440);
  g.add(flashLamp);
  const down = new THREE.Vector3(0, -1, 0);
  const aim = new THREE.Vector3();

  /* ---------------- low fog creeping across the floor */
  const FOG = 9;
  const fogs = Array.from({ length: FOG }, (_, i) => {
    const s = halo(380, "#78849c", 0.09);
    s.scale.set(380, 130, 1);
    g.add(s);
    return { s, i, y: 340 + (i % 5) * 80 };
  });

  anim.push((f) => {
    const now = f.t;
    const beat = f.playing ? Math.pow(1 - ((now * 2) % 1), 2.2) : 0;

    // beam sweep (radians off straight-down-the-room)
    const sweep = Math.sin(now / 1.4) * 0.9;
    const tx = ROOM.w / 2 + Math.sin(sweep) * 430;
    const tz = b.y + b.h + Math.cos(sweep) * 430;
    aim.set(tx, 0, tz).sub(pivot).normalize();
    beam.quaternion.setFromUnitVectors(down, aim);
    beamM.uniforms.uI.value = f.playing ? 0.2 : 0.09;
    spot.position.set(tx, 0.9, tz);
    (spot.material as THREE.MeshBasicMaterial).opacity = f.playing ? 0.22 : 0.1;

    // the hard white stutter-flash (simulated — the iframe audio isn't readable)
    const flash = f.playing ? Math.pow(Math.max(0, Math.sin(now / 0.47)), 22) : 0;
    flashLamp.intensity = flash > 0.02 ? flash * 5 : 0;

    // CDJ glints + jog spin, meters, LED strip, truss heads
    for (const gl of glints) (gl.material as THREE.MeshLambertMaterial).emissiveIntensity = f.playing ? 1 : 0.15;
    if (f.playing) for (const j of jogs) j.rotation.y -= f.dt * 3;
    meters.forEach((m, i) => {
      const lv = f.playing ? 0.3 + beat * (0.7 - (i % 2) * 0.2) : 0.15;
      m.scale.z = lv;
    });
    ledM.opacity = 0.5 + 0.4 * (f.playing ? beat : 0.3);
    heads.forEach((h, i) => {
      (h.material as THREE.MeshBasicMaterial).opacity = f.playing ? 0.25 + (((now * 2 + i * 0.25) % 1) < 0.25 ? 0.75 : 0) : 0.25;
    });

    // neon breath + the red bleed
    const neon = 0.5 + 0.5 * Math.sin(now / 0.3);
    (signGlow.material as THREE.SpriteMaterial).opacity = 0.22 + 0.12 * neon;
    redLamp.intensity = 0.7 + 0.2 * neon + beat * 0.4;

    // fog drifts left → right, bobbing
    for (const fg of fogs) {
      const fx = ((fg.i * 251 + now * 18) % (ROOM.w + 360)) - 180;
      const fy = fg.y + Math.sin(now / 2.1 + fg.i * 1.7) * 36;
      fg.s.position.set(fx, 16, fy);
    }
  });

  return {
    group: g,
    bg: "#070708",
    fog: { color: "#070708", near: 1000, far: 2700 },
    light: { sky: "#9aa4c0", ground: "#141416", hemi: 0.85, key: "#c4cce8", keyI: 0.75, keyFrom: [0.35, 1, 0.5] },
    dancers: true,
    update: (f) => anim.forEach((a) => a(f)),
  };
};
