"use client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getBrowserClient } from "@/lib/supabase/client";
import type { RemotePlayer, Track } from "./types";
import {
  flowLimits,
  MAX_TRACK_SECONDS,
  MAX_CUE_LENGTH,
  type FlowLimits,
} from "./flow";
import { defaultFit, gearCode, type Fit } from "./fits";

// Supabase Realtime allows 5 presence calls per client per 30s and CLOSES the
// channel on the 6th ("Client presence rate limit exceeded"). Stay under it.
const TRACK_BUDGET = 4;
const TRACK_WINDOW_MS = 31_000;

// The lobby + the SHARED ROOM PLAYER. One Supabase Realtime channel carries
// several ephemeral streams (no DB tables — additive to the shared sombra
// project, scoped by the channel name):
//   • presence  — the roster (who's here, colour). Drives host election.
//   • broadcast "move"          — ~10Hz position updates → moving characters
//   • broadcast "chat" / "react"— the tiny chat + emoji reactions
//   • broadcast "room"          — the authoritative shared player state (host→all)
//   • broadcast "intent"        — anyone's request to skip / cue a song (→ host)
//   • broadcast "room-req"      — a newcomer asking the host for current state
//
// THE ROOM IS ONE SHARED PLAYER. Everyone hears the same track at ~the same
// position. ANYONE can control it: skip affects the whole room; selecting a song
// CUES it (plays next, ahead of the auto-radio). One host (lowest present id)
// owns the authoritative state and applies everyone's intents, so there's a
// single source of truth and no conflicting edits.


export interface ChatMessage {
  key: string;
  color: string;
  text: string;
}
export interface Reaction {
  key: string;
  emoji: string;
  color: string;
}

/** A cued song — what someone selected to play next, with who added it. */
export interface CueItem {
  track: Track;
  by: string; // contributor colour (anonymous identity, display)
  byId: string; // contributor user id (for per-user cap + self-remove)
}

/**
 * The authoritative shared room state, owned by the host and broadcast to all.
 *   now       — the track playing right now
 *   nowCuedBy — id of whoever cued `now` (may skip it solo), or null if auto-radio
 *   startedAt — epoch ms it started (followers seek to now-startedAt)
 *   cue       — songs selected to play next, in order
 *   seed/index— deterministic auto-radio fallback position
 *   skipVotes — user ids who've voted to skip the current track
 *   present   — count of present listeners P (so every client derives the SAME
 *               flowLimits the host enforces, for matching UI)
 *   rev       — monotonic revision (newer wins on the wire)
 *   host      — host id that produced this state
 */
export interface RoomState {
  now: Track | null;
  nowCuedBy: string | null;
  startedAt: number;
  cue: CueItem[];
  seed: number;
  index: number;
  skipVotes: string[];
  present: number;
  /** epoch ms until which skipping is on cooldown (0 = none). Shared so EVERY
   *  client shows the same countdown, not just the host. */
  cooldownUntil: number;
  /** god-mode: when true, normal users can't cue (room-wide lock) */
  cueLocked: boolean;
  /** ON AIR broadcast state (Part 3). Default off — collaborative cue. */
  live: boolean;
  dj: string | null;
  liveStartedAt: number | null;
  rev: number;
  host: string;
}

type Intent =
  | { kind: "skip"; by: string }
  | { kind: "cue"; track: Track; by: string; byId: string }
  | { kind: "uncue"; recordKey: string; byId: string } // remove my own pending entry
  | { kind: "clearCue"; by: string } // wipe the whole cue (anti-spam)
  // "the track that started at `startedAt` just ended on my player" — lets ANY
  // listener's natural end move the room on, not only the host's
  | { kind: "ended"; startedAt: number };

interface Pose {
  x: number;
  y: number;
  dir: number;
}

interface PresenceOpts {
  /** the local listener's starting fit (from localStorage / a fresh pick) */
  fit?: Fit;
  /** realtime channel override — dev/testing only (never set in production) */
  channel?: string;
  getPose: () => Pose;
  onChat: (m: ChatMessage) => void;
  onReact: (r: Reaction) => void;
  onRoster: (count: number) => void;
  /** the shared room state changed — update local playback + cue UI */
  onRoom: (s: RoomState) => void;
  /** auto-radio: pick the opening track + seed for a brand-new room */
  openRoom: () => { track: Track; seed: number; index: number } | null;
  /** auto-radio: given seed+index, the next auto track when the cue is empty */
  nextAuto: (seed: number, index: number) => { track: Track; index: number } | null;
}

interface TrackMeta {
  id: string;
  color: string; // == fit.body, kept flat for older-client back-compat
  hair: string;
  skin?: string;
  hat?: string;
  /** gifted gear, "top.neck.eyes.back" (fits.gearCode) — older clients omit it */
  gear?: string;
  /** which VENUE ROOM (scenery) this listener is in — for per-room avatar render.
   *  Distinct from RoomState (the shared audio/cue state); presence is venue-wide. */
  vroom?: string;
  /** look version — newer wins, so a lagging presence meta can't undo a live change */
  v?: number;
}

export class BarPresence {
  readonly id: string;
  /** the local listener's customisable look (skin / outfit / hair / hat) */
  fit: Fit;
  /** outfit colour — your cue-dot + chat identity. Tracks fit.body. */
  get color(): string {
    return this.fit.body;
  }
  get hair(): string {
    return this.fit.hair;
  }
  /** live array the engine reads each frame; mutated in place to avoid churn */
  readonly remotes: RemotePlayer[] = [];

  private byId = new Map<string, RemotePlayer>();
  private meta = new Map<string, TrackMeta>();
  private presentIds: string[] = [];
  private channel: RealtimeChannel | null = null;
  private opts: PresenceOpts;
  private subscribed = false;
  /** lurk mode: subscribed (hearing room state) but NOT tracked as present — used
   *  while the intro screen is up, so the current track + offset are already known
   *  by the time the user taps to enter (mobile audio must start inside that tap) */
  private lurking = false;
  private pumpTimer: ReturnType<typeof setInterval> | null = null;
  private hiddenAt = 0;
  // presence re-tracks are rate-limited (TRACK_BUDGET); looks also go out as an
  // instant "look" broadcast, versioned so the older copy never wins
  private lookV = 0;
  private lookVById = new Map<string, number>();
  private trackTimes: number[] = [];
  private trackTimer: ReturnType<typeof setTimeout> | null = null;
  private roomTimer: ReturnType<typeof setInterval> | null = null;
  /** follower fallback: advance ourselves if the host never answers our "ended" */
  private endWatchdog: ReturnType<typeof setTimeout> | null = null;
  /** the now-playing track's length as the local player reported it (s) */
  private nowDuration: { startedAt: number; seconds: number } | null = null;
  private last: Pose = { x: -1, y: -1, dir: 1 };
  private seq = 0;
  private ticks = 0;
  // the venue room (scenery) this listener is currently in — NOT the audio state
  private venueRoom = "kissa";

  // shared room state
  private room: RoomState | null = null;
  private playedStartedAt = -1; // dedupe: only (re)load when the track changes
  private cooldownAdvanceTimer: ReturnType<typeof setTimeout> | null = null;
  private cueAtById = new Map<string, number>(); // host: last cue time per session
  private myLastCueAt = 0; // this session's last accepted cue (for the UI timer)

  constructor(opts: PresenceOpts) {
    this.opts = opts;
    this.id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "g" + Math.random().toString(36).slice(2);
    // a saved/passed fit wins; else a stable look derived from the id
    this.fit = opts.fit ?? defaultFit(this.id);
  }

  /** Change the local look and re-broadcast it so everyone re-renders this avatar. */
  setFit(fit: Fit) {
    this.fit = fit;
    this.lookV++;
    // instant for the room; presence catches up within the rate budget
    if (this.pumpTimer) this.sendLook();
    this.retrack();
  }

  /** A phone back from the lock screen often holds a socket that died silently;
   *  phoenix only notices on its next 25s heartbeat. Probe now: an unanswered
   *  heartbeat at the second probe forces a reconnect (which re-tracks us). */
  private onVisibility = () => {
    if (document.visibilityState === "hidden") {
      this.hiddenAt = Date.now();
      return;
    }
    if (!this.hiddenAt || Date.now() - this.hiddenAt < 3000) return;
    this.hiddenAt = 0;
    const rt = getBrowserClient().realtime;
    if (!rt.isConnected()) return rt.connect();
    void rt.sendHeartbeat();
    setTimeout(() => void rt.sendHeartbeat(), 2500);
  };

  start(opts?: { lurk?: boolean }) {
    this.lurking = !!opts?.lurk;
    document.addEventListener("visibilitychange", this.onVisibility);
    const sb = getBrowserClient();
    const ch = sb.channel(this.opts.channel ?? "hallucinate-bar", {
      config: { presence: { key: this.id }, broadcast: { self: false } },
    });
    this.channel = ch;

    ch.on("presence", { event: "sync" }, () => this.syncRoster())
      .on("broadcast", { event: "move" }, ({ payload }) =>
        this.onMove(payload as { id: string; x: number; y: number; dir: number; room?: string })
      )
      .on("broadcast", { event: "chat" }, ({ payload }) => {
        const p = payload as { color: string; text: string };
        this.opts.onChat({ key: this.nextKey(), color: p.color, text: p.text });
      })
      .on("broadcast", { event: "dance" }, ({ payload }) => {
        // someone hit 💃 — their avatar plays the move here too (scenery only)
        const p = payload as { id: string; move: string };
        const r = this.byId.get(p.id);
        if (r && typeof p.move === "string") r.dance = { move: p.move, at: performance.now() };
      })
      .on("broadcast", { event: "react" }, ({ payload }) => {
        const p = payload as { color: string; emoji: string };
        this.opts.onReact({ key: this.nextKey(), color: p.color, emoji: p.emoji });
      })
      .on("broadcast", { event: "room" }, ({ payload }) =>
        this.onRoomState(payload as RoomState)
      )
      .on("broadcast", { event: "intent" }, ({ payload }) =>
        this.onIntent(payload as Intent)
      )
      .on("broadcast", { event: "look" }, ({ payload }) => this.applyLook(payload as TrackMeta))
      .on("broadcast", { event: "room-req" }, () => {
        if (this.isHost() && this.room) this.broadcastRoom();
        // a newcomer: show them my current look now, not my last presence meta
        if (this.pumpTimer) this.sendLook();
      })
      // GOD-MODE admin events. These originate ONLY from the server action (which
      // verified the owner cookie); a normal client has no way to emit a trusted
      // one. The host applies them authoritatively — bypassing votes/cooldown/cap.
      .on("broadcast", { event: "admin" }, ({ payload }) =>
        this.onAdmin(payload as Record<string, unknown>)
      )
      .subscribe((status) => {
        if (status === "CLOSED" && this.channel === ch) {
          // the server shut the channel (e.g. a rate limit) — rebuild it rather
          // than leave this listener deaf until a reload
          setTimeout(() => {
            if (this.channel === ch) this.restart();
          }, 2000);
          return;
        }
        if (status !== "SUBSCRIBED") return;
        this.subscribed = true;
        // learn the room state immediately, even while only lurking
        this.requestRoom();
        if (this.lurking) return;
        // a socket reconnect (phone locked / app switch / network blip) re-runs this
        // with the server's presence for us gone — re-track, or we stay invisible
        if (this.pumpTimer) {
          this.trackTimes = []; // a rejoin is a fresh server-side channel
          this.retrack();
        } else this.join();
      });
  }

  /** Become a real listener: track presence, pump movement, and (if host-elect)
   *  bootstrap the room. Split from start() so a lurker can join later. */
  private join() {
    const ch = this.channel;
    if (!ch || this.pumpTimer) return;
    this.retrack();
    this.pumpTimer = setInterval(() => this.pump(), 110);
    // host heartbeat: re-broadcast so late joiners + clock drift stay corrected
    this.roomTimer = setInterval(() => {
      if (!this.isHost() || !this.room) return;
      this.broadcastRoom();
      // wall-clock backstop: the track's known length has clearly passed and no
      // player reported the end (everyone muted / backgrounded / blocked) — move on
      const d = this.knownDuration();
      if (d && Date.now() - this.room.startedAt > (d + 12) * 1000) this.advance(false);
    }, 4000);
    // bootstrap the room: adopt the host's state, or start one if I'm host-elect
    this.requestRoom();
    setTimeout(() => this.maybeStartRoom(), 1200);
  }

  /** Lurker → listener (the intro tap). No-op if already a listener. */
  materialize() {
    if (!this.lurking) return;
    this.lurking = false;
    if (this.subscribed) this.join();
    // not subscribed yet → the subscribe callback joins, since lurking is false
  }

  /** Tear down and rejoin with the same identity + look. */
  private restart() {
    const lurk = this.lurking;
    this.stop();
    this.start({ lurk });
  }

  stop() {
    document.removeEventListener("visibilitychange", this.onVisibility);
    if (this.trackTimer) clearTimeout(this.trackTimer);
    this.trackTimer = null;
    this.trackTimes = [];
    this.subscribed = false;
    if (this.pumpTimer) clearInterval(this.pumpTimer);
    if (this.roomTimer) clearInterval(this.roomTimer);
    if (this.cooldownAdvanceTimer) clearTimeout(this.cooldownAdvanceTimer);
    if (this.endWatchdog) clearTimeout(this.endWatchdog);
    this.endWatchdog = null;
    this.pumpTimer = null;
    this.roomTimer = null;
    this.cooldownAdvanceTimer = null;
    if (this.channel) {
      void this.channel.untrack();
      // remove, not just unsubscribe: sb.channel() hands back an existing
      // channel of the same name, so a dead one would be reused on restart
      void getBrowserClient().removeChannel(this.channel);
      this.channel = null;
    }
    this.remotes.length = 0;
    this.byId.clear();
    this.meta.clear();
  }

  /* ----------------------------------------------------------- room control */
  // PUBLIC INTENTS — clients only ever express intent; the host mutates state.

  /** Vote to skip the current track. Tally scales with P (flowLimits). */
  skip() {
    this.sendIntent({ kind: "skip", by: this.id });
  }
  /** Cue a song to play next. Subject to the per-user cap + anti-spam rate limit. */
  cue(track: Track) {
    if (!this.canCue()) return; // local guard: don't even broadcast a doomed cue
    this.myLastCueAt = Date.now(); // optimistic; host's cueAtById is authoritative
    this.sendIntent({ kind: "cue", track, by: this.color, byId: this.id });
  }
  /** Remove one of MY OWN pending cue entries. */
  uncue(recordKey: string) {
    this.sendIntent({ kind: "uncue", recordKey, byId: this.id });
  }
  /** Wipe the entire cue (anti-spam reset). Anyone can do this. */
  clearCue() {
    this.sendIntent({ kind: "clearCue", by: this.id });
  }

  /* ----- derived limits + UI helpers (read the SAME flowLimits as the host) */
  private P(): number {
    return Math.max(1, this.presentIds.length || 1);
  }
  limits(): FlowLimits {
    return flowLimits(this.room?.present ?? this.P());
  }
  getCue(): CueItem[] {
    return this.room?.cue ?? [];
  }
  /** how many pending cue entries the local user holds (for the cap UI) */
  myCueCount(): number {
    return (this.room?.cue ?? []).filter((c) => c.byId === this.id).length;
  }
  /** can the local user cue another right now? (cap AND rate limit AND room cap) */
  canCue(): boolean {
    if (this.myCueCount() >= this.limits().cueCap) return false;
    if ((this.room?.cue.length ?? 0) >= MAX_CUE_LENGTH) return false;
    return this.cueWaitLeft() <= 0;
  }
  /** ms until this session may cue again (anti-spam rate limit; 0 = ready now) */
  cueWaitLeft(): number {
    const iv = this.limits().cueIntervalMs;
    if (iv === 0) return 0;
    return Math.max(0, iv - (Date.now() - this.myLastCueAt));
  }
  /** skip-vote progress for the current track: {have, need} */
  skipProgress(): { have: number; need: number; cuerBypass: boolean } {
    const have = this.room?.skipVotes?.length ?? 0;
    const cuerBypass = !!this.room && this.room.nowCuedBy === this.id;
    return { have, need: this.limits().skipNeeded, cuerBypass };
  }
  /** ms left on the skip cooldown (0 if none) — read from the SHARED room state */
  cooldownLeft(): number {
    return Math.max(0, (this.room?.cooldownUntil ?? 0) - Date.now());
  }

  private sendIntent(intent: Intent) {
    if (this.isHost()) this.applyIntent(intent);
    else void this.channel?.send({ type: "broadcast", event: "intent", payload: intent });
  }
  private onIntent(intent: Intent) {
    if (!this.isHost() || !this.room) return; // only the host mutates room state
    this.applyIntent(intent);
  }

  /**
   * Apply a server-verified GOD-MODE command. Only the host mutates state; the
   * authority is the server (it verified the owner cookie before broadcasting).
   * These bypass vote-skip / cooldown / cue-cap — god mode is the ONLY thing
   * allowed to. A non-host client ignores it (its host will apply + rebroadcast).
   */
  private onAdmin(p: Record<string, unknown>) {
    if (!this.isHost() || !this.room) return;
    const kind = p.kind as string;
    if (kind === "forceSkip") {
      this.advance(false); // immediate, no cooldown, ignores votes
    } else if (kind === "clearCue") {
      this.room = { ...this.room, cue: [], rev: this.room.rev + 1, host: this.id };
      this.publishRoom();
    } else if (kind === "removeCue") {
      const key = p.recordKey as string;
      const cue = this.room.cue.filter((c) => trackKey(c.track) !== key);
      this.room = { ...this.room, cue, rev: this.room.rev + 1, host: this.id };
      this.publishRoom();
    } else if (kind === "pin" || kind === "forcePlay") {
      const t = p.track as Track;
      if (!t) return;
      if (kind === "forcePlay") {
        // play right now (front + immediate advance through it)
        this.room = {
          ...this.room,
          cue: [{ track: t, by: "#ffffff", byId: "owner" }, ...this.room.cue],
          rev: this.room.rev + 1,
          host: this.id,
        };
        this.advance(false);
      } else {
        // pin to the FRONT of the cue (plays next)
        this.room = {
          ...this.room,
          cue: [{ track: t, by: "#ffffff", byId: "owner" }, ...this.room.cue],
          rev: this.room.rev + 1,
          host: this.id,
        };
        this.publishRoom();
      }
    } else if (kind === "lockCue") {
      this.room = { ...this.room, cueLocked: !!p.locked, rev: this.room.rev + 1, host: this.id };
      this.publishRoom();
    } else if (kind === "onAir") {
      const live = !!p.live;
      this.room = {
        ...this.room,
        live,
        dj: live ? ((p.dj as string) ?? "THE OWNER") : null,
        liveStartedAt: live ? Date.now() : null,
        // going live locks the cue to the owner; going off restores collaboration
        cueLocked: live ? true : false,
        rev: this.room.rev + 1,
        host: this.id,
      };
      this.publishRoom();
    }
  }

  private applyIntent(intent: Intent) {
    if (!this.room) return;
    if (intent.kind === "skip") {
      this.registerSkipVote(intent.by);
    } else if (intent.kind === "cue") {
      // god-mode lock + ON AIR both close the collaborative cue to normal users.
      if (this.room.cueLocked || this.room.live) return;
      const iv = this.limits().cueIntervalMs;
      const now = Date.now();
      // Anti-spam rate limit: at most one cue per session per cueIntervalMs.
      const last = this.cueAtById.get(intent.byId) ?? 0;
      if (iv > 0 && now - last < iv) return; // too soon — silently dropped
      // Per-user cap (grandfathered: only blocks NEW adds) + hard room-cue cap.
      const held = this.room.cue.filter((c) => c.byId === intent.byId).length;
      if (held >= this.limits().cueCap) return;
      if (this.room.cue.length >= MAX_CUE_LENGTH) return; // spam backstop
      this.cueAtById.set(intent.byId, now);
      this.room = {
        ...this.room,
        cue: [...this.room.cue, { track: intent.track, by: intent.by, byId: intent.byId }],
        rev: this.room.rev + 1,
        host: this.id,
      };
      this.publishRoom();
    } else if (intent.kind === "uncue") {
      const idx = this.room.cue.findIndex(
        (c) => c.byId === intent.byId && trackKey(c.track) === intent.recordKey
      );
      if (idx < 0) return;
      const cue = this.room.cue.slice();
      cue.splice(idx, 1);
      this.room = { ...this.room, cue, rev: this.room.rev + 1, host: this.id };
      this.publishRoom();
    } else if (intent.kind === "ended") {
      // someone's player finished the CURRENT track (not a stale one) — if the
      // timing is plausible, advance. Ignores early ends (a player that errored
      // or joined oddly) so one client can't cut a track short.
      if (intent.startedAt !== this.room.startedAt) return;
      if (!this.plausibleEnd()) return;
      this.advance(false);
    } else if (intent.kind === "clearCue") {
      if (!this.room.cue.length) return;
      this.room = { ...this.room, cue: [], rev: this.room.rev + 1, host: this.id };
      this.publishRoom();
    }
  }

  /** Host: record a skip vote; advance if the threshold is met (cuer bypasses). */
  private registerSkipVote(voter: string) {
    if (!this.room) return;
    const cuerBypass = this.room.nowCuedBy === voter; // cuer may skip own pick solo
    const votes = new Set(this.room.skipVotes);
    votes.add(voter);
    this.room = { ...this.room, skipVotes: [...votes], rev: this.room.rev + 1, host: this.id };

    if (cuerBypass || votes.size >= this.limits().skipNeeded) {
      // Skip cooldown: ignore the advance if we're inside it — but KEEP the votes
      // so it advances the moment the cooldown elapses (a timer re-checks).
      if (this.cooldownActive() && !cuerBypass) {
        this.publishRoom(); // reflect the new vote count in the UI
        this.scheduleCooldownAdvance();
        return;
      }
      this.advance(true); // a skip → starts the next cooldown
    } else {
      this.publishRoom();
    }
  }

  private cooldownActive(): boolean {
    return this.cooldownLeft() > 0;
  }
  private scheduleCooldownAdvance() {
    if (this.cooldownAdvanceTimer) return;
    const wait = this.cooldownLeft() + 30;
    this.cooldownAdvanceTimer = setTimeout(() => {
      this.cooldownAdvanceTimer = null;
      // re-check: if remaining votes still meet the threshold, advance
      if (
        this.isHost() &&
        this.room &&
        (this.room.skipVotes?.length ?? 0) >= this.limits().skipNeeded
      )
        this.advance(true);
    }, wait);
  }

  /**
   * Host: move to the next track — cue first, else the seeded auto-radio.
   * `viaSkip` starts a fresh skip cooldown; a natural track end / duration
   * backstop passes false so it doesn't trip the cooldown.
   */
  private advance(viaSkip = false) {
    if (!this.room) return;
    let next: Track | null = null;
    let nowCuedBy: string | null = null;
    let cue = this.room.cue;
    let index = this.room.index;
    if (cue.length) {
      next = cue[0].track;
      nowCuedBy = cue[0].byId;
      cue = cue.slice(1);
    } else {
      const a = this.opts.nextAuto(this.room.seed, this.room.index);
      if (a) {
        next = a.track;
        index = a.index;
      }
    }
    if (!next) return;
    const cd = viaSkip ? this.limits().skipCooldownMs : 0;
    this.room = {
      ...this.room, // carry cueLocked / live / dj / liveStartedAt
      now: next,
      nowCuedBy,
      startedAt: Date.now(),
      cue,
      seed: this.room.seed,
      index,
      skipVotes: [], // reset votes on every track change
      present: this.P(),
      cooldownUntil: cd > 0 ? Date.now() + cd : 0,
      rev: this.room.rev + 1,
      host: this.id,
    };
    this.publishRoom();
  }

  /**
   * Local player reported the current track ended. The host advances the room;
   * anyone else tells the host (the host's own player may be muted, blocked or
   * asleep — that used to stall the whole room). If the host doesn't move within
   * a few seconds, this listener advances the room itself: the next track is
   * deterministic (cue head, else the seeded radio), and if the host does act too
   * the room converges on one state (newer rev wins, ties → lowest host id).
   */
  trackEnded() {
    if (!this.room) return;
    if (this.isHost()) {
      this.advance(false); // natural end, no cooldown
      return;
    }
    const startedAt = this.room.startedAt;
    if (!this.plausibleEnd()) return; // an early end (error / odd join) moves nothing
    this.sendIntent({ kind: "ended", startedAt });
    if (this.endWatchdog) clearTimeout(this.endWatchdog);
    this.endWatchdog = setTimeout(() => {
      this.endWatchdog = null;
      if (this.room && this.room.startedAt === startedAt) this.advance(false);
    }, 8000);
  }

  /** Has the current track plausibly run its course? (known length − 20s, or
   *  ≥30s when the length is unknown) — so one client can't cut a track short. */
  private plausibleEnd(): boolean {
    if (!this.room) return false;
    const elapsed = (Date.now() - this.room.startedAt) / 1000;
    const d = this.knownDuration();
    return d ? elapsed >= d - 20 : elapsed >= 30;
  }

  /** The now-playing track's length in seconds, if anyone knows it yet. */
  private knownDuration(): number | null {
    if (!this.room?.now) return null;
    if (this.nowDuration && this.nowDuration.startedAt === this.room.startedAt) return this.nowDuration.seconds;
    return this.room.now.durationSeconds ?? null;
  }

  /**
   * Duration backstop (host): the player learned the now-playing track is at or
   * over the 15-min library cap (stale row or unresolved SoundCloud). Skip it for
   * the whole room immediately — bypasses votes + cooldown. Full DJ sets from a
   * FULL_SET_CRATES crate (someone cued them on purpose) are allowed to run.
   */
  durationKnown(seconds: number) {
    if (!this.room) return;
    // remember it for the wall-clock backstop + the "ended" plausibility check
    this.nowDuration = { startedAt: this.room.startedAt, seconds };
    if (!this.isHost()) return;
    if (this.room.now?.fullSet) return;
    if (seconds >= MAX_TRACK_SECONDS) this.advance(false); // backstop, no cooldown
  }

  /* ----------------------------------------------------------- room internals */
  private maybeStartRoom() {
    if (this.room || !this.isHost()) return;
    const o = this.opts.openRoom();
    if (!o) return;
    this.room = {
      now: o.track,
      nowCuedBy: null,
      startedAt: Date.now(),
      cue: [],
      seed: o.seed,
      index: o.index,
      skipVotes: [],
      present: this.P(),
      cooldownUntil: 0,
      cueLocked: false,
      live: false,
      dj: null,
      liveStartedAt: null,
      rev: 1,
      host: this.id,
    };
    this.publishRoom();
  }

  private onRoomState(raw: RoomState) {
    // Normalize: a broadcast from a client on an OLDER build may lack the newer
    // fields (skipVotes/present/nowCuedBy). Guarantee arrays/numbers so nothing
    // downstream reads `.length` of undefined.
    const s: RoomState = {
      now: raw.now ?? null,
      nowCuedBy: raw.nowCuedBy ?? null,
      startedAt: raw.startedAt ?? Date.now(),
      cue: Array.isArray(raw.cue) ? raw.cue : [],
      seed: raw.seed ?? 0,
      index: raw.index ?? 0,
      skipVotes: Array.isArray(raw.skipVotes) ? raw.skipVotes : [],
      present: typeof raw.present === "number" ? raw.present : this.P(),
      cooldownUntil: typeof raw.cooldownUntil === "number" ? raw.cooldownUntil : 0,
      cueLocked: !!raw.cueLocked,
      live: !!raw.live,
      dj: raw.dj ?? null,
      liveStartedAt: raw.liveStartedAt ?? null,
      rev: raw.rev ?? 0,
      host: raw.host ?? "",
    };
    // newer revision wins; ties broken by lower host id so brief co-hosts converge
    if (
      this.room &&
      (s.rev < this.room.rev ||
        (s.rev === this.room.rev && s.host > this.room.host))
    )
      return;
    this.room = s;
    this.opts.onRoom(s);
  }

  /** Host: bump P + persist, broadcast, and refresh the local UI in one place. */
  private publishRoom() {
    if (!this.room) return;
    this.broadcastRoom();
    this.opts.onRoom(this.room);
  }

  private broadcastRoom() {
    if (!this.room) return;
    void this.channel?.send({ type: "broadcast", event: "room", payload: this.room });
  }
  private requestRoom() {
    void this.channel?.send({
      type: "broadcast",
      event: "room-req",
      payload: { id: this.id },
    });
  }

  /** Host = the lowest id among everyone present. A lurker is never host — it
   *  isn't in the presence roster, so it must not heartbeat or bootstrap. */
  private isHost(): boolean {
    if (this.lurking) return false;
    const ids = this.presentIds.includes(this.id)
      ? this.presentIds
      : [...this.presentIds, this.id];
    return [...ids].sort()[0] === this.id;
  }

  /** Is this client the room's host right now (it reports plays). */
  amHost(): boolean {
    return this.isHost();
  }

  /** Whether this client should (re)load the player — true on track change. */
  shouldReload(): boolean {
    if (!this.room || !this.room.now) return false;
    if (this.room.startedAt === this.playedStartedAt) return false;
    this.playedStartedAt = this.room.startedAt;
    return true;
  }

  /** The player already started this room state locally (the in-gesture mobile
   *  start) — don't reload when the matching broadcast lands. */
  notePlayed(startedAt: number) {
    this.playedStartedAt = startedAt;
  }
  currentRoom(): RoomState | null {
    return this.room;
  }

  /* ----------------------------------------------------------- chat / react */
  sendChat(text: string) {
    const t = text.trim().slice(0, 240);
    if (!t || !this.channel) return;
    void this.channel.send({
      type: "broadcast",
      event: "chat",
      payload: { color: this.color, text: t },
    });
    this.opts.onChat({ key: this.nextKey(), color: this.color, text: t });
  }

  sendReact(emoji: string) {
    if (!this.channel) return;
    void this.channel.send({
      type: "broadcast",
      event: "react",
      payload: { color: this.color, emoji },
    });
    this.opts.onReact({ key: this.nextKey(), color: this.color, emoji });
  }

  /** Tell the room your avatar is dancing (they play the same move). */
  sendDance(move: string) {
    void this.channel?.send({ type: "broadcast", event: "dance", payload: { id: this.id, move } });
  }

  /** The local listener moved to another venue room (scenery). Re-track presence
   *  so others render this avatar in the new room. Does NOT touch audio/cue/skip. */
  setRoom(roomId: string) {
    if (this.venueRoom === roomId) return;
    this.venueRoom = roomId;
    this.lookV++;
    this.retrack(); // "move" broadcasts carry the room meanwhile
  }

  /* ----------------------------------------------------------- internals */
  private myMeta(): TrackMeta {
    return {
      id: this.id,
      color: this.fit.body,
      hair: this.fit.hair,
      skin: this.fit.skin,
      hat: this.fit.hat,
      gear: gearCode(this.fit),
      vroom: this.venueRoom,
      v: this.lookV,
    };
  }

  private sendLook() {
    void this.channel?.send({ type: "broadcast", event: "look", payload: this.myMeta() });
  }

  /** Re-send our presence meta within Supabase's per-client budget. Over budget,
   *  one trailing send goes out when the window frees up, carrying the latest look. */
  private retrack() {
    const ch = this.channel;
    if (!ch || !this.subscribed || this.lurking || this.trackTimer) return;
    const now = Date.now();
    this.trackTimes = this.trackTimes.filter((t) => now - t < TRACK_WINDOW_MS);
    if (this.trackTimes.length < TRACK_BUDGET) {
      this.trackTimes.push(now);
      void ch.track(this.myMeta());
      return;
    }
    this.trackTimer = setTimeout(() => {
      this.trackTimer = null;
      this.retrack();
    }, this.trackTimes[0] + TRACK_WINDOW_MS - now + 50);
  }

  /** Adopt a listener's look + room unless we already hold a newer version. */
  private applyLook(m: TrackMeta) {
    const pid = m.id;
    if (pid === this.id) return;
    const v = m.v ?? 0;
    if (v < (this.lookVById.get(pid) ?? 0)) return;
    this.lookVById.set(pid, v);
    this.meta.set(pid, m);
    const r = this.byId.get(pid);
    if (!r) return;
    r.color = m.color;
    r.hair = m.hair;
    if (m.skin) r.skin = m.skin;
    if (m.hat) r.hat = m.hat;
    if (m.gear) r.gear = m.gear;
    if (m.vroom) r.room = m.vroom;
  }

  private nextKey() {
    return `${Date.now()}-${this.seq++}`;
  }

  private pump() {
    if (!this.channel) return;
    const p = this.opts.getPose();
    const moved =
      Math.abs(p.x - this.last.x) > 0.6 ||
      Math.abs(p.y - this.last.y) > 0.6 ||
      p.dir !== this.last.dir;
    // Heartbeat (~every 1.5s) even when still, so anyone who JUST joined learns
    // where the stationary regulars are standing — presence sync alone has no pose.
    this.ticks++;
    const heartbeat = this.ticks % 14 === 0;
    if (!moved && !heartbeat) return;
    if (moved) this.last = { ...p };
    void this.channel.send({
      type: "broadcast",
      event: "move",
      payload: { id: this.id, x: p.x, y: p.y, dir: p.dir, room: this.venueRoom },
    });
  }

  private onMove(p: { id: string; x: number; y: number; dir: number; room?: string }) {
    if (p.id === this.id) return;
    let r = this.byId.get(p.id);
    if (!r) r = this.ensure(p.id, p.x, p.y);
    r.tx = p.x;
    r.ty = p.y;
    r.dir = p.dir;
    if (p.room) r.room = p.room; // keep avatar's room current between presence syncs
  }

  /** Reconcile rendered characters + the present set with the presence roster. */
  private syncRoster() {
    if (!this.channel) return;
    const state = this.channel.presenceState<TrackMeta>();
    const live = new Set<string>();
    const present: string[] = [];
    const wasHost = this.isHost();

    for (const key of Object.keys(state)) {
      const metas = state[key];
      const m = metas && metas[0];
      const pid = m?.id ?? key;
      live.add(pid);
      present.push(pid);
      if (pid === this.id) continue;
      // spawn newcomers at the door until their first move tells us where
      if (!this.byId.has(pid)) this.ensure(pid, 570, 630);
      if (m) this.applyLook(m);
    }
    this.presentIds = present;

    // drop anyone who left
    for (const pid of [...this.byId.keys()]) {
      if (!live.has(pid)) {
        this.byId.delete(pid);
        const i = this.remotes.findIndex((x) => x.id === pid);
        if (i >= 0) this.remotes.splice(i, 1);
      }
    }
    this.opts.onRoster(live.size);

    // ----- live recompute on presence change (host only) -----
    // P changed → flowLimits change. Prune departed users from skipVotes, refresh
    // the stored P, and if remaining votes already meet the (possibly lowered)
    // threshold, advance. Also re-publish so everyone's cap/threshold UI updates.
    if (this.isHost() && this.room) {
      const before = this.room;
      const prunedVotes = (before.skipVotes ?? []).filter((v) => live.has(v));
      const presentChanged = before.present !== this.P();
      const votesChanged = prunedVotes.length !== (before.skipVotes?.length ?? 0);
      if (presentChanged || votesChanged || !wasHost) {
        this.room = {
          ...before,
          skipVotes: prunedVotes,
          present: this.P(),
          rev: before.rev + 1,
          host: this.id,
        };
        // a departing voter may have tipped us under OR a smaller room may now
        // meet the lowered threshold — re-evaluate
        if (
          prunedVotes.length >= this.limits().skipNeeded &&
          !this.cooldownActive()
        ) {
          this.advance();
        } else {
          this.publishRoom();
        }
      }
    }
  }

  private ensure(id: string, x: number, y: number, m?: TrackMeta): RemotePlayer {
    const meta = m ?? this.meta.get(id);
    const r: RemotePlayer = {
      id,
      x,
      y,
      tx: x,
      ty: y,
      dir: 1,
      bob: 0,
      color: meta?.color ?? "#8a8a8a",
      hair: meta?.hair ?? "#1b1b22",
      skin: meta?.skin ?? "#cf9268",
      hat: meta?.hat ?? "none",
      gear: meta?.gear,
      room: meta?.vroom ?? "kissa",
    };
    this.byId.set(id, r);
    this.remotes.push(r);
    return r;
  }
}

/** Stable identity for a track in the cue (DB id, else source url/id). */
export function trackKey(t: Track): string {
  return t.id ?? t.ytId ?? t.scUrl ?? `${t.artist}-${t.title}`;
}
