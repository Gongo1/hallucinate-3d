import * as THREE from "three";
import type { Fit } from "../fits";
import { mat, ownMat, shade, radialTexture } from "./kit";

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
    const key = `${fit.skin}|${fit.body}|${fit.hair}|${fit.hat}`;
    if (key === this.fitKey) return;
    this.fitKey = key;
    // drop the old parts (geometries are per-character; materials are cached)
    for (const g of [this.legL, this.legR, this.armL, this.armR, this.head, this.hatGroup]) {
      g.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      g.clear();
    }
    if (this.torso) {
      this.torso.geometry.dispose();
      this.body.remove(this.torso);
    }
    this.halo = null;
    this.hairMesh = null;

    const skin = mat(fit.skin);
    const outfit = mat(fit.body);
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
    this.torso = new THREE.Mesh(tg, outfit);
    this.torso.position.y = HIP_Y - 1;
    this.torso.castShadow = true;
    this.body.add(this.torso);

    // ---- arms: shoulder pivots, sleeve in the outfit colour, faceted hand
    for (const [arm, side] of [[this.armL, -1], [this.armR, 1]] as const) {
      arm.position.set(side * 9.2, HIP_Y - 1 + SHOULDER_Y, 0);
      const ag = new THREE.CylinderGeometry(2.4, 2.0, 11, 5);
      ag.translate(0, -5.5, 0);
      const sleeve = new THREE.Mesh(ag, outfit);
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
    const covers = fit.hat === "beanie" || fit.hat === "cap";
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
    this.body.add(this.head);
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
    }
    this.armL.rotation.x += (aL - this.armL.rotation.x) * Math.min(1, dt * 14);
    this.armR.rotation.x += (aR - this.armR.rotation.x) * Math.min(1, dt * 14);
    this.armL.rotation.z = -aZ;
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

/** yaw (radians around +Y) that faces a plan-space direction (dx right, dy down) */
export function yawOf(dx: number, dy: number): number {
  return Math.atan2(dx, dy);
}
