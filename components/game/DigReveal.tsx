"use client";

// The dig reveal — a record bursting out of the pile, Pokémon-catch style:
// sleeve, pressing tier, NEW-to-your-dex, where it came from, and what to do next.

import { REALMS } from "@/lib/bar/realms";
import { TIERS, type DugEntry } from "@/lib/bar/progress";
import type { Shelf, Track } from "@/lib/bar/types";
import { Sleeve, TierChip, cueLabel, recordLink, type FlowUi } from "./shared";

export type Reveal =
  | { kind: "record"; room: string; track: Track; shelf: Shelf; entry: DugEntry; isNew: boolean }
  | { kind: "empty"; room: string };

export function DigReveal({
  reveal,
  flow,
  solo,
  onCue,
  onClose,
}: {
  reveal: Reveal;
  flow: FlowUi;
  solo: boolean;
  onCue: (t: Track) => void;
  onClose: () => void;
}) {
  const realm = REALMS[reveal.room];
  return (
    <div
      className="overlay open gReveal"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ovClose" onClick={onClose}>
        CLOSE ✕
      </div>
      {reveal.kind === "empty" ? (
        <div className="revealBox">
          <div className="revealKicker">✦ YOU DUG IN {realm?.name ?? reveal.room}</div>
          <div className="revealDust">🌫</div>
          <div className="revealEmpty">Only dust… this realm&apos;s crates are empty for now.</div>
          <button className="gBtn" onClick={onClose}>
            keep digging
          </button>
        </div>
      ) : (
        <RecordReveal reveal={reveal} flow={flow} solo={solo} onCue={onCue} onClose={onClose} />
      )}
    </div>
  );
}

function RecordReveal({
  reveal,
  flow,
  solo,
  onCue,
  onClose,
}: {
  reveal: Extract<Reveal, { kind: "record" }>;
  flow: FlowUi;
  solo: boolean;
  onCue: (t: Track) => void;
  onClose: () => void;
}) {
  const { track, shelf, entry, isNew, room } = reveal;
  const realm = REALMS[room];
  const tier = TIERS[entry.tier];
  const link = recordLink(track);
  const rare = entry.tier === "white" || entry.tier === "test";
  return (
    <div className={"revealBox tier-" + entry.tier}>
      <div className="revealKicker">
        ✦ DUG UP IN <span style={{ color: realm?.color }}>{realm?.kanji} {realm?.name}</span>
      </div>
      <div className="revealStage">
        <div className="revealRays" style={{ ["--ray" as string]: tier.color }} />
        <Sleeve color={shelf.color} artist={track.artist} title={track.title} tier={entry.tier} size={220} className="pop" chip={false} />
      </div>
      <div className="revealTier">
        <TierChip tier={entry.tier} />
        {rare && <span className="revealRare">{entry.tier === "test" ? "✦ one of the rare ones" : "✦ nice pull"}</span>}
      </div>
      <div className={"revealNew" + (isNew ? " on" : "")}>{isNew ? "NEW · added to your Crate Dex" : "already in your Crate Dex"}</div>
      <div className="revealArtist">{track.artist || "—"}</div>
      <div className="revealTitle">{track.title}</div>
      <div className="revealFrom">
        from the <b style={{ color: shelf.color }}>{shelf.label.replace(/·.*/, "").trim()}</b> crate
      </div>
      <div className="revealActions">
        <button
          id="revealCue"
          className="gBtn primary"
          disabled={!flow.canCue}
          onClick={() => {
            onCue(track);
            onClose();
          }}
        >
          {cueLabel(flow, solo, "⤵ cue for the room")}
        </button>
        {link && (
          <a className="gBtn ghost" href={link} target="_blank" rel="noopener noreferrer">
            open ↗
          </a>
        )}
        <button className="gBtn ghost" onClick={onClose}>
          keep digging
        </button>
      </div>
    </div>
  );
}
