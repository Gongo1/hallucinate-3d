import type { Track } from "./types";

// Audio-only playback. Hosted, the YouTube IFrame API script loads, so we run a
// hidden (off-screen, zero-size) YT player and auto-advance on ENDED, skip on
// error. SoundCloud uses the Widget API (FINISH -> next). No visible video —
// per the project guardrails, once hosted we go audio-only.
//
// Two playback modes:
//   • queue  — the user's own pick (a record or a whole shelf). Auto-advances
//              within the queue. Per-listener, NOT synced.
//   • station — the shared house radio. The player just renders whatever track +
//              offset the radio controller (lib/bar/presence) tells it to, and
//              reports back when the track ENDS (onStationEnded) so the host can
//              advance everyone. Seeking on start keeps listeners in sync.

export interface PlayerState {
  track: Track | null;
  source: "yt" | "sc" | null;
  playing: boolean;
  progress: number; // 0..1
  queueLen: number;
  visible: boolean;
  /** true while the synced house station is what you're hearing (not a hand-pick) */
  radio: boolean;
  /** autoplay was blocked (mobile policy) — the UI shows a tap-to-listen pill */
  blocked: boolean;
}

interface PlayerOpts {
  ytMount: HTMLElement;
  scFrame: HTMLIFrameElement;
  onState: (s: PlayerState) => void;
  onPlaying: (playing: boolean) => void;
  /** the current STATION track finished — host uses this to advance everyone */
  onStationEnded?: () => void;
  /** the active player reported the track's true length (s) — duration backstop */
  onDurationKnown?: (seconds: number) => void;
}

/* Minimal shapes for the two external player SDKs (loaded at runtime). */
interface YTPlayer {
  loadVideoById(arg: string | { videoId: string; startSeconds?: number }): void;
  cueVideoById(arg: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getDuration(): number;
  getCurrentTime(): number;
  setVolume(v: number): void;
  unMute(): void;
}
interface SCWidget {
  bind(event: string, cb: (e?: unknown) => void): void;
  load(url: string, opts: Record<string, unknown>): void;
  play(): void;
  pause(): void;
  seekTo(ms: number): void;
  getDuration(cb: (ms: number) => void): void;
  getPosition(cb: (ms: number) => void): void;
  setVolume(v: number): void;
}
type WindowWithSdks = Window & {
  YT?: {
    Player: new (el: HTMLElement, cfg: unknown) => YTPlayer;
    PlayerState: { ENDED: number; PLAYING: number; PAUSED: number };
  };
  onYouTubeIframeAPIReady?: () => void;
  SC?: {
    Widget: ((el: HTMLIFrameElement) => SCWidget) & {
      Events: Record<string, string>;
    };
  };
};

export class BarPlayer {
  private opts: PlayerOpts;
  private queue: Track[] = [];
  private i = 0;
  private station = false; // station mode (synced radio) vs queue mode (own pick)
  private pendingSeekMs = 0; // seek target applied once the active SDK is ready
  private posSec = 0; // last known playhead (for the same-track reload guard)
  private state: PlayerState = {
    track: null,
    source: null,
    playing: false,
    progress: 0,
    queueLen: 0,
    visible: false,
    radio: false,
    blocked: false,
  };

  private yt: YTPlayer | null = null;
  private ytReady = false;
  private sc: SCWidget | null = null;
  private scReady = false;
  private progressTimer: ReturnType<typeof setInterval> | null = null;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private blockTimer: ReturnType<typeof setTimeout> | null = null;
  private reportedDuration = false; // duration reported for the current track?
  private inited = false;
  // the door ritual's one-shot volume profile: start at `floor`, swell to full
  // from `at` over `ms` (at = Infinity until the door opens). Desktop only in
  // effect — iOS ignores programmatic volume, so there the track just arrives.
  private arrival: { floor: number; at: number; ms: number } | null = null;

  constructor(opts: PlayerOpts) {
    this.opts = opts;
  }

  /** Door ritual: the next track starts near-silent, as if through the wall.
   *  Call BEFORE playStation. swell() opens it up; a safety swell fires if the
   *  door never calls it. */
  holdLow(floor = 12) {
    const a = { floor, at: Infinity, ms: 800 };
    this.arrival = a;
    setTimeout(() => {
      if (this.arrival === a && a.at === Infinity) this.swell(800);
    }, 4000);
  }

  // the YouTube id cued (loaded, not playing) while the listener is still at
  // the door; pendingPrime waits for the YT API if it isn't ready yet
  private primed: string | null = null;
  private pendingPrime: { ytId: string; offsetSec: number } | null = null;

  /** Door: cue the room's track before the knock, so the knock only has to
   *  press play. iOS lets a tap start audio only if playback begins right away;
   *  a fresh load (network first) outlives the tap and gets blocked, while
   *  play on an already-cued video (what the tap-to-listen pill does) works.
   *  YouTube only — SoundCloud tracks still fall back to the pill on iOS. */
  prime(track: Track, offsetSec: number) {
    if (this.state.track || !track.ytId || this.primed === track.ytId) return;
    if (!this.ytReady || !this.yt) {
      this.pendingPrime = { ytId: track.ytId, offsetSec };
      return;
    }
    try {
      this.yt.cueVideoById({ videoId: track.ytId, startSeconds: Math.max(0, offsetSec) });
      this.primed = track.ytId;
    } catch {}
  }

  /** Door ritual: swell the held track to full volume over `ms`. */
  swell(ms: number) {
    const a = this.arrival;
    if (!a) return;
    a.at = performance.now();
    a.ms = Math.max(1, ms);
  }

  /** Kick off SDK loading and the progress ticker. Called at mount (BEFORE any
   *  gesture) so the YT player is already built when the user taps to enter —
   *  on mobile, only a play started inside that tap is allowed to make sound. */
  init() {
    if (this.inited) return;
    this.inited = true;
    this.loadYouTube();
    // Load the SoundCloud Widget script up front too, so the FIRST SC track can
    // bind its widget immediately (else pause/next silently no-op — the bug where
    // uploaded SoundCloud tracks played but couldn't be paused).
    this.loadSoundCloud();
    this.progressTimer = setInterval(() => this.tickProgress(), 500);
  }

  destroy() {
    if (this.progressTimer) clearInterval(this.progressTimer);
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    if (this.blockTimer) clearTimeout(this.blockTimer);
    try {
      this.yt?.stopVideo();
    } catch {}
    this.opts.scFrame.src = "";
  }

  /* ----------------------------------------------------------- queue (own pick) */
  /** Hand-pick: play a record or a whole shelf. Leaves the synced radio (local). */
  setQueue(records: Track[], start = 0) {
    this.station = false;
    this.queue = records.slice();
    this.i = start;
    this.state.queueLen = this.queue.length;
    this.state.radio = false;
    this.pendingSeekMs = 0;
    this.playCurrent();
  }

  next() {
    if (!this.queue.length) return;
    this.i = (this.i + 1) % this.queue.length;
    this.playCurrent();
  }

  prev() {
    if (!this.queue.length) return;
    this.i = (this.i - 1 + this.queue.length) % this.queue.length;
    this.playCurrent();
  }

  togglePlay() {
    // Pause/resume is always LOCAL — on the station it just mutes you; the bar
    // keeps playing for everyone else.
    if (!this.state.track) return;
    if (this.state.source === "yt" && this.ytReady && this.yt) {
      if (this.state.playing) this.yt.pauseVideo();
      else this.yt.playVideo();
      return; // YT state events flip `playing`
    }
    if (this.state.source === "sc" && this.sc) {
      if (this.state.playing) this.sc.pause();
      else this.sc.play();
      return;
    }
  }

  showDeck() {
    this.state.visible = true;
    this.emit();
  }

  hasQueue() {
    return this.queue.length > 0;
  }

  hasTrack() {
    return !!this.state.track;
  }

  /** Restart the current track from 0 (the room's "⏮"). Local-only seek. */
  replayFromStart() {
    if (this.state.source === "yt" && this.ytReady && this.yt) {
      this.yt.seekTo(0, true);
      this.yt.playVideo();
    } else if (this.state.source === "sc" && this.sc) {
      this.sc.seekTo(0);
      this.sc.play();
    }
  }

  /* ----------------------------------------------------------- station (synced) */
  /**
   * Play a single STATION track and seek to `offsetSec` so this listener lands
   * where the shared house radio currently is. No queue auto-advance — when the
   * track ends we report it (onStationEnded) and the host drives the next one.
   */
  playStation(track: Track, offsetSec = 0) {
    // Same track already audibly near this offset — adopt the state without a
    // reload. Covers the mobile in-gesture start racing the first room broadcast
    // (a reload here would stutter, and on iOS could re-trip the autoplay gate).
    const cur = this.state.track;
    const same =
      !!cur &&
      ((!!track.ytId && cur.ytId === track.ytId) ||
        (!!track.scUrl && cur.scUrl === track.scUrl));
    if (same && this.state.playing && Math.abs(this.posSec - offsetSec) < 5) {
      this.station = true;
      this.state.track = track;
      this.state.radio = true;
      this.emit();
      return;
    }
    this.station = true;
    this.queue = [];
    this.state.queueLen = 0;
    this.state.radio = true;
    this.pendingSeekMs = Math.max(0, offsetSec) * 1000;
    this.playStationCurrent(track);
  }

  private playStationCurrent(rec: Track) {
    this.state.track = rec;
    this.state.visible = true;
    this.state.progress = 0;
    this.posSec = this.pendingSeekMs / 1000;
    this.reportedDuration = false;
    const offsetSec = this.pendingSeekMs / 1000;

    if (rec.scUrl) {
      try {
        this.yt?.pauseVideo();
      } catch {}
      this.state.source = "sc";
      this.playSc(rec.scUrl);
    } else if (rec.ytId) {
      try {
        this.sc?.pause();
      } catch {}
      this.state.source = "yt";
      if (this.ytReady && this.yt) {
        if (this.primed === rec.ytId) {
          // already cued at the door: just play + seek, like the tap-to-listen
          // pill. On iOS a fresh loadVideoById outlives the tap's permission.
          this.yt.playVideo();
          this.yt.seekTo(offsetSec, true);
        } else {
          this.yt.loadVideoById({ videoId: rec.ytId, startSeconds: offsetSec });
          this.yt.playVideo();
        }
      }
      // if YT isn't ready yet, onReady() starts the current track at pendingSeek
    }
    this.primed = null;
    this.pendingPrime = null;
    this.fadeIn();
    this.setPlaying(true);
    this.armBlockWatch();
    this.emit();
  }

  /* ----------------------------------------------------------- play one (queue) */
  private playCurrent() {
    const rec = this.queue[this.i];
    if (!rec) return;
    this.state.track = rec;
    this.state.visible = true;
    this.state.progress = 0;
    this.posSec = 0;
    this.reportedDuration = false;

    if (rec.scUrl) {
      try {
        this.yt?.pauseVideo();
      } catch {}
      this.state.source = "sc";
      this.playSc(rec.scUrl);
    } else if (rec.ytId) {
      try {
        this.sc?.pause();
      } catch {}
      this.state.source = "yt";
      this.playYt(rec.ytId);
    }
    this.fadeIn();
    this.setPlaying(true);
    this.armBlockWatch();
    this.emit();
  }

  /* ----------------------------------------------------- autoplay blocked? */
  // `playing` is set optimistically on every load, so blocked autoplay (mobile
  // policy) is detected by ground truth instead: the playhead never moving.
  private armBlockWatch() {
    if (this.blockTimer) clearTimeout(this.blockTimer);
    const at = this.posSec;
    this.blockTimer = setTimeout(() => {
      this.blockTimer = null;
      // "should be playing" but the playhead hasn't advanced → show the pill.
      // A user pause in the window flips `playing` false (real SDK event), so a
      // deliberate mute doesn't false-positive here.
      if (this.state.track && this.state.playing && this.posSec < at + 0.5) {
        this.state.blocked = true;
        this.emit();
      }
    }, 3000);
  }

  /**
   * Restart blocked audio. MUST be called from inside a real tap (click) — on
   * mobile only a gesture-initiated play is allowed to make sound. `offsetSec`
   * re-seeks to the room's live position (the room kept moving while blocked).
   */
  tapToListen(offsetSec?: number) {
    this.state.blocked = false;
    try {
      if (this.state.source === "yt" && this.ytReady && this.yt) {
        this.yt.unMute();
        this.yt.playVideo();
        if (offsetSec !== undefined && this.station)
          this.yt.seekTo(Math.max(0, offsetSec), true);
      } else if (this.state.source === "sc" && this.sc) {
        this.sc.play();
        if (offsetSec !== undefined && this.station)
          this.sc.seekTo(Math.max(0, offsetSec) * 1000);
      }
    } catch {}
    this.setPlaying(true);
    this.armBlockWatch();
    this.emit();
  }

  private playYt(id: string) {
    if (this.ytReady && this.yt) {
      this.yt.loadVideoById(id);
      this.yt.playVideo();
    }
    // if the API isn't ready yet, onReady() will start the current track
  }

  private static SC_OPTS = {
    auto_play: true,
    visual: false,
    hide_related: true,
    show_comments: false,
    show_user: true,
    download: false,
    sharing: false,
    buying: false,
  };

  private playSc(url: string) {
    const seekMs = this.pendingSeekMs;
    // Once the widget exists, switch tracks THROUGH it (load), not by swapping
    // iframe.src — a src swap orphans the bound PLAY/PAUSE/FINISH handlers, which
    // is exactly why pause stopped working on uploaded SoundCloud tracks.
    if (this.sc && this.scReady) {
      this.sc.load(url, {
        ...BarPlayer.SC_OPTS,
        callback: () => {
          if (seekMs > 0) this.sc?.seekTo(seekMs);
          this.sc?.play();
        },
      });
      return;
    }
    // First SoundCloud track: point the iframe at the player, then attach +
    // bind the widget (retrying until the SC script is actually ready).
    const qs =
      "&auto_play=true&visual=false&hide_related=true&show_comments=false&show_user=true&download=false&sharing=false&buying=false";
    this.opts.scFrame.src =
      "https://w.soundcloud.com/player/?url=" + encodeURIComponent(url) + qs;
    this.attachScWidget();
  }

  private attachScWidget(attempt = 0) {
    const w = window as WindowWithSdks;
    if (!w.SC || !w.SC.Widget) {
      this.loadSoundCloud();
      if (attempt < 80) setTimeout(() => this.attachScWidget(attempt + 1), 150);
      return; // give up after ~12s
    }
    if (this.sc) return;
    this.sc = w.SC.Widget(this.opts.scFrame);
    const E = w.SC.Widget.Events;
    this.sc.bind(E.READY, () => {
      this.scReady = true;
      if (this.pendingSeekMs > 0) {
        this.sc?.seekTo(this.pendingSeekMs);
        this.pendingSeekMs = 0;
      }
    });
    this.sc.bind(E.FINISH, () => this.onTrackEnded());
    this.sc.bind(E.PLAY, () => this.setPlaying(true));
    this.sc.bind(E.PAUSE, () => this.setPlaying(false));
    this.sc.bind(E.ERROR, () => this.onTrackEnded());
  }

  /* ----------------------------------------------------------- SDKs */
  private loadYouTube() {
    const w = window as WindowWithSdks;
    const make = () => {
      if (!w.YT) return;
      this.yt = new w.YT.Player(this.opts.ytMount, {
        height: "0",
        width: "0",
        playerVars: { playsinline: 1, rel: 0, controls: 0 },
        events: {
          onReady: () => {
            this.ytReady = true;
            // start whatever is queued if it's a YouTube track (seek if station)
            if (this.state.source === "yt" && this.state.track?.ytId) {
              this.yt!.loadVideoById({
                videoId: this.state.track.ytId,
                startSeconds: this.pendingSeekMs / 1000,
              });
              this.yt!.playVideo();
              this.fadeIn();
              this.armBlockWatch();
            } else if (this.pendingPrime && !this.state.track) {
              // the door asked to cue a track before the API was up
              const pp = this.pendingPrime;
              this.pendingPrime = null;
              try {
                this.yt!.cueVideoById({ videoId: pp.ytId, startSeconds: pp.offsetSec });
                this.primed = pp.ytId;
              } catch {}
            }
          },
          onStateChange: (e: { data: number }) => {
            const YT = w.YT!;
            if (e.data === YT.PlayerState.ENDED) this.onTrackEnded();
            else if (e.data === YT.PlayerState.PLAYING) this.setPlaying(true);
            else if (e.data === YT.PlayerState.PAUSED) this.setPlaying(false);
          },
          onError: () => this.onTrackEnded(),
        },
      });
    };

    if (w.YT && w.YT.Player) {
      make();
      return;
    }
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      make();
    };
    if (!document.getElementById("yt-iframe-api")) {
      const s = document.createElement("script");
      s.id = "yt-iframe-api";
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    }
  }

  private loadSoundCloud() {
    if (document.getElementById("sc-widget-api")) return;
    const s = document.createElement("script");
    s.id = "sc-widget-api";
    s.src = "https://w.soundcloud.com/player/api.js";
    document.head.appendChild(s);
  }

  /** A track finished (or errored). Station → tell the host; queue → auto-next. */
  private onTrackEnded() {
    if (this.station) {
      this.opts.onStationEnded?.();
      return;
    }
    this.next();
  }

  /* ----------------------------------------------------------- fade */
  // A short volume ramp on each track change softens the radio's shelf-to-shelf
  // transitions. Not a true dual-deck crossfade (that needs two overlapping
  // players — a possible follow-up); this just removes the hard cut on start.
  private fadeIn() {
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    const a = this.arrival;
    if (a) {
      // door arrival: hold near-silent until swell(), then ramp. Time-based, so a
      // late YT onReady re-entering here lands at the right level.
      const tick = () => {
        const k = a.at === Infinity ? 0 : (performance.now() - a.at) / a.ms;
        if (k >= 1) {
          if (this.fadeTimer) clearInterval(this.fadeTimer);
          this.fadeTimer = null;
          if (this.arrival === a) this.arrival = null;
          this.setVol(100);
          return;
        }
        const e = k <= 0 ? 0 : 1 - Math.pow(1 - k, 2);
        this.setVol(Math.round(a.floor + (100 - a.floor) * e));
      };
      tick();
      this.fadeTimer = setInterval(tick, 50);
      return;
    }
    let v = 0;
    this.setVol(0);
    this.fadeTimer = setInterval(() => {
      v += 14;
      if (v >= 100) {
        v = 100;
        if (this.fadeTimer) clearInterval(this.fadeTimer);
        this.fadeTimer = null;
      }
      this.setVol(v);
    }, 80);
  }
  private setVol(v: number) {
    try {
      if (this.state.source === "yt") this.yt?.setVolume(v);
      else this.sc?.setVolume(v);
    } catch {}
  }

  /* ----------------------------------------------------------- progress */
  private tickProgress() {
    if (!this.state.playing) return;
    if (this.state.source === "yt" && this.ytReady && this.yt) {
      try {
        const d = this.yt.getDuration();
        const t = this.yt.getCurrentTime();
        if (d > 0) {
          this.reportDuration(d);
          this.state.progress = t / d;
          // playback really started (late unblock, slow buffer) → hide the pill
          if (this.state.blocked && t > this.posSec + 0.2)
            this.state.blocked = false;
          this.posSec = t;
          this.emit();
        }
      } catch {}
    } else if (this.state.source === "sc" && this.sc) {
      this.sc.getDuration((durMs) => {
        if (durMs > 0) {
          this.reportDuration(durMs / 1000);
          this.sc!.getPosition((pos) => {
            this.state.progress = pos / durMs;
            if (this.state.blocked && pos / 1000 > this.posSec + 0.2)
              this.state.blocked = false;
            this.posSec = pos / 1000;
            this.emit();
          });
        }
      });
    }
  }

  // Report the active track's true length once (duration backstop). The host
  // uses this to auto-advance past stale long rows + unresolved SoundCloud.
  private reportDuration(seconds: number) {
    if (this.reportedDuration) return;
    this.reportedDuration = true;
    this.opts.onDurationKnown?.(Math.round(seconds));
  }

  /* ----------------------------------------------------------- state */
  private setPlaying(p: boolean) {
    if (this.state.playing !== p) {
      this.state.playing = p;
      this.opts.onPlaying(p);
    }
    this.emit();
  }

  private emit() {
    this.opts.onState({ ...this.state });
  }
}
