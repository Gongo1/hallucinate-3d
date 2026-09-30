import * as THREE from "three";
import type { Fit } from "../fits";
import { mat, ownMat, shade, radialTexture, labelTexture } from "./kit";

// A stylized low-poly listener: chunky faceted head, tapered torso, swinging
// limbs. Built from a Fit (skin / outfit / hair / hat) so the same look shows in
// the room, over presence, and in the fit preview. Proportions are chibi (big
// head, short legs) so faces read from the tilted overhead camera.
//
// The rig is a plain Object3D hierarchy (no skinning) — hips → torso → head, with
// shoulder / hip pivots for the limbs — animated procedurally in update().

// rig dimensions in world px (a standing listener is ~56px tall)
const LEG = 14;
const HIP_Y = LEG + 2;
const TORSO = 17;
const SHOULDER_Y = TORSO - 2;
const HEAD_R = 10.5;
/** the whole rig is modelled at 1× then scaled up so faces read from the camera */
export const CHAR_SCALE = 1.5;

export type Pose = "walk" | "idle" | "sit" | "dance";

// DANCE MOVES — a one-shot, two-bar house move on the 💃 button. Procedural (no
// animation files): each move is a pose function of time on the room's ~120bpm
// beat. Names + feel from the house dance vocabulary (frague.at/house-move-list).
export const DANCE_MOVES = ["jack", "heeltoe", "shuffle", "crisscross", "stomp", "looselegs", "skate"] as const;
export type DanceMove = (typeof DANCE_MOVES)[number];
export const DANCE_NAMES: Record<DanceMove, string> = {
  jack: "Jack in the Box",
  heeltoe: "Heel Toe",
  shuffle: "Shuffle",
  crisscross: "Criss Cross",
  stomp: "Stomp",
  looselegs: "Loose Legs",
  skate: "The Skate",
};
/** a move lasts two bars at ~120bpm */
export const DANCE_SECONDS = 4;

interface DancePose {
  lx: number; lz: number; ly: number; // left leg (forward/back, out/in, swivel)
  rx: number; rz: number; ry: number; // right leg
  alx: number; alz: number; // left arm (forward/back, out/in)
  arx: number; arz: number; // right arm
  bx: number; by: number; // body slide + bounce
  brx: number; brz: number; bry: number; // body lean / tilt / twist
  hx: number; hz: number; // head nod / tilt
}

function dancePose(move: DanceMove, t: number): DancePose {
  const bt = t * 2; // beats (~120bpm, the same clock the room nods to)
  const n = Math.floor(bt);
  const b = bt - n;
  const s = n % 2 ? 1 : -1; // alternating side each beat
  const pulse = Math.sin(Math.PI * b); // 0 → 1 → 0 across each beat
  const p: DancePose = { lx: 0, lz: 0, ly: 0, rx: 0, rz: 0, ry: 0, alx: -0.2, alz: -0.2, arx: -0.2, arz: 0.2, bx: 0, by: 0, brx: 0, brz: 0, bry: 0, hx: 0.15 * pulse, hz: 0 };
  switch (move) {
    case "jack": // the torso jacks forward on every beat, knees loose, head down
      p.brx = 0.28 * pulse;
      p.by = 1.4 * pulse;
      p.hx = 0.28 * pulse;
      p.lx = p.rx = -0.12 * pulse;
      p.alx = p.arx = -0.5 - 0.35 * pulse;
      p.alz = -0.35;
      p.arz = 0.35;
      break;
    case "heeltoe": { // feet swivel heel-toe, travelling side to side, arms out
      const side = Math.sin((Math.PI * bt) / 2);
      p.ly = p.ry = 0.55 * side;
      p.bx = 4 * side;
      p.brz = -0.08 * side;
      p.alz = -0.95 - 0.2 * pulse;
      p.arz = 0.95 + 0.2 * pulse;
      p.by = pulse;
      p.hz = 0.1 * side;
      break;
    }
    case "shuffle": // alternating kicks with a little hop, arms pumping
      if (s > 0) {
        p.lx = -0.9 * pulse;
        p.rx = 0.25 * pulse;
      } else {
        p.rx = -0.9 * pulse;
        p.lx = 0.25 * pulse;
      }
      p.by = 2.6 * pulse;
      p.brx = 0.12;
      p.alx = -0.4 + 0.7 * s * pulse;
      p.arx = -0.4 - 0.7 * s * pulse;
      break;
    case "crisscross": { // legs cross + open on alternate beats, arms cross in front
      const cr = 0.5 - 0.5 * Math.cos(Math.PI * bt);
      p.lz = 0.35 * cr - 0.25 * (1 - cr);
      p.rz = -p.lz;
      p.alx = p.arx = -0.9;
      p.alz = 0.6 * cr - 0.5 * (1 - cr);
      p.arz = -p.alz;
      p.by = 2 * pulse;
      break;
    }
    case "stomp": { // lift high, slam down — arms come down with it
      const lift = Math.pow(pulse, 0.6);
      if (s > 0) {
        p.lx = -1.1 * lift;
        p.lz = -0.25 * lift;
      } else {
        p.rx = -1.1 * lift;
        p.rz = 0.25 * lift;
      }
      p.alx = p.arx = 0.3 - 1.6 * lift;
      p.brx = 0.25 * (1 - lift);
      p.by = 2 * lift;
      break;
    }
    case "looselegs": { // legs flick out sideways, body sways the other way, arms loose
      if (s > 0) p.lz = -0.7 * pulse;
      else p.rz = 0.7 * pulse;
      p.brz = 0.12 * s * pulse;
      p.bx = -2 * s * pulse;
      const wave = Math.sin((Math.PI * bt) / 2);
      p.alx = -0.6 + 0.5 * wave;
      p.arx = -0.6 - 0.5 * wave;
      p.alz = -0.5;
      p.arz = 0.5;
      p.by = 1.5 * pulse;
      p.hz = -0.12 * s * pulse;
      break;
    }
    case "skate": { // glide side to side, leaning in, trailing leg kicked back
      const glide = Math.sin((Math.PI * bt) / 2);
      p.bx = 7 * glide;
      p.brz = -0.2 * glide;
      p.bry = 0.35 * glide;
      p.lx = 0.8 * Math.max(0, glide);
      p.rx = 0.8 * Math.max(0, -glide);
      p.alx = -0.8 * glide;
      p.arx = 0.8 * glide;
      p.alz = -0.3;
      p.arz = 0.3;
      p.by = 1.5 * Math.abs(glide);
      break;
    }
  }
  // a touch bigger than life, so moves read from the camera's distance
  for (const k of ["lx", "lz", "ly", "rx", "rz", "ry", "alx", "alz", "arx", "arz", "brx", "brz", "bry"] as const) p[k] *= 1.2;
  p.by *= 1.4;
  p.bx *= 1.25;
  return p;
}

export interface CharState {
  /** moving this frame (drives the walk cycle) */
  moving: boolean;
  /** heading in radians around +Y (0 = facing the camera / +Z) — or null to keep */
  yaw: number | null;
  sitting?: boolean;
  /** dancer: bounces + arm pumps when standing still (Berlin / warehouse floor) */
  dancer?: boolean;
  /** music is playing — idle listeners nod along to the (simulated) beat */
  playing: boolean;
  /** 0..1 walk speed scale (joystick tilt) */
  speed?: number;
  /** one arm up, waving hello */
  waving?: boolean;
  /** a one-shot dance move in progress (t = seconds since it started) */
  dance?: { move: DanceMove; t: number };
}

export class Character {
  readonly root = new THREE.Group();
  private body = new THREE.Group(); // bob / lean / bounce
  private torso!: THREE.Mesh;
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private hatGroup = new THREE.Group();
  private gearGroup = new THREE.Group(); // gifted gear on the body (neck / back / top extras)
  private eyesGroup = new THREE.Group(); // gifted eyewear, rides on the head
  private hairMesh: THREE.Mesh | null = null;
  private halo: THREE.Mesh | null = null;
  private shadow: THREE.Mesh;
  private ring: THREE.Mesh | null = null;
  private fitKey = "";

  private phase = Math.random() * 10; // walk-cycle phase
  private seed = Math.random() * 100; // per-character idle offset
  private yaw = 0;
  private walkAmt = 0; // 0 idle → 1 full stride (eased so starts/stops blend)
  private sitAmt = 0;

  constructor(fit: Fit, opts: { player?: boolean } = {}) {
    this.root.add(this.body);
    this.root.scale.setScalar(CHAR_SCALE);

    // contact shadow — a soft dark blob that stays on the floor
    const sg = new THREE.PlaneGeometry(30, 30);
    sg.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(
      sg,
      new THREE.MeshBasicMaterial({
        map: radialTexture(),
        color: 0x000000,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      })
    );
    this.shadow.position.y = 0.6;
    this.shadow.renderOrder = 1;
    this.root.add(this.shadow);

    if (opts.player) {
      // the "that's you" ring (amber, like the 2D engine's player ellipse)
      const rg = new THREE.RingGeometry(15, 17.5, 20);
      rg.rotateX(-Math.PI / 2);
      this.ring = new THREE.Mesh(
        rg,
        new THREE.MeshBasicMaterial({ color: 0xffb35e, transparent: true, opacity: 0.55, depthWrite: false })
      );
      this.ring.position.y = 0.9;
      this.ring.renderOrder = 2;
      this.root.add(this.ring);
    }
    this.setFit(fit);
  }

  /** Rebuild the look (cheap — a few dozen faces). No-op if the fit is unchanged. */
  setFit(fit: Fit) {
    const key = `${fit.skin}|${fit.body}|${fit.hair}|${fit.hat}|${fit.top}|${fit.neck}|${fit.eyes}|${fit.back}`;
    if (key === this.fitKey) return;
    this.fitKey = key;
    // drop the old parts (geometries are per-character; materials are cached)
    for (const g of [this.legL, this.legR, this.armL, this.armR, this.head, this.hatGroup, this.gearGroup, this.eyesGroup]) {
      g.traverse((o) => {
        const me = o as THREE.Mesh;
        me.geometry?.dispose();
        const m = me.material as THREE.Material | undefined;
        if (m && !m.userData?.cached) m.dispose();
      });
      g.clear();
    }
    if (this.torso) {
      this.torso.geometry.dispose();
      this.body.remove(this.torso);
    }
    this.halo = null;
    this.hairMesh = null;

    const skin = mat(fit.skin);
    // the top decides the torso + sleeve colour: the Sombra tee is black, the haori
    // wraps the torso in indigo (sleeves too), everything else wears the outfit colour
    const top = fit.top ?? "basic";
    const outfit = mat(top === "sombra-tee" ? "#1c1916" : fit.body);
    const sleeveM = top === "haori" ? mat("#2c3a5a") : top === "hoodie" ? mat(shade(fit.body, -18)) : outfit;
    const pants = mat(shade(fit.body, -70));
    const shoe = mat("#1e1814");
    const hair = mat(fit.hair);

    // ---- legs: hip pivots, tapered 5-sided shins, blocky shoes
    for (const [leg, side] of [[this.legL, -1], [this.legR, 1]] as const) {
      leg.position.set(side * 3.6, HIP_Y, 0);
      const lg = new THREE.CylinderGeometry(2.9, 2.3, LEG, 5);
      lg.translate(0, -LEG / 2, 0);
      const shin = new THREE.Mesh(lg, pants);
      shin.castShadow = true;
      const sg = new THREE.BoxGeometry(5, 3, 7.5);
      sg.translate(0, -LEG - 0.5, 1.4);
      const foot = new THREE.Mesh(sg, shoe);
      foot.castShadow = true;
      leg.add(shin, foot);
      this.body.add(leg);
    }

    // ---- torso: a 6-sided frustum, shoulders wider than hips, a collar ring
    const tg = new THREE.CylinderGeometry(8.2, 6.4, TORSO, 6);
    tg.translate(0, TORSO / 2, 0);
    tg.rotateY(Math.PI / 6); // a flat face to the front (so a chest print sits flush)
    this.torso = new THREE.Mesh(tg, outfit);
    this.torso.position.y = HIP_Y - 1;
    this.torso.castShadow = true;
    this.body.add(this.torso);

    // ---- arms: shoulder pivots, sleeve in the outfit colour, faceted hand
    for (const [arm, side] of [[this.armL, -1], [this.armR, 1]] as const) {
      arm.position.set(side * 9.2, HIP_Y - 1 + SHOULDER_Y, 0);
      const ag = new THREE.CylinderGeometry(2.4, 2.0, 11, 5);
      ag.translate(0, -5.5, 0);
      const sleeve = new THREE.Mesh(ag, sleeveM);
      sleeve.castShadow = true;
      const hand = new THREE.Mesh(new THREE.IcosahedronGeometry(2.6, 0), skin);
      hand.position.y = -12.5;
      arm.add(sleeve, hand);
      arm.rotation.z = side * 0.12;
      this.body.add(arm);
    }

    // ---- head: an 80-face icosphere, eyes, a little nose facet, hair cap
    this.head.position.y = HIP_Y - 1 + TORSO + HEAD_R - 1.5;
    const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(HEAD_R, 1), skin);
    skull.castShadow = true;
    this.head.add(skull);
    const eyeM = mat("#1a130d");
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.8, 1), eyeM);
      eye.position.set(side * 3.8, 0.4, HEAD_R - 0.9);
      this.head.add(eye);
      const cheek = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 0.6), mat(shade(fit.skin, -22)));
      cheek.position.set(side * 5.6, -2.6, HEAD_R - 1.9);
      this.head.add(cheek);
    }
    const covers = fit.hat === "beanie" || fit.hat === "cap" || fit.hat === "bucket";
    if (!covers) {
      // a faceted cap of hair over the crown + back, leaving the face open
      const hg = new THREE.SphereGeometry(HEAD_R + 1.1, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.52);
      this.hairMesh = new THREE.Mesh(hg, hair);
      this.hairMesh.rotation.x = -0.42;
      this.hairMesh.position.set(0, 0.6, -0.6);
      this.hairMesh.castShadow = true;
      this.head.add(this.hairMesh);
      // fringe
      const fg = new THREE.BoxGeometry(HEAD_R * 1.5, 2.6, 3);
      const fringe = new THREE.Mesh(fg, hair);
      fringe.position.set(0, HEAD_R * 0.62, HEAD_R * 0.58);
      fringe.rotation.x = 0.5;
      this.head.add(fringe);
    }
    this.buildHat(fit);
    this.head.add(this.hatGroup);
    this.buildGear(fit);
    this.body.add(this.gearGroup);
    this.head.add(this.eyesGroup);
    this.body.add(this.head);
  }

  /** Gifted gear (lib/bar/gifts.ts): the top's extras, neckwear, eyewear, back piece. */
  private buildGear(fit: Fit) {
    const g = this.gearGroup;
    const e = this.eyesGroup;
    const chestY = HIP_Y - 1 + TORSO * 0.62; // print / pendant height
    const neckY = HIP_Y - 1 + TORSO - 1.2;
    const add = (m: THREE.Mesh, to = g) => {
      m.castShadow = true;
      to.add(m);
      return m;
    };
    // ---- tops
    if (fit.top === "sombra-tee") {
      const print = new THREE.Mesh(
        new THREE.PlaneGeometry(7.2, 7.2),
        new THREE.MeshLambertMaterial({ map: sunMoonTexture(), transparent: true, depthWrite: false })
      );
      print.position.set(0, chestY, 6.75);
      print.rotation.x = -0.1;
      g.add(print);
    } else if (fit.top === "haori") {
      // an open-front jacket over the outfit — the gap at the front shows it
      const jg = new THREE.CylinderGeometry(8.9, 7.2, TORSO - 1.5, 6, 1, true, Math.PI * 0.18, Math.PI * 2 - Math.PI * 0.36);
      jg.translate(0, (TORSO - 1.5) / 2, 0);
      const jacket = add(new THREE.Mesh(jg, mat("#2c3a5a", { side: THREE.DoubleSide })));
      jacket.position.y = HIP_Y - 0.5;
      const belt = add(new THREE.Mesh(new THREE.CylinderGeometry(7.3, 7.3, 2, 6), mat("#c0432f")));
      belt.position.y = HIP_Y + 2.5;
    } else if (fit.top === "hoodie") {
      const hood = add(new THREE.Mesh(new THREE.SphereGeometry(7.4, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), mat(shade(fit.body, -30))));
      hood.position.set(0, neckY - 1, -4.6);
      hood.rotation.x = -1.15;
      for (const sx of [-1.8, 1.8]) {
        const cord = add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 5, 0.6), mat("#efe6d6")));
        cord.position.set(sx, neckY - 3.5, 6.9);
      }
      const pocket = add(new THREE.Mesh(new THREE.BoxGeometry(8, 3.4, 0.8), mat(shade(fit.body, -24))));
      pocket.position.set(0, HIP_Y + 3.5, 6.6);
    }
    // ---- neck
    const gold = mat("#e8b84a", { emissive: "#b8862e", glow: 0.25 });
    if (fit.neck === "chain" || fit.neck === "record") {
      const chain = add(new THREE.Mesh(new THREE.TorusGeometry(6.2, fit.neck === "chain" ? 0.75 : 0.4, 4, 14), gold));
      chain.rotation.x = Math.PI / 2 - 0.45;
      chain.position.set(0, neckY - 2.2, 1.6);
      if (fit.neck === "record") {
        const disc = add(new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 0.7, 14), gold));
        disc.rotation.x = Math.PI / 2;
        disc.position.set(0, chestY + 0.5, 7.4);
        const hole = add(new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.8, 8), mat("#1a130d")));
        hole.rotation.x = Math.PI / 2;
        hole.position.set(0, chestY + 0.5, 7.5);
      } else {
        const tag = add(new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, 0), gold));
        tag.position.set(0, chestY + 1.2, 7.3);
      }
    } else if (fit.neck === "usb") {
      const lanyard = add(new THREE.Mesh(new THREE.TorusGeometry(6.1, 0.5, 3, 14), mat("#a8352a")));
      lanyard.rotation.x = Math.PI / 2 - 0.55;
      lanyard.position.set(0, neckY - 3, 2.2);
      const stick = add(new THREE.Mesh(new THREE.BoxGeometry(2.8, 4.6, 1.3), mat("#2a2a30")));
      stick.position.set(0, chestY - 0.5, 7.2);
      const tip = add(new THREE.Mesh(new THREE.BoxGeometry(2, 1.6, 1), mat("#c8c8d0")));
      tip.position.set(0, chestY - 3.4, 7.2);
      const led = add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.4), mat("#7ed6a0", { emissive: "#7ed6a0", glow: 0.9 })));
      led.position.set(0, chestY + 0.8, 7.9);
    } else if (fit.neck === "mala") {
      const bead = mat("#8a4a2e");
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const b = add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.95, 0), bead));
        b.position.set(Math.sin(a) * 6.2, neckY - 2 - Math.max(0, Math.cos(a)) * 4.2, Math.cos(a) * 6.2 + 1);
      }
      const tassel = add(new THREE.Mesh(new THREE.ConeGeometry(1.1, 3.2, 5), mat("#c0432f")));
      tassel.position.set(0, chestY - 1.5, 7.4);
    }
    // ---- eyes (ride on the head so they nod along)
    if (fit.eyes === "shades") {
      const dark = mat("#111114");
      for (const side of [-1, 1]) {
        const lens = add(new THREE.Mesh(new THREE.BoxGeometry(4, 2.8, 0.8), dark), e);
        lens.position.set(side * 3.9, 0.6, HEAD_R - 0.1);
        const arm = add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 6), dark), e);
        arm.position.set(side * 6.2, 1.1, HEAD_R - 3.6);
      }
      const bridge = add(new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.7, 0.6), dark), e);
      bridge.position.set(0, 1.4, HEAD_R + 0.1);
    } else if (fit.eyes === "specs") {
      const wire = mat("#c8a060");
      for (const side of [-1, 1]) {
        const ring = add(new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.32, 4, 10), wire), e);
        ring.position.set(side * 3.8, 0.4, HEAD_R + 0.05);
      }
      const bridge = add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.4, 0.4), wire), e);
      bridge.position.set(0, 0.9, HEAD_R + 0.1);
    }
    // ---- back
    if (fit.back === "crate") {
      const wood = mat("#9a7442");
      const crate = add(new THREE.Mesh(new THREE.BoxGeometry(13, 10, 8), wood));
      crate.position.set(0, HIP_Y + 9, -9.5);
      const recs = ["#c0432f", "#1a1410", "#ffb35e", "#56877e"];
      for (let i = 0; i < 4; i++) {
        const r = add(new THREE.Mesh(new THREE.BoxGeometry(9, 9, 0.8), mat(recs[i])));
        r.position.set(0, HIP_Y + 15, -12.5 + i * 2);
        r.rotation.x = 0.12;
      }
      for (const sx of [-4, 4]) {
        const strap = add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 12, 1), mat("#3a2817")));
        strap.position.set(sx, neckY - 5, 5.8);
        strap.rotation.x = -0.2;
      }
    } else if (fit.back === "tote") {
      const bag = add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 10, 9), mat("#e8dcc4")));
      bag.position.set(9.8, HIP_Y + 1, -1.5);
      const mark = new THREE.Mesh(
        new THREE.PlaneGeometry(6, 6),
        new THREE.MeshLambertMaterial({ map: sunMoonTexture("#1c1916"), transparent: true, depthWrite: false })
      );
      mark.position.set(11.05, HIP_Y + 1, -1.5);
      mark.rotation.y = Math.PI / 2;
      g.add(mark);
      const strap = add(new THREE.Mesh(new THREE.BoxGeometry(1, 20, 1), mat("#c9b48a")));
      strap.position.set(3, neckY - 6, 0);
      strap.rotation.z = 0.62;
    } else if (fit.back === "gong") {
      const bronze = mat("#c08a3a", { emissive: "#6a4414", glow: 0.25 });
      const gong = add(new THREE.Mesh(new THREE.CylinderGeometry(7.5, 7.5, 0.9, 16), bronze));
      gong.rotation.x = Math.PI / 2;
      gong.position.set(0, HIP_Y + 10, -8.2);
      const boss = add(new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 1.4, 10), bronze));
      boss.rotation.x = Math.PI / 2;
      boss.position.set(0, HIP_Y + 10, -8.9);
      const rim = add(new THREE.Mesh(new THREE.TorusGeometry(7.6, 0.6, 4, 16), mat("#3a2817")));
      rim.position.set(0, HIP_Y + 10, -8.2);
      const cord = add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 14, 0.8), mat("#3a2817")));
      cord.position.set(-4, neckY - 5, 5.6);
      cord.rotation.z = -0.35;
    }
  }

  private buildHat(fit: Fit) {
    const g = this.hatGroup;
    switch (fit.hat) {
      case "cap": {
        const m = mat(fit.body); // matches the outfit
        const dome = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R + 0.9, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.5), m);
        dome.position.y = 1.2;
        dome.castShadow = true;
        const brim = new THREE.Mesh(new THREE.BoxGeometry(HEAD_R * 1.5, 1.3, 9), mat(shade(fit.body, -30)));
        brim.position.set(0, 2.2, HEAD_R + 2.5);
        const button = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 2), m);
        button.position.y = HEAD_R + 2.2;
        g.add(dome, brim, button);
        break;
      }
      case "beanie": {
        const col = fit.hair === "#9a9aa2" ? "#5a6470" : "#7a4a3a";
        const dome = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R + 1.1, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(col));
        dome.position.y = 1.4;
        dome.castShadow = true;
        const fold = new THREE.Mesh(new THREE.CylinderGeometry(HEAD_R + 1.6, HEAD_R + 1.6, 3.4, 8, 1, true), mat(shade(col, 26), { side: THREE.DoubleSide }));
        fold.position.y = 1.6;
        const pom = new THREE.Mesh(new THREE.IcosahedronGeometry(2.8, 0), mat(shade(col, 40)));
        pom.position.y = HEAD_R + 3.8;
        g.add(dome, fold, pom);
        break;
      }
      case "flower": {
        const petal = mat("#e7708f");
        const f = new THREE.Group();
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          const p = new THREE.Mesh(new THREE.IcosahedronGeometry(2.3, 0), petal);
          p.position.set(Math.cos(a) * 2.8, Math.sin(a) * 2.8, 0);
          f.add(p);
        }
        const c = new THREE.Mesh(new THREE.IcosahedronGeometry(1.9, 0), mat("#ffd76a"));
        c.position.z = 0.8;
        f.add(c);
        f.position.set(HEAD_R * 0.72, HEAD_R * 0.62, 2);
        f.rotation.y = 0.9;
        g.add(f);
        break;
      }
      case "halo": {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(8, 1.3, 4, 14),
          ownMat("#ffe082", { emissive: "#ffd24a", glow: 0.9 })
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.y = HEAD_R + 6;
        this.halo = ring;
        g.add(ring);
        break;
      }
      case "bucket": {
        const cloth = mat("#b8a47a");
        // a soft crown + a short, down-turned brim (wide enough to read, small
        // enough that the face still shows from the overhead camera)
        const crown = new THREE.Mesh(new THREE.CylinderGeometry(HEAD_R * 0.78, HEAD_R + 0.9, 6, 8), cloth);
        crown.position.y = HEAD_R * 0.5;
        crown.castShadow = true;
        const brim = new THREE.Mesh(new THREE.CylinderGeometry(HEAD_R + 1, HEAD_R + 3.2, 2.2, 10, 1, true), mat(shade("#b8a47a", -20), { side: THREE.DoubleSide }));
        brim.position.y = HEAD_R * 0.5 - 3.6;
        brim.castShadow = true;
        const band = new THREE.Mesh(new THREE.CylinderGeometry(HEAD_R + 0.95, HEAD_R + 0.95, 1.4, 8), mat("#3a2817"));
        band.position.y = HEAD_R * 0.5 - 2;
        g.add(crown, brim, band);
        break;
      }
      case "phones": {
        const dark = mat("#23232a");
        const band = new THREE.Mesh(new THREE.TorusGeometry(HEAD_R + 1.4, 1.3, 4, 10, Math.PI), dark);
        band.position.y = 0.5;
        const cupM = mat("#2c2c34");
        for (const side of [-1, 1]) {
          const cup = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 3, 7), cupM);
          cup.rotation.z = Math.PI / 2;
          cup.position.set(side * (HEAD_R + 1.2), 0, 0);
          const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.8, 7), mat("#ffb35e", { emissive: "#ff9a3a", glow: 0.35 }));
          pad.rotation.z = Math.PI / 2;
          pad.position.set(side * (HEAD_R + 2.9), 0, 0);
          g.add(cup, pad);
        }
        g.add(band);
        break;
      }
      default:
        break;
    }
  }

  /** Face a heading smoothly. yaw 0 = toward the camera. */
  private turnTo(target: number, dt: number) {
    let d = target - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * 10);
    this.root.rotation.y = this.yaw;
  }

  /** Snap the heading (spawns / room entry) so nobody spins in place. */
  faceNow(yaw: number) {
    this.yaw = yaw;
    this.root.rotation.y = yaw;
  }

  /**
   * Advance the procedural animation. `t` is seconds (shared clock, so every
   * listener nods to the same beat), `dt` the frame delta.
   */
  update(t: number, dt: number, s: CharState) {
    if (s.yaw !== null) this.turnTo(s.yaw, dt);

    const k = Math.min(1, dt * 8);
    this.walkAmt += ((s.moving ? 1 : 0) - this.walkAmt) * k;
    this.sitAmt += ((s.sitting ? 1 : 0) - this.sitAmt) * k;
    if (s.moving) this.phase += dt * (8.5 + 3 * (s.speed ?? 1));

    const w = this.walkAmt;
    const sw = Math.sin(this.phase);
    // ~120 bpm: the same simulated four-on-the-floor the rave portal breathes to
    const beatPh = (t * 2) % 1;
    const beat = s.playing ? Math.pow(1 - beatPh, 2.4) : 0;
    const idle = 1 - w;

    // ---- legs
    const stride = sw * 0.75 * w;
    const sitLeg = -Math.PI / 2 * this.sitAmt;
    this.legL.rotation.x = stride + sitLeg;
    this.legR.rotation.x = -stride + sitLeg;

    // ---- arms (opposite to legs while walking; pumps when dancing)
    let aL = -stride * 0.8;
    let aR = stride * 0.8;
    let aZ = 0.12;
    if (s.dancer && !s.moving && s.playing) {
      const pump = Math.sin(t * Math.PI * 2 + this.seed);
      aL = -2.3 + pump * 0.5;
      aR = -2.3 - pump * 0.5;
      aZ = 0.35;
    } else if (this.sitAmt > 0.5) {
      aL = aR = -0.55; // hands resting on the knees
    } else if (s.waving) {
      aR = -2.7;
      aZ = 0.2 + Math.sin(t * 9) * 0.35;
    }
    this.armL.rotation.x += (aL - this.armL.rotation.x) * Math.min(1, dt * 14);
    this.armR.rotation.x += (aR - this.armR.rotation.x) * Math.min(1, dt * 14);
    this.armL.rotation.z = s.waving ? -0.12 : -aZ;
    this.armR.rotation.z = aZ;

    // ---- body: walk bounce, dance bounce, breathing, sit drop
    const bounce = Math.abs(Math.cos(this.phase)) * 1.8 * w;
    const danceBounce = s.dancer && s.playing ? beat * 3.2 * idle : 0;
    const breathe = Math.sin(t * 2.1 + this.seed) * 0.35 * idle;
    this.body.position.y = bounce + danceBounce + breathe - this.sitAmt * (LEG - 3);
    this.body.rotation.x = 0.09 * w; // lean into the stroll
    this.body.rotation.z = s.dancer && s.playing ? Math.sin(t * Math.PI + this.seed) * 0.08 * idle : sw * 0.04 * w;
    this.torso.scale.set(1, 1 + Math.sin(t * 2.1 + this.seed) * 0.015, 1);

    // ---- head: nod on the beat when the room is playing (everyone in sync)
    const nod = s.playing ? beat * 0.2 * (0.6 + 0.4 * idle) : Math.sin(t * 0.7 + this.seed) * 0.03;
    this.head.rotation.x = nod;
    this.head.rotation.z = Math.sin(t * 0.9 + this.seed) * 0.05 * idle;

    // ---- a dance move (the 💃 button) layers over everything above, easing in
    // at the start and back out to normal at the end; walking cancels it
    const d = s.dance && !s.moving && !s.sitting && d0(s.dance.t) ? s.dance : null;
    const ease = Math.min(1, dt * 10);
    if (d) {
      const w = Math.max(0, Math.min(1, d.t / 0.25, (DANCE_SECONDS - d.t) / 0.35));
      const p = dancePose(d.move, d.t);
      const mix = (a: number, v: number) => a + (v - a) * w;
      this.legL.rotation.x = mix(this.legL.rotation.x, p.lx);
      this.legR.rotation.x = mix(this.legR.rotation.x, p.rx);
      this.legL.rotation.z = p.lz * w;
      this.legR.rotation.z = p.rz * w;
      this.legL.rotation.y = p.ly * w;
      this.legR.rotation.y = p.ry * w;
      this.armL.rotation.x = mix(this.armL.rotation.x, p.alx);
      this.armR.rotation.x = mix(this.armR.rotation.x, p.arx);
      this.armL.rotation.z = mix(this.armL.rotation.z, p.alz);
      this.armR.rotation.z = mix(this.armR.rotation.z, p.arz);
      this.body.position.x = p.bx * w;
      this.body.position.y += p.by * w;
      this.body.rotation.x = mix(this.body.rotation.x, p.brx);
      this.body.rotation.z = mix(this.body.rotation.z, p.brz);
      this.body.rotation.y = p.bry * w;
      this.head.rotation.x = mix(this.head.rotation.x, p.hx);
      this.head.rotation.z = mix(this.head.rotation.z, p.hz);
    } else {
      // settle anything only a dance moves back to rest
      for (const o of [this.legL.rotation, this.legR.rotation]) {
        o.z -= o.z * ease;
        o.y -= o.y * ease;
      }
      this.body.position.x -= this.body.position.x * ease;
      this.body.rotation.y -= this.body.rotation.y * ease;
    }

    // ---- extras
    if (this.halo) {
      const pulse = 0.6 + 0.4 * Math.sin(t * 2);
      (this.halo.material as THREE.MeshLambertMaterial).emissiveIntensity = 0.6 + pulse * 0.6;
      this.halo.rotation.z = t * 0.8;
    }
    const sh = this.shadow.material as THREE.MeshBasicMaterial;
    sh.opacity = 0.42 - bounce * 0.04;
    if (this.ring) {
      (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.4 + 0.2 * Math.sin(t * 3);
    }
  }

  setVisible(v: boolean) {
    this.root.visible = v;
  }

  dispose() {
    this.root.traverse((o) => {
      const me = o as THREE.Mesh;
      me.geometry?.dispose();
      const m = me.material as THREE.Material | undefined;
      if (m && !m.userData?.cached) m.dispose();
    });
  }
}

// the ☉☽ mark, drawn (not a font glyph) — shared by every Sombra tee / tote
const sunMoonTex = new Map<string, THREE.Texture>();
function sunMoonTexture(color = "#ffb35e"): THREE.Texture {
  let t = sunMoonTex.get(color);
  if (t) return t;
  const l = labelTexture(64, 64, (c) => {
    c.strokeStyle = color;
    c.fillStyle = color;
    c.lineWidth = 4.5;
    c.beginPath();
    c.arc(20, 32, 12, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.arc(20, 32, 3.6, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.arc(46, 32, 13, Math.PI * 0.5, Math.PI * 1.5, false);
    c.arc(40, 32, 10, Math.PI * 1.5, Math.PI * 0.5, true);
    c.fill();
  }, 2);
  t = l.tex;
  t.userData.cached = true;
  sunMoonTex.set(color, t);
  return t;
}

/** is a dance that started `t` seconds ago still going? */
function d0(t: number): boolean {
  return t >= 0 && t < DANCE_SECONDS;
}

/** yaw (radians around +Y) that faces a plan-space direction (dx right, dy down) */
export function yawOf(dx: number, dy: number): number {
  return Math.atan2(dx, dy);
}
