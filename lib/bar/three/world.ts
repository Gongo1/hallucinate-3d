import * as THREE from "three";
import type { RoomDef } from "../rooms";
import { CURATORS } from "../curators";
import type { Fit } from "../fits";
import { ROOM, crateStyleFor } from "../layout";
import { Character, yawOf, type CharState } from "./character";
import { buildCrate, buildDoor, type CrateObj, type CrateView, type DoorView } from "./shared";
import { disposeTree, hex } from "./kit";
import { ROOM_BUILDERS } from "./rooms";
import type { ActiveRef, FrameInfo, RoomView } from "./types";

// THE 3D VIEW. Owns the WebGL canvas, camera, lights, the current room's meshes,
// the crates + doors, every character, and the screen-space finish (time-of-day
// light, vignette, portal tunnel, door fade). It never touches game state: the
// engine hands it a FrameState each frame and asks it to turn clicks into floor
// points. Swap the room → rebuild the scenery; everything else stays put.

export interface Actor {
  /** stable id (player / npc:room:i / remote id / seat:i / master) */
  id: string;
  x: number;
  y: number;
  fit: Fit;
  moving: boolean;
  sitting?: boolean;
  /** a fixed heading (seated / the master) instead of face-where-you-walk */
  yaw?: number;
  player?: boolean;
}

export interface FrameState {
  t: number;
  dt: number;
  actors: Actor[];
  playing: boolean;
  active: ActiveRef | null;
  portalCharge: number;
  onAir: boolean;
  onAirDj: string | null;
  /** 0..1 door fade (abs of the engine's signed fade) */
  fade: number;
  phaseMult: readonly number[];
  phaseGlow: readonly number[];
  /** 0..1 joystick tilt for the player's stride */
  speed: number;
}

const FOV = 36;
const PITCH = (54 * Math.PI) / 180; // camera looks down this far below horizontal

const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
// vignette + rave-portal tunnel + door fade, composited back-to-front in one pass
// (premultiplied output — see the blend setup on the material)
const FINISH_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec2 uRes;
uniform float uCharge;
uniform float uFade;
void main() {
  vec2 p = (vUv - 0.5) * uRes;
  float d = length(p);
  float mn = min(uRes.x, uRes.y), mx = max(uRes.x, uRes.y);
  vec3 c = vec3(0.0); float a = 0.0;
  // vignette: transparent → rgba(0,0,0,.52)
  float v = smoothstep(mn * 0.32, mx * 0.74, d) * 0.52;
  c = c * (1.0 - v); a = v + a * (1.0 - v);
  // pull-through charge: a cool violet tunnel closing in
  if (uCharge > 0.0) {
    float r0 = mx * (0.6 - uCharge * 0.5), r1 = mx * (0.78 - uCharge * 0.45);
    float k = smoothstep(r0, r1, d) * (0.25 + uCharge * 0.6);
    c = vec3(90.0, 40.0, 200.0) / 255.0 * k + c * (1.0 - k); a = k + a * (1.0 - k);
  }
  // door fade: a cool dark wash
  if (uFade > 0.0) {
    float k = min(1.0, uFade);
    c = vec3(8.0, 7.0, 14.0) / 255.0 * k + c * (1.0 - k); a = k + a * (1.0 - k);
  }
  gl_FragColor = vec4(c, a);
}
`;

export class World3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 10, 6000);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 1);
  private key = new THREE.DirectionalLight(0xffffff, 1);
  private post = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private multQuad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private screenQuad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private finish: THREE.ShaderMaterial;

  private roomView: RoomView | null = null;
  private roomGroup: THREE.Group | null = null;
  private doors: DoorView[] = [];
  private crates: CrateView[] = [];
  private crateGroup = new THREE.Group();
  private chars = new Map<string, { c: Character; x: number; y: number; seen: boolean }>();
  private roomDef: RoomDef | null = null;
  private dancers = false;

  private W = 1;
  private H = 1;
  private target = new THREE.Vector3(ROOM.w / 2, 0, ROOM.h - 200);
  private camDist = 1200;
  private snapCam = true;
  private ray = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(private canvas: HTMLCanvasElement) {
    const touch = typeof matchMedia !== "undefined" && matchMedia("(pointer:coarse)").matches;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, touch ? 1.75 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;

    this.scene.add(this.hemi);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(touch ? 1024 : 2048, touch ? 1024 : 2048);
    const sc = this.key.shadow.camera;
    sc.left = -ROOM.w * 0.62;
    sc.right = ROOM.w * 0.62;
    sc.top = ROOM.h * 0.75;
    sc.bottom = -ROOM.h * 0.75;
    sc.near = 10;
    sc.far = 3000;
    this.key.shadow.bias = -0.0008;
    this.key.shadow.normalBias = 1.2;
    this.key.target.position.set(ROOM.w / 2, 0, ROOM.h / 2);
    this.scene.add(this.key, this.key.target);
    this.scene.add(this.crateGroup);

    // time-of-day: multiply (dst × eff) then screen (src + dst·(1−src)), exactly
    // the 2D engine's composite ops — so every room re-tints through the day
    const quad = () => new THREE.PlaneGeometry(2, 2);
    // raw framebuffer maths on the sRGB output, like canvas composite ops
    const flat = (blendSrc: THREE.BlendingSrcFactor, blendDst: THREE.BlendingDstFactor) =>
      new THREE.ShaderMaterial({
        vertexShader: POST_VERT,
        fragmentShader: "uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 1.0); }",
        uniforms: { uColor: { value: new THREE.Vector3(1, 1, 1) } },
        depthTest: false,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc,
        blendDst,
      });
    this.multQuad = new THREE.Mesh(quad(), flat(THREE.ZeroFactor, THREE.SrcColorFactor));
    this.screenQuad = new THREE.Mesh(quad(), flat(THREE.OneFactor, THREE.OneMinusSrcColorFactor));
    this.finish = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: FINISH_FRAG,
      uniforms: { uRes: { value: new THREE.Vector2(1, 1) }, uCharge: { value: 0 }, uFade: { value: 0 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    // the quads bypass the camera (clip-space positions) — never cull them
    this.multQuad.frustumCulled = false;
    this.screenQuad.frustumCulled = false;
    const fin = new THREE.Mesh(quad(), this.finish);
    fin.frustumCulled = false;
    this.multQuad.renderOrder = 0;
    this.screenQuad.renderOrder = 1;
    fin.renderOrder = 2;
    this.post.add(this.multQuad, this.screenQuad, fin);

    this.resize();
  }

  /* ----------------------------------------------------------- rooms */

  /** Build a room's scenery + doors (crates arrive via setCrates). */
  setRoom(room: RoomDef) {
    if (this.roomGroup) {
      this.scene.remove(this.roomGroup);
      disposeTree(this.roomGroup);
    }
    for (const [id, e] of this.chars) {
      if (!id.startsWith("player")) {
        this.scene.remove(e.c.root);
        e.c.dispose();
        this.chars.delete(id);
      }
    }
    this.roomDef = room;
    const build = ROOM_BUILDERS[room.scene] ?? ROOM_BUILDERS.kissa;
    const view = build({ room, curator: CURATORS[room.id] });
    this.roomView = view;
    this.dancers = !!view.dancers;
    const g = new THREE.Group();
    g.add(view.group);
    this.doors = room.doors.map((d) => buildDoor(d));
    for (const d of this.doors) g.add(d.group);
    this.roomGroup = g;
    this.scene.add(g);

    // lighting + atmosphere for this room
    const L = view.light;
    this.hemi.color = hex(L.sky);
    this.hemi.groundColor = hex(L.ground);
    this.hemi.intensity = L.hemi;
    this.key.color = hex(L.key);
    this.key.intensity = L.keyI;
    const [fx, fy, fz] = L.keyFrom ?? [-0.45, 1, 0.55];
    const kv = new THREE.Vector3(fx, fy, fz).normalize().multiplyScalar(1400);
    this.key.position.set(ROOM.w / 2 + kv.x, kv.y, ROOM.h / 2 + kv.z);
    this.scene.background = hex(view.bg);
    this.scene.fog = view.fog ? new THREE.Fog(hex(view.fog.color), view.fog.near, view.fog.far) : null;
    this.snapCam = true;
  }

  /** (Re)place the crates for the current room. */
  setCrates(objs: CrateObj[], scene: string) {
    for (const c of this.crates) {
      this.crateGroup.remove(c.group);
      disposeTree(c.group);
    }
    const st = crateStyleFor(scene);
    this.crates = objs.map((o) => buildCrate(o, st));
    for (const c of this.crates) this.crateGroup.add(c.group);
  }

  /* ----------------------------------------------------------- input */

  /** Screen point → floor point (world px), for click-to-walk. */
  screenToWorld(clientX: number, clientY: number): { x: number; y: number } | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.ground, hit)) return null;
    return { x: hit.x, y: hit.z };
  }

  resize() {
    this.W = this.canvas.clientWidth || 1;
    this.H = this.canvas.clientHeight || 1;
    this.renderer.setSize(this.W, this.H, false);
    this.camera.aspect = this.W / this.H;
    // frame roughly the 2D view's scale (≈1 world px per css px at the player),
    // a little wider on small screens so phones see more of the room
    const small = Math.min(this.W, this.H) < 560;
    const visH = this.H * (small ? 1.2 : 0.8);
    const visW = this.W * (small ? 1.2 : 0.8);
    const t = Math.tan((FOV * Math.PI) / 360);
    const byH = visH / (2 * t);
    const byW = visW / (2 * t * this.camera.aspect);
    this.camDist = Math.min(Math.max(byH, byW, 560), 1500);
    this.camera.updateProjectionMatrix();
    this.finish.uniforms.uRes.value.set(this.W, this.H);
  }

  /* ----------------------------------------------------------- frame */

  frame(s: FrameState) {
    this.syncActors(s);
    this.followCamera(s);

    const info: FrameInfo = {
      t: s.t,
      dt: s.dt,
      playing: s.playing,
      active: s.active,
      portalCharge: s.portalCharge,
      onAir: s.onAir,
      onAirDj: s.onAirDj,
      player: this.playerPos(s),
      camera: this.camera,
    };
    this.roomView?.update?.(info);
    for (const d of this.doors) d.update(info);
    for (const c of this.crates) c.update(info);

    // screen-space finish
    const [mr, mg, mb, ma] = s.phaseMult;
    const eff = (c: number) => 1 - ma + (ma * c) / 255;
    this.multQuad.material.uniforms.uColor.value.set(eff(mr), eff(mg), eff(mb));
    this.multQuad.visible = ma > 0.002;
    const [gr, gg, gb, ga] = s.phaseGlow;
    this.screenQuad.material.uniforms.uColor.value.set((gr / 255) * ga, (gg / 255) * ga, (gb / 255) * ga);
    this.screenQuad.visible = ga > 0.002;
    this.finish.uniforms.uCharge.value = s.portalCharge;
    this.finish.uniforms.uFade.value = s.fade;

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.render(this.post, this.postCam);
  }

  private playerPos(s: FrameState) {
    const p = s.actors.find((a) => a.player);
    return p ? { x: p.x, y: p.y } : { x: ROOM.w / 2, y: ROOM.h / 2 };
  }

  private followCamera(s: FrameState) {
    const p = this.playerPos(s);
    // keep the view inside the room: centre it on an axis the screen already covers
    const t = Math.tan((FOV * Math.PI) / 360);
    const halfW = this.camDist * t * this.camera.aspect * 0.92;
    const halfD = (this.camDist * t) / Math.sin(PITCH) * 0.7;
    const clampAxis = (v: number, half: number, lo: number, hi: number) =>
      hi - lo <= half * 2 ? (lo + hi) / 2 : Math.min(Math.max(v, lo + half), hi - half);
    const tx = clampAxis(p.x, halfW, -40, ROOM.w + 40);
    const tz = clampAxis(p.y, halfD, -10, ROOM.h + 30);
    const k = this.snapCam ? 1 : Math.min(1, s.dt * 5);
    this.snapCam = false;
    this.target.x += (tx - this.target.x) * k;
    this.target.z += (tz - this.target.z) * k;
    this.camera.position.set(
      this.target.x,
      this.target.y + Math.sin(PITCH) * this.camDist,
      this.target.z + Math.cos(PITCH) * this.camDist
    );
    this.camera.lookAt(this.target.x, 18, this.target.z);
  }

  /** Create / update / retire a Character per actor, facing where they walk. */
  private syncActors(s: FrameState) {
    for (const e of this.chars.values()) e.seen = false;
    for (const a of s.actors) {
      let e = this.chars.get(a.id);
      if (!e) {
        const c = new Character(a.fit, { player: a.player });
        c.faceNow(a.yaw ?? 0);
        e = { c, x: a.x, y: a.y, seen: true };
        this.chars.set(a.id, e);
        this.scene.add(c.root);
      }
      e.seen = true;
      e.c.setFit(a.fit);
      const dx = a.x - e.x;
      const dy = a.y - e.y;
      const jumped = Math.hypot(dx, dy) > 60; // a spawn / room swap — don't spin
      let yaw: number | null = a.yaw ?? null;
      if (yaw === null && !jumped && Math.hypot(dx, dy) > 0.25) yaw = yawOf(dx, dy);
      e.x = a.x;
      e.y = a.y;
      e.c.root.position.set(a.x, this.roomView?.floorAt?.(a.x, a.y) ?? 0, a.y);
      const st: CharState = {
        moving: a.moving,
        yaw,
        sitting: a.sitting,
        dancer: this.dancers && !a.player && !a.id.startsWith("r:"),
        playing: s.playing,
        speed: a.player ? s.speed : 1,
      };
      e.c.update(s.t, s.dt, st);
    }
    for (const [id, e] of this.chars) {
      if (!e.seen) {
        this.scene.remove(e.c.root);
        e.c.dispose();
        this.chars.delete(id);
      }
    }
  }

  dispose() {
    if (this.roomGroup) disposeTree(this.roomGroup);
    for (const c of this.crates) disposeTree(c.group);
    for (const e of this.chars.values()) e.c.dispose();
    this.chars.clear();
    this.renderer.dispose();
  }

  /** current room def (debug) */
  get room() {
    return this.roomDef;
  }
}
