// FITS — your look in the bar. A Fit is four choices (skin, outfit, hair, hat).
// It's persisted locally and broadcast over presence so everyone sees the same
// you. Pure data + tiny helpers; the canvas draws it (engine.person), React
// previews it (the fit panel), and presence carries it on the wire.

export type Hat = "none" | "cap" | "beanie" | "flower" | "halo" | "phones";

export interface Fit {
  skin: string;
  body: string; // the outfit colour — also your cue-dot / chat identity
  hair: string;
  hat: Hat;
}

// Curated swatches. Outfits double as the anonymous identity colour, so they're
// distinct + readable on the dark room.
export const SKINS = ["#f4cda3", "#e6b184", "#cf9268", "#a36b45", "#7a4e30", "#5a3a24"];
export const OUTFITS = [
  "#c0432f", "#d98a5f", "#caa06a", "#9b7d4e",
  "#7e9b5e", "#3f7d5a", "#56877e", "#5a86a8",
  "#7e6fb0", "#b06a52", "#c97e5d", "#8a6cff",
];
export const HAIRS = [
  "#2a1c12", "#1b1b22", "#15151a", "#241812",
  "#5a3a22", "#8a6a3a", "#b0593a", "#9a9aa2",
];
export const HATS: Hat[] = ["none", "cap", "beanie", "flower", "halo", "phones"];

const HAT_LABEL: Record<Hat, string> = {
  none: "—",
  cap: "cap",
  beanie: "beanie",
  flower: "flower",
  halo: "halo",
  phones: "phones",
};
export function hatLabel(h: Hat): string {
  return HAT_LABEL[h] ?? h;
}

const KEY = "hallucinate-fit";

/** Stable look from an id (the pre-customise default — same id, same face). */
export function defaultFit(id: string): Fit {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return {
    skin: SKINS[h % SKINS.length],
    body: OUTFITS[(h >> 3) % OUTFITS.length],
    hair: HAIRS[(h >> 6) % HAIRS.length],
    hat: "none",
  };
}

export function randomFit(): Fit {
  const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  return { skin: pick(SKINS), body: pick(OUTFITS), hair: pick(HAIRS), hat: pick(HATS) };
}

function valid(f: unknown): f is Fit {
  const o = f as Fit;
  return (
    !!o &&
    typeof o.skin === "string" &&
    typeof o.body === "string" &&
    typeof o.hair === "string" &&
    HATS.includes(o.hat)
  );
}

/** Read the saved fit, or null if none/invalid (caller falls back to default). */
export function loadFit(): Fit | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const f = JSON.parse(raw);
    return valid(f) ? f : null;
  } catch {
    return null;
  }
}

export function saveFit(f: Fit) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(f));
  } catch {}
}
