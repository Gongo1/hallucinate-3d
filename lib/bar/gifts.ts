// GIFTS — you arrive in basic clothes; the bar gifts you things as you play.
// Talk to a keeper, keep a record, bring new records, find a
// secret, earn a badge → a gift: gear you can WEAR (shows on your 3D self for
// everyone) or a KEEPSAKE, a knick-knack that tells you a bit more about what
// Sombra is. Kept in your local save (progress.ts). Pure client state.
//
// Facts in keepsake blurbs come from the KB (events, people, links); tribute
// rooms keep attribution language.

import type { Fit, Hat, Top, Neck, Eyes, Back } from "./fits";
import { getProgress, markGift } from "./progress";

export type GiftSlot = "hat" | "top" | "neck" | "eyes" | "back";

export interface Gift {
  id: string;
  name: string;
  /** a small glyph for lists + the reveal card */
  icon: string;
  kind: "wear" | "keepsake";
  /** wearables: which slot + the value it sets */
  slot?: GiftSlot;
  value?: Hat | Top | Neck | Eyes | Back;
  /** a line that ties it back to Sombra (or the realm it came from) */
  blurb: string;
  /** optional link (Sombra site / socials / the tribute's own page) */
  link?: string;
  /** 1 common … 3 rare (weights the random draw) */
  rarity: 1 | 2 | 3;
}

const wear = (id: string, name: string, icon: string, slot: GiftSlot, value: Gift["value"], blurb: string, rarity: Gift["rarity"] = 1): Gift => ({ id, name, icon, kind: "wear", slot, value, blurb, rarity });
const keep = (id: string, name: string, icon: string, blurb: string, link?: string, rarity: Gift["rarity"] = 1): Gift => ({ id, name, icon, kind: "keepsake", blurb, link, rarity });

export const GIFTS: Gift[] = [
  // ---- wearables
  wear("sombra-tee", "Sombra Tee", "☉☽", "top", "sombra-tee", "Black tee, ☉☽ on the chest — the mark that's the door between sombraproject.com and this bar."),
  wear("haori", "Tea Haori", "🥋", "top", "haori", "A light jacket from the tea room. Sound and tea are Elixir Pau's side of Sombra.", 2),
  wear("hoodie", "Late-Set Hoodie", "🧥", "top", "hoodie", "For the last hour of a long night — the rooms Gongo plays best.", 2),
  wear("chain", "Gold Chain", "⛓️", "neck", "chain", "A little shine for the dancefloor.", 2),
  wear("usb", "USB Lanyard", "💾", "neck", "usb", "Every selector carries one. You brought records to the bar — now you're one of them."),
  wear("mala", "Mala Beads", "📿", "neck", "mala", "Breath, bowls, tones — the rhythm of HUM, Sombra's 360° sound healing."),
  wear("record", "Gold Record Pendant", "📀", "neck", "record", "A tiny gold record. Earned in the deep end, never bought.", 3),
  wear("shades", "Door Shades", "🕶️", "eyes", "shades", "Sven's spare pair from the Berlin door. No photos."),
  wear("specs", "Liner-Note Specs", "👓", "eyes", "specs", "For reading the small print on the back of the sleeve."),
  wear("crate", "Crate Pack", "🧺", "back", "crate", "A milk crate on your back. The digger's uniform.", 2),
  wear("tote", "Sombra Tote", "👜", "back", "tote", "Canvas, ☉☽ on the side — records, a towel for the soak, a thermos of tea."),
  wear("gong", "Mini Gong", "🥁", "back", "gong", "A pocket version of the gongs at HUM. Strike gently.", 3),
  wear("cap", "Five-Panel Cap", "🧢", "hat", "cap", "Brim forward, head down, digging."),
  wear("beanie", "Knit Beanie", "🧶", "hat", "beanie", "Warm enough for a 4am set."),
  wear("flower", "Garden Bloom", "🌸", "hat", "flower", "Picked at golden hour in the garden."),
  wear("phones", "Studio Phones", "🎧", "hat", "phones", "Cue it up before the room hears it."),
  wear("bucket", "Bucket Hat", "👒", "hat", "bucket", "Desert-sun gear — Marfa, Terlingua, the sunset sets.", 2),
  wear("halo", "Halo", "😇", "hat", "halo", "For the ones who stay till the lights come up.", 3),
  // ---- keepsakes: Sombra
  keep("hum-mallet", "HUM Mallet", "🪘", "A felt mallet from HUM — Sombra's flagship: six sound healers in a circle around you, bowls, gongs, tones, breath.", "https://sombraproject.com/hum"),
  keep("bathe-token", "BATHE Soak Token", "♨️", "BATHE is Sombra's recurring home in Austin — soaks, sound baths, and a garden that ends in a slow set."),
  keep("marfa-postcard", "Marfa Postcard", "🏜️", "La Mesa · Marfa — days in the desert with art tours, sound healing, sunset DJ sets and stargazing.", undefined, 2),
  keep("terlingua-dust", "Terlingua Dust", "🫙", "A vial from Big Bond Festival in Terlingua, where Paula and Austin played live.", undefined, 2),
  keep("sxsw-wristband", "SXSW Wristband", "🎟️", "House of Wellness at SXSW — Gongo on the decks, Elixir Pau leading with sound and tea."),
  keep("matcha-whisk", "Matcha Whisk", "🍵", "A bamboo chasen. Tea is half of how Sombra slows a room down."),
  keep("la-hora-matchbook", "La Hora Matchbook", "🔥", "La Hora — Sombra's Austin happy hours.", "https://sombraproject.com/la-hora"),
  keep("sun-moon-pin", "☉☽ Enamel Pin", "🌗", "The sun-moon mark. On sombraproject.com it's the door into this bar.", "https://sombraproject.com"),
  keep("gongo-tape", "Gongo Mixtape", "📼", "Long, patient deep-house sets for rooms where nobody's performing attention.", "https://soundcloud.com/gongo-atx", 2),
  keep("sombra-sticker", "@sombra.atx Sticker", "🏷️", "Slap it on a crate. Follow along for the next gathering.", "https://instagram.com/sombra.atx"),
  // ---- keepsakes: the realms (each keeper's parting gift)
  keep("cosmic-star", "Fallen Star", "🌟", "From the Houseum terrace — a tribute to their cosmic French house.", "https://www.youtube.com/@Houseum"),
  keep("chopstick-rest", "Chopstick Rest", "🥢", "From the omakase counter. Trust the selector."),
  keep("909-keychain", "909 Keychain", "🎛️", "Chicago, the TR-909, the warehouse — where house began."),
  keep("seashell", "Sunset Shell", "🐚", "From La Playa, the sunset that never ends."),
  keep("skyline-postcard", "Skyline Postcard", "🌃", "Austin from above — Sombra's home city."),
  keep("rolling-pin", "Rolling-Pin Charm", "🥖", "A tribute to Il Mattarello — handmade, unhurried, Baja.", "https://www.ilmattarello.mx/"),
  keep("archive-card", "Archive Card", "🗂️", "Checked out: one deep cut. Sombra digs B-sides, never anthems."),
  keep("hedge-leaf", "Pressed Hedge Leaf", "🍃", "Picked in the labyrinth. The best records turn up when you're lost."),
  keep("serpent-fang", "Serpent Fang", "🐍", "From the chamber under the Archive. Sombra means shadow; the best nights are the ones you had to find."),
];

export const GIFT_BY_ID: Record<string, Gift> = Object.fromEntries(GIFTS.map((g) => [g.id, g]));

/** each keeper's gift the first time you talk to them (realm id → gift id) */
export const KEEPER_GIFT: Record<string, string> = {
  kissa: "sombra-tee", // Rio's welcome: you're one of us now
  garden: "bathe-token",
  tearoom: "mala",
  housemiam: "cosmic-star",
  omakase: "chopstick-rest",
  berlin: "shades",
  warehouse: "909-keychain",
  playa: "seashell",
  rooftop: "skyline-postcard",
  mattarello: "rolling-pin",
  archive: "archive-card",
  labyrinth: "hedge-leaf",
  chamber: "serpent-fang",
};
/** bringing records to the bar (the 新着 paste box) earns the USB first */
export const INGEST_GIFT = "usb";

// reserved gifts only come from their moment, never the random draw
const RESERVED = new Set([...Object.values(KEEPER_GIFT), INGEST_GIFT]);

export type GiftTrigger =
  | { kind: "talk"; room: string }
  | { kind: "keep" }
  | { kind: "ingest" }
  | { kind: "secret" }
  | { kind: "badge" }
  | { kind: "visit" };

/** chance a trigger turns up a random gift (talk/ingest have their own rules) */
const CHANCE: Record<GiftTrigger["kind"], number> = {
  talk: 0,
  keep: 0.2,
  ingest: 0.6,
  secret: 1,
  badge: 1,
  visit: 0.3,
};

const owned = (id: string) => !!getProgress().gifts[id];

function draw(preferWear: boolean): Gift | null {
  const pool = GIFTS.filter((g) => !owned(g.id) && !RESERVED.has(g.id));
  if (!pool.length) return null;
  const weight = (g: Gift) => (g.rarity === 3 ? 1 : g.rarity === 2 ? 2 : 3) * (preferWear && g.kind === "wear" ? 2 : 1);
  let total = 0;
  for (const g of pool) total += weight(g);
  let r = Math.random() * total;
  for (const g of pool) {
    r -= weight(g);
    if (r <= 0) return g;
  }
  return pool[pool.length - 1];
}

/**
 * Something happened — maybe hand over a gift. Returns the gift you just got
 * (already saved), or null. Keepers always gift the first time you talk; your
 * first 新着 paste earns the USB; secrets + badges always gift; keeps and
 * first visits gift by chance.
 */
export function rollGift(t: GiftTrigger): Gift | null {
  let g: Gift | null = null;
  if (t.kind === "talk") {
    const id = KEEPER_GIFT[t.room];
    if (id && !owned(id)) g = GIFT_BY_ID[id];
  } else if (t.kind === "ingest" && !owned(INGEST_GIFT)) {
    g = GIFT_BY_ID[INGEST_GIFT];
  } else if (Math.random() < CHANCE[t.kind]) {
    g = draw(t.kind === "secret");
  }
  if (!g || !markGift(g.id)) return null;
  return g;
}

/** Gear you own for each slot (the basic defaults are always yours). */
export function ownedGear() {
  const p = getProgress();
  const has = (g: Gift) => !!p.gifts[g.id];
  const of = <T,>(slot: GiftSlot, base: T) => [base, ...GIFTS.filter((g) => g.slot === slot && has(g)).map((g) => g.value as T)];
  return {
    hat: of<Hat>("hat", "none"),
    top: of<Top>("top", "basic"),
    neck: of<Neck>("neck", "none"),
    eyes: of<Eyes>("eyes", "none"),
    back: of<Back>("back", "none"),
  };
}

/** Put a newly gifted wearable on. */
export function wearGift(fit: Fit, g: Gift): Fit {
  if (g.kind !== "wear" || !g.slot) return fit;
  return { ...fit, [g.slot]: g.value } as Fit;
}

/**
 * Players from before gifts existed keep what they were wearing (their saved
 * hat etc. becomes theirs) — nobody gets undressed by an update.
 */
export function grandfatherFit(fit: Fit) {
  const slots: [GiftSlot, string | undefined][] = [
    ["hat", fit.hat],
    ["top", fit.top],
    ["neck", fit.neck],
    ["eyes", fit.eyes],
    ["back", fit.back],
  ];
  for (const [slot, v] of slots) {
    const g = GIFTS.find((x) => x.slot === slot && x.value === v);
    if (g && !owned(g.id)) markGift(g.id);
  }
}

/** Keep the fit to gear you own (a fit from a shared device, a stale save…). */
export function clampFit(fit: Fit): Fit {
  const o = ownedGear();
  return {
    ...fit,
    hat: o.hat.includes(fit.hat) ? fit.hat : "none",
    top: fit.top && o.top.includes(fit.top) ? fit.top : "basic",
    neck: fit.neck && o.neck.includes(fit.neck) ? fit.neck : "none",
    eyes: fit.eyes && o.eyes.includes(fit.eyes) ? fit.eyes : "none",
    back: fit.back && o.back.includes(fit.back) ? fit.back : "none",
  };
}
