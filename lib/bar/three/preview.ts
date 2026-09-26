import * as THREE from "three";
import type { Fit } from "../fits";
import { Character } from "./character";

// The fit panel's live preview: the SAME low-poly character the room renders,
// drawn by one small shared WebGL renderer and copied into any 2D canvas (the big
// turntable preview and the tiny intro icon both use it — one GL context total).

let R: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  cam: THREE.PerspectiveCamera;
  char: Character;
} | null = null;

function ensure(fit: Fit) {
  if (R) return R;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff0dc, 0x3a2414, 1.6));
  const key = new THREE.DirectionalLight(0xffe0b0, 1.6);
  key.position.set(-60, 120, 140);
  scene.add(key);
  const cam = new THREE.PerspectiveCamera(30, 1, 1, 2000);
  cam.position.set(0, 72, 158);
  cam.lookAt(0, 46, 0);
  const char = new Character(fit);
  scene.add(char.root);
  R = { renderer, scene, cam, char };
  return R;
}

/**
 * Render `fit` into a 2D canvas. `t` drives the idle animation; `spin` turns the
 * character slowly so the hat / hair read from every side.
 */
export function drawFit(target: HTMLCanvasElement, fit: Fit, t: number, spin: boolean) {
  const r = ensure(fit);
  const w = target.width;
  const h = target.height;
  if (!w || !h) return;
  const size = r.renderer.getSize(new THREE.Vector2());
  if (size.x !== w || size.y !== h) {
    r.renderer.setPixelRatio(1);
    r.renderer.setSize(w, h, false);
    r.cam.aspect = w / h;
    r.cam.updateProjectionMatrix();
  }
  r.char.setFit(fit);
  r.char.faceNow(spin ? Math.sin(t * 0.7) * 0.75 : 0.35);
  r.char.update(t, 1 / 60, { moving: false, yaw: null, playing: spin });
  r.renderer.render(r.scene, r.cam);
  const ctx = target.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(r.renderer.domElement, 0, 0, w, h);
}
