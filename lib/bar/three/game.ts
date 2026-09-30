import * as THREE from "three";
import { REALMS, WANDER_CAT, secretsIn } from "../realms";
import { box, cyl, mat, ownMat, glowMat, glowPool, halo, billboard, motes, rr } from "./kit";
import { CHAR_SCALE } from "./character";
import type { FrameInfo, GameFrame, PickRef } from "./types";

// The game layer drawn over any realm: the keeper's speech bubble, secret
// hatches, and the Kissa's lucky cat. Built
// from lib/bar/realms.ts; animated from the engine's GameFrame each frame.

export interface GameLayer {
  group: THREE.Group;
  /** objects tagged with userData.pick (the world raycasts these for clicks) */
  pickables: THREE.Object3D[];
  update: (f: FrameInfo, g: GameFrame) => void;
}

const tag = <T extends THREE.Object3D>(o: T, pick: PickRef): T => {
  o.userData.pick = pick;
  return o;
};

export function buildGameLayer(roomId: string): GameLayer {
  const g = new THREE.Group();
  const pickables: THREE.Object3D[] = [];
  const anim: ((f: FrameInfo, gf: GameFrame) => void)[] = [];
  const realm = REALMS[roomId];

  /* ---------------- the keeper's speech bubble (+ name on hover) */
  if (realm) {
    const k = realm.keeper;
    const cat = k.kind === "cat";
    const bubbleY = cat ? 64 : 58 * CHAR_SCALE + 26;
    const drawBubble = (talked: boolean) => (c: CanvasRenderingContext2D, w: number, h: number) => {
      c.fillStyle = talked ? "rgba(241,230,210,.82)" : "#ffd24a";
      rr(c, 4, 4, w - 8, h - 18, 12);
      c.fill();
      c.beginPath();
      c.moveTo(w / 2 - 7, h - 15);
      c.lineTo(w / 2, h - 4);
      c.lineTo(w / 2 + 7, h - 15);
      c.fill();
      c.fillStyle = "#1a130d";
      c.font = talked ? "900 22px 'Anton',sans-serif" : "900 30px 'Anton',sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(talked ? "…" : "!", w / 2, (h - 14) / 2 + 2);
    };
    const bubble = billboard(48, 56, drawBubble(false), 24);
    bubble.position.set(k.x, bubbleY, k.y);
    g.add(bubble);
    const name = billboard(170, 34, (c, w, h) => {
      c.fillStyle = "rgba(13,10,7,.86)";
      rr(c, 2, 2, w - 4, h - 4, 8);
      c.fill();
      c.strokeStyle = realm.color;
      c.lineWidth = 1.5;
      rr(c, 2, 2, w - 4, h - 4, 8);
      c.stroke();
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = "#f1e6d2";
      c.font = "900 14px 'Anton',sans-serif";
      c.fillText(k.name.toUpperCase(), w / 2, 13);
      c.fillStyle = "rgba(241,230,210,.6)";
      c.font = "9px 'DM Mono'";
      c.fillText(k.title, w / 2, 25);
    }, 110);
    name.position.set(k.x, bubbleY + 30, k.y);
    name.visible = false;
    g.add(name);
    if (cat) {
      // the cat has no character body to click — give it a hit volume
      const hit = new THREE.Mesh(new THREE.BoxGeometry(80, 40, 50), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.set(k.x, 20, k.y);
      tag(hit, { kind: "keeper" });
      g.add(hit);
      pickables.push(hit);
    }
    let talkedWas = false;
    anim.push((f, gf) => {
      if (gf.talked !== talkedWas) {
        talkedWas = gf.talked;
        bubble.label.redraw(drawBubble(gf.talked));
        bubble.scale.set(gf.talked ? 18 : 24, (gf.talked ? 18 : 24) * (56 / 48), 1);
      }
      bubble.position.y = bubbleY + Math.abs(Math.sin(f.t * (gf.talked ? 1.5 : 3.2))) * (gf.talked ? 2 : 7);
      (bubble.material as THREE.SpriteMaterial).opacity = gf.talked ? 0.7 : 1;
      name.visible = f.active?.type === "keeper" || gf.hover?.kind === "keeper";
    });
  }

  /* ---------------- secret hatches */
  for (const { secret, here, there } of secretsIn(roomId)) {
    const dest = REALMS[there.room];
    const col = dest?.color ?? "#c8a0ff";
    const hatch = new THREE.Group();
    hatch.position.set(here.x, 0, here.y);
    const frame = box(46, 2.4, 46, "#3a2e22");
    const lid = new THREE.Group();
    const lidMesh = box(38, 2.2, 38, "#5b4630");
    lidMesh.position.z = -19; // hinge along the far edge
    lid.add(lidMesh);
    for (const [rx, rz] of [[-14, -33], [14, -33], [-14, -5], [14, -5]]) {
      const rivet = cyl(1.6, 1.6, 1.2, 6, "#a08a64");
      rivet.position.set(rx, 2.2, rz + 19 - 19);
      lid.add(rivet);
    }
    lid.position.set(0, 1.2, 19);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(36, 36), glowMat(col, 0, true));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 1.3;
    const ring = glowPool(0, 0, 48, col, 0.05, 1);
    ring.position.set(0, 1, 0);
    const whisper = motes(4, col, 6, 0.5);
    hatch.add(frame, glow, lid, ring, whisper);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(50, 20, 50), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 10;
    hatch.add(hit);
    const sign = billboard(200, 34, (c, w, h) => {
      c.fillStyle = "rgba(13,10,7,.86)";
      rr(c, 2, 2, w - 4, h - 4, 8);
      c.fill();
      c.strokeStyle = col;
      c.lineWidth = 1.6;
      rr(c, 2, 2, w - 4, h - 4, 8);
      c.stroke();
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = col;
      c.font = "900 12px 'Anton',sans-serif";
      c.fillText(`⟡ ${secret.name.toUpperCase()}`, w / 2, 13);
      c.fillStyle = "rgba(241,230,210,.66)";
      c.font = "8.5px 'DM Mono'";
      c.fillText(`secret passage → ${dest?.name ?? there.room}`, w / 2, 25);
    }, 130);
    sign.position.set(0, 44, 0);
    sign.visible = false;
    hatch.add(sign);
    tag(hatch, { kind: "secret", id: secret.id });
    pickables.push(hatch);
    g.add(hatch);
    anim.push((f, gf) => {
      const found = gf.secretsFound.includes(secret.id);
      const on =
        (f.active?.type === "secret" && f.active.id === secret.id) ||
        (gf.hover?.kind === "secret" && gf.hover.id === secret.id);
      // unfound: just a loose hatch with the faintest shimmer — you have to look;
      // found: it stands open, glowing the colour of where it goes
      lid.rotation.x += ((found ? 1.1 : on ? 0.12 : 0) - lid.rotation.x) * Math.min(1, f.dt * 6);
      (glow.material as THREE.MeshBasicMaterial).opacity = found ? 0.55 + 0.25 * Math.sin(f.t * 3) : on ? 0.25 : 0;
      (ring.material as THREE.MeshBasicMaterial).opacity = found ? 0.4 : on ? 0.3 : 0.06 + 0.05 * Math.sin(f.t * 1.3);
      sign.visible = found || on;
      const wp = whisper.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < 4; i++) {
        const k = (f.t * 0.3 + i / 4) % 1;
        wp.setXYZ(i, Math.sin(i * 2.1 + f.t) * 12, 2 + k * (found ? 60 : 26), Math.cos(i * 1.7 + f.t) * 12);
      }
      wp.needsUpdate = true;
      (whisper.material as THREE.PointsMaterial).opacity = found ? 0.9 : 0.35;
    });
  }

  /* ---------------- the lucky cat (Kissa): rub it to wander */
  if (roomId === WANDER_CAT.room) {
    const cat = new THREE.Group();
    cat.position.set(WANDER_CAT.x, 0, WANDER_CAT.y);
    const white = mat("#f4efe6");
    const plinth = box(40, 12, 30, "#8a2c22");
    const body = cyl(12, 14, 26, 8, white);
    body.position.y = 12;
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(13, 1), white);
    head.position.y = 46;
    head.scale.set(1.1, 0.95, 1);
    const earM = mat("#f4efe6");
    const innerM = mat("#e7708f");
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(5, 9, 4), earM);
      ear.position.set(s * 8, 57, 0);
      ear.rotation.z = -s * 0.35;
      const inner = new THREE.Mesh(new THREE.ConeGeometry(2.6, 5, 4), innerM);
      inner.position.set(s * 8, 56.5, 1.8);
      inner.rotation.z = -s * 0.35;
      cat.add(ear, inner);
      const eye = box(3.2, 1.4, 1, "#1a130d");
      eye.position.set(s * 5, 47, 12.5);
      eye.rotation.z = s * 0.2;
      cat.add(eye);
    }
    const nose = box(2.4, 1.6, 1, "#e7708f");
    nose.position.set(0, 43.5, 13.6);
    const collar = cyl(12.4, 12.4, 3, 10, "#c0432f");
    collar.position.y = 34;
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 1.6, 12), ownMat("#ffd76a", { emissive: "#ffb000", glow: 0.35 }));
    coin.rotation.x = Math.PI / 2;
    coin.position.set(0, 24, 14);
    const bell = new THREE.Mesh(new THREE.IcosahedronGeometry(2.6, 0), mat("#ffd76a"));
    bell.position.set(0, 32, 12.5);
    // the beckoning paw (raised, swinging)
    const arm = new THREE.Group();
    arm.position.set(10, 34, 4);
    const paw = cyl(3.6, 4.2, 20, 6, white);
    paw.rotation.z = Math.PI;
    paw.position.y = 20;
    const pad = new THREE.Mesh(new THREE.IcosahedronGeometry(4.4, 0), white);
    pad.position.y = 21;
    arm.add(paw, pad);
    body.position.y = 12;
    cat.add(plinth, body, head, nose, collar, coin, bell, arm);
    const cHalo = halo(90, "#ffd76a", 0.18);
    cHalo.position.y = 40;
    cat.add(cHalo);
    const sign = billboard(150, 34, (c, w, h) => {
      c.fillStyle = "rgba(13,10,7,.86)";
      rr(c, 2, 2, w - 4, h - 4, 8);
      c.fill();
      c.strokeStyle = "#ffd76a";
      c.lineWidth = 1.5;
      rr(c, 2, 2, w - 4, h - 4, 8);
      c.stroke();
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = "#ffd76a";
      c.font = "900 13px 'Anton',sans-serif";
      c.fillText("迷い · WANDER", w / 2, 13);
      c.fillStyle = "rgba(241,230,210,.66)";
      c.font = "8.5px 'DM Mono'";
      c.fillText("rub for a random realm", w / 2, 25);
    }, 96);
    sign.position.y = 86;
    cat.add(sign);
    tag(cat, { kind: "wander" });
    pickables.push(cat);
    g.add(cat);
    anim.push((f, gf) => {
      const on = f.active?.type === "wander" || gf.hover?.kind === "wander";
      arm.rotation.x = -0.3 + Math.sin(f.t * (on ? 9 : 3)) * (on ? 0.55 : 0.35);
      (cHalo.material as THREE.SpriteMaterial).opacity = on ? 0.4 : 0.16;
      head.rotation.z = Math.sin(f.t * 1.4) * 0.06;
    });
  }

  return {
    group: g,
    pickables,
    update: (f, gf) => anim.forEach((a) => a(f, gf)),
  };
}
