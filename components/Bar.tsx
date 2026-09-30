"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { BarEngine } from "@/lib/bar/engine";
import { DANCE_NAMES } from "@/lib/bar/three/character";
import { BarPlayer, type PlayerState } from "@/lib/bar/player";
import {
  BarPresence,
  trackKey,
  type ChatMessage,
  type Reaction,
  type RoomState,
  type CueItem,
} from "@/lib/bar/presence";
import { ingestLinks } from "@/app/actions/ingest";
import { getBrowserClient } from "@/lib/supabase/client";
import { shade } from "@/lib/bar/color";
import { phaseAt } from "@/lib/bar/clock";
import { CURATED_CRATES } from "@/lib/bar/layout";
import {
  loadFit,
  saveFit,
  randomFit,
  SKINS,
  OUTFITS,
  HAIRS,
  type Fit,
} from "@/lib/bar/fits";
import {
  GIFTS,
  KEEPER_GIFT,
  rollGift,
  ownedGear,
  wearGift,
  grandfatherFit,
  clampFit,
  type Gift,
  type GiftSlot,
  type GiftTrigger,
} from "@/lib/bar/gifts";
import type { Shelf, Track } from "@/lib/bar/types";
import { REALMS, REALM_ORDER, SECRETS } from "@/lib/bar/realms";
import {
  getProgress,
  markVisited,
  markSeen,
  markDug,
  markSecret,
  markTalked,
  recordKey,
  titleFor,
} from "@/lib/bar/progress";
import { AvatarPreview, TierChip, useProgress, type FlowUi } from "@/components/game/shared";
import { Dialogue } from "@/components/game/Dialogue";
import { Dex, STASH } from "@/components/game/Dex";
import { GiftCard, type GiftItem } from "@/components/game/GiftCard";
import { WorldMap } from "@/components/game/WorldMap";
import { ArrivalBanner, Toasts, type Banner, type Toast } from "@/components/game/Hud";
import { Door, type DoorPhase } from "@/components/game/Door";
import * as sfx from "@/lib/bar/sfx";
import {
  knockIn,
  myMembership,
  joinList,
  scoreAction,
  earnSetKey,
  weekBoard,
  type Membership,
  type WeekBoard,
} from "@/app/actions/members";
import { memberTag } from "@/lib/members/tag";
import { notePlay } from "@/app/actions/plays";
import { submitRecords } from "@/app/actions/submissions";

// The door ritual's timing (ms from the knock). Spec:
// KB/Sombra/outputs/html/2026-09-29-hallucinate-door-ritual.html
const ARRIVAL = {
  first: { knocks: 2, slideAt: 650, slide: 1200, dolly: 1600, chromeAt: 1850, bed: true },
  back: { knocks: 1, slideAt: 200, slide: 700, dolly: 800, chromeAt: 900, bed: false },
} as const;
const GATE_MAX_MS = 2500; // never hold the door longer than this after the knock
const DOLLY_FROM = 1.35; // the camera waits this much farther back behind the door

/** one row on the live "Added" board */
interface AddedRow {
  id: string;
  title: string;
  artist: string;
  ytId?: string;
  scUrl?: string;
  color: string; // adder's dot
  at: number; // created_at ms
}

/** "2 min ago" style relative time */
function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

const REACTIONS = ["👏", "🔥", "☕", "🙏", "🕺"];

// A small deterministic RNG. Seeded so a given (seed, index) picks the same track —
// the host advances the radio and broadcasts the result, so all clients agree and a
// promoted host can keep the sequence going from the shared index.
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ENERGY × TIME auto-radio. The phase (lib/bar/clock.ts) gives a target energy;
// each crate weights toward the radio by how close its energy is to that target —
// so the favored crates (Detroit at Afterhours, Golden Hour at Sunrise, …) emerge
// purely from data, never a hardcoded list. The non-zero `floor` means NO crate is
// ever locked out — you can always dig anything; the pull is gravity, not a gate.
function energyWeight(energy: number, target: number): number {
  // floor 0.01 (never zero → never locked out) + a steep 0.22^distance falloff so
  // the phase's crates clearly lead. Tuned against the live library so each phase's
  // favored crates emerge (Detroit/Deep Down at night, Golden Hour/Organica at dawn).
  return 0.01 + Math.pow(0.22, Math.abs(energy - target));
}

/**
 * Pick one playable record, weighted per-record by its crate's energy proximity to
 * `target`. Per-record (not per-crate) weighting lets energy dominate the pick while
 * bigger crates still bring variety. `avoidKey` re-rolls once to dodge an immediate
 * repeat of the now-playing track. Returns null if nothing is loaded yet.
 */
function weightedPick(
  shelves: Shelf[],
  target: number,
  rnd: () => number,
  avoidKey?: string
): Track | null {
  const pool: { track: Track; w: number }[] = [];
  let total = 0;
  for (const s of shelves) {
    if (s.ingest) continue; // the 新着 paste crate isn't a radio source
    const w = energyWeight(s.energy ?? 3, target);
    for (const r of s.records) {
      if (!r.ytId && !r.scUrl) continue;
      if (r.fullSet) continue; // full DJ sets are cue-only — never the radio's pick
      pool.push({ track: r, w });
      total += w;
    }
  }
  if (!pool.length) return null;
  const roll = () => {
    let n = rnd() * total;
    for (const e of pool) {
      n -= e.w;
      if (n <= 0) return e.track;
    }
    return pool[pool.length - 1].track;
  };
  let pick = roll();
  if (avoidKey && pool.length > 1 && trackKey(pick) === avoidKey) pick = roll();
  return pick;
}

/** the game layer's engine/UI handlers (kept in a ref so callbacks see fresh state) */
interface GameHandlers {
  onArrive: (room: string) => void;
  onTalk: (room: string) => void;
  onSecret: (id: string, first: boolean) => void;
  toast: (text: string, tone?: Toast["tone"], ms?: number) => void;
}
const noop = () => {};

interface CrateState {
  shelf: Shelf;
  idx: number;
}

const EMPTY_NP: PlayerState = {
  track: null,
  source: null,
  playing: false,
  progress: 0,
  queueLen: 0,
  visible: false,
  radio: false,
  blocked: false,
  preview: null,
};

// Where a dig preview starts: past the intro (a third in, house intros run
// long), leaving room for the 30s; unknown lengths start a minute in.
function previewStart(t: Track): number {
  const d = t.durationSeconds;
  if (!d) return 60;
  return Math.max(0, Math.min(Math.max(20, d * 0.33), d - 35));
}

export default function Bar({
  initialShelves,
  member = null,
  invite = null,
  owner = false,
}: {
  initialShelves: Shelf[];
  /** the returning member's number (from the signed cookie), for the door */
  member?: number | null;
  /** a /k/ key waiting at the door: who sent it, or the number it hands over */
  invite?: { from: number | null; claim: number | null } | null;
  /** a verified /booth session: adds records straight to crates */
  owner?: boolean;
}) {
  // ----- library: seeded server-side from Supabase (see lib/bar/data.ts) -----
  const [shelves, setShelves] = useState<Shelf[]>(initialShelves);
  const shelvesRef = useRef(shelves);
  shelvesRef.current = shelves;

  // ----- UI state -----
  const [started, setStarted] = useState(false);
  const startedRef = useRef(false); // read inside presence callbacks
  // ----- the door ritual -----
  const [doorPhase, setDoorPhase] = useState<DoorPhase>("shut");
  const doorPhaseRef = useRef<DoorPhase>("shut");
  doorPhaseRef.current = doorPhase;
  const [doorSlideMs, setDoorSlideMs] = useState<number>(ARRIVAL.first.slide);
  // the in-room chrome waits behind the door, then fades in one piece at a time
  const [chrome, setChrome] = useState<"" | "hidden" | "in">("");
  // door copy inputs, all client-only (read after mount — no hydration mismatch)
  const [rosterKnown, setRosterKnown] = useState(false);
  const [phaseLabel, setPhaseLabel] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const sceneReadyRef = useRef(false); // the 3D room has drawn behind the door
  const rosterKnownRef = useRef(false);
  const othersRef = useRef(0); // listeners already inside, counted while lurking
  const arrivalTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // runs once, as the interface comes in (the realm banner waits for the reveal)
  const onInsideRef = useRef<(() => void) | null>(null);
  const reducedMotion = useRef(false);
  // ----- membership (numbers, keys, the Sombra list) -----
  const [memberNo, setMemberNo] = useState<number | null>(member);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const listPendingRef = useRef(false); // first crate dug: offer the list once it's closed
  const memberToastRef = useRef<string | null>(null); // "You're #118" waits for the reveal
  // ----- the weekly board: the whiteboard by the sign + the master's gossip -----
  const [board, setBoard] = useState<WeekBoard | null>(null);
  const [boardOpen, setBoardOpen] = useState(false);
  const [masterOpen, setMasterOpen] = useState(false);
  const refreshBoardRef = useRef<() => void>(() => {});
  // adding records: the owner files them straight into crates; everyone else
  // suggests them (the drop box), reviewed weekly into THIS WEEK / the Selection
  const [submitOpen, setSubmitOpen] = useState(false);
  const openAddRef = useRef<() => void>(() => {});
  openAddRef.current = () => (owner ? setIngestOpen(true) : setSubmitOpen(true));
  const countedPlayRef = useRef(0); // the startedAt of the last track this host counted
  const [prompt, setPrompt] = useState<string | null>(null);
  const [np, setNp] = useState<PlayerState>(EMPTY_NP);
  const [crate, setCrate] = useState<CrateState | null>(null);
  const [ingestOpen, setIngestOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false); // touch: chat behind a 💬 toggle
  const [menuOpen, setMenuOpen] = useState(false); // touch: topbar pills behind ☰
  const [fitOpen, setFitOpen] = useState(false); // the fit-customiser overlay
  // the local listener's look. null until the mount effect reads localStorage
  // (avoids an SSR/Math.random hydration mismatch); the engine/presence own the
  // live copy, this state just drives the panel + preview.
  const [fit, setFit] = useState<Fit | null>(null);
  const fitRef = useRef<Fit | null>(null);
  fitRef.current = fit;

  // ----- lobby (Supabase Realtime presence) -----
  const [roster, setRoster] = useState(0);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [reacts, setReacts] = useState<Reaction[]>([]);
  const [cue, setCue] = useState<CueItem[]>([]);
  // flow-rule UI mirror (refreshed on room change + a light tick for cooldown)
  const [flowUi, setFlowUi] = useState({
    myCue: 0,
    cueCap: Infinity as number,
    canCue: true,
    skipHave: 0,
    skipNeed: 1,
    cooldownLeft: 0,
    cueWaitLeft: 0,
  });
  // Added board
  const [added, setAdded] = useState<AddedRow[]>([]);
  const [addedOpen, setAddedOpen] = useState(false);
  const [unseenAdds, setUnseenAdds] = useState(0);
  // ON AIR / cue-lock (god mode) — display only; authority is server+host
  const [onAir, setOnAir] = useState<{ live: boolean; dj: string | null; locked: boolean }>({
    live: false,
    dj: null,
    locked: false,
  });
  const presenceRef = useRef<BarPresence | null>(null);
  // freshest shared room state (set while lurking too) — the intro tap reads it
  // so audio can start INSIDE the gesture, which mobile autoplay rules require
  const latestRoomRef = useRef<RoomState | null>(null);
  // the opener picked in-gesture for an empty room; openRoom() adopts it so the
  // host bootstrap doesn't restart onto a different random track
  const pendingOpenRef = useRef<{ track: Track; seed: number; index: number } | null>(null);

  // ----- the game layer: digging, keepers, realms, secrets (lib/bar/realms.ts +
  // your local save in lib/bar/progress.ts). All client-local; cueing still goes
  // through presence + the flow rules like any crate. -----
  const progress = useProgress();
  const [room, setRoom] = useState("kissa");
  const [dialogue, setDialogue] = useState<string | null>(null); // the keeper's realm id
  const [dexOpen, setDexOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const dialogueAdvanceRef = useRef<(() => void) | null>(null);
  const dialogueOpenRef = useRef(false);
  dialogueOpenRef.current = dialogue !== null;
  const escRef = useRef(false); // the Esc key closes a dialogue instead of paging it
  // gifts waiting to be handed over — shown one at a time, only once nothing
  // else modal is open (a keeper mid-sentence, a crate…)
  const [giftQueue, setGiftQueue] = useState<GiftItem[]>([]);
  const [dexTab, setDexTab] = useState<string | undefined>(undefined);
  const [unseenGifts, setUnseenGifts] = useState(0);

  // ----- refs read every frame by the engine (avoid per-frame re-render) -----
  const playingRef = useRef(false);
  const overlayOpenRef = useRef(false);
  const giftBlocked =
    !started || doorPhase !== "gone" || crate !== null || ingestOpen || dialogue !== null || dexOpen || mapOpen || fitOpen;
  const giftShowing = !giftBlocked && giftQueue.length > 0 ? giftQueue[0] : null;
  const giftShowingRef = useRef(false);
  giftShowingRef.current = giftShowing !== null;
  // when the current gift card appeared — a mashed E (paging a keeper) must not
  // dismiss the gift before anyone sees it
  const giftShownAtRef = useRef(0);
  const giftKey = giftShowing?.key ?? 0;
  useEffect(() => {
    if (giftKey) giftShownAtRef.current = performance.now();
  }, [giftKey]);
  overlayOpenRef.current =
    crate !== null || ingestOpen || dialogue !== null || dexOpen || mapOpen || giftShowing !== null || boardOpen || masterOpen || submitOpen;
  const typingRef = useRef(false);

  // ----- dom + instance refs -----
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stickRef = useRef<HTMLDivElement>(null);
  const nubRef = useRef<HTMLDivElement>(null);
  const actBtnRef = useRef<HTMLDivElement>(null);
  const ytHostRef = useRef<HTMLDivElement>(null);
  const scFrameRef = useRef<HTMLIFrameElement>(null);

  const engineRef = useRef<BarEngine | null>(null);
  const playerRef = useRef<BarPlayer | null>(null);
  const addedChannelRef = useRef<RealtimeChannel | null>(null);

  // mirror the host's flow-rule numbers (cue cap, skip votes, cooldown) into the
  // UI — read from the SAME flowLimits the host enforces (lib/bar/flow.ts)
  const refreshFlowUi = useCallback(() => {
    const p = presenceRef.current;
    if (!p) return;
    const sp = p.skipProgress();
    setFlowUi({
      myCue: p.myCueCount(),
      cueCap: p.limits().cueCap,
      canCue: p.canCue(),
      skipHave: sp.have,
      skipNeed: sp.need,
      cooldownLeft: p.cooldownLeft(),
      cueWaitLeft: p.cueWaitLeft(),
    });
  }, []);

  // light tick so the cooldown countdown + cap state stay live between events
  useEffect(() => {
    if (!started) return;
    const t = setInterval(refreshFlowUi, 500);
    return () => clearInterval(t);
  }, [started, refreshFlowUi]);

  // ----- mount: build the player + engine once -----
  useEffect(() => {
    const canvas = canvasRef.current;
    const stick = stickRef.current;
    const nub = nubRef.current;
    const actBtn = actBtnRef.current;
    const ytHost = ytHostRef.current;
    const scFrame = scFrameRef.current;
    if (!canvas || !stick || !nub || !actBtn || !ytHost || !scFrame) return;

    if (matchMedia("(pointer:coarse)").matches)
      document.body.classList.add("touch");

    // YouTube's API replaces the element it mounts into; give it a throwaway
    // child so React never tries to reconcile the replaced node.
    const ytMount = document.createElement("div");
    ytHost.appendChild(ytMount);

    const player = new BarPlayer({
      ytMount,
      scFrame,
      onState: (s) => setNp(s),
      onPlaying: (p) => {
        playingRef.current = p;
      },
      // the shared room track finished — the host advances the whole room
      onStationEnded: () => presenceRef.current?.trackEnded(),
      // duration backstop: host auto-advances past stale long / unresolved tracks
      onDurationKnown: (sec) => presenceRef.current?.durationKnown(sec),
      // a dig preview ended — rejoin the room wherever it's got to by now
      onPreviewEnd: () => {
        const s = latestRoomRef.current ?? presenceRef.current?.currentRoom() ?? null;
        if (!s?.now) {
          // no room track known yet: never leave the preview running
          playerRef.current?.silence();
          return;
        }
        playerRef.current?.rejoin(s.now, Math.max(0, (Date.now() - s.startedAt) / 1000));
        presenceRef.current?.notePlayed(s.startedAt);
      },
    });
    playerRef.current = player;

    const engine = new BarEngine({
      canvas,
      stick,
      stickNub: nub,
      actBtn,
      shelves: shelvesRef.current,
      callbacks: {
        onPrompt: (html) => setPrompt(html),
        onBrowseShelf: (shelf) => {
          if (shelf.records.length) setCrate({ shelf, idx: 0 });
          // an empty curated crate is being stocked by Sombra — not a paste box
          else if (shelf.slug && CURATED_CRATES.has(shelf.slug))
            gameRef.current.toast(`${shelf.label.replace(/·.*/, "").trim()} is being curated — check back soon`);
          else openAddRef.current();
        },
        onOpenIngest: () => openAddRef.current(),
        // the bar master skips the room to the next track (cue first, then radio)
        // the master behind the bar: who's leading this week (+ a pick, on request)
        onMastersPick: () => {
          setMasterOpen(true);
          refreshBoardRef.current();
        },
        // walked up to the whiteboard: zoom in on this week's board
        onOpenBoard: () => {
          setBoardOpen(true);
          refreshBoardRef.current();
        },
        onShowDeck: () => player.showDeck(),
        onTogglePlay: () => player.togglePlay(), // local mute toggle
        onNext: () => presenceRef.current?.skip(), // skip the whole room
        onCloseOverlays: () => {
          // E / tap while a keeper is talking turns the page (Esc still closes)
          if (dialogueOpenRef.current && !escRef.current) {
            dialogueAdvanceRef.current?.();
            return;
          }
          // a gift on screen is the top layer — E / Esc just takes it
          if (giftShowingRef.current) {
            if (escRef.current || performance.now() - giftShownAtRef.current > 900)
              setGiftQueue((q) => q.slice(1));
            return;
          }
          setCrate(null);
          setIngestOpen(false);
          setDialogue(null);
          setDexOpen(false);
          setMapOpen(false);
          setBoardOpen(false);
          setMasterOpen(false);
          setSubmitOpen(false);
        },
        isOverlayOpen: () => overlayOpenRef.current,
        isPlaying: () => playingRef.current,
        isTyping: () => typingRef.current,
        // rave portal — client-local: open the rave in a NEW TAB after the charge.
        // The bar tab keeps running, so the synced room + audio + presence survive.
        onEnterRave: () =>
          window.open("https://hallucinate.site/", "_blank", "noopener,noreferrer"),
        // a curator-room link (the gold-record attribution) — client-local new tab
        onOpenExternal: (url) =>
          window.open(url, "_blank", "noopener,noreferrer"),
        // moved to another venue room — scenery only. Tell presence so this
        // listener's avatar renders in the new room (count stays venue-wide), and
        // refresh the crate geometry for the new room. Audio is NOT touched.
        onRoomChange: (roomId) => {
          presenceRef.current?.setRoom(roomId);
          engineRef.current?.setShelves(shelvesRef.current);
          gameRef.current.onArrive(roomId);
        },
        // the game layer — handlers live in gameRef so they always see fresh state
        onTalk: (roomId) => gameRef.current.onTalk(roomId),
        onSecret: (id, first) => gameRef.current.onSecret(id, first),
      },
    });
    engineRef.current = engine;
    // dev-only handle for headless screenshot / debugging (never exposed in prod)
    if (process.env.NODE_ENV !== "production")
      (window as unknown as { __barEngine?: BarEngine }).__barEngine = engine;

    // Load the player SDKs NOW (pre-gesture) so the YT player is built before
    // the intro tap — mobile audio must start inside that tap, synchronously.
    player.init();

    // resolve the saved look now (client-only — localStorage), or roll a fresh
    // one. Seed the engine + the panel state, and hand it to presence so the
    // first broadcast already carries the right fit.
    // Brand-new listeners arrive in basic clothes; players from before gifts keep
    // whatever they were wearing (it becomes theirs), and the fit never shows
    // gear you don't own.
    const loaded = loadFit() ?? randomFit();
    grandfatherFit(loaded);
    const initialFit = clampFit(loaded);
    setFit(initialFit);
    engine.setPlayerFit(initialFit);

    // your save: which secret hatches you've found + which keepers you've met
    const saved = getProgress();
    engine.setSecretsFound(Object.keys(saved.secrets));
    engine.setTalked(Object.keys(saved.talked));

    // the door: regulars get the short ritual; the camera waits back behind the
    // door (no dolly when the viewer asked for reduced motion); the door opens
    // only once the room has actually drawn behind it
    setReturning(Object.keys(saved.visited).length > 0);
    setPhaseLabel(phaseAt(Date.now()).label);
    reducedMotion.current = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reducedMotion.current) engine.setArrival(DOLLY_FROM);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        sceneReadyRef.current = true;
      })
    );

    // Join the lobby channel immediately, but only LURKING (not tracked as
    // present, so no ghost listeners): by the time the user taps to enter, the
    // current track + offset are already known and playable in-gesture.
    const presence: BarPresence = new BarPresence({
      fit: initialFit,
      // dev/testing only: ?channel=… joins a private room instead of the live one
      channel:
        process.env.NODE_ENV !== "production"
          ? new URLSearchParams(location.search).get("channel") ?? undefined
          : undefined,
      getPose: () =>
        engineRef.current?.getPlayerPose() ?? { x: 570, y: 470, dir: 1 },
      onRoster: (n) => {
        setRoster(n);
        // while still at the door we're only lurking, so n = the people inside
        if (!startedRef.current) othersRef.current = n;
        rosterKnownRef.current = true;
        setRosterKnown(true);
        // an empty room at the door: pick the opener now (not in the knock) so it
        // can be cued in advance, same reason as the prime in onRoom
        if (!startedRef.current && n === 0 && !pendingOpenRef.current && !latestRoomRef.current) {
          const seed = Math.floor(Math.random() * 0x7fffffff);
          const track = weightedPick(shelvesRef.current, phaseAt(Date.now()).target, mulberry32(seed));
          if (track) {
            pendingOpenRef.current = { track, seed, index: 0 };
            playerRef.current?.prime(track, 0);
          }
        }
      },
      onChat: (m) =>
        setChat((c) => {
          const next = [...c, m].slice(-7);
          // auto-expire each line after a while
          setTimeout(
            () => setChat((cur) => cur.filter((x) => x.key !== m.key)),
            14000
          );
          return next;
        }),
      onReact: (r) => {
        setReacts((rs) => [...rs, r]);
        setTimeout(
          () => setReacts((rs) => rs.filter((x) => x.key !== r.key)),
          2600
        );
      },
      // ----- shared room player -----
      // the room state changed: play/seek to the current track (only on change)
      // and mirror the cue + flow-rule numbers into the UI
      onRoom: (s: RoomState) => {
        latestRoomRef.current = s;
        // the host counts each new track once (the crates show play counts)
        if (s.now?.id && s.startedAt !== countedPlayRef.current && presenceRef.current?.amHost()) {
          countedPlayRef.current = s.startedAt;
          void notePlay(s.now.id).catch(() => {});
        }
        setCue(s.cue);
        setOnAir({ live: s.live, dj: s.dj, locked: s.cueLocked });
        engineRef.current?.setOnAir(s.live, s.dj); // light the in-world sign
        refreshFlowUi();
        if (!startedRef.current) {
          // lurking — the knock starts audio. Cue the room's track now so the
          // knock only has to press play (iOS blocks a load started in the tap).
          if (s.now) {
            pendingOpenRef.current = null; // someone's in; no opener needed
            playerRef.current?.prime(s.now, Math.max(0, (Date.now() - s.startedAt) / 1000));
          }
          return;
        }
        if (s.now && presenceRef.current?.shouldReload()) {
          const offset = Math.max(0, (Date.now() - s.startedAt) / 1000);
          playerRef.current?.playStation(s.now, offset);
        }
      },
      // auto-radio opener for a brand-new room — a phase-appropriate cut for the
      // current hour (energy-weighted; replaces the old hardcoded opener list)
      openRoom: () => {
        // the intro tap may have pre-picked (and already started) the opener
        if (pendingOpenRef.current) {
          const o = pendingOpenRef.current;
          pendingOpenRef.current = null;
          return o;
        }
        const seed = Math.floor(Math.random() * 0x7fffffff);
        const target = phaseAt(Date.now()).target;
        const track = weightedPick(shelvesRef.current, target, mulberry32(seed));
        if (!track) return null;
        return { track, seed, index: 0 };
      },
      // auto-radio next track (when the cue is empty) — leans toward crates near
      // the current phase's target energy, drifting smoothly as the phase eases
      nextAuto: (seed: number, index: number) => {
        const target = phaseAt(Date.now()).target;
        const now = presenceRef.current?.currentRoom()?.now;
        const track = weightedPick(
          shelvesRef.current,
          target,
          mulberry32((seed ^ (index * 0x9e3779b1)) >>> 0),
          now ? trackKey(now) : undefined
        );
        if (!track) return null;
        return { track, index: index + 1 };
      },
    });
    presenceRef.current = presence;
    if (process.env.NODE_ENV !== "production")
      (window as unknown as { __barPresence?: BarPresence }).__barPresence = presence;
    presence.start({ lurk: true });
    engine.setRemoteSource(() => presence.remotes);

    // ----- Added board: live feed of new records (Supabase Realtime) -----
    const sb = getBrowserClient();
    addedChannelRef.current = sb
      .channel("added-board")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "records" },
        ({ new: row }) => {
          const r = row as {
            id: string;
            title: string;
            artist: string | null;
            yt_id: string | null;
            sc_url: string | null;
            added_by_color: string | null;
            created_at: string;
          };
          setAdded((prev) =>
            [
              {
                id: r.id,
                title: r.title,
                artist: r.artist ?? "",
                ytId: r.yt_id ?? undefined,
                scUrl: r.sc_url ?? undefined,
                color: r.added_by_color ?? "#8a8a8a",
                at: Date.parse(r.created_at) || Date.now(),
              },
              ...prev.filter((x) => x.id !== r.id),
            ].slice(0, 20)
          );
          setUnseenAdds((n) => n + 1);
        }
      )
      .subscribe();

    return () => {
      engine.destroy();
      player.destroy();
      presenceRef.current?.stop();
      presenceRef.current = null;
      // the Added-board channel rides the shared browser-client singleton, so it
      // must be removed explicitly or it outlives the component (presence.stop()
      // only tears down the separate "hallucinate-bar" channel).
      if (addedChannelRef.current) {
        getBrowserClient().removeChannel(addedChannelRef.current);
        addedChannelRef.current = null;
      }
      engineRef.current = null;
      playerRef.current = null;
      ytMount.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep the engine's shelf geometry in sync with the library
  useEffect(() => {
    engineRef.current?.setShelves(shelves);
  }, [shelves]);

  // ----- intro: enter the bar -----
  // Wired to CLICK (not pointerdown — on touch, pointerdown carries no user
  // activation) so the playStation below runs INSIDE the gesture. That's what
  // lets iPhones start the sound: mobile browsers only allow audio that begins
  // synchronously in a real tap.
  //
  // The knock also runs the door ritual (knock → ready gate → slide → swell).
  // Timing lives in ARRIVAL; a second tap mid-ritual skips to the end.
  const later = useCallback((ms: number, fn: () => void) => {
    arrivalTimers.current.push(setTimeout(fn, ms));
  }, []);
  const clearArrival = useCallback(() => {
    arrivalTimers.current.forEach(clearTimeout);
    arrivalTimers.current = [];
  }, []);

  // ----- dig previews: hear 30s of the record you're looking at (Austin,
  // 2026-09-29). Flipping through a crate plays each record just for you;
  // close it and you're back in the room at its live spot.
  const previewing = crate ? crate.shelf.records[crate.idx] ?? null : null;
  useEffect(() => {
    if (!previewing) {
      playerRef.current?.endPreview();
      return;
    }
    // a beat before loading, so arrowing down a tracklist doesn't fire a load
    // per row; the record you land on plays
    const t = setTimeout(() => playerRef.current?.startPreview(previewing, previewStart(previewing)), 260);
    return () => clearTimeout(t);
  }, [previewing]);

  // ----- the weekly board: fetched once you're inside, then every minute; the
  // whiteboard in the Listening Room is redrawn from it
  refreshBoardRef.current = () => {
    void weekBoard()
      .then((b) => {
        if (!b) return;
        setBoard(b);
        engineRef.current?.setBoard(boardView(b));
      })
      .catch(() => {});
  };
  useEffect(() => {
    if (doorPhase !== "gone") return;
    refreshBoardRef.current();
    const t = setInterval(() => refreshBoardRef.current(), 60_000);
    return () => clearInterval(t);
  }, [doorPhase]);

  // a ritual in flight when the bar unmounts shouldn't fire into a dead tree
  useEffect(() => clearArrival, [clearArrival]);

  /** Slide the door open and hand over to the room. `fast` = the skip tap. */
  const openDoor = useCallback(
    (t: (typeof ARRIVAL)["first" | "back"], fast: boolean) => {
      clearArrival();
      const reduce = reducedMotion.current;
      const slideMs = fast ? 250 : reduce ? 400 : t.slide;
      const dollyMs = fast ? 250 : reduce ? 0 : t.dolly;
      setDoorSlideMs(slideMs);
      setDoorPhase("open");
      if (!fast && !reduce) sfx.slide(t.slide);
      sfx.bedStop(fast ? 200 : 1000);
      playerRef.current?.swell(fast ? 250 : t.dolly);
      engineRef.current?.setArrival(1, dollyMs);
      // the interface follows the door in (CSS staggers the pieces)
      const chromeIn = fast ? 0 : Math.max(0, t.chromeAt - t.slideAt);
      later(chromeIn, () => {
        setChrome("in");
        onInsideRef.current?.();
        onInsideRef.current = null;
      });
      later(slideMs + 50, () => setDoorPhase("gone"));
      later(chromeIn + 1000, () => setChrome(""));
    },
    [clearArrival, later]
  );

  const enter = useCallback(() => {
    if (startedRef.current) {
      // tapped again mid-ritual: regulars shouldn't have to wait
      const ph = doorPhaseRef.current;
      if (ph === "knock" || ph === "hold") openDoor(ARRIVAL.first, true);
      else if (ph === "open") {
        setDoorPhase("gone");
        setChrome("in");
        onInsideRef.current?.();
        onInsideRef.current = null;
      }
      return;
    }
    startedRef.current = true;
    setStarted(true);
    setChrome("hidden"); // same render as `started`, so no chrome flashes in early
    engineRef.current?.start();

    const player = playerRef.current;
    const p = presenceRef.current;
    const s = latestRoomRef.current ?? p?.currentRoom() ?? null;
    // the room is heard "through the wall" until the door opens (desktop; iOS
    // ignores volume, so there the track simply arrives as the panels part)
    player?.holdLow(12);
    if (player && s?.now) {
      // the lurk phase already learned the room's track — join it in-gesture
      const offset = Math.max(0, (Date.now() - s.startedAt) / 1000);
      player.playStation(s.now, offset);
      p?.notePlayed(s.startedAt); // don't reload on the matching broadcast
    } else if (player) {
      // empty room (we're about to be host) — start the opener picked (and
      // cued) at the door, or pick one now; openRoom() hands this same pick to
      // the host bootstrap
      if (!pendingOpenRef.current) {
        const seed = Math.floor(Math.random() * 0x7fffffff);
        const target = phaseAt(Date.now()).target;
        const track = weightedPick(shelvesRef.current, target, mulberry32(seed));
        if (track) pendingOpenRef.current = { track, seed, index: 0 };
      }
      if (pendingOpenRef.current) player.playStation(pendingOpenRef.current.track, 0);
    }

    // become a live character others can see (lurker → listener)
    p?.materialize();

    // ----- the ritual (everything audible above already started in-gesture) -----
    const firstRun = Object.keys(getProgress().visited).length === 0;
    const t = firstRun ? ARRIVAL.first : ARRIVAL.back;
    sfx.unlock(); // still inside the click, so the door's own sounds may play
    sfx.knock(t.knocks);
    if (t.bed) later(200, () => sfx.bedStart());
    setDoorPhase("knock");

    // ready gate: the room has drawn, we know who's inside, and — if anyone is —
    // their track has arrived. Never hold past GATE_MAX_MS.
    const tapAt = performance.now();
    const ready = () =>
      sceneReadyRef.current &&
      rosterKnownRef.current &&
      (othersRef.current === 0 || latestRoomRef.current !== null);
    const gate = () => {
      if (ready() || performance.now() - tapAt >= GATE_MAX_MS) openDoor(t, false);
      else {
        if (doorPhaseRef.current !== "hold") setDoorPhase("hold");
        later(50, gate);
      }
    };
    later(t.slideAt, gate);

    // who is this? A returning member, a key at the door, or the next number.
    // Never awaited: the audio above already started inside the tap.
    void knockIn()
      .then((r) => {
        if (!r) return;
        setMemberNo(r.number);
        const msg = r.handoff
          ? `This device is ${memberTag(r.number)} now.`
          : r.isNew
            ? `You're ${memberTag(r.number)}. Welcome to the room.`
            : null;
        if (!msg) return;
        if (doorPhaseRef.current === "gone") gameRef.current.toast(msg, "gold", 5200);
        else memberToastRef.current = msg;
      })
      .catch(() => {});

    // once inside: stamp the hub (its banner lands with the interface, not
    // behind the door); first-timers get pointed at the scout
    onInsideRef.current = () => {
      gameRef.current.onArrive("kissa");
      setTimeout(() => {
        if (memberToastRef.current) gameRef.current.toast(memberToastRef.current, "gold", 5200);
        memberToastRef.current = null;
      }, 900);
      if (firstRun)
        setTimeout(() => {
          if (!getProgress().talked.kissa)
            gameRef.current.toast("Talk to Rio (!) — or open a crate and have a listen", "hint", 7000);
        }, 1750);
    };
  }, [later, openDoor]);

  // the tap-to-listen pill: restart blocked audio inside a fresh tap, re-seeking
  // to wherever the room is NOW (it kept moving while this client sat muted)
  const tapToListen = useCallback(() => {
    const s = latestRoomRef.current;
    const offset = s?.now
      ? Math.max(0, (Date.now() - s.startedAt) / 1000)
      : undefined;
    playerRef.current?.tapToListen(offset);
  }, []);

  // change the local look: persist it, repaint the player avatar, and re-broadcast
  // so everyone else re-renders this listener with the new fit (live).
  const applyFit = useCallback((f: Fit) => {
    setFit(f);
    saveFit(f);
    engineRef.current?.setPlayerFit(f);
    presenceRef.current?.setFit(f);
  }, []);

  // ----- the game layer -----
  const toast = useCallback((text: string, tone: Toast["tone"] = "plain", ms = 4200) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);
  /** celebrate a newly reached digger title */
  const titleCheck = useCallback(
    (before: number) => {
      const now = Object.keys(getProgress().dug).length;
      const a = titleFor(before);
      const b = titleFor(now);
      if (a !== b) toast(`🎖 You're a ${b} now — ${now} records dug`, "gold", 5200);
    },
    [toast]
  );
  // the Sombra list: offered ONCE, after you close your first crate (Austin: no
  // pop-up barrage); always reachable from the menu and the fit panel after.
  // Opening a crate also retires the first-run hint (they found the digging).
  useEffect(() => {
    if (crate) {
      setToasts((t) => t.filter((x) => x.tone !== "hint"));
      if (crate.shelf.records.length) listPendingRef.current = true;
      return;
    }
    if (!listPendingRef.current) return;
    listPendingRef.current = false;
    let asked = false;
    try {
      asked = localStorage.getItem(LIST_ASKED) === "1";
      localStorage.setItem(LIST_ASKED, "1");
    } catch {}
    if (!asked && memberNo) setTimeout(() => setListOpen(true), 700);
  }, [crate, memberNo]);

  // your keys + list status, fresh each time the fit panel opens
  useEffect(() => {
    if (fitOpen && memberNo) void myMembership().then(setMembership).catch(() => {});
  }, [fitOpen, memberNo]);

  // stay for an ON AIR set (10 min) → +1 key, once per set (server-deduped)
  useEffect(() => {
    if (!started || !onAir.live || !memberNo) return;
    const at = latestRoomRef.current?.liveStartedAt;
    if (!at) return;
    const t = setTimeout(() => {
      void earnSetKey(at)
        .then((r) => r.ok && toast("⚿ +1 key for staying for the set", "gold", 5200))
        .catch(() => {});
    }, 10 * 60_000);
    return () => clearTimeout(t);
  }, [started, onAir.live, memberNo, toast]);

  /** keep a record in your dex (from a crate / a cue), with the celebrations */
  const keep = useCallback(
    (t: Track, shelf: Shelf) => {
      const before = Object.keys(getProgress().dug).length;
      const res = markDug(t, shelf, shelf.room ?? "kissa", shelvesRef.current);
      // keeping a record from a crate IS the crate digging (no piles since
      // 2026-09-29): it scores as a dig on the weekly board
      if (res.isNew) void scoreAction("dig", recordKey(t)).catch(() => {});
      if (res.badge) {
        void scoreAction("badge", res.badge).catch(() => {});
        toast(`🏅 Realm badge — ${REALMS[res.badge]?.name ?? res.badge}`, "gold", 5200);
        giftRef.current({ kind: "badge" }, REALMS[res.badge]?.keeper.name ?? "the bar");
      }
      if (res.isNew) titleCheck(before);
      return res;
    },
    [toast, titleCheck]
  );
  /** something happened — maybe the bar hands over a gift (queued for display) */
  const giftRef = useRef<(t: GiftTrigger, from?: string) => Gift | null>(() => null);
  giftRef.current = (t, from = "the bar") => {
    const g = rollGift(t);
    if (!g) return null;
    void scoreAction("gift", g.id).catch(() => {});
    setGiftQueue((q) => [...q, { key: Date.now() + Math.random(), gift: g, from }]);
    setUnseenGifts((n) => n + 1);
    // behind a crate / the paste box: let them know it's waiting
    if (crate || ingestOpen) toast(`🎁 A gift is waiting — ${g.icon} close to open it`, "gold", 4200);
    return g;
  };
  const takeGift = useCallback(() => setGiftQueue((q) => q.slice(1)), []);
  const wearNow = useCallback(
    (g: Gift) => {
      const f = fitRef.current;
      if (f) applyFit(wearGift(f, g));
      setGiftQueue((q) => q.slice(1));
      toast(`${g.icon} Wearing the ${g.name}`, "green", 2600);
    },
    [applyFit, toast]
  );

  const gameRef = useRef<GameHandlers>({
    onArrive: noop,
    onTalk: noop,
    onSecret: noop,
    toast: noop,
  });
  gameRef.current = {
    onArrive: (r) => {
      setRoom(r);
      const { first } = markVisited(r);
      const stamped = REALM_ORDER.filter((id) => getProgress().visited[id]).length;
      // phone: small screen + frequent room changes, so only a realm's FIRST
      // visit gets the sign, and no "stamped" toast (the sign already says it)
      const touch = document.body.classList.contains("touch");
      if (first || !touch) setBanner({ key: Date.now(), room: r, first, stamped });
      if (first && r !== "kissa") {
        if (!touch) toast(`✦ New realm stamped — ${stamped}/${REALM_ORDER.length}`, "green");
        giftRef.current({ kind: "visit" }, REALMS[r]?.name ?? "the bar");
      }
    },
    onTalk: (r) => {
      if (!REALMS[r]) return;
      setToasts((t) => t.filter((x) => x.tone !== "hint")); // they found Rio — hint done
      setDialogue(r);
      markTalked(r);
      // the keeper's gift (first talk only) — handed over when the talk ends
      giftRef.current({ kind: "talk", room: r }, REALMS[r].keeper.name);
      engineRef.current?.setTalked(Object.keys(getProgress().talked));
    },
    onSecret: (id, first) => {
      if (first) {
        markSecret(id);
        void scoreAction("secret", id).catch(() => {});
        const sec = SECRETS.find((x) => x.id === id);
        toast(`✦ Secret passage found — ${sec?.name ?? id}`, "gold", 5200);
        giftRef.current({ kind: "secret" }, sec?.name ?? "a secret passage");
      }
      engineRef.current?.setSecretsFound(Object.keys(getProgress().secrets));
    },
    toast,
  };
  const travel = useCallback((id: string) => {
    setMapOpen(false);
    setDexOpen(false);
    engineRef.current?.travelTo(id);
  }, []);
  const wander = useCallback(() => {
    setMapOpen(false);
    setDexOpen(false);
    setDialogue(null);
    const id = engineRef.current?.wander();
    if (id) toast("🎲 wandering…", "plain", 1800);
  }, [toast]);

  // hotkeys: M map · C crate dex · R wander · Enter pages a keeper. Never while
  // typing in chat, and only over the game's own overlays.
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      escRef.current = true;
      setTimeout(() => (escRef.current = false), 0);
    };
    const onKey = (e: KeyboardEvent) => {
      if (typingRef.current || !startedRef.current) return;
      // typing in any field (the drop box, the list card, a shelf name) must
      // never fire M / C / R — an "r" in a link used to wander you off
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const k = e.key.toLowerCase();
      if (k === "enter" && dialogueOpenRef.current) {
        e.preventDefault();
        dialogueAdvanceRef.current?.();
        return;
      }
      const blocked = crate !== null || ingestOpen || dialogue !== null || fitOpen;
      if (k === "m" && !blocked) {
        setDexOpen(false);
        setMapOpen((o) => !o);
      } else if (k === "c" && !blocked) {
        setMapOpen(false);
        setDexOpen((o) => !o);
      } else if (k === "r" && !blocked && !dexOpen && !mapOpen) {
        wander();
      }
    };
    addEventListener("keydown", onEsc, true); // before the engine's handler
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("keydown", onEsc, true);
      removeEventListener("keydown", onKey);
    };
  }, [crate, ingestOpen, dialogue, fitOpen, dexOpen, mapOpen, wander]);

  // the arrival sign fades itself out
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), banner.first ? 5200 : 3600);
    return () => clearTimeout(t);
  }, [banner]);

  // ----- chat / reactions -----
  const sendChat = useCallback((text: string) => {
    presenceRef.current?.sendChat(text);
  }, []);
  const sendReact = useCallback((emoji: string) => {
    presenceRef.current?.sendReact(emoji);
  }, []);
  // 💃 — a random house move (a new one each press); everyone in the room sees it
  const dance = useCallback(() => {
    const move = engineRef.current?.dance();
    if (!move) return;
    presenceRef.current?.sendDance(move);
    gameRef.current.toast(`💃 ${DANCE_NAMES[move]}`);
  }, []);
  const setTyping = useCallback((v: boolean) => {
    typingRef.current = v;
  }, []);

  // ----- crate controls -----
  const flip = useCallback(
    (d: number) =>
      setCrate((c) =>
        c
          ? {
              ...c,
              idx:
                (c.idx + d + c.shelf.records.length) % c.shelf.records.length,
            }
          : c
      ),
    []
  );
  // selecting a record CUES it for the whole room (plays next), subject to the
  // per-user cue cap (host-enforced). One record at a time — no whole-shelf cue.
  const cueFromCrate = useCallback(
    (idx: number) => {
      const p = presenceRef.current;
      if (!crate || !p || !p.canCue()) return;
      const r = crate.shelf.records[idx];
      p.cue(r);
      // cueing a record keeps it in your dex
      if (keep(r, crate.shelf).isNew) giftRef.current({ kind: "keep" });
      refreshFlowUi();
      setCrate(null);
    },
    [crate, refreshFlowUi, keep]
  );
  const cueTrack = useCallback(
    (t: Track) => {
      const p = presenceRef.current;
      if (!p || !p.canCue()) return;
      p.cue(t);
      refreshFlowUi();
    },
    [refreshFlowUi]
  );
  const uncue = useCallback(
    (key: string) => {
      presenceRef.current?.uncue(key);
      refreshFlowUi();
    },
    [refreshFlowUi]
  );

  // ----- now-playing controls -----
  const onPrev = () => playerRef.current?.replayFromStart(); // restart this track
  const onSkip = () => presenceRef.current?.skip(); // skip — for the whole room
  const onMute = () => playerRef.current?.togglePlay(); // LOCAL mute (just you)
  const onClearCue = useCallback(() => {
    presenceRef.current?.clearCue();
    refreshFlowUi();
  }, [refreshFlowUi]);

  const openAdded = useCallback(() => {
    setAddedOpen((o) => !o);
    setUnseenAdds(0);
  }, []);
  const myColor = presenceRef.current?.color;
  const soloMode = roster <= 1;

  // the door's copy — real numbers only. While lurking, roster = the people
  // inside; after the knock it would count you too, so freeze it there.
  const inside = started ? othersRef.current : roster;
  const doorLive = !rosterKnown
    ? null
    : onAir.live
      ? `ON AIR · ${inside} inside`
      : inside === 0
        ? `Empty right now${phaseLabel ? ` · ${phaseLabel}` : ""}`
        : `${inside} inside${phaseLabel ? ` · ${phaseLabel}` : ""}`;
  const doorLine = onAir.live
    ? onAir.dj
      ? `${onAir.dj} is spinning`
      : "Live from the booth"
    : invite?.claim
      ? `${memberTag(invite.claim)} is waiting for you`
      : invite?.from
        ? `${memberTag(invite.from)} saved you a key`
        : member
          ? `Welcome back, ${memberTag(member)}`
          : rosterKnown && inside === 0
            ? "The room is yours"
            : returning
              ? "Welcome back"
              : null;
  const wrapClass = [dialogue ? "dlgOpen" : "", chrome ? `chrome-${chrome}` : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div id="wrap" className={wrapClass}>
      <canvas ref={canvasRef} id="c" />

      <div id="topbar" className={menuOpen ? "open" : ""}>
        {/* touch: the pills live behind this ☰ (CSS keeps them mounted — the
            venue clock must keep ticking the world light even while hidden) */}
        <button
          id="menuBtn"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="menu"
        >
          {menuOpen ? "✕" : "☰"}
          {!menuOpen && unseenAdds > 0 && <span className="badge">{unseenAdds}</span>}
          {!menuOpen && unseenGifts > 0 && <span className="giftDotMenu">🎁</span>}
        </button>
        {started && <VenueClock engineRef={engineRef} />}
        {started && roster > 0 && (
          <div id="roster" title="listeners in the bar right now">
            ☕ {roster} {roster === 1 ? "listener" : "listeners"}
          </div>
        )}
        {started && (
          <button
            id="addedBtn"
            onClick={() => {
              openAdded();
              setMenuOpen(false);
            }}
            title="recently added records"
          >
            ＋ added
            {unseenAdds > 0 && <span className="badge">{unseenAdds}</span>}
          </button>
        )}
        <button
          id="addBtn"
          onClick={() => {
            openAddRef.current();
            setMenuOpen(false);
          }}
        >
          {owner ? "＋ 新着 add records" : "＋ add a record"}
        </button>
        {started && (
          <button
            id="dexBtn"
            onClick={() => {
              setMapOpen(false);
              setDexOpen(true);
              setMenuOpen(false);
            }}
            title="your Crate Dex — every record you've dug (C)"
          >
            💿 {Object.keys(progress.dug).length}
            <span className="dexPillTitle">{titleFor(Object.keys(progress.dug).length)}</span>
            {unseenGifts > 0 && (
              <span className="giftDot" title="new gifts in your stash">
                🎁{unseenGifts}
              </span>
            )}
          </button>
        )}
        {started && (
          <button
            id="mapBtn"
            onClick={() => {
              setDexOpen(false);
              setMapOpen(true);
              setMenuOpen(false);
            }}
            title="the map of the realms — fast travel (M)"
          >
            🗺 map
            <span className="mapPillCount">
              {REALM_ORDER.filter((r) => progress.visited[r]).length}/{REALM_ORDER.length}
            </span>
          </button>
        )}
        {started && memberNo && (
          <button
            id="listBtn"
            onClick={() => {
              setListOpen(true);
              setMenuOpen(false);
            }}
            title="the Sombra list: live sets, fresh drops, Austin nights"
          >
            ☉☽ the list
          </button>
        )}
        {started && (
          <button
            id="fitBtn"
            onClick={() => {
              setFitOpen(true);
              setMenuOpen(false);
            }}
            title="customize your look"
          >
            ◇ your fit
          </button>
        )}
        {/* the worlds connect both ways — a quiet door back to Sombra */}
        <a
          id="sombraDoor"
          href="https://sombraproject.com"
          title="back to Sombra"
        >
          ☉☽
        </a>
        <div id="hint">
          WASD · move &nbsp; ⇧ · sprint &nbsp; CLICK · anything
          <br />
          E · talk · browse &nbsp; M · map &nbsp; C · dex &nbsp; R · wander
          <br />
          SPACE · mute me &nbsp; N · skip room &nbsp; V · view
        </div>
      </div>

      {/* on touch the pill is tappable — it IS the E button you're standing on */}
      <div
        id="prompt"
        className={prompt ? "show" : ""}
        onClick={() => engineRef.current?.interact()}
        dangerouslySetInnerHTML={{ __html: prompt ?? "" }}
      />

      {/* mobile autoplay was blocked — one tap (a real gesture) starts the sound */}
      {started && np.blocked && (
        <button id="tapSound" onClick={tapToListen}>
          ♪ tap to join the sound
        </button>
      )}

      {np.preview && (
        <PreviewChip preview={np.preview} onStop={() => playerRef.current?.endPreview()} />
      )}

      {started && onAir.live && (
        <div id="onAirBanner">
          🔴 ON AIR — {onAir.dj ?? "THE OWNER"} is spinning · the room is listening
        </div>
      )}

      <NowPlaying
        np={np}
        cue={cue}
        flow={flowUi}
        solo={soloMode}
        myColor={myColor}
        latestAdded={added[0]}
        onPrev={onPrev}
        onSkip={onSkip}
        onMute={onMute}
        onUncue={uncue}
        onClearCue={onClearCue}
      />

      {crate && (
        <Crate
          crate={crate}
          flow={flowUi}
          solo={soloMode}
          dug={progress.dug}
          onClose={() => setCrate(null)}
          onFlip={flip}
          onPick={(i) => setCrate((c) => (c ? { ...c, idx: i } : c))}
          onPlay={() => cueFromCrate(crate.idx)}
          onKeep={(t) => {
            if (keep(t, crate.shelf).isNew) giftRef.current({ kind: "keep" });
          }}
        />
      )}

      {/* ----- the game layer ----- */}
      {banner && <ArrivalBanner banner={banner} />}
      <Toasts toasts={toasts} />
      {dialogue && (
        <Dialogue
          room={dialogue}
          advanceRef={dialogueAdvanceRef}
          onClose={() => setDialogue(null)}
          onMap={() => {
            setDialogue(null);
            setMapOpen(true);
          }}
          onWander={wander}
          gift={(() => {
            const held = giftQueue.find((q) => q.gift.id === KEEPER_GIFT[dialogue]);
            return held ? held.gift : null;
          })()}
        />
      )}
      {giftShowing && (
        <GiftCard
          item={giftShowing}
          owned={GIFTS.filter((g) => progress.gifts?.[g.id]).length}
          wearing={!!fit && giftShowing.gift.kind === "wear" && !!giftShowing.gift.slot && fit[giftShowing.gift.slot] === giftShowing.gift.value}
          onWear={() => wearNow(giftShowing.gift)}
          onStash={() => {
            takeGift();
            setDexTab(STASH);
            setUnseenGifts(0);
            setDexOpen(true);
          }}
          onClose={takeGift}
          onBackdrop={() => {
            if (performance.now() - giftShownAtRef.current > 900) takeGift();
          }}
        />
      )}
      {dexOpen && (
        <Dex
          progress={progress}
          shelves={shelves}
          room={room}
          flow={flowUi}
          solo={soloMode}
          onCue={cueTrack}
          onClose={() => {
            setDexOpen(false);
            setDexTab(undefined);
          }}
          onMap={() => {
            setDexOpen(false);
            setDexTab(undefined);
            setMapOpen(true);
          }}
          startTab={dexTab}
          onSeeStash={() => setUnseenGifts(0)}
        />
      )}
      {mapOpen && (
        <WorldMap
          progress={progress}
          shelves={shelves}
          room={room}
          onTravel={travel}
          onWander={wander}
          onClose={() => setMapOpen(false)}
          onDex={() => {
            setMapOpen(false);
            setDexOpen(true);
          }}
        />
      )}

      <Ingest
        open={ingestOpen}
        shelves={shelves}
        myColor={myColor}
        onClose={() => setIngestOpen(false)}
        onShelvesChange={setShelves}
        onIngested={() => giftRef.current({ kind: "ingest" }, "the bar — thanks for the records")}
      />

      {addedOpen && (
        <AddedBoard
          rows={added}
          onClose={() => setAddedOpen(false)}
          onCue={cueTrack}
          canCue={flowUi.canCue}
        />
      )}

      {fitOpen && fit && (
        <FitPanel
          fit={fit}
          onChange={applyFit}
          onClose={() => setFitOpen(false)}
          membership={membership}
          onOpenList={() => {
            setFitOpen(false);
            setListOpen(true);
          }}
        />
      )}

      {masterOpen && (
        <MasterTalk
          board={board}
          onClose={() => setMasterOpen(false)}
          onBoard={() => {
            setMasterOpen(false);
            setBoardOpen(true);
          }}
          onAdd={() => {
            setMasterOpen(false);
            openAddRef.current();
          }}
          onPick={() => {
            setMasterOpen(false);
            presenceRef.current?.skip();
            toast("The master reaches for the next record…", "plain", 3200);
          }}
        />
      )}

      {boardOpen && <BoardOverlay board={board} onClose={() => setBoardOpen(false)} />}

      {submitOpen && (
        <SubmitCard
          memberNo={memberNo}
          onClose={() => setSubmitOpen(false)}
          onSent={() => giftRef.current({ kind: "ingest" }, "the bar — thanks for the record")}
        />
      )}

      {listOpen && (
        <ListCard
          memberNo={memberNo}
          onClose={() => setListOpen(false)}
          onJoined={() => setMembership((m) => (m ? { ...m, onList: true } : m))}
        />
      )}

      {started && (
        <Lobby
          chat={chat}
          reacts={reacts}
          open={chatOpen}
          onToggle={() => setChatOpen((o) => !o)}
          onSend={sendChat}
          onReact={sendReact}
          onDance={dance}
          onTyping={setTyping}
        />
      )}

      {/* hidden audio players (off-screen) */}
      <div id="bar-players" aria-hidden="true">
        <div ref={ytHostRef} />
        <iframe ref={scFrameRef} title="soundcloud" allow="autoplay" />
      </div>

      {/* mobile controls */}
      <div ref={stickRef} id="stick">
        <div id="stickBase" />
        <div ref={nubRef} id="stickNub" />
      </div>
      <div ref={actBtnRef} id="actBtn">
        E
      </div>
      {/* touch: dance sits beside E (desktop has it in the reaction row) */}
      {started && (
        <button id="danceBtnTouch" onClick={dance} aria-label="dance">
          💃
        </button>
      )}

      {/* the door (id="intro"): its CLICK is the knock, the gesture that lets
          the in-gesture playStation make sound on phones */}
      {doorPhase !== "gone" && (
        <Door
          phase={doorPhase}
          slideMs={doorSlideMs}
          live={doorLive}
          line={doorLine}
          onAir={onAir.live}
          fit={fit}
          onKnock={enter}
          onFit={() => setFitOpen(true)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------ the weekly board */
const byDigs = (b: WeekBoard) => [...b.top].filter((r) => r.digs > 0).sort((x, y) => y.digs - x.digs);
const byTrinkets = (b: WeekBoard) => [...b.top].filter((r) => r.trinkets > 0).sort((x, y) => y.trinkets - x.trinkets);

/** what the whiteboard on the wall shows (top 3 of each) */
function boardView(b: WeekBoard) {
  return {
    diggers: byDigs(b).slice(0, 3).map((r) => [memberTag(r.number), r.digs] as [string, number]),
    collectors: byTrinkets(b).slice(0, 3).map((r) => [memberTag(r.number), r.trinkets] as [string, number]),
  };
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}

/** "Friday at noon · in 2d 4h" */
function resetWhen(endsAt: number): string {
  const h = Math.max(0, (endsAt - Date.now()) / 3_600_000);
  const rel = h < 24 ? `in ${Math.max(1, Math.round(h))}h` : `in ${Math.floor(h / 24)}d ${Math.round(h % 24)}h`;
  return `Friday at noon (Austin) · ${rel}`;
}

/** The master's gossip: who's digging, who's collecting, where you stand. */
function masterLines(b: WeekBoard | null): string[] {
  if (!b) return ["Busy night. Ask me again in a minute."];
  const out: string[] = [];
  const dig = byDigs(b)[0];
  const col = byTrinkets(b)[0];
  if (!dig && !col) out.push("Quiet week so far. Keep a record or two and your number's the first one on my board.");
  if (dig) out.push(`${memberTag(dig.number)} has been digging all week: ${dig.digs} ${dig.digs === 1 ? "record" : "records"} kept.`);
  if (col) out.push(`${memberTag(col.number)}'s carrying the most trinkets: ${col.trinkets}.`);
  if (b.me) {
    out.push(
      b.me.place
        ? `You? ${ordinal(b.me.place)} overall, ${b.me.score} points.`
        : b.me.score
          ? `You've got ${b.me.score} points. Not up there yet. Keep digging.`
          : "You're not on the board yet. Open a crate, keep what moves you."
    );
  }
  out.push(`Board gets wiped ${resetWhen(b.endsAt).replace(" · ", ", ")}.`);
  out.push("Got a record the room should hear? Tell me. I go through them every week.");
  return out;
}

/** Talking to the master behind the bar. */
function MasterTalk({
  board,
  onClose,
  onBoard,
  onAdd,
  onPick,
}: {
  board: WeekBoard | null;
  onClose: () => void;
  onBoard: () => void;
  onAdd: () => void;
  onPick: () => void;
}) {
  return (
    <div
      className="overlay open"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div id="masterTalk" role="dialog" aria-label="The master">
        <div className="mtWho">THE MASTER · 店主</div>
        <div className="mtLines">
          {masterLines(board).map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
        <div className="mtBtns">
          <button type="button" className="primary" onClick={onBoard}>
            read the board
          </button>
          <button type="button" onClick={onAdd}>
            add a record
          </button>
          <button type="button" onClick={onPick}>
            pour me a pick
          </button>
          <button type="button" onClick={onClose}>
            thanks
          </button>
        </div>
      </div>
    </div>
  );
}

/** Zoomed in on the whiteboard: this week's diggers + trinket collectors. */
function BoardOverlay({ board, onClose }: { board: WeekBoard | null; onClose: () => void }) {
  const me = board?.me?.number;
  const list = (rows: WeekBoard["top"], val: (r: WeekBoard["top"][number]) => number, empty: string) =>
    rows.length ? (
      <ol>
        {rows.slice(0, 10).map((r) => (
          <li key={r.number} className={r.number === me ? "me" : ""}>
            <span className="bdTag">{memberTag(r.number)}</span>
            <span className="bdVal">{val(r)}</span>
          </li>
        ))}
      </ol>
    ) : (
      <div className="bdEmpty">{empty}</div>
    );
  return (
    <div
      className="overlay open"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ovClose" onClick={onClose}>
        CLOSE ✕
      </div>
      <div id="boardBox">
        <div className="bdHead">
          <span className="bdTitle">THIS WEEK · 今週</span>
          {board && <span className="bdReset">wiped {resetWhen(board.endsAt)}</span>}
        </div>
        {!board ? (
          <div className="bdEmpty">The board&apos;s being chalked up. Try again in a moment.</div>
        ) : (
          <div className="bdCols">
            <section>
              <h3>Diggers · records kept</h3>
              {list(byDigs(board), (r) => r.digs, "Nobody's kept a record yet. Open a crate.")}
            </section>
            <section>
              <h3>Trinkets collected</h3>
              {list(byTrinkets(board), (r) => r.trinkets, "No trinkets handed out yet.")}
            </section>
          </div>
        )}
        {board?.me && (
          <div className="bdMe">
            You · {memberTag(board.me.number)}
            {board.me.place ? ` · ${ordinal(board.me.place)} overall` : ""} · {board.me.digs} kept · {board.me.trinkets}{" "}
            trinkets · {board.me.score} pts
          </div>
        )}
        <div className="bdLegend">keep a record 10 · trinket 15 · secret passage 25 · realm badge 40 · stay for an ON AIR set 20</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ suggest a record */
/** Visitors suggest records; Sombra reviews them weekly into THIS WEEK or the
 *  Sombra Selection. Step one is following @sombra.atx on Instagram. */
function SubmitCard({
  memberNo,
  onClose,
  onSent,
}: {
  memberNo: number | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [links, setLinks] = useState("");
  const [note, setNote] = useState("");
  const [ig, setIg] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("busy");
    const r = await submitRecords({ text: links, note, instagram: ig }).catch(() => ({
      ok: false,
      message: "Couldn't drop that in just now. Try again in a moment.",
    }));
    if (r.ok) {
      setState("done");
      onSent();
    } else {
      setState("error");
      setMsg(r.message ?? "Couldn't drop that in just now.");
    }
  };
  return (
    <div
      className="overlay open"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form id="submitCard" onSubmit={submit}>
        <button type="button" className="lcX" onClick={onClose}>
          close ✕
        </button>
        <div className="lcKicker">投函 · THE DROP BOX</div>
        <div className="lcTitle">Add a record to the room</div>
        {state === "done" ? (
          <div className="lcBody">
            {"It's in the box. Every week Sombra goes through them, and the best land in This Week or the Sombra Selection. Keep an eye on the crates."}
          </div>
        ) : (
          <>
            <div className="lcBody">
              Every week Sombra reviews what&apos;s been dropped in, and the best go into <b>This Week</b> or the{" "}
              <b>Sombra Selection</b>.
            </div>
            <div className="scStep">
              <span className="scNum">1</span>
              <span>
                Follow{" "}
                <a href="https://www.instagram.com/sombra.atx/" target="_blank" rel="noopener noreferrer">
                  @sombra.atx
                </a>{" "}
                on Instagram. That&apos;s where picks get shouted out.
              </span>
            </div>
            <div className="scStep">
              <span className="scNum">2</span>
              <span>Paste a YouTube or SoundCloud link (up to 5, one per line). House only.</span>
            </div>
            <textarea
              id="submitLinks"
              aria-label="Record links"
              placeholder={"Artist — Title | https://youtu.be/…"}
              value={links}
              onChange={(e) => setLinks(e.target.value)}
              required
            />
            <input
              id="submitNote"
              aria-label="Why this one (optional)"
              placeholder="Why this one? (optional)"
              value={note}
              maxLength={280}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="lcField">
              <input
                id="submitIg"
                aria-label="Your Instagram (optional)"
                placeholder="@your.instagram (optional)"
                value={ig}
                maxLength={40}
                onChange={(e) => setIg(e.target.value)}
              />
              <button type="submit" disabled={state === "busy"}>
                {state === "busy" ? "…" : "Drop it in"}
              </button>
            </div>
            {state === "error" && <div className="lcErr">{msg}</div>}
          </>
        )}
        <div className="lcFine">
          {memberNo ? `From member ${memberTag(memberNo)} · ` : ""}reviewed every week
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------ membership */
const LIST_ASKED = "hallu-list-asked";

/** In the fit panel: your number, your keys (copy a link to bring someone in),
 *  who you've brought in, and the Sombra list. */
function MemberCard({ m, onOpenList }: { m: Membership; onOpenList: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const open = m.keys.filter((k) => !k.used);
  const copy = (code: string) => {
    const url = `${location.origin}/k/${code}`;
    navigator.clipboard
      .writeText(url)
      .then(() => setCopied(code))
      .catch(() => window.prompt("Copy your key link:", url));
  };
  return (
    <div id="memberCard">
      <div className="mcHead">
        <span className="mcNum">{memberTag(m.number)}</span>
        <span className="mcSub">
          member{m.broughtIn > 0 ? ` · brought in ${m.broughtIn}` : ""}
        </span>
      </div>
      <div className="mcLabel">
        {`Your keys: send one to bring someone in. They'll see "${memberTag(m.number)} saved you a key".`}
      </div>
      {open.length ? (
        <div className="mcKeys">
          {open.map((k) => (
            <button key={k.code} type="button" className="mcKey" onClick={() => copy(k.code)}>
              ⚿ {k.code} <span>{copied === k.code ? "link copied" : "copy link"}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="mcLabel">All your keys are out. Stay for an ON AIR set to earn another.</div>
      )}
      {m.onList ? (
        <div className="mcList done">✓ On the Sombra list</div>
      ) : (
        <button type="button" className="mcList" onClick={onOpenList}>
          ☉☽ Stay close to the room: join the list
        </button>
      )}
    </div>
  );
}

/** "Stay close to the room." The one ask: shown once after your first crate, and
 *  from the menu / fit panel after that. */
function ListCard({
  memberNo,
  onClose,
  onJoined,
}: {
  memberNo: number | null;
  onClose: () => void;
  onJoined: () => void;
}) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("busy");
    const r = await joinList(email).catch(() => ({ ok: false, message: "Couldn't save that just now. Try again in a moment." }));
    if (r.ok) {
      setState("done");
      onJoined();
      setTimeout(onClose, 2200);
    } else {
      setState("error");
      setMsg(r.message ?? "Couldn't save that just now.");
    }
  };
  return (
    <div
      className="overlay open"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form id="listCard" onSubmit={submit}>
        <button type="button" className="lcX" onClick={onClose}>
          not now ✕
        </button>
        <div className="lcKicker">☉☽ THE SOMBRA LIST</div>
        <div className="lcTitle">Stay close to the room</div>
        {state === "done" ? (
          <div className="lcBody">{"You're on the list. We'll keep you posted."}</div>
        ) : (
          <>
            <div className="lcBody">
              Live sets, fresh drops, and the good nights in Austin, Texas. A few emails a month, never spam.
            </div>
            <div className="lcField">
              <input
                id="listEmail"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@email.com"
                aria-label="Your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <button type="submit" disabled={state === "busy"}>
                {state === "busy" ? "…" : "Keep me posted"}
              </button>
            </div>
            {state === "error" && <div className="lcErr">{msg}</div>}
          </>
        )}
        <div className="lcFine">
          {memberNo ? `Saved with member ${memberTag(memberNo)} · ` : ""}unsubscribe any time
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------ dig preview */
// "you're hearing this record, not the room" — with the seconds left and a way
// straight back. Sits above the crate overlay.
function PreviewChip({
  preview,
  onStop,
}: {
  preview: NonNullable<PlayerState["preview"]>;
  onStop: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((preview.until - now) / 1000));
  return (
    <div id="previewChip" role="status">
      <span className="pvDot" />
      <span className="pvText">
        previewing · <b>{preview.artist || preview.title}</b>
      </span>
      <span className="pvLeft">0:{String(left).padStart(2, "0")}</span>
      <button type="button" onClick={onStop}>
        back to the room
      </button>
    </div>
  );
}

/* ------------------------------------------------------------ venue clock */
// The world-time HUD pill + the one-way push of the eased phase light into the
// engine. Kept as its own component so the ~1s tick re-renders ONLY this pill, not
// the whole Bar tree. UTC-global on purpose: every client shows the same hour.
function VenueClock({ engineRef }: { engineRef: RefObject<BarEngine | null> }) {
  const [phase, setPhase] = useState(() => phaseAt(Date.now()));
  useEffect(() => {
    const tick = () => {
      const p = phaseAt(Date.now());
      setPhase(p);
      engineRef.current?.setPhase(p.light);
    };
    tick(); // push immediately on enter, don't wait a second for the first tint
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [engineRef]);
  return (
    <div
      id="venueClock"
      title="the venue runs on its own world-time (UTC) — everyone here shares the same hour"
    >
      <span className="vcGlyph">{phase.glyph}</span>
      <span className="vcLabel">{phase.label}</span>
      <span className="vcTime">{phase.utcLabel}</span>
    </div>
  );
}

/* ------------------------------------------------------------ now playing */
function NowPlaying({
  np,
  cue,
  flow,
  solo,
  myColor,
  latestAdded,
  onPrev,
  onSkip,
  onMute,
  onUncue,
  onClearCue,
}: {
  np: PlayerState;
  cue: CueItem[];
  flow: FlowUi;
  solo: boolean;
  myColor?: string;
  latestAdded?: AddedRow;
  onPrev: () => void;
  onSkip: () => void;
  onMute: () => void;
  onUncue: (key: string) => void;
  onClearCue: () => void;
}) {
  // touch: the card rides collapsed (a slim top mini-bar); tap to expand.
  // Desktop CSS ignores `open` entirely — the full card is always shown there.
  const [open, setOpen] = useState(false);
  const t = np.track;
  const link = t?.scUrl ?? (t?.ytId ? `https://www.youtube.com/watch?v=${t.ytId}` : "#");
  const src =
    np.source === "sc"
      ? "☁ SOUNDCLOUD · audio"
      : np.source === "yt"
      ? "▶ YOUTUBE · audio"
      : "";
  const next = cue[0];
  const cd = Math.ceil(flow.cooldownLeft / 1000);
  // skip-button label scales with the crowd: solo = instant; otherwise show votes
  const skipLabel = solo
    ? "⏭ skip"
    : flow.skipNeed <= 1
    ? "⏭ skip room"
    : `⏭ skip (${flow.skipHave}/${flow.skipNeed})`;
  const miniSkip =
    cd > 0 ? `⏳${cd}` : !solo && flow.skipNeed > 1 ? `⏭ ${flow.skipHave}/${flow.skipNeed}` : "⏭";
  return (
    <div id="np" className={(np.visible ? "" : "hidden") + (open ? " open" : "")}>
      <div id="npHead" onClick={() => setOpen((o) => !o)}>
        <div className={"disc" + (np.playing ? " spin" : "")} />
        <div id="npMeta">
          <div id="npLabel">♫ THE ROOM · NOW PLAYING</div>
          <div id="npTitle">{t?.title ?? "—"}</div>
          <div id="npArtist">{t?.artist ?? "—"}</div>
          <div id="npSrc">{src}</div>
        </div>
        {/* touch-only quick controls — the whole mini-bar in one row */}
        <div id="npMini">
          <button
            className="mbtn act"
            title="mute / unmute — just you"
            onClick={(e) => {
              e.stopPropagation();
              onMute();
            }}
          >
            {np.playing ? "🔊" : "🔇"}
          </button>
          <button
            className="mbtn act"
            disabled={cd > 0}
            title={solo ? "skip" : "vote to skip for the whole room"}
            onClick={(e) => {
              e.stopPropagation();
              onSkip();
            }}
          >
            {miniSkip}
          </button>
          <button className="mbtn" aria-label="expand">
            {open ? "▴" : "▾"}
          </button>
        </div>
      </div>
      <div id="bar">
        <div id="barFill" style={{ width: `${Math.round(np.progress * 100)}%` }} />
      </div>

      {/* up next (the cue) — own entries are removable; anyone can clear it */}
      {cue.length > 0 && (
        <div id="cue">
          <div id="cueHead">
            <span>⤵ UP NEXT · {cue.length} cued</span>
            <button
              className="cueClear"
              title="clear the whole cue (anti-spam)"
              onClick={onClearCue}
            >
              clear
            </button>
          </div>
          <div id="cueList">
            {cue.slice(0, 4).map((c, i) => {
              const mine = myColor && c.by === myColor;
              return (
                <div className="cueItem" key={trackKey(c.track) + i}>
                  <span className="cueDot" style={{ background: c.by }} />
                  <span className="cueText">
                    {next === c ? "▶ " : ""}
                    {c.track.artist ? `${c.track.artist} — ` : ""}
                    {c.track.title}
                  </span>
                  {mine && (
                    <button
                      className="cueX"
                      title="remove your cue"
                      onClick={() => onUncue(trackKey(c.track))}
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
            {cue.length > 4 && <div className="cueMore">+{cue.length - 4} more</div>}
          </div>
        </div>
      )}

      {/* just added (trio: now / up-next / just-added) */}
      {latestAdded && (
        <div id="justAdded">
          <span className="cueDot" style={{ background: latestAdded.color }} />
          <span className="cueText">
            ＋ just added: {latestAdded.artist ? `${latestAdded.artist} — ` : ""}
            {latestAdded.title}
          </span>
        </div>
      )}

      <div id="npCtl">
        <button className="cbtn" onClick={onPrev} title="restart this track">
          ⏮
        </button>
        <button className="cbtn" onClick={onMute} title="mute / unmute — just you">
          {np.playing ? "🔊" : "🔇"} mute me
        </button>
        <button
          className="cbtn"
          onClick={onSkip}
          disabled={cd > 0}
          title={
            cd > 0
              ? `cooling down — ${cd}s`
              : solo
              ? "skip"
              : "vote to skip for the whole room"
          }
        >
          {cd > 0 ? `⏳ ${cd}s` : skipLabel}
        </button>
        <a id="npLink" href={link} target="_blank" rel="noopener noreferrer">
          open ↗
        </a>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ crate flip */
function Crate({
  crate,
  flow,
  solo,
  dug,
  onClose,
  onFlip,
  onPick,
  onPlay,
  onKeep,
}: {
  crate: CrateState;
  flow: FlowUi;
  solo: boolean;
  dug: ReturnType<typeof getProgress>["dug"];
  onClose: () => void;
  onFlip: (d: number) => void;
  onPick: (idx: number) => void;
  onPlay: () => void;
  onKeep: (t: Track) => void;
}) {
  // The back of the record: the whole tracklist at once (Side A / Side B),
  // play counts, ↑/↓ to move, ↵ to cue, K to keep. The selected record
  // previews just for you (the room plays on).
  const { shelf, idx } = crate;
  const rec = shelf.records[idx];
  const kept = dug[recordKey(rec)];
  const [caught, setCaught] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  // flipping to a record counts as seeing it (the Dex's "seen")
  useEffect(() => {
    markSeen(rec);
  }, [rec]);
  // keep the selected row in view as you arrow through
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${idx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [idx]);
  const atCap = !flow.canCue;
  const keepIt = () => {
    if (kept) return;
    onKeep(rec);
    setCaught(recordKey(rec));
  };
  // keyboard: the list owns the arrows while the crate is open
  const keysRef = useRef({ onFlip, onPlay, keepIt, atCap });
  keysRef.current = { onFlip, onPlay, keepIt, atCap };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keysRef.current;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") k.onFlip(1);
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") k.onFlip(-1);
      else if (e.key === "Enter") {
        if (!k.atCap) k.onPlay();
      } else if (e.key.toLowerCase() === "k") k.keepIt();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, []);

  const col = shelf.color;
  const big = (rec.artist || rec.title).split(/[\s&]/)[0].toUpperCase();
  const waitSec = Math.ceil(flow.cueWaitLeft / 1000);
  const cueLabel = solo
    ? "⤵ CUE NEXT"
    : waitSec > 0
    ? `⤵ wait ${waitSec}s to cue`
    : atCap
    ? "wait for one to play"
    : `⤵ CUE NEXT (${flow.myCue}/${flow.cueCap})`;
  const n = shelf.records.length;
  const sideB = Math.ceil(n / 2); // first index on Side B
  const pos = (i: number) => (i < sideB ? `A${i + 1}` : `B${i - sideB + 1}`);
  return (
    <div
      className="overlay open"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ovClose" onClick={onClose}>
        CLOSE ✕
      </div>
      <div id="recordBack" style={{ ["--crate" as string]: col }}>
        <header className="rbHead">
          <div className="rbLabel">{shelf.label}</div>
          <div className="rbCat">
            SOMBRA · {n} {n === 1 ? "record" : "records"} · reshuffled every friday
          </div>
        </header>
        <div className="rbBody">
          <aside className="rbNow">
            <div
              className={"rbSleeve" + (caught === recordKey(rec) ? " caught" : "")}
              key={recordKey(rec)}
              style={{ background: `linear-gradient(135deg, ${col}, ${shade(col, -58)})` }}
            >
              <div className="vinyl" />
              <div className="big" style={{ color: shade(col, 95) }}>
                {big}
              </div>
              {kept && (
                <div className="sleeveDex">
                  <TierChip tier={kept.tier} small />
                  <span>IN DEX</span>
                </div>
              )}
            </div>
            <div className="rbArtist">{rec.artist || "—"}</div>
            <div className="rbTitle">{rec.title}</div>
            <div className="rbStats">
              {pos(idx)} · played {rec.plays ?? 0} {(rec.plays ?? 0) === 1 ? "time" : "times"}
              {rec.durationSeconds ? ` · ${fmtLen(rec.durationSeconds)}` : ""}
            </div>
            <button id="playBtn" onClick={onPlay} disabled={atCap}>
              {cueLabel}
            </button>
            <button
              id="keepBtn"
              className={kept ? "kept" : ""}
              onClick={keepIt}
              title="keep it in your Crate Dex (no cue needed)"
            >
              {kept ? "✓ in your dex" : "✦ keep"}
            </button>
          </aside>
          <ol className="rbList" ref={listRef} role="listbox" aria-label={`${shelf.label} tracklist`}>
            {shelf.records.map((t, i) => (
              <Fragment key={recordKey(t) + i}>
                {(i === 0 || i === sideB) && <li className="rbSide">SIDE {i === 0 ? "A" : "B"}</li>}
                <li
                  data-i={i}
                  role="option"
                  aria-selected={i === idx}
                  className={"rbRow" + (i === idx ? " on" : "")}
                  onClick={() => onPick(i)}
                >
                  <span className="rbPos">{pos(i)}</span>
                  <span className="rbTrack">
                    <b>{t.artist || "—"}</b> {t.title}
                  </span>
                  <span className="rbPlays" title="times played in the room">
                    {dug[recordKey(t)] ? "✦ " : ""}▶ {t.plays ?? 0}
                  </span>
                  <span className="rbLen">{t.durationSeconds ? fmtLen(t.durationSeconds) : ""}</span>
                </li>
              </Fragment>
            ))}
          </ol>
        </div>
        <footer className="rbFoot">
          <span className="deskOnly">↑ ↓ browse · ↵ cue · K keep · </span>▶ plays in the room · ✦ in your dex
        </footer>
      </div>
    </div>
  );
}

/** 6:12, or 1:02:40 for a full set */
function fmtLen(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

/* ------------------------------------------------------------ ingest */
const NEW_SHELF = "__new";

function Ingest({
  open,
  shelves,
  myColor,
  onClose,
  onShelvesChange,
  onIngested,
}: {
  open: boolean;
  shelves: Shelf[];
  myColor?: string;
  onClose: () => void;
  onShelvesChange: (s: Shelf[]) => void;
  /** records were added (the bar thanks you with a gift) */
  onIngested?: (count: number) => void;
}) {
  // default the file-into picker to the live ingest crate, like the prototype
  const ingestShelfId =
    shelves.find((s) => s.ingest)?.id ?? shelves[0]?.id ?? NEW_SHELF;
  const [text, setText] = useState("");
  const [target, setTarget] = useState(ingestShelfId);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#7e9b5e");
  const [newEnergy, setNewEnergy] = useState(3);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ ok: boolean; msg: string } | null>(null);
  const [rejected, setRejected] = useState<{ title: string; reason: string }[]>([]);

  // every shelf is a valid target, like the prototype
  const options = useMemo(
    () =>
      shelves.map((s) => ({
        id: s.id,
        slug: s.slug,
        label: s.label.replace(/·.*/, "").trim(),
      })),
    [shelves]
  );

  // The server action parses, enriches titles, and persists — then we mirror the
  // returned records into local state so the room updates without a reload.
  const doAdd = async () => {
    if (busy) return;
    setBusy(true);
    setLog(null);
    setRejected([]);
    try {
      const res = await ingestLinks({
        text,
        byColor: myColor,
        target:
          target === NEW_SHELF
            ? { kind: "new", name: newName, color: newColor, energy: newEnergy }
            : { kind: "existing", shelfId: target },
      });
      setRejected(res.rejected ?? []);
      if (!res.ok || !res.shelf || !res.records) {
        setLog({ ok: false, msg: res.message });
        return;
      }
      const { shelf, records } = res;
      const next = shelves.map((s) => ({ ...s, records: s.records.slice() }));
      const existing = next.find((s) => s.id === shelf.id);
      if (existing) {
        existing.records.push(...records);
      } else {
        const created: Shelf = {
          id: shelf.id,
          label: shelf.label,
          color: shelf.color,
          records: records.slice(),
          ingest: shelf.ingest,
          energy: shelf.energy ?? 3,
        };
        // keep "new arrivals" last
        const ingestIdx = next.findIndex((s) => s.ingest);
        next.splice(ingestIdx < 0 ? next.length : ingestIdx, 0, created);
      }
      onShelvesChange(next);
      onIngested?.(records.length);
      setLog({
        ok: true,
        msg: `＋ filed ${records.length} record${
          records.length > 1 ? "s" : ""
        } into ${shelf.label.replace(/·.*/, "").trim()}.`,
      });
      setText("");
      setTarget(shelf.id);
    } catch {
      setLog({ ok: false, msg: "Couldn’t reach the bar. Try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={"overlay" + (open ? " open" : "")}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ovClose" onClick={onClose}>
        CLOSE ✕
      </div>
      <div id="ingestBox">
        <h2>新着 · New Arrivals</h2>
        <div className="sub">
          Paste links — one per line. YouTube or SoundCloud. Optionally tag
          them:
          <br />
          <code>Artist — Title | https://…</code> &nbsp;or just drop the raw URL
          and I&apos;ll fetch the name.
          <br />
          <span style={{ opacity: 0.7 }}>
            ⏱ tracks 15 min or longer are skipped automatically.
          </span>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            "https://www.youtube.com/watch?v=...\nBicep — Glue | https://soundcloud.com/.../glue\nhttps://youtu.be/..."
          }
        />
        <div className="row">
          <span style={{ fontSize: 11, opacity: 0.6 }}>file into</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
                {o.slug && CURATED_CRATES.has(o.slug) ? " — curated (owner)" : ""}
              </option>
            ))}
            <option value={NEW_SHELF}>＋ new shelf… — owner</option>
          </select>
          {target === NEW_SHELF && (
            <>
              <input
                id="newName"
                placeholder="…or new shelf name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <input
                id="newColor"
                type="color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
              />
              <select
                id="newEnergy"
                value={newEnergy}
                onChange={(e) => setNewEnergy(Number(e.target.value))}
                title="crate energy (1 calm → 5 peak) — the radio leans toward crates that fit the hour"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    ⚡{n}
                  </option>
                ))}
              </select>
            </>
          )}
          <button className="btn" onClick={doAdd} disabled={busy}>
            {busy ? "Adding…" : "Add to shelf"}
          </button>
        </div>
        {log && (
          <div id="ingestLog">
            <span className={log.ok ? "ok" : "no"}>{log.msg}</span>
            {rejected.map((r, i) => (
              <div key={i} className="no" style={{ fontSize: 10, opacity: 0.85 }}>
                ✕ {r.title} — {r.reason}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ added board */
function AddedBoard({
  rows,
  onClose,
  onCue,
  canCue,
}: {
  rows: AddedRow[];
  onClose: () => void;
  onCue: (t: Track) => void;
  canCue: boolean;
}) {
  return (
    <div id="addedDrawer">
      <div id="addedHead">
        <span>＋ RECENTLY ADDED</span>
        <span className="addedClose" onClick={onClose}>
          ✕
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="addedEmpty">
          nothing yet — pour links into 新着 NEW ARRIVALS
        </div>
      ) : (
        <div id="addedList">
          {rows.map((r) => (
            <div className="addedItem" key={r.id}>
              <span className="cueDot" style={{ background: r.color }} />
              <div className="addedMeta">
                <div className="addedTitle">
                  {r.artist ? `${r.artist} — ` : ""}
                  {r.title}
                </div>
                <div className="addedAgo">{ago(r.at)}</div>
              </div>
              <button
                className="addedCue"
                disabled={!canCue}
                title={canCue ? "cue this for the room" : "wait for one to play"}
                onClick={() =>
                  onCue({
                    title: r.title,
                    artist: r.artist,
                    ytId: r.ytId,
                    scUrl: r.scUrl,
                    id: r.id,
                  })
                }
              >
                ⤵ cue
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ fit */
// (AvatarPreview — the live 3D fit portrait — lives in components/game/shared.tsx)

function Swatch({
  color,
  on,
  onClick,
}: {
  color: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={"swatch" + (on ? " on" : "")}
      style={{ background: color }}
      onClick={onClick}
      aria-label={color}
    />
  );
}

function FitPanel({
  fit,
  onChange,
  onClose,
  membership,
  onOpenList,
}: {
  fit: Fit;
  onChange: (f: Fit) => void;
  onClose: () => void;
  membership: Membership | null;
  onOpenList: () => void;
}) {
  return (
    <div
      id="fitOverlay"
      className="overlay open"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ovClose" onClick={onClose}>
        CLOSE ✕
      </div>
      <div id="fitBox">
        <h2>◇ Your Fit</h2>
        <div className="sub">
          How you look to everyone else in the bar. Saved on this device.
        </div>

        <div id="fitStage">
          <AvatarPreview fit={fit} size={150} animate />
        </div>

        {membership && <MemberCard m={membership} onOpenList={onOpenList} />}

        <div className="fitRow">
          <span className="fitLabel">skin</span>
          <div className="swatches">
            {SKINS.map((c) => (
              <Swatch
                key={c}
                color={c}
                on={fit.skin === c}
                onClick={() => onChange({ ...fit, skin: c })}
              />
            ))}
          </div>
        </div>
        <div className="fitRow">
          <span className="fitLabel">outfit</span>
          <div className="swatches">
            {OUTFITS.map((c) => (
              <Swatch
                key={c}
                color={c}
                on={fit.body === c}
                onClick={() => onChange({ ...fit, body: c })}
              />
            ))}
          </div>
        </div>
        <div className="fitRow">
          <span className="fitLabel">hair</span>
          <div className="swatches">
            {HAIRS.map((c) => (
              <Swatch
                key={c}
                color={c}
                on={fit.hair === c}
                onClick={() => onChange({ ...fit, hair: c })}
              />
            ))}
          </div>
        </div>
        <GearRow slot="hat" label="hat" fit={fit} onChange={onChange} />
        <GearRow slot="top" label="top" fit={fit} onChange={onChange} />
        <GearRow slot="neck" label="neck" fit={fit} onChange={onChange} />
        <GearRow slot="eyes" label="eyes" fit={fit} onChange={onChange} />
        <GearRow slot="back" label="back" fit={fit} onChange={onChange} />

        <div className="fitActions">
          <button className="btn ghost" onClick={() => onChange(randomOwnedFit())}>
            🎲 randomize
          </button>
          <button className="btn" onClick={onClose}>
            done
          </button>
        </div>
      </div>
    </div>
  );
}

/** A random look from the free swatches + only the gear you've been gifted. */
function randomOwnedFit(): Fit {
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  const o = ownedGear();
  return {
    skin: pick(SKINS),
    body: pick(OUTFITS),
    hair: pick(HAIRS),
    hat: pick(o.hat),
    top: pick(o.top),
    neck: pick(o.neck),
    eyes: pick(o.eyes),
    back: pick(o.back),
  };
}

const GEAR_BASE: Record<GiftSlot, { value: string; label: string }> = {
  hat: { value: "none", label: "—" },
  top: { value: "basic", label: "basic tee" },
  neck: { value: "none", label: "—" },
  eyes: { value: "none", label: "—" },
  back: { value: "none", label: "—" },
};

/** One gear slot in the fit panel: the basic default + what you've been gifted,
 *  and how many pieces for this slot are still out there. */
function GearRow({
  slot,
  label,
  fit,
  onChange,
}: {
  slot: GiftSlot;
  label: string;
  fit: Fit;
  onChange: (f: Fit) => void;
}) {
  useProgress(); // re-render when a new piece is gifted
  const base = GEAR_BASE[slot];
  const all = GIFTS.filter((g) => g.slot === slot);
  const owned = new Set<string>(ownedGear()[slot] as string[]);
  const mine = all.filter((g) => owned.has(g.value as string));
  const locked = all.length - mine.length;
  const current = (fit[slot] as string | undefined) ?? base.value;
  const set = (v: string) => onChange({ ...fit, [slot]: v } as Fit);
  return (
    <div className="fitRow">
      <span className="fitLabel">{label}</span>
      <div className="hatRow">
        <button className={"hatChip" + (current === base.value ? " on" : "")} onClick={() => set(base.value)}>
          {base.label}
        </button>
        {mine.map((g) => (
          <button
            key={g.id}
            className={"hatChip" + (current === g.value ? " on" : "")}
            onClick={() => set(g.value as string)}
            title={g.blurb}
          >
            {g.icon} {g.name}
          </button>
        ))}
        {locked > 0 && (
          <span className="gearLocked" title="keep digging, keep talking — the bar gifts gear as you play">
            🎁 ×{locked} more to find
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ lobby */
function Lobby({
  chat,
  reacts,
  open,
  onToggle,
  onSend,
  onReact,
  onDance,
  onTyping,
}: {
  chat: ChatMessage[];
  reacts: Reaction[];
  /** touch only: whether the chat input + reactions are expanded (💬 toggle).
   *  Desktop ignores this — CSS keeps the lobby always expanded there. */
  open: boolean;
  onToggle: () => void;
  onSend: (text: string) => void;
  onReact: (emoji: string) => void;
  onDance: () => void;
  onTyping: (v: boolean) => void;
}) {
  const [text, setText] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };
  return (
    <>
      {/* floating emoji reactions */}
      <div id="reactStream" aria-hidden="true">
        {reacts.map((r, i) => (
          <span
            key={r.key}
            className="reactPop"
            style={{ left: `${(i % 5) * 26}px`, color: r.color }}
          >
            {r.emoji}
          </span>
        ))}
      </div>

      {/* touch: chat lives behind this toggle so the small screen stays clear */}
      <button id="chatToggle" onClick={onToggle} aria-label="chat">
        {open ? "✕" : "💬"}
      </button>

      <div id="lobby" className={open ? "open" : ""}>
        <div id="chatLog">
          {chat.map((m) => (
            <div key={m.key} className="chatMsg">
              <span className="chatDot" style={{ background: m.color }} />
              <span className="chatText">{m.text}</span>
            </div>
          ))}
        </div>
        <div id="reactRow">
          <button id="danceBtn" className="reactBtn" onClick={onDance} title="dance — a random house move">
            💃 dance
          </button>
          {REACTIONS.map((e) => (
            <button
              key={e}
              className="reactBtn"
              onClick={() => onReact(e)}
              aria-label={`react ${e}`}
            >
              {e}
            </button>
          ))}
        </div>
        <form id="chatForm" onSubmit={submit}>
          <input
            id="chatInput"
            value={text}
            maxLength={240}
            placeholder="say something to the bar…"
            onChange={(e) => setText(e.target.value)}
            onFocus={() => onTyping(true)}
            onBlur={() => onTyping(false)}
          />
          <button type="submit" className="chatSend" aria-label="send">
            ↵
          </button>
        </form>
      </div>
    </>
  );
}
