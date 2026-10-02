import * as THREE from "three";
import type { RoomDef } from "../rooms";
import { CURATORS } from "../curators";
import type { Fit } from "../fits";
import { ROOM, crateStyleFor } from "../layout";
import { Character, yawOf, type CharState, type DanceMove } from "./character";
import { buildCrate, buildDoor, type CrateObj, type CrateView, type DoorView } from "./shared";
import { buildGameLayer, type GameLayer } from "./game";
import { disposeTree, hex } from "./kit";
import { ROOM_BUILDERS } from "./rooms";
import type { ActiveRef, BoardView, FrameInfo, GameFrame, PickRef, RoomView } from "./types";

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
  /** clickable (keepers) */
  pick?: PickRef;
  /** a dance move in progress (t = seconds since it started) */
  dance?: { move: DanceMove; t: number };
  /** a jump in progress: seconds since take-off */
  jump?: number;
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
  game: GameFrame;
}

// Two camera views. CLOSE (default): low over your shoulder, looking ahead into
// the room — you see what's in front of you. OVERVIEW: the high diorama view.
export type ViewMode = "close" | "overview";
const VIEWS: Record<ViewMode, { fov: number; pitch: number; visH: number; visW: number; ahead: number; min: number; max: number }> = {
  // visH/visW: world px the view spans at the player (height / min width)
  close: { fov: 46, pitch: (27 * Math.PI) / 180, visH: 400, visW: 330, ahead: 110, min: 380, max: 1250 },
  overview: { fov: 36, pitch: (54 * Math.PI) / 180, visH: 0, visW: 0, ahead: 0, min: 560, max: 1500 },
};

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
  readonly camera = new THREE.PerspectiveCamera(VIEWS.close.fov, 1, 10, 6000);
  private viewMode: ViewMode = "close";
  // arrival dolly: a camera-distance multiplier eased from → to (the door ritual
  // holds the camera back while the door is shut, then glides in as it opens)
  private arrival = { from: 1, to: 1, at: 0, ms: 0 };
  // scenery between the camera and you fades out of the way (mesh → its own material)
  private faded = new Map<THREE.Mesh, THREE.Material>();
  private fadeTick = 0;
  // camera-facing labels (placards, tags, bubbles) — the ones between the camera
  // and you get tucked away in the close view so they never fill the screen
  private labels: THREE.Sprite[] = [];
  private hiddenLabels: THREE.Sprite[] = [];
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
  private game: GameLayer | null = null;
  /** everything clickable in the current room (crates, doors, keepers, hatches…) */
  private pickables: THREE.Object3D[] = [];

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
    this.clearFades();
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
    if (this.board) view.setBoard?.(this.board);
    this.dancers = !!view.dancers;
    const g = new THREE.Group();
    g.add(view.group);
    this.doors = room.doors.map((d) => {
      const v = buildDoor(d);
      v.group.userData.pick = { kind: "door", id: d.to } satisfies PickRef;
      return v;
    });
    for (const d of this.doors) g.add(d.group);
    this.game = buildGameLayer(room.id);
    g.add(this.game.group);
    this.roomGroup = g;
    this.scene.add(g);
    this.collectPickables();

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
    for (const c of this.crates) {
      c.group.userData.pick = { kind: "shelf", id: c.id } satisfies PickRef;
      this.crateGroup.add(c.group);
    }
    this.collectPickables();
  }

  /** Gather the clickable roots: tagged scenery (deck, easel, gold record…),
   *  doors, crates, and the game layer. Characters are tagged per frame. */
  private collectPickables() {
    const list: THREE.Object3D[] = [];
    const labels: THREE.Sprite[] = [];
    const scan = (o: THREE.Object3D) => {
      if (o.userData.pick) list.push(o);
      if ((o as THREE.Sprite).isSprite && o.userData.label) labels.push(o as THREE.Sprite);
    };
    this.roomGroup?.traverse(scan);
    for (const c of this.crates) {
      list.push(c.group);
      c.group.traverse((o) => {
        if ((o as THREE.Sprite).isSprite && o.userData.label) labels.push(o as THREE.Sprite);
      });
    }
    this.pickables = list;
    this.labels = labels;
    this.hiddenLabels = [];
  }

  /** Close view: hide labels that sit between the camera and you. */
  private tuckForegroundLabels(p: { x: number; y: number }) {
    for (const l of this.hiddenLabels) l.visible = true;
    this.hiddenLabels = [];
    if (this.viewMode !== "close") return;
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    const cam = this.camera.position;
    const playerDepth = new THREE.Vector3(p.x, 40, p.y).sub(cam).dot(fwd);
    const w = new THREE.Vector3();
    for (const l of this.labels) {
      if (!l.visible) continue;
      l.getWorldPosition(w);
      if (w.sub(cam).dot(fwd) < playerDepth - 70) {
        l.visible = false;
        this.hiddenLabels.push(l);
      }
    }
  }

  /** The clickable thing under a screen point (nearest tagged hit), if any. */
  pick(clientX: number, clientY: number): PickRef | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const roots = [...this.pickables];
    for (const [id, e] of this.chars) if (id.startsWith("keeper:")) roots.push(e.c.root);
    const hits = this.ray.intersectObjects(roots, true);
    for (const h of hits) {
      for (let o: THREE.Object3D | null = h.object; o; o = o.parent) {
        if (o.userData.pick) return o.userData.pick as PickRef;
      }
    }
    return null;
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

  /** Switch the camera between the close over-the-shoulder view and the overview. */
  setView(mode: ViewMode) {
    this.viewMode = mode;
    this.resize();
    this.snapCam = true;
    if (mode === "overview") this.clearFades();
  }
  get view(): ViewMode {
    return this.viewMode;
  }

  /** This week's leaders for the Listening Room's whiteboard (kept across room
   *  swaps, so it's drawn the moment you walk back in). */
  private board: BoardView | null = null;
  setBoard(b: BoardView) {
    this.board = b;
    this.roomView?.setBoard?.(b);
  }

  /** Ease the camera distance to `mult`× the normal follow distance over `ms`
   *  (0 = jump). View-only: the door ritual's dolly. */
  setArrival(mult: number, ms = 0) {
    const from = ms > 0 ? this.arrivalNow() : mult;
    this.arrival = { from, to: mult, at: performance.now(), ms };
  }
  private arrivalNow(): number {
    const a = this.arrival;
    if (a.ms <= 0) return a.to;
    const k = Math.min(1, (performance.now() - a.at) / a.ms);
    return a.from + (a.to - a.from) * (1 - Math.pow(1 - k, 3));
  }

  resize() {
    this.W = this.canvas.clientWidth || 1;
    this.H = this.canvas.clientHeight || 1;
    this.renderer.setSize(this.W, this.H, false);
    this.camera.aspect = this.W / this.H;
    const v = VIEWS[this.viewMode];
    this.camera.fov = v.fov;
    const t = Math.tan((v.fov * Math.PI) / 360);
    let visH: number, visW: number;
    if (this.viewMode === "close") {
      visH = v.visH;
      visW = v.visW;
    } else {
      // frame roughly the old 2D view's scale (≈1 world px per css px), a little
      // wider on small screens so phones see more of the room
      const small = Math.min(this.W, this.H) < 560;
      visH = this.H * (small ? 1.2 : 0.8);
      visW = this.W * (small ? 1.2 : 0.8);
    }
    const byH = visH / (2 * t);
    const byW = visW / (2 * t * this.camera.aspect);
    this.camDist = Math.min(Math.max(byH, byW, v.min), v.max);
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
      hover: s.game.hover,
    };
    // labels tucked last frame come back before the room logic decides visibility
    for (const l of this.hiddenLabels) l.visible = true;
    this.hiddenLabels = [];
    this.roomView?.update?.(info);
    this.game?.update(info, s.game);
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

    this.tuckForegroundLabels(info.player);
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
    const v = VIEWS[this.viewMode];
    const t = Math.tan((v.fov * Math.PI) / 360);
    const halfW = this.camDist * t * this.camera.aspect * 0.92;
    const clampAxis = (x: number, half: number, lo: number, hi: number) =>
      hi - lo <= half * 2 ? (lo + hi) / 2 : Math.min(Math.max(x, lo + half), hi - half);
    let tx: number, tz: number;
    if (this.viewMode === "close") {
      // follow you closely, looking a little ahead (into the room); only keep the
      // view from sliding far past the side walls
      tx = clampAxis(p.x, halfW * 0.55, -20, ROOM.w + 20);
      tz = Math.min(Math.max(p.y - v.ahead, 40), ROOM.h - 60);
    } else {
      // keep the view inside the room: centre it on an axis the screen already covers
      const halfD = (this.camDist * t) / Math.sin(v.pitch) * 0.7;
      tx = clampAxis(p.x, halfW, -40, ROOM.w + 40);
      tz = clampAxis(p.y, halfD, -10, ROOM.h + 30);
    }
    const k = this.snapCam ? 1 : Math.min(1, s.dt * (this.viewMode === "close" ? 6 : 5));
    this.snapCam = false;
    this.target.x += (tx - this.target.x) * k;
    this.target.z += (tz - this.target.z) * k;
    const dist = this.camDist * this.arrivalNow();
    this.camera.position.set(
      this.target.x,
      this.target.y + Math.sin(v.pitch) * dist,
      this.target.z + Math.cos(v.pitch) * dist
    );
    this.camera.lookAt(this.target.x, this.viewMode === "close" ? 30 : 18, this.target.z);
    if (this.viewMode === "close" && ++this.fadeTick % 3 === 0) this.fadeOccluders(p);
  }

  /** Fade scenery that stands between the camera and you (pillars, hedges,
   *  speakers, walls) so you never lose your character in the close view. */
  private fadeOccluders(p: { x: number; y: number }) {
    const hits = new Set<THREE.Mesh>();
    const from = this.camera.position;
    const roots: THREE.Object3D[] = [this.crateGroup];
    if (this.roomGroup) roots.push(this.roomGroup);
    for (const h of [18, 46, 74]) {
      const dir = new THREE.Vector3(p.x, h, p.y).sub(from);
      const dist = dir.length();
      this.ray.set(from, dir.normalize());
      this.ray.camera = this.camera; // sprites (labels) need it to be raycastable
      this.ray.far = dist - 16;
      for (const hit of this.ray.intersectObjects(roots, true)) {
        const m = hit.object as THREE.Mesh;
        if (!m.isMesh || Array.isArray(m.material)) continue;
        const mat = this.faded.get(m) ?? m.material;
        if (!(mat instanceof THREE.MeshLambertMaterial) || mat.transparent || !mat.visible) continue;
        hits.add(m);
      }
    }
    this.ray.far = Infinity;
    for (const m of hits) {
      if (this.faded.has(m)) continue;
      const orig = m.material as THREE.MeshLambertMaterial;
      const ghost = orig.clone();
      ghost.transparent = true;
      ghost.opacity = 0.28;
      ghost.depthWrite = false;
      this.faded.set(m, orig);
      m.material = ghost;
    }
    for (const [m, orig] of this.faded) {
      if (hits.has(m)) continue;
      (m.material as THREE.Material).dispose();
      m.material = orig;
      this.faded.delete(m);
    }
  }

  private clearFades() {
    for (const [m, orig] of this.faded) {
      (m.material as THREE.Material).dispose();
      m.material = orig;
    }
    this.faded.clear();
  }

  /** Create / update / retire a Character per actor, facing where they walk. */
  private syncActors(s: FrameState) {
    for (const e of this.chars.values()) e.seen = false;
    for (const a of s.actors) {
      let e = this.chars.get(a.id);
      if (!e) {
        const c = new Character(a.fit, { player: a.player });
        c.faceNow(a.yaw ?? 0);
        if (a.pick) c.root.userData.pick = a.pick;
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
      const keeper = a.id.startsWith("keeper:");
      const near = keeper && Math.hypot(a.x - this.playerPos(s).x, a.y - this.playerPos(s).y) < 190;
      const st: CharState = {
        moving: a.moving,
        yaw,
        sitting: a.sitting,
        dancer: this.dancers && !a.player && !keeper && !a.id.startsWith("r:"),
        playing: s.playing,
        speed: a.player ? s.speed : 1,
        // keepers you haven't met wave you over
        waving: near && !s.game.talked,
        dance: a.dance,
        jump: a.jump,
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
