"use client";

// THE BACKPACK — the collectible copies you've claimed (lib/collection). Apart
// from house records (the Gongo crate, the Selection), it's the only place a
// track goes onto the room's queue from: a copy you hold. A drawer on the
// right (the room stays in view); a sheet on phones. Not to be confused with
// My crate (K): those are ✦ saves, bookmarks that own nothing.

import { useEffect, useMemo, useRef, useState } from "react";
import { COPIES_PER_TRACK, type OwnedCopy } from "@/lib/collection/rules";
import { copyState, isNewCopy, visibleCopies, type BackpackFilter, type CopyState, type RoomView } from "@/lib/collection/backpack";

/** your copies as a list, newest first, with one action each (the deck uses it) */
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

const FILTERS: { id: BackpackFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready" },
  { id: "new", label: "New" },
  { id: "queued", label: "Queued" },
  { id: "here", label: "Found here" },
];

export function Backpack({
  backpack,
  room,
  here,
  sourceOf,
  highlight,
  onQueue,
  onPreview,
  onClose,
}: {
  /** null = collecting isn't open (or you haven't knocked in yet) */
  backpack: { cap: number; copies: OwnedCopy[] } | null;
  /** what the room is playing / has cued, and whether you can cue */
  room: RoomView;
  /** track keys found in the room you're standing in */
  here: ReadonlySet<string>;
  /** where a copy was found ("CRATE · Room"), if we know */
  sourceOf: (copy: OwnedCopy) => string | null;
  /** a copy to point at (just claimed) */
  highlight: string | null;
  onQueue: (copy: OwnedCopy) => void;
  onPreview: (copy: OwnedCopy) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<BackpackFilter>("all");
  const [query, setQuery] = useState("");
  const [now] = useState(() => Date.now());
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);

  // focus moves into the drawer, and back to whatever opened it on close
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus({ preventScroll: true });
    return () => opener?.focus?.({ preventScroll: true });
  }, []);
  // the just-claimed copy scrolls into view
  useEffect(() => {
    if (highlight) listRef.current?.querySelector<HTMLElement>(`[data-copy="${highlight}"]`)?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const copies = useMemo(() => backpack?.copies ?? [], [backpack]);
  const shown = useMemo(() => visibleCopies(copies, filter, query, room, now, here), [copies, filter, query, room, now, here]);
  const held = copies.length;
  const cap = backpack?.cap ?? 0;
  const left = Math.max(cap - held, 0);
  const counts = useMemo(() => {
    const out: Record<BackpackFilter, number> = { all: copies.length, ready: 0, new: 0, queued: 0, here: 0 };
    for (const c of copies) {
      const s = copyState(c, room).kind;
      if (s === "ready") out.ready++;
      if (s === "queued" || s === "playing") out.queued++;
      if (isNewCopy(c, now)) out.new++;
      if (here.has(c.trackKey)) out.here++;
    }
    return out;
  }, [copies, room, now, here]);

  return (
    <aside id="backpack" role="dialog" aria-modal="false" aria-labelledby="bpTitle">
      <header className="bpHead">
        <div className="bpKicker">
          BACKPACK <kbd>C</kbd>
        </div>
        <button type="button" ref={closeRef} className="bpX" onClick={onClose} aria-label="Close backpack">
          close ✕
        </button>
        <h2 id="bpTitle" className="bpTitle">
          Your records
        </h2>
        {backpack && (
          <div className="bpCount" aria-live="polite">
            <span>
              <b>{held}</b> of {cap} spaces used · {left === 0 ? "full" : `${left} ${left === 1 ? "space" : "spaces"} left`}
            </span>
            <span className="bpSlots" aria-hidden="true">
              {Array.from({ length: cap }, (_, i) => (
                <i key={i} className={i < held ? "on" : ""} />
              ))}
            </span>
          </div>
        )}
      </header>

      {!backpack ? (
        <p className="bpEmpty">Collecting isn&apos;t open right now. Try again in a bit.</p>
      ) : !held ? (
        <div className="bpEmpty">
          <p>Nothing in here yet.</p>
          <p>
            Dig through any crate and hit <b>◆ Claim copy</b>. Each track has only {COPIES_PER_TRACK} numbered copies
            in the whole bar, and you have room for {cap}.
          </p>
          <p className="bpFine">
            Records from the Gongo crate and the Sombra Selection are house records: you can&apos;t claim them, and
            anyone can put them on straight from the crate.
          </p>
        </div>
      ) : (
        <>
          <div className="bpTools">
            <input
              type="search"
              className="bpSearch"
              placeholder="Search title or artist"
              aria-label="Search your records"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="bpFilters" role="group" aria-label="Show">
              {FILTERS.map((f) =>
                f.id !== "all" && !counts[f.id] && filter !== f.id ? null : (
                  <button
                    key={f.id}
                    type="button"
                    className={"bpChip" + (filter === f.id ? " on" : "")}
                    aria-pressed={filter === f.id}
                    onClick={() => setFilter(f.id)}
                  >
                    {f.label} <span>{counts[f.id]}</span>
                  </button>
                )
              )}
            </div>
          </div>
          <ol className="bpList" ref={listRef}>
            {shown.map((c) => (
              <CopyRow
                key={c.id}
                copy={c}
                state={copyState(c, room)}
                source={sourceOf(c)}
                isNew={isNewCopy(c, now)}
                lit={c.id === highlight}
                onQueue={() => onQueue(c)}
                onPreview={() => onPreview(c)}
              />
            ))}
            {!shown.length && <li className="bpNone">Nothing matches. Try All.</li>}
          </ol>
          <p className="bpFine">
            ✦ Saves live in My crate (<kbd>K</kbd>). They&apos;re bookmarks: they don&apos;t take a space here, and they
            can&apos;t go on for the room.
          </p>
        </>
      )}
    </aside>
  );
}

function CopyRow({
  copy,
  state,
  source,
  isNew,
  lit,
  onQueue,
  onPreview,
}: {
  copy: OwnedCopy;
  state: CopyState;
  source: string | null;
  isNew: boolean;
  lit: boolean;
  onQueue: () => void;
  onPreview: () => void;
}) {
  const name = `${copy.artist ? `${copy.artist}, ` : ""}${copy.title}`;
  return (
    <li className={"bpRow " + state.kind + (lit ? " lit" : "")} data-copy={copy.id}>
      <span className="bpSleeve" aria-hidden="true">
        <span className="bpSerial">◆{copy.serial}</span>
      </span>
      <span className="bpMeta">
        <span className="bpTrack">{copy.title}</span>
        <span className="bpArtist">{copy.artist || "—"}</span>
        <span className="bpFacts">
          Copy {copy.serial} of {COPIES_PER_TRACK}
          {source ? ` · found in ${source}` : ""}
          {isNew ? <em className="bpNew">new</em> : null}
        </span>
      </span>
      <span className="bpAct">
        {state.kind === "ready" && (
          <button type="button" className="gBtn small primary" onClick={onQueue} aria-label={`Put it on: ${name}`}>
            ▶ Put it on
          </button>
        )}
        {state.kind === "playing" && <span className="bpState on">♪ On now</span>}
        {state.kind === "queued" && <span className="bpState">Queued · #{state.pos} in line</span>}
        {state.kind === "unavailable" && <span className="bpState dim">{state.reason}</span>}
        {state.kind !== "playing" && (
          <button type="button" className="bpPreview" onClick={onPreview} aria-label={`Preview 30 seconds, just for you: ${name}`}>
            preview
          </button>
        )}
      </span>
    </li>
  );
}
