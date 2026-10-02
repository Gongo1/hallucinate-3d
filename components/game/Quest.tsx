"use client";

// The mission layer's UI: the always-on tracker (what to do next), and the two
// record pickers — the deck (put one of yours on for the room) and the swap
// you're offered when your crate is full.

import type { Quest, QuestPhase } from "@/lib/bar/quests";
import type { DugEntry } from "@/lib/bar/progress";
import { TierChip } from "./shared";

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

/** The turntables: put one of your records on for the whole room. */
export function DeckPanel({
  rows,
  nowPlaying,
  status,
  onPlace,
  onClose,
}: {
  rows: CrateRow[];
  nowPlaying: string | null;
  /** why you can't right now ("wait 40s"), or the cue count */
  status: string;
  onPlace: (key: string) => void;
  onClose: () => void;
}) {
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
              On now: <b>{nowPlaying}</b>. Yours goes on next, for the whole room.
            </>
          ) : (
            "Yours goes on next, for the whole room."
          )}
        </div>
        {rows.length ? (
          <>
            <RecordList rows={rows} action="▶ put it on" onPick={onPlace} />
            <div className="lcFine">{status}</div>
          </>
        ) : (
          <div className="pickEmpty">Your crate&apos;s empty. Flip through any crate and hit ✦ Save to my crate first.</div>
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
