// The door's own sounds — knock, the shoji slide, and the muffled party through
// the wall. All procedural Web Audio (no audio files, like the dance moves).
//
// Why synthesized: the room's music plays in cross-origin YouTube/SoundCloud
// iframes, which Web Audio can't filter, so "through the wall" has to be our
// own bed that hands off to the real stream as the door opens.
//
// Browsers only allow sound after a real gesture: call unlock() INSIDE the
// knock's click handler, before anything else here.

type Bed = { out: GainNode; murmur: AudioBufferSourceNode; timer: ReturnType<typeof setInterval> };

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let bed: Bed | null = null;

const BPM = 122;

/** Create/resume the audio context. Must run synchronously inside a click. */
export function unlock(): boolean {
  try {
    if (!ctx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.45;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume();
    return true;
  } catch {
    return false;
  }
}

function noise(sec: number): AudioBuffer {
  const c = ctx!;
  const b = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * sec)), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

/** Knuckles on a wooden frame: a low thump plus a short knock of filtered noise. */
export function knock(times = 2, gapSec = 0.22) {
  if (!ctx || !master) return;
  for (let i = 0; i < times; i++) {
    const t = ctx.currentTime + 0.02 + i * gapSec;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(62, t + 0.09);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.14);

    const n = ctx.createBufferSource();
    const f = ctx.createBiquadFilter();
    const ng = ctx.createGain();
    n.buffer = noise(0.06);
    f.type = "bandpass";
    f.frequency.value = 900;
    f.Q.value = 1.4;
    ng.gain.setValueAtTime(0.45, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    n.connect(f).connect(ng).connect(master);
    n.start(t);
  }
}

/** Paper-and-wood slide: band-passed noise sweeping up over the slide. */
export function slide(ms: number) {
  if (!ctx || !master) return;
  const dur = ms / 1000;
  const t = ctx.currentTime;
  const n = ctx.createBufferSource();
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  n.buffer = noise(dur + 0.1);
  f.type = "bandpass";
  f.Q.value = 2.2;
  f.frequency.setValueAtTime(420, t);
  f.frequency.exponentialRampToValueAtTime(1500, t + dur);
  g.gain.setValueAtTime(0.001, t);
  g.gain.linearRampToValueAtTime(0.12, t + dur * 0.25);
  g.gain.linearRampToValueAtTime(0.001, t + dur);
  n.connect(f).connect(g).connect(master);
  n.start(t);
  n.stop(t + dur + 0.1);
}

/** The party on the other side of the wall: a low-passed four-on-the-floor kick
 *  and a crowd murmur. Plays until bedStop(). */
export function bedStart() {
  if (!ctx || !master || bed) return;
  const c = ctx;
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 190;
  lp.Q.value = 0.8;
  const out = c.createGain();
  out.gain.setValueAtTime(0.0001, c.currentTime);
  out.gain.exponentialRampToValueAtTime(0.8, c.currentTime + 0.4);
  lp.connect(out).connect(master);

  const murmur = c.createBufferSource();
  const mf = c.createBiquadFilter();
  const mg = c.createGain();
  murmur.buffer = noise(2);
  murmur.loop = true;
  mf.type = "lowpass";
  mf.frequency.value = 520;
  mg.gain.value = 0.05;
  murmur.connect(mf).connect(mg).connect(lp);
  murmur.start();

  // lookahead scheduler: queue kicks ~120ms ahead so timer jitter never drags the beat
  const beat = 60 / BPM;
  let next = c.currentTime + 0.05;
  const timer = setInterval(() => {
    while (next < c.currentTime + 0.12) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.setValueAtTime(115, next);
      o.frequency.exponentialRampToValueAtTime(44, next + 0.11);
      g.gain.setValueAtTime(1, next);
      g.gain.exponentialRampToValueAtTime(0.001, next + 0.32);
      o.connect(g).connect(lp);
      o.start(next);
      o.stop(next + 0.34);
      next += beat;
    }
  }, 25);
  bed = { out, murmur, timer };
}

/** Fade the bed out (the real room stream takes over). */
export function bedStop(fadeMs = 300) {
  if (!ctx || !bed) return;
  const b = bed;
  bed = null;
  const t = ctx.currentTime;
  b.out.gain.cancelScheduledValues(t);
  b.out.gain.setValueAtTime(Math.max(0.0001, b.out.gain.value), t);
  b.out.gain.exponentialRampToValueAtTime(0.0001, t + fadeMs / 1000);
  setTimeout(() => {
    clearInterval(b.timer);
    try {
      b.murmur.stop();
    } catch {}
  }, fadeMs + 100);
}
