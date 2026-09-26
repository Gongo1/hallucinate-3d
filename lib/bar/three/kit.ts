import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// The low-poly toolkit every room is built from. World units are the engine's
// world px (room = 1140×800): a fixture at engine (x, y) sits at three (x, elev, y),
// +Y is up, and the camera looks from +Z (the bottom of the old top-down view).
// Everything is flat-shaded so facets read — that IS the art style.

/* ------------------------------------------------------------ colour */

export function hex(c: string): THREE.Color {
  return new THREE.Color(c);
}
/** lighten (+) / darken (−) a hex by an 0–255 channel offset (the 2D engine's shade()) */
export function shade(c: string, a: number): string {
  const col = new THREE.Color(c);
  const r = Math.min(255, Math.max(0, col.r * 255 + a));
  const g = Math.min(255, Math.max(0, col.g * 255 + a));
  const b = Math.min(255, Math.max(0, col.b * 255 + a));
  return "#" + new THREE.Color(r / 255, g / 255, b / 255).getHexString();
}
export function rgba(c: string, a: number): string {
  const col = new THREE.Color(c);
  return `rgba(${(col.r * 255) | 0},${(col.g * 255) | 0},${(col.b * 255) | 0},${a})`;
}

/** deterministic RNG so decor (rocks, leaves, stars) doesn't reshuffle per visit */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------ materials */

export interface MatOpts {
  emissive?: string;
  /** 0..n — how strongly the emissive colour glows */
  glow?: number;
  opacity?: number;
  side?: THREE.Side;
  /** smooth instead of faceted (rare — water, glass) */
  smooth?: boolean;
}

// Shared + cached: most rooms reuse a small palette, and cached materials are
// never disposed on a room swap (they're cheap and the next visit wants them).
const matCache = new Map<string, THREE.MeshLambertMaterial>();

/** Flat-shaded Lambert — the house material. Cached by colour + options. */
export function mat(color: string, o: MatOpts = {}): THREE.MeshLambertMaterial {
  const key = `${color}|${o.emissive ?? ""}|${o.glow ?? ""}|${o.opacity ?? 1}|${o.side ?? 0}|${o.smooth ? 1 : 0}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({
      color: hex(color),
      flatShading: !o.smooth,
      side: o.side ?? THREE.FrontSide,
    });
    if (o.emissive) {
      m.emissive = hex(o.emissive);
      m.emissiveIntensity = o.glow ?? 1;
    }
    if (o.opacity !== undefined && o.opacity < 1) {
      m.transparent = true;
      m.opacity = o.opacity;
      m.depthWrite = false;
    }
    m.userData.cached = true;
    matCache.set(key, m);
  }
  return m;
}

/** A fresh (uncached) material — for things that animate their colour/glow. */
export function ownMat(color: string, o: MatOpts = {}): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({
    color: hex(color),
    flatShading: !o.smooth,
    side: o.side ?? THREE.FrontSide,
  });
  if (o.emissive) {
    m.emissive = hex(o.emissive);
    m.emissiveIntensity = o.glow ?? 1;
  }
  if (o.opacity !== undefined && o.opacity < 1) {
    m.transparent = true;
    m.opacity = o.opacity;
    m.depthWrite = false;
  }
  return m;
}

/** Unlit colour — neon, glowing glass, light itself. */
export function glowMat(color: string, opacity = 1, additive = false): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: hex(color),
    transparent: opacity < 1 || additive,
    opacity,
    depthWrite: !(opacity < 1 || additive),
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: false,
  });
}

/* ------------------------------------------------------------ meshes */

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, shadow = true): THREE.Mesh {
  const me = new THREE.Mesh(geo, m);
  me.castShadow = shadow;
  me.receiveShadow = true;
  return me;
}

/** Axis box, BOTTOM-pivoted (sits on whatever elevation you place it at). */
export function box(w: number, h: number, d: number, color: string | THREE.Material, o: MatOpts = {}): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  return mesh(g, typeof color === "string" ? mat(color, o) : color);
}

/** A plan-rect (engine x,y,w,h) extruded up to `h`, placed in the world. */
export function block(r: { x: number; y: number; w: number; h: number }, height: number, color: string | THREE.Material, elev = 0, o: MatOpts = {}): THREE.Mesh {
  const b = box(r.w, height, r.h, color, o);
  b.position.set(r.x + r.w / 2, elev, r.y + r.h / 2);
  return b;
}

/** Low-segment cylinder / frustum, BOTTOM-pivoted. */
export function cyl(rTop: number, rBot: number, h: number, seg: number, color: string | THREE.Material, o: MatOpts = {}): THREE.Mesh {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
  g.translate(0, h / 2, 0);
  return mesh(g, typeof color === "string" ? mat(color, o) : color);
}

export function cone(r: number, h: number, seg: number, color: string | THREE.Material, o: MatOpts = {}): THREE.Mesh {
  const g = new THREE.ConeGeometry(r, h, seg);
  g.translate(0, h / 2, 0);
  return mesh(g, typeof color === "string" ? mat(color, o) : color);
}

/** Faceted sphere-ish blob, CENTRE-pivoted. detail 0 = 20 faces, 1 = 80. */
export function ico(r: number, color: string | THREE.Material, detail = 0, o: MatOpts = {}): THREE.Mesh {
  return mesh(new THREE.IcosahedronGeometry(r, detail), typeof color === "string" ? mat(color, o) : color);
}

/** Organic low-poly lump (rocks, foliage, bushes): an icosahedron with every
 *  vertex nudged by a seeded amount, squashed by (sx, sy, sz). CENTRE-pivoted. */
export function lump(r: number, color: string, seed: number, amt = 0.28, sx = 1, sy = 1, sz = 1, detail = 1): THREE.Mesh {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(r, detail);
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  g = mergeVertices(g);
  const rand = rng(seed);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const k = 1 + (rand() - 0.5) * 2 * amt;
    p.setXYZ(i, p.getX(i) * k * sx, p.getY(i) * k * sy, p.getZ(i) * k * sz);
  }
  g.computeVertexNormals();
  return mesh(g, mat(color));
}

/** A flat shape lying on the floor (rugs, water, paths) from a plan-rect. */
export function floorRect(r: { x: number; y: number; w: number; h: number }, color: string | THREE.Material, elev = 0.5): THREE.Mesh {
  const g = new THREE.PlaneGeometry(r.w, r.h);
  g.rotateX(-Math.PI / 2);
  const m = mesh(g, typeof color === "string" ? mat(color) : color, false);
  m.position.set(r.x + r.w / 2, elev, r.y + r.h / 2);
  return m;
}

/** A flat ellipse/polygon on the floor, CENTRE at (x, y). */
export function floorDisc(x: number, y: number, rx: number, ry: number, seg: number, color: string | THREE.Material, elev = 0.5): THREE.Mesh {
  const g = new THREE.CircleGeometry(1, seg);
  g.rotateX(-Math.PI / 2);
  g.scale(rx, 1, ry);
  const m = mesh(g, typeof color === "string" ? mat(color) : color, false);
  m.position.set(x, elev, y);
  return m;
}

/** place an object at engine (x, y) + elevation; returns it for chaining */
export function at<T extends THREE.Object3D>(o: T, x: number, y: number, elev = 0): T {
  o.position.set(x, elev, y);
  return o;
}

export function group(...kids: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  kids.forEach((k) => g.add(k));
  return g;
}

/* ------------------------------------------------------------ glow + light */

let radialTex: THREE.Texture | null = null;
/** a soft white radial falloff — tinted per use for floor pools, halos, blobs */
export function radialTexture(): THREE.Texture {
  if (radialTex) return radialTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  radialTex = new THREE.CanvasTexture(c);
  radialTex.colorSpace = THREE.SRGBColorSpace;
  radialTex.userData.cached = true;
  return radialTex;
}

/** A pool of coloured light on the floor (additive decal) — the 2D engine's pool(). */
export function glowPool(x: number, y: number, r: number, color: string, alpha: number, elev = 0.8): THREE.Mesh {
  const g = new THREE.PlaneGeometry(r * 2, r * 2);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.MeshBasicMaterial({
    map: radialTexture(),
    color: hex(color),
    transparent: true,
    opacity: alpha,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const me = new THREE.Mesh(g, m);
  me.position.set(x, elev, y);
  me.renderOrder = 1;
  return me;
}

/** A camera-facing soft halo (lamp glow, neon bloom) CENTRE at the given point. */
export function halo(size: number, color: string, alpha: number): THREE.Sprite {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: radialTexture(),
      color: hex(color),
      transparent: true,
      opacity: alpha,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    })
  );
  s.scale.set(size, size, 1);
  return s;
}

/** Warm/cool point light. Units are world px, so distance is in px too. */
export function lamp(color: string, intensity: number, distance: number): THREE.PointLight {
  const l = new THREE.PointLight(hex(color), intensity, distance, 1);
  l.castShadow = false;
  return l;
}

/* ------------------------------------------------------------ text labels */

// Every label is a canvas texture. Fonts arrive async (Google Fonts), so each
// label keeps its draw fn and is redrawn once the faces are ready.
type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
interface LiveLabel {
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  draw: Draw;
  w: number;
  h: number;
}
const liveLabels = new Set<LiveLabel>();
let fontsHooked = false;

function hookFonts() {
  if (fontsHooked || typeof document === "undefined" || !document.fonts) return;
  fontsHooked = true;
  const faces = ["800 34px 'Shippori Mincho'", "900 20px 'Anton'", "400 12px 'DM Mono'", "500 12px 'DM Mono'"];
  Promise.all(faces.map((f) => document.fonts.load(f).catch(() => null)))
    .then(() => document.fonts.ready)
    .then(() => liveLabels.forEach(paint));
}

function paint(l: LiveLabel) {
  const ctx = l.canvas.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, l.canvas.width, l.canvas.height);
  const k = l.canvas.width / l.w;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  l.draw(ctx, l.w, l.h);
  l.tex.needsUpdate = true;
}

export interface Label {
  tex: THREE.CanvasTexture;
  /** re-run the draw fn (e.g. ON AIR flips live) */
  redraw: (draw?: Draw) => void;
  dispose: () => void;
}

/** Make a label texture drawn in label px (w×h), rendered at `res`× for crispness. */
export function labelTexture(w: number, h: number, draw: Draw, res = 3): Label {
  hookFonts();
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w * res);
  canvas.height = Math.ceil(h * res);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const l: LiveLabel = { canvas, tex, draw, w, h };
  liveLabels.add(l);
  paint(l);
  return {
    tex,
    redraw: (d) => {
      if (d) l.draw = d;
      paint(l);
    },
    dispose: () => {
      liveLabels.delete(l);
      tex.dispose();
    },
  };
}

/** A camera-facing text sign (always readable from the tilted camera). `size` is
 *  its width in world px; height follows the canvas aspect. */
export function billboard(w: number, h: number, draw: Draw, size = w, res = 3): THREE.Sprite & { label: Label } {
  const label = labelTexture(w, h, draw, res);
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: label.tex, transparent: true, depthWrite: false, fog: false })
  ) as THREE.Sprite & { label: Label };
  s.scale.set(size, (size * h) / w, 1);
  s.label = label;
  s.userData.label = label;
  s.renderOrder = 5;
  return s;
}

/** A flat text panel (wall signs, placards) — a plane you orient yourself. */
export function panel(w: number, h: number, draw: Draw, size = w, res = 3, lit = false): THREE.Mesh & { label: Label } {
  const label = labelTexture(w, h, draw, res);
  // text is mostly transparent canvas — never let it write depth, or glow pools /
  // other transparent layers under a floor-lying panel get culled into a dark box
  const m = lit
    ? new THREE.MeshLambertMaterial({ map: label.tex, transparent: true, depthWrite: false })
    : new THREE.MeshBasicMaterial({ map: label.tex, transparent: true, depthWrite: false, fog: false });
  const me = new THREE.Mesh(new THREE.PlaneGeometry(size, (size * h) / w), m) as unknown as THREE.Mesh & { label: Label };
  me.label = label;
  me.userData.label = label;
  return me;
}

/** Canvas helper: rounded rect path (the 2D engine's roundRect). */
export function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ------------------------------------------------------------ particles */

/** A cloud of soft additive points (dust motes, fireflies, sparks, stars). */
export function motes(count: number, color: string, size: number, opacity = 0.8): THREE.Points {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const m = new THREE.PointsMaterial({
    color: hex(color),
    size,
    map: radialTexture(),
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    fog: false,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}

/* ------------------------------------------------------------ disposal */

/** Free everything a room built (geometries, own materials, label textures).
 *  Cached materials + the shared radial texture are kept. */
export function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const label = o.userData.label as Label | undefined;
    if (label) label.dispose();
    const me = o as THREE.Mesh;
    if (me.geometry) me.geometry.dispose();
    const mats = me.material ? (Array.isArray(me.material) ? me.material : [me.material]) : [];
    for (const m of mats) {
      if ((m as THREE.Material).userData?.cached) continue;
      const mm = m as THREE.MeshBasicMaterial;
      if (mm.map && !mm.map.userData?.cached && !label) mm.map.dispose();
      (m as THREE.Material).dispose();
    }
  });
}
