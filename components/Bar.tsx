"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { BarEngine } from "@/lib/bar/engine";
import { drawFit } from "@/lib/bar/three/preview";
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
import {
  loadFit,
  saveFit,
  randomFit,
  SKINS,
  OUTFITS,
  HAIRS,
  HATS,
  hatLabel,
  type Fit,
} from "@/lib/bar/fits";
import type { Shelf, Track } from "@/lib/bar/types";

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

/** flow-rule numbers mirrored into the UI (derived from lib/bar/flow.ts) */
interface FlowUi {
  myCue: number;
  cueCap: number;
  canCue: boolean;
  skipHave: number;
  skipNeed: number;
  cooldownLeft: number;
  cueWaitLeft: number;
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
};

export default function Bar({ initialShelves }: { initialShelves: Shelf[] }) {
  // ----- library: seeded server-side from Supabase (see lib/bar/data.ts) -----
  const [shelves, setShelves] = useState<Shelf[]>(initialShelves);
  const shelvesRef = useRef(shelves);
  shelvesRef.current = shelves;

  // ----- UI state -----
  const [started, setStarted] = useState(false);
  const startedRef = useRef(false); // read inside presence callbacks
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

  // ----- refs read every frame by the engine (avoid per-frame re-render) -----
  const playingRef = useRef(false);
  const overlayOpenRef = useRef(false);
  overlayOpenRef.current = crate !== null || ingestOpen;
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
          else setIngestOpen(true);
        },
        onOpenIngest: () => setIngestOpen(true),
        // the bar master skips the room to the next track (cue first, then radio)
        onMastersPick: () => presenceRef.current?.skip(),
        onShowDeck: () => player.showDeck(),
        onTogglePlay: () => player.togglePlay(), // local mute toggle
        onNext: () => presenceRef.current?.skip(), // skip the whole room
        onCloseOverlays: () => {
          setCrate(null);
          setIngestOpen(false);
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
        },
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
    const initialFit = loadFit() ?? randomFit();
    setFit(initialFit);
    engine.setPlayerFit(initialFit);

    // Join the lobby channel immediately, but only LURKING (not tracked as
    // present, so no ghost listeners): by the time the user taps to enter, the
    // current track + offset are already known and playable in-gesture.
    const presence: BarPresence = new BarPresence({
      fit: initialFit,
      getPose: () =>
        engineRef.current?.getPlayerPose() ?? { x: 570, y: 470, dir: 1 },
      onRoster: (n) => setRoster(n),
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
        setCue(s.cue);
        setOnAir({ live: s.live, dj: s.dj, locked: s.cueLocked });
        engineRef.current?.setOnAir(s.live, s.dj); // light the in-world sign
        refreshFlowUi();
        if (!startedRef.current) return; // lurking — the intro tap starts audio
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
  const enter = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    setStarted(true);
    engineRef.current?.start();

    const player = playerRef.current;
    const p = presenceRef.current;
    const s = latestRoomRef.current ?? p?.currentRoom() ?? null;
    if (player && s?.now) {
      // the lurk phase already learned the room's track — join it in-gesture
      const offset = Math.max(0, (Date.now() - s.startedAt) / 1000);
      player.playStation(s.now, offset);
      p?.notePlayed(s.startedAt); // don't reload on the matching broadcast
    } else if (player) {
      // empty room (we're about to be host) — pre-pick the opener and start it
      // now; openRoom() hands this same pick to the host bootstrap
      const seed = Math.floor(Math.random() * 0x7fffffff);
      const target = phaseAt(Date.now()).target;
      const track = weightedPick(shelvesRef.current, target, mulberry32(seed));
      if (track) {
        pendingOpenRef.current = { track, seed, index: 0 };
        player.playStation(track, 0);
      }
    }

    // become a live character others can see (lurker → listener)
    p?.materialize();
  }, []);

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

  // ----- chat / reactions -----
  const sendChat = useCallback((text: string) => {
    presenceRef.current?.sendChat(text);
  }, []);
  const sendReact = useCallback((emoji: string) => {
    presenceRef.current?.sendReact(emoji);
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
  // selecting a record CUES it for the whole room (plays next). A whole shelf
  // cues tracks in order, each subject to the per-user cue cap (host-enforced;
  // we also stop early client-side so the UI doesn't imply more got through).
  const cueFromCrate = useCallback(
    (start: number, whole: boolean) => {
      const p = presenceRef.current;
      if (!crate || !p) return;
      const recs = whole ? crate.shelf.records : [crate.shelf.records[start]];
      for (const r of recs) {
        if (!p.canCue()) break;
        p.cue(r);
      }
      refreshFlowUi();
      setCrate(null);
    },
    [crate, refreshFlowUi]
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

  return (
    <div id="wrap">
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
            setIngestOpen(true);
            setMenuOpen(false);
          }}
        >
          ＋ 新着 add records
        </button>
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
          WASD · move &nbsp; E · browse
          <br />
          SPACE · mute me &nbsp; N · skip room
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
          onClose={() => setCrate(null)}
          onFlip={flip}
          onPlay={() => cueFromCrate(crate.idx, false)}
          onPlayShelf={() => cueFromCrate(0, true)}
        />
      )}

      <Ingest
        open={ingestOpen}
        shelves={shelves}
        myColor={myColor}
        onClose={() => setIngestOpen(false)}
        onShelvesChange={setShelves}
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

      {/* onClick, NOT pointerdown: on touch only click carries the user
          activation that lets the in-gesture playStation make sound */}
      <div id="intro" className={started ? "gone" : ""} onClick={enter}>
        <div className="glow" />
        <div id="introInner">
          <div id="presents">☉☽ &nbsp;SOMBRA PRESENTS</div>
          <div id="kanji">音楽喫茶</div>
          <div id="title">HALLUCINATE</div>
          <div id="sub">ONGAKU KISSA · A LISTENING BAR</div>
          <div id="enter">▸ SLIDE THE DOOR OPEN ◂</div>
          {fit && (
            <button
              id="introFit"
              onClick={(e) => {
                e.stopPropagation(); // don't let the tap fall through to "enter"
                setFitOpen(true);
              }}
            >
              <AvatarPreview fit={fit} size={20} /> ◇ customize your fit
            </button>
          )}
          <div id="howto">
            <span className="deskOnly">
              <span className="key">WASD</span> walk &nbsp;·&nbsp;{" "}
              <span className="key">CLICK</span> walk-to &nbsp;·&nbsp;{" "}
              <span className="key">E</span> browse a shelf
            </span>
            <span className="touchOnly">
              drag the <b>stick</b> to walk &nbsp;·&nbsp; tap{" "}
              <span className="key">E</span> to browse a shelf
            </span>
            <br />
            <b style={{ color: "var(--lantern)" }}>
              everyone here hears the same track
            </b>{" "}
            — cue a record to add it
            <br />
            visit{" "}
            <b style={{ color: "var(--vermilion)" }}>新着 NEW ARRIVALS</b> to
            pour in your own links
          </div>
        </div>
      </div>
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
  onClose,
  onFlip,
  onPlay,
  onPlayShelf,
}: {
  crate: CrateState;
  flow: FlowUi;
  solo: boolean;
  onClose: () => void;
  onFlip: (d: number) => void;
  onPlay: () => void;
  onPlayShelf: () => void;
}) {
  const { shelf, idx } = crate;
  const rec = shelf.records[idx];
  const col = shelf.color;
  const big = (rec.artist || rec.title).split(/[\s&]/)[0].toUpperCase();
  const atCap = !flow.canCue;
  const waitSec = Math.ceil(flow.cueWaitLeft / 1000);
  // cue button label: solo hides limits; in a crowd show rate-limit wait, then cap
  const cueLabel = solo
    ? "⤵ CUE NEXT"
    : waitSec > 0
    ? `⤵ wait ${waitSec}s to cue`
    : atCap
    ? "wait for one to play"
    : `⤵ CUE NEXT (${flow.myCue}/${flow.cueCap})`;
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
      <div id="crateBox">
        <div id="crateGenre" style={{ color: col }}>
          {shelf.label}
        </div>
        <div id="sleeveWrap">
          <div
            id="sleeve"
            style={{
              background: `linear-gradient(135deg, ${col}, ${shade(col, -58)})`,
            }}
          >
            <div className="vinyl" />
            <div className="num">A{idx + 1}</div>
            <div className="big" style={{ color: shade(col, 95) }}>
              {big}
            </div>
          </div>
        </div>
        <div id="sleeveArtist">{rec.artist || "—"}</div>
        <div id="sleeveTitle">{rec.title}</div>
        <div id="crateNav">
          <button className="navbtn" onClick={() => onFlip(-1)}>
            ‹
          </button>
          <button id="playBtn" onClick={onPlay} disabled={atCap}>
            {cueLabel}
          </button>
          <button className="navbtn" onClick={() => onFlip(1)}>
            ›
          </button>
        </div>
        <div id="crateMeta">
          {idx + 1} / {shelf.records.length}
        </div>
        <button id="playShelf" onClick={onPlayShelf} disabled={atCap}>
          ⤵ cue the whole shelf →
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ ingest */
const NEW_SHELF = "__new";

function Ingest({
  open,
  shelves,
  myColor,
  onClose,
  onShelvesChange,
}: {
  open: boolean;
  shelves: Shelf[];
  myColor?: string;
  onClose: () => void;
  onShelvesChange: (s: Shelf[]) => void;
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
              </option>
            ))}
            <option value={NEW_SHELF}>＋ new shelf…</option>
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
// The fit preview: the same low-poly character the room renders (one shared
// WebGL renderer copies into this canvas — see lib/bar/three/preview.ts). The big
// stage preview idles + turns; the tiny intro icon is a still.
function AvatarPreview({ fit, size = 96, animate = false }: { fit: Fit; size?: number; animate?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(size * dpr);
    cv.height = Math.round(size * dpr);
    let raf = 0;
    const t0 = performance.now();
    const draw = () => {
      drawFit(cv, fit, (performance.now() - t0) / 1000, animate);
      if (animate) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [fit, size, animate]);
  return (
    <canvas
      ref={ref}
      style={{ width: size, height: size, display: "block", flex: "0 0 auto" }}
      aria-hidden="true"
    />
  );
}

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
}: {
  fit: Fit;
  onChange: (f: Fit) => void;
  onClose: () => void;
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
        <div className="fitRow">
          <span className="fitLabel">hat</span>
          <div className="hatRow">
            {HATS.map((h) => (
              <button
                key={h}
                className={"hatChip" + (fit.hat === h ? " on" : "")}
                onClick={() => onChange({ ...fit, hat: h })}
              >
                {hatLabel(h)}
              </button>
            ))}
          </div>
        </div>

        <div className="fitActions">
          <button className="btn ghost" onClick={() => onChange(randomFit())}>
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

/* ------------------------------------------------------------ lobby */
function Lobby({
  chat,
  reacts,
  open,
  onToggle,
  onSend,
  onReact,
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
