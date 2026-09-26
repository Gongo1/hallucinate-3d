"use client";

// THE CRATE DEX — your collection, realm by realm. Records you've dug (tier-
// coloured, rarest first), what's still buried, each realm's lore and how it
// ties to Sombra, and the badges you've earned.

import { useMemo, useState } from "react";
import { REALMS, REALM_ORDER, SECRETS } from "@/lib/bar/realms";
import {
  TIERS,
  BADGE_AT,
  recordKey,
  realmRecords,
  titleFor,
  TITLES,
  type DugEntry,
  type Progress,
} from "@/lib/bar/progress";
import type { Shelf, Track } from "@/lib/bar/types";
import { TierChip, cueLabel, recordLink, type FlowUi } from "./shared";

export function Dex({
  progress,
  shelves,
  room,
  flow,
  solo,
  onCue,
  onClose,
  onMap,
}: {
  progress: Progress;
  shelves: Shelf[];
  room: string;
  flow: FlowUi;
  solo: boolean;
  onCue: (t: Track) => void;
  onClose: () => void;
  onMap: () => void;
}) {
  const [sel, setSel] = useState(REALMS[room] ? room : "kissa");
  const dugCount = Object.keys(progress.dug).length;
  const total = shelves.reduce((n, s) => n + (s.ingest ? 0 : s.records.length), 0);
  const title = titleFor(dugCount);
  const nextTitle = TITLES.find((t) => t.at > dugCount);
  const stamped = REALM_ORDER.filter((r) => progress.visited[r]).length;
  const secrets = SECRETS.filter((s) => progress.secrets[s.id]).length;
  const badges = REALM_ORDER.filter((r) => progress.badges[r]).length;

  const realm = REALMS[sel];
  const visited = !!progress.visited[sel];
  const recs = useMemo(() => realmRecords(sel, shelves), [sel, shelves]);
  const byShelf = useMemo(() => {
    const m = new Map<string, { shelf: Shelf; total: number; dug: number }>();
    for (const { track, shelf } of recs) {
      const e = m.get(shelf.id) ?? { shelf, total: 0, dug: 0 };
      e.total++;
      if (progress.dug[recordKey(track)]) e.dug++;
      m.set(shelf.id, e);
    }
    return [...m.values()];
  }, [recs, progress.dug]);
  const dug = useMemo(() => {
    const out: { key: string; entry: DugEntry; track: Track }[] = [];
    for (const { track } of recs) {
      const key = recordKey(track);
      const entry = progress.dug[key];
      if (entry) out.push({ key, entry, track });
    }
    return out.sort((a, b) => TIERS[b.entry.tier].rank - TIERS[a.entry.tier].rank || b.entry.at - a.entry.at);
  }, [recs, progress.dug]);
  const buried = recs.length - dug.length;

  return (
    <div
      className="overlay open gDex"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ovClose" onClick={onClose}>
        CLOSE ✕
      </div>
      <div className="dexBox">
        <div className="dexHead">
          <div className="dexBrand">
            <span className="dexDisc">💿</span>
            <div>
              <div className="dexName">CRATE DEX</div>
              <div className="dexRank">
                {title}
                {nextTitle && (
                  <span className="dexNext">
                    {" "}
                    · {nextTitle.at - dugCount} more to {nextTitle.name}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="dexStats">
            <Stat n={`${dugCount}`} of={`/${total}`} label="records dug" />
            <Stat n={`${stamped}`} of={`/${REALM_ORDER.length}`} label="realms stamped" />
            <Stat n={`${secrets}`} of={`/${SECRETS.length}`} label="secrets" />
            <Stat n={`${badges}`} of="" label="badges" />
            <button className="gBtn small" onClick={onMap}>
              🗺 map
            </button>
          </div>
        </div>

        <div className="dexTabs">
          {REALM_ORDER.map((id) => {
            const r = REALMS[id];
            const v = !!progress.visited[id];
            return (
              <button
                key={id}
                className={"dexTab" + (id === sel ? " on" : "") + (progress.badges[id] ? " badge" : "") + (v ? "" : " unknown")}
                style={{ ["--accent" as string]: r.color }}
                onClick={() => setSel(id)}
                title={v ? r.name : "not stamped yet"}
              >
                <span className="dexTabKanji">{v ? r.kanji : "?"}</span>
                <span className="dexTabName">{v ? r.name : "???"}</span>
                {id === room && <span className="dexHere">here</span>}
              </button>
            );
          })}
        </div>

        <div className="dexBody">
          <div className="dexRealm" style={{ ["--accent" as string]: realm.color }}>
            <div className="dexRealmKanji">{visited ? realm.kanji : "?"}</div>
            <div className="dexRealmName">{visited ? realm.name : "an unstamped realm"}</div>
            <div className="dexRealmTag">{visited ? realm.tagline : "find the door to learn more"}</div>
            {visited ? (
              <>
                <p className="dexLore">{realm.lore}</p>
                <p className="dexSombra">
                  <b>☉☽ Sombra</b> — {realm.sombra}
                </p>
                <div className="dexKeeper">
                  keeper · <b>{realm.keeper.name}</b>, {realm.keeper.title}
                  {progress.talked[sel] ? "" : " — hasn't met you yet (!)"}
                </div>
              </>
            ) : (
              <p className="dexLore dim">Walk the doors, take a secret passage, or rub the lucky cat to stamp it.</p>
            )}
            <div className="dexCrates">
              {byShelf.map(({ shelf, total, dug }) => (
                <div className="dexCrate" key={shelf.id}>
                  <div className="dexCrateTop">
                    <span style={{ color: shelf.color }}>{shelf.label.replace(/·.*/, "").trim()}</span>
                    <span>
                      {dug}/{total}
                    </span>
                  </div>
                  <div className="dexBar">
                    <i style={{ width: `${total ? (dug / total) * 100 : 0}%`, background: shelf.color }} />
                  </div>
                </div>
              ))}
              {!byShelf.length && <div className="dexEmpty">no crates here yet</div>}
            </div>
            <div className={"dexBadge" + (progress.badges[sel] ? " on" : "")}>
              🏅 {progress.badges[sel] ? `${realm.name} badge earned` : `dig ${Math.min(BADGE_AT, recs.length || BADGE_AT)} records here to earn this realm's badge`}
            </div>
          </div>

          <div className="dexList">
            {dug.map(({ key, entry, track }) => {
              const link = recordLink(track);
              return (
                <div className={"dexRec tier-" + entry.tier} key={key}>
                  <span className="dexRecSwatch" style={{ background: entry.color }} />
                  <div className="dexRecMeta">
                    <div className="dexRecTitle">{track.title}</div>
                    <div className="dexRecArtist">
                      {track.artist || "—"} <span className="dexRecCrate">· {entry.shelf.replace(/·.*/, "").trim()}</span>
                    </div>
                  </div>
                  <TierChip tier={entry.tier} small />
                  <button className="dexCue" disabled={!flow.canCue} onClick={() => onCue(track)} title={cueLabel(flow, solo)}>
                    ⤵
                  </button>
                  {link && (
                    <a className="dexOpen" href={link} target="_blank" rel="noopener noreferrer" title="open">
                      ↗
                    </a>
                  )}
                </div>
              );
            })}
            {buried > 0 && (
              <div className="dexBuried">
                <span className="q">???</span> × {buried} still buried{" "}
                {visited ? "— dig the piles or flip the crates here" : "in this realm"}
              </div>
            )}
            {!recs.length && <div className="dexEmpty">This realm&apos;s crates are empty for now.</div>}
            {recs.length > 0 && !dug.length && (
              <div className="dexEmpty">Nothing dug here yet. Find a glinting pile, or open a crate and hit ✦ keep.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ n, of, label }: { n: string; of: string; label: string }) {
  return (
    <div className="dexStat">
      <div className="dexStatN">
        {n}
        <span>{of}</span>
      </div>
      <div className="dexStatL">{label}</div>
    </div>
  );
}
