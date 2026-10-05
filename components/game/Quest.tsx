"use client";

// The mission layer's UI: the always-on tracker (what to do next), and the two
// record pickers — the deck (put one of yours on for the room) and the swap
// you're offered when your crate is full.

import type { Quest, QuestPhase } from "@/lib/bar/quests";
import type { DugEntry } from "@/lib/bar/progress";
import { TierChip } from "./shared";
import { CopyList } from "./Backpack";
import type { OwnedCopy } from "@/lib/collection/rules";

/** Top-left, out of the way: the mission you're on and the one thing to do next. */
export function QuestTracker({
  quest,
  phase,
  step,
  yieldToPrompt,
}: {
  quest: Quest;
  phase: QuestPhase;
  step: number;
  /** an action prompt is up: on a phone it sits in the same spot, so step aside */
  yieldToPrompt: boolean;
}) {
  const next = phase === "offer" ? "Talk to Rio, the record scout (look for the !)" : quest.steps[Math.max(0, step)];
  return (
    <div id="questTracker" className={yieldToPrompt ? "yield" : ""} role="status" aria-live="polite">
      <div className="qtKicker">MISSION · {quest.name}</div>
      <div className="qtStep">
        <span className="qtDot" />
        {next}
      </div>
      {phase !== "offer" && (
        <div className="qtPips" aria-hidden="true">
          {quest.steps.map((_, i) => (
            <i key={i} className={i < step ? "done" : i === step ? "on" : ""} />
          ))}
        </div>
      )}
    </div>
  );
}

export interface CrateRow {
  key: string;
  entry: DugEntry;
}

/** Your crate as a list, newest first — every record you hold, even ones that
 *  have since left the realm's crates (the Dex only shows what's still there). */
export function crateRows(dug: Record<string, DugEntry>): CrateRow[] {
  return Object.entries(dug)
    .map(([key, entry]) => ({ key, entry }))
    .sort((a, b) => b.entry.at - a.entry.at);
}

function RecordList({
  rows,
  action,
  disabled,
  onPick,
}: {
  rows: CrateRow[];
  action: string;
  disabled?: boolean;
  onPick: (key: string) => void;
}) {
  return (
    <ol className="pickList">
      {rows.map(({ key, entry }) => (
        <li key={key} className="pickRow">
          <span className="pickSwatch" style={{ background: entry.color }} />
          <span className="pickMeta">
            <span className="pickTitle">{entry.title}</span>
            <span className="pickArtist">
              {entry.artist || "—"} · {entry.shelf.replace(/·.*/, "").trim()}
            </span>
          </span>
          <TierChip tier={entry.tier} small />
          <button type="button" className="gBtn small" disabled={disabled} onClick={() => onPick(key)}>
            {action}
          </button>
        </li>
      ))}
    </ol>
  );
}

/** The turntables: put a copy you hold on for the whole room. During Rio's
 *  orientation a saved record gets a practice spin instead: it plays just for
 *  you and counts for the step, but never reaches the room's queue. */
export function DeckPanel({
  copies,
  practice,
  nowPlaying,
  status,
  canQueue,
  onQueue,
  onPractice,
  onClose,
}: {
  /** your backpack (null = collecting isn't open) */
  copies: OwnedCopy[] | null;
  /** saved records offered for Rio's practice spin (empty outside that step) */
  practice: CrateRow[];
  nowPlaying: string | null;
  /** why you can't right now ("wait 40s"), or the cue count */
  status: string;
  canQueue: boolean;
  onQueue: (copy: OwnedCopy) => void;
  onPractice: (key: string) => void;
  onClose: () => void;
}) {
  const mine = copies ?? [];
  return (
    <div className="overlay open" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pickBox" role="dialog" aria-label="The deck">
        <button type="button" className="lcX" onClick={onClose}>
          close ✕
        </button>
        <div className="lcKicker">THE DECK · 盤</div>
        <div className="lcTitle">Put a record on</div>
        <div className="lcBody">
          {nowPlaying ? (
            <>
              On now: <b>{nowPlaying}</b>.{" "}
            </>
          ) : null}
          A copy from your backpack goes on next, for the whole room.
        </div>
        {practice.length > 0 && (
          <>
            <div className="lcKicker">RIO&apos;S PRACTICE SPIN · JUST YOU</div>
            <RecordList rows={practice} action="◐ practice spin" onPick={onPractice} />
          </>
        )}
        {mine.length ? (
          <>
            <CopyList copies={mine} action="▶ put it on" disabled={!canQueue} onPick={onQueue} />
            <div className="lcFine">{status}</div>
          </>
        ) : (
          !practice.length && (
            <div className="pickEmpty">
              {copies === null
                ? "Collecting isn't open right now."
                : "Your backpack's empty. Flip through any crate and hit ◆ Claim copy first."}
            </div>
          )
        )}
      </div>
    </div>
  );
}

/** Crate full: let one go to make room for the record you just saved. */
export function SwapPanel({
  rows,
  incoming,
  cap,
  onRelease,
  onClose,
}: {
  rows: CrateRow[];
  incoming: { title: string; artist: string };
  cap: number;
  onRelease: (key: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="overlay open" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pickBox" role="dialog" aria-label="Your crate is full">
        <button type="button" className="lcX" onClick={onClose}>
          keep digging ✕
        </button>
        <div className="lcKicker">
          YOUR CRATE IS FULL · {rows.length}/{cap}
        </div>
        <div className="lcTitle">Let one go?</div>
        <div className="lcBody">
          To keep <b>{incoming.artist ? `${incoming.artist} — ` : ""}{incoming.title}</b>, let go of one you hold. Finish
          missions to make your crate bigger.
        </div>
        <RecordList rows={rows} action="let go" onPick={onRelease} />
      </div>
    </div>
  );
}
