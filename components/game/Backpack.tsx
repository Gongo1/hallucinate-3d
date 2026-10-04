"use client";

// THE BACKPACK — the collectible copies you've claimed (lib/collection). It's
// the only place a track goes onto the room's queue from: a copy you hold.

import { COPIES_PER_TRACK, type OwnedCopy } from "@/lib/collection/rules";

/** your copies as a list, newest first, with one action each */
export function CopyList({
  copies,
  action,
  disabled,
  onPick,
}: {
  copies: OwnedCopy[];
  action: string;
  disabled?: boolean;
  onPick: (copy: OwnedCopy) => void;
}) {
  return (
    <ol className="pickList">
      {copies.map((c) => (
        <li key={c.id} className="pickRow">
          <span className="pickSwatch copySerial" title={`copy #${c.serial} of ${COPIES_PER_TRACK}`}>
            ◆{c.serial}
          </span>
          <span className="pickMeta">
            <span className="pickTitle">{c.title}</span>
            <span className="pickArtist">
              {c.artist || "—"} · copy #{c.serial} of {COPIES_PER_TRACK}
            </span>
          </span>
          <button type="button" className="gBtn small" disabled={disabled} onClick={() => onPick(c)}>
            {action}
          </button>
        </li>
      ))}
    </ol>
  );
}

export function Backpack({
  backpack,
  canQueue,
  status,
  onQueue,
  onClose,
}: {
  /** null = collecting isn't open (or you haven't knocked in yet) */
  backpack: { cap: number; copies: OwnedCopy[] } | null;
  canQueue: boolean;
  /** the cue rules right now ("wait 40s", "Your cues 1/3") */
  status: string;
  onQueue: (copy: OwnedCopy) => void;
  onClose: () => void;
}) {
  return (
    <div className="overlay open" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pickBox" role="dialog" aria-label="Your backpack">
        <button type="button" className="lcX" onClick={onClose}>
          close ✕
        </button>
        <div className="lcKicker">
          YOUR BACKPACK{backpack ? ` · ${backpack.copies.length}/${backpack.cap}` : ""}
        </div>
        <div className="lcTitle">Records you hold</div>
        {!backpack ? (
          <div className="pickEmpty">Collecting isn&apos;t open right now. Try again in a bit.</div>
        ) : backpack.copies.length ? (
          <>
            <div className="lcBody">
              Every track has only {COPIES_PER_TRACK} copies in the whole bar. Put one of yours on for the room.
            </div>
            <CopyList copies={backpack.copies} action="▶ put it on" disabled={!canQueue} onPick={onQueue} />
            <div className="lcFine">{status}</div>
          </>
        ) : (
          <div className="pickEmpty">
            Empty so far. Flip through any crate and hit ◆ Claim copy: only {COPIES_PER_TRACK} of each track exist.
          </div>
        )}
      </div>
    </div>
  );
}
