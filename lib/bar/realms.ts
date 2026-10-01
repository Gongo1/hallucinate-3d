// THE REALMS — the game layer's data. Every room is a realm with its own lore,
// a keeper who tells you how it connects to Sombra, and records
// turn up. Secret passages stitch far-apart realms together.
//
// Pure data (positions in world px, same plan as layout.ts). NOTHING here touches
// music / sync / flow — digging only *reveals* records from the room's own crates;
// cueing still goes through presence + flow rules like any crate.
//
// Copy voice: Sombra — grounded, warm, a little Spanish-inflected, never woo.
// Facts about Sombra come from the KB (events, people); the rest is flavour.

import type { Fit } from "./fits";
import { CHAMBER } from "./layout";

export interface Keeper {
  name: string;
  /** what they do here, shown under the name */
  title: string;
  x: number;
  y: number;
  /** the talk zone centre if it isn't the keeper's own spot (e.g. across a counter) */
  zone?: { x: number; y: number };
  /** block movement (a small solid) — off for keepers standing in tight corridors */
  solid?: boolean;
  /** "cat" = the resident cosmic cat (no human body) */
  kind?: "person" | "cat";
  fit: Fit;
  /** dialogue pages (plain text, short) */
  lines: string[];
}

export interface Realm {
  id: string;
  name: string;
  kanji: string;
  /** one-line vibe (matches the door placards) */
  tagline: string;
  /** what this realm is */
  lore: string;
  /** how it connects to Sombra */
  sombra: string;
  /** accent colour (the door glow) */
  color: string;
  keeper: Keeper;
  /** position on the world map (0..1 × 0..1) */
  map: { x: number; y: number };
}

const fit = (skin: string, body: string, hair: string, hat: Fit["hat"] = "none", gear: Partial<Fit> = {}): Fit => ({ skin, body, hair, hat, ...gear });

export const REALMS: Record<string, Realm> = {
  kissa: {
    id: "kissa",
    name: "SOMBRA LISTENING ROOM",
    kanji: "聴",
    tagline: "sombra's room · the hub",
    lore: "Sombra's listening room — built like a Japanese ongaku kissa, where the record is the reason you came.",
    sombra: "Gongo built this bar so Sombra's room never has to close. Every realm branches off from here.",
    color: "#ffb35e",
    keeper: {
      name: "Rio",
      title: "record scout",
      x: 300,
      y: 470,
      fit: fit("#cf9268", "#c0432f", "#1b1b22", "phones", { top: "sombra-tee", neck: "usb" }),
      lines: [
        "Hey — welcome to the Sombra Listening Room. The room never closes.",
        "Right under the sign: the Gongo crate — Gongo's own sets, full length — this week's fresh drop, and the Sombra Selection, the house picks.",
        "This place is for digging. Every realm has crates: flip through one and you'll hear each record before you pick it.",
        "Keep the ones you love and they land in your Crate Dex — press C. Some pressings are rare: first press, white label… and the odd test pressing.",
        "Doors lead to other realms — just walk through them. Press M for the map once you've been somewhere; you can jump straight back.",
        "And the lucky cat by the deck? Rub it and it'll send you somewhere random. Good luck, digger.",
      ],
    },
    map: { x: 0.5, y: 0.5 },
  },
  garden: {
    id: "garden",
    name: "THE GARDEN",
    kanji: "庭",
    tagline: "open air · dusk & koi",
    lore: "An open-air courtyard at dusk: raked gravel, a koi pond, a red maple, fireflies.",
    sombra: "Sombra gatherings love to end outdoors — the Soaking Garden at BATHE, sunset sets. This is the golden-hour realm.",
    color: "#7e9b5e",
    keeper: {
      name: "Mizu",
      title: "koi keeper",
      x: 930,
      y: 470,
      fit: fit("#e6b184", "#56877e", "#241812", "bucket", { back: "tote" }),
      lines: [
        "Shh — the koi are listening too.",
        "Sombra's soaks at BATHE end in a garden like this one: warm water, open sky, a slow set drifting over it.",
        "The Golden Hour crate lives here. Easy records for the hour the light goes soft.",
        "Up the path is the cosmos. Down the dunes, the beach. And past the tea room, people get lost in the hedges on purpose.",
      ],
    },
    map: { x: 0.5, y: 0.27 },
  },
  tearoom: {
    id: "tearoom",
    name: "TEA ROOM",
    kanji: "茶室",
    tagline: "tatami · tea · calm",
    lore: "Tatami, a low table, a singing bowl in the corner. Stillness is the point.",
    sombra: "Tea and sound are Elixir Pau's practice — she led SXSW's House of Wellness with sound and tea, and co-created HUM, Sombra's 360° sound healing.",
    color: "#9bbf8a",
    keeper: {
      name: "Shizuka",
      title: "tea keeper",
      x: 360,
      y: 310,
      fit: fit("#f4cda3", "#7e6fb0", "#15151a", "flower", { top: "haori", neck: "mala" }),
      lines: [
        "Sit a while. Slow down until the room can actually listen.",
        "At HUM, six sound healers circle the room — bowls, gongs, tones, breath. This room keeps a little of that quiet.",
        "Organica lives here: warm, rooted, unhurried house.",
        "The hedge maze is just through the far door. Get lost. Something's waiting at the centre.",
      ],
    },
    map: { x: 0.2, y: 0.27 },
  },
  housemiam: {
    id: "housemiam",
    name: "HOUSEUM",
    kanji: "宇宙",
    tagline: "cosmic french house",
    lore: "A terrace floating in the cosmos — a tribute lounge to Houseum and their cosmic French house.",
    sombra: "A tribute, not a partnership: Sombra digs Houseum's selections, so this room sends you their way. Give them their flowers — the gold record opens their channel.",
    color: "#8a6cff",
    keeper: {
      name: "Comète",
      title: "the cosmic cat",
      kind: "cat",
      x: 690,
      y: 500,
      zone: { x: 720, y: 540 },
      solid: false,
      fit: fit("#8a6cff", "#8a6cff", "#1a1240"),
      lines: [
        "…mrrp. You found the stars.",
        "This whole terrace is a tribute to Houseum — cosmic French house, filtered and warm. The music here is theirs to find.",
        "Tap the gold record to visit them. Tributes send traffic home.",
        "…and some say a pizza oven far below has a back door up here. Cats don't gossip. Mostly.",
      ],
    },
    map: { x: 0.5, y: 0.08 },
  },
  omakase: {
    id: "omakase",
    name: "OMAKASE",
    kanji: "御任せ",
    tagline: "selector's counter",
    lore: "A blonde-wood counter where you don't order — the selector chooses for you.",
    sombra: "Omakase is how Gongo plays: long, patient sets built for rooms where nobody is performing attention.",
    color: "#5a86a8",
    keeper: {
      name: "Ken",
      title: "the selector",
      x: 760,
      y: 262,
      zone: { x: 760, y: 405 },
      fit: fit("#cf9268", "#2c3a5a", "#1b1b22", "beanie", { eyes: "specs" }),
      lines: [
        "Omakase — 'I leave it to you.' Trust the selector.",
        "A good set is a meal. Courses, pacing, silence between. Sombra plays it long and patient.",
        "Deep Down is on the counter tonight. Dig it slow.",
        "Through the side door there's a vault of old records. The archivist knows things about Berlin nobody else does.",
      ],
    },
    map: { x: 0.64, y: 0.72 },
  },
  berlin: {
    id: "berlin",
    name: "BERLIN",
    kanji: "地下",
    tagline: "concrete · fog · 4am",
    lore: "Concrete, fog, a strobe sweeping the floor at four in the morning.",
    sombra: "The after-dark side of the house Sombra plays — deep, driving, Detroit in its blood.",
    color: "#e0433a",
    keeper: {
      name: "Sven",
      title: "the door",
      x: 980,
      y: 250,
      fit: fit("#f4cda3", "#26262b", "#0c0c0e", "cap", { eyes: "shades", neck: "chain" }),
      lines: [
        "No photos. House only. You're in.",
        "The Detroit crate lives here. Machines with soul.",
        "Through the back is a Chicago warehouse — where all of this started.",
        "Some nights the fog in the corner is thicker than it should be. Like something's underneath. I don't ask.",
      ],
    },
    map: { x: 0.36, y: 0.72 },
  },
  warehouse: {
    id: "warehouse",
    name: "WAREHOUSE",
    kanji: "倉庫",
    tagline: "chicago · where it began",
    lore: "Brick, steel, a wall of speakers, and a TR-909 on a pedestal like a relic.",
    sombra: "Every set Sombra plays traces back to rooms like this — Chicago, the warehouse, where house music began.",
    color: "#d86a3a",
    keeper: {
      name: "Dee",
      title: "909 tech",
      x: 1020,
      y: 620,
      fit: fit("#7a4e30", "#caa06a", "#15151a", "cap", { back: "crate" }),
      lines: [
        "Careful with the 909. She's older than both of us.",
        "Chicago, mid-'80s: a drum machine, a basement, and a crowd that didn't want to go home. That's the root of everything Sombra plays.",
        "The Warehouse crate is the classic stuff. Dig for B-sides, not anthems.",
        "Stairs go up to the roof. The city looks good from up there.",
      ],
    },
    map: { x: 0.2, y: 0.88 },
  },
  playa: {
    id: "playa",
    name: "LA PLAYA",
    kanji: "波",
    tagline: "dusk surf · fire · sand",
    lore: "A beach at dusk: a fire pit, tiki torches, surf rolling in.",
    sombra: "Sunset sets are a Sombra staple — Marfa, Terlingua, soaking gardens. La Playa is the sunset that never ends.",
    color: "#ff9e5e",
    keeper: {
      name: "Marisol",
      title: "lifeguard",
      x: 850,
      y: 300,
      fit: fit("#a36b45", "#c97e5d", "#2a1c12", "flower", { eyes: "shades" }),
      lines: [
        "¡Hola! Water's warm, the fire's lit.",
        "Sombra loves a sunset set — the desert outside Marfa, Big Bond in Terlingua. Here the sun just keeps going down.",
        "La Playa crate: afro-melodic, deep, a little salt in it.",
        "Old lifeguard story: there's a hatch up by the dunes with a staircase that comes out on a rooftop across town. Never found it myself.",
      ],
    },
    map: { x: 0.8, y: 0.27 },
  },
  rooftop: {
    id: "rooftop",
    name: "SKYLINE",
    kanji: "空",
    tagline: "melodic · city far below",
    lore: "A terrace over the city, string lights, the skyline glittering below the parapet.",
    sombra: "Sombra is an Austin, Texas group — this is the city from above, the melodic hour between plans.",
    color: "#7ab8d8",
    keeper: {
      name: "Nico",
      title: "night watch",
      x: 960,
      y: 350,
      fit: fit("#e6b184", "#5a86a8", "#5a3a22", "none", { top: "hoodie" }),
      lines: [
        "Best view in the venue. Don't tell the Listening Room.",
        "Skyline is the melodic crate — records for the hour when the city lights come on.",
        "Across the roof there's a hedge maze. How it got up here, nobody knows.",
        "And if you smell salt air up here… follow it.",
      ],
    },
    map: { x: 0.07, y: 0.72 },
  },
  mattarello: {
    id: "mattarello",
    name: "IL MATTARELLO",
    kanji: "麺棒",
    tagline: "handmade · unhurried · baja",
    lore: "A terracotta trattoria: wood-fired oven, one long table, flour in the air.",
    sombra: "A tribute to Il Mattarello, a handmade Baja kitchen Sombra loves. Food and music, both unhurried. The easel opens their site.",
    color: "#e0875a",
    keeper: {
      name: "Lupita",
      title: "pasta maker",
      x: 120,
      y: 650,
      fit: fit("#a36b45", "#f3c9a8", "#1c130b", "none"),
      lines: [
        "Handmade. Unhurried. Baja. Sit, sit.",
        "This room is a tribute to Il Mattarello — the real one is in Baja, and the easel will take you there.",
        "Their crate is warm and easy, made for a long table.",
        "Between us: the oven has a back door. Where it goes… mira, just look near the oven.",
      ],
    },
    map: { x: 0.92, y: 0.5 },
  },
  archive: {
    id: "archive",
    name: "THE ARCHIVE",
    kanji: "書庫",
    tagline: "the deep history shelf",
    lore: "A vault of record stacks, banker's lamps, and a card catalogue nobody finishes.",
    sombra: "Digging is Sombra's practice: B-sides, back catalogues, deep cuts — never the anthems.",
    color: "#3f7d5a",
    keeper: {
      name: "Ines",
      title: "archivist",
      x: 1000,
      y: 650,
      fit: fit("#e6b184", "#3f7d5a", "#9a9aa2", "none", { eyes: "specs", neck: "record" }),
      lines: [
        "Quiet, please. Every record in here was somebody's secret once.",
        "Sombra digs deep: not the hits, the B-side of the B-side. This room is where that habit lives.",
        "The catalogue says one stack is hollow. Left end, between the shelves. It hums like a Berlin kick drum.",
        "Try it. Then come back and tell me I'm wrong.",
        "And if you hear water under the floor in the far corner, by the stairs to the maze? Don't tell anyone I told you.",
      ],
    },
    map: { x: 0.5, y: 0.9 },
  },
  chamber: {
    id: "chamber",
    name: "UNDERCROFT",
    kanji: "秘密",
    tagline: "below the archive · candlelit",
    lore: "A stone hall under the Archive: a carved face, a stage in its mouth, black water on both sides, and candles nobody lit.",
    sombra: "Sombra means shadow. The best nights happen somewhere you had to go looking for.",
    color: "#3a8a5a",
    keeper: {
      name: "Basilio",
      title: "keeper of the undercroft",
      x: 880,
      y: 620,
      fit: fit("#cf9268", "#3f7d5a", "#15151a", "none", { top: "haori", neck: "chain" }),
      lines: [
        "You found the hatch. Most people walk right past it.",
        "Sombra means shadow. Down here is where the shadow keeps its music.",
        "That stage is for the DJs. Stand in the mouth and play to the room; the water carries the sound.",
        "The candles? They were floating when I got here. I don't ask.",
      ],
    },
    map: { x: 0.78, y: 0.92 },
  },
  labyrinth: {
    id: "labyrinth",
    name: "LABYRINTH",
    kanji: "迷路",
    tagline: "get lost · find the centre",
    lore: "A real hedge maze. Records that wander off from every realm end up in here.",
    sombra: "The best records are found by getting lost.",
    color: "#86b86a",
    keeper: {
      name: "Hana",
      title: "hedge gardener",
      x: 253,
      y: 612,
      solid: false,
      fit: fit("#f4cda3", "#7e9b5e", "#b0593a", "cap", { back: "tote" }),
      lines: [
        "Lost? Good. That's the idea.",
        "Find the centre: follow the long corridor, then double back.",
        "The maze rewards the stubborn.",
      ],
    },
    map: { x: 0.14, y: 0.5 },
  },
};

export const REALM_ORDER = [
  "kissa", "garden", "tearoom", "housemiam", "omakase", "berlin",
  "warehouse", "playa", "rooftop", "mattarello", "archive", "labyrinth", "chamber",
];

// SECRET PASSAGES — floor hatches that connect far-apart realms. Both ends work
// once found (and the first E on either end finds it).
export interface SecretEnd {
  room: string;
  x: number;
  y: number;
}
export interface Secret {
  id: string;
  name: string;
  a: SecretEnd;
  b: SecretEnd;
}
export const SECRETS: Secret[] = [
  {
    id: "hollow-stack",
    name: "The Hollow Stack",
    a: { room: "archive", x: 120, y: 272 },
    b: { room: "berlin", x: 1000, y: 700 },
  },
  {
    id: "lighthouse-stair",
    name: "The Lighthouse Stair",
    a: { room: "playa", x: 120, y: 180 },
    b: { room: "rooftop", x: 180, y: 700 },
  },
  {
    id: "oven-door",
    name: "The Oven Door",
    a: { room: "mattarello", x: 985, y: 330 },
    b: { room: "housemiam", x: 960, y: 650 },
  },
  {
    // the Undercroft's only way in: a hatch in the Archive's quiet top-right corner
    id: "serpent-stair",
    name: "The Serpent Stair",
    a: { room: "archive", x: 1010, y: 230 },
    b: { room: "chamber", x: CHAMBER.hatch.x, y: CHAMBER.hatch.y },
  },
];

/** the lucky cat in the Listening Room — rub it to wander to a random realm */
export const WANDER_CAT = { room: "kissa", x: 880, y: 700, zone: { x: 880, y: 652 } };

/** secret ends that sit in a given room */
export function secretsIn(room: string): { secret: Secret; here: SecretEnd; there: SecretEnd }[] {
  const out: { secret: Secret; here: SecretEnd; there: SecretEnd }[] = [];
  for (const s of SECRETS) {
    if (s.a.room === room) out.push({ secret: s, here: s.a, there: s.b });
    if (s.b.room === room) out.push({ secret: s, here: s.b, there: s.a });
  }
  return out;
}
