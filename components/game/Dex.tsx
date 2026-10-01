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
  keptCount,
  TITLES,
  type DugEntry,
  type Progress,
} from "@/lib/bar/progress";
import type { Shelf, Track } from "@/lib/bar/types";
import { GIFTS } from "@/lib/bar/gifts";
import { slotCap } from "@/lib/bar/quests";
import { TierChip, cueLabel, recordLink, type FlowUi } from "./shared";

/** the special tab id for your gift stash */
export const STASH = "stash";

export function Dex({
  progress,
  shelves,
  room,
  flow,
  solo,
  onCue,
  onClose,
  onMap,
  startTab,
  onSeeStash,
  onRelease,
}: {
  progress: Progress;
  shelves: Shelf[];
  room: string;
  flow: FlowUi;
  solo: boolean;
  onCue: (t: Track) => void;
  onClose: () => void;
  onMap: () => void;
  /** open on a realm id or STASH (default: the current realm) */
  startTab?: string;
  /** the stash was looked at (clears the HUD's new-gift dot) */
  onSeeStash?: () => void;
  /** let a record go from your crate (frees a slot) */
  onRelease: (key: string) => void;
}) {
  const [sel, setSelRaw] = useState(startTab ?? (REALMS[room] ? room : "kissa"));
  const setSel = (id: string) => {
    setSelRaw(id);
    if (id === STASH) onSeeStash?.();
  };
  const giftCount = GIFTS.filter((g) => progress.gifts?.[g.id]).length;
  const dugCount = Object.keys(progress.dug).length;
  const total = shelves.reduce((n, s) => n + (s.ingest ? 0 : s.records.length), 0);
  // titles count every record you've ever kept, so letting one go never demotes you
  const everKept = keptCount(progress);
  const title = titleFor(everKept);
  const nextTitle = TITLES.find((t) => t.at > everKept);
  const stamped = REALM_ORDER.filter((r) => progress.visited[r]).length;
  const secrets = SECRETS.filter((s) => progress.secrets[s.id]).length;
  const badges = REALM_ORDER.filter((r) => progress.badges[r]).length;

  const isStash = sel === STASH;
  const realmId = isStash ? room : sel;
  const realm = REALMS[realmId] ?? REALMS.kissa;
  const visited = !!progress.visited[realmId];
  const recs = useMemo(() => realmRecords(realmId, shelves), [realmId, shelves]);
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
                    · {nextTitle.at - everKept} more to {nextTitle.name}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="dexStats">
            <Stat n={`${dugCount}`} of={`/${slotCap(progress)}`} label="crate slots" />
            <Stat n={`${total}`} of="" label="in the crates" />
            <Stat n={`${stamped}`} of={`/${REALM_ORDER.length}`} label="realms stamped" />
            <Stat n={`${secrets}`} of={`/${SECRETS.length}`} label="secrets" />
            <Stat n={`${badges}`} of="" label="badges" />
            <Stat n={`${giftCount}`} of={`/${GIFTS.length}`} label="gifts" />
            <button className="gBtn small" onClick={onMap}>
              🗺 map
            </button>
          </div>
        </div>

        <div className="dexTabs">
          <button
            className={"dexTab stashTab" + (isStash ? " on" : "")}
            onClick={() => setSel(STASH)}
            title="your gift stash"
          >
            <span className="dexTabKanji">🎁</span>
            <span className="dexTabName">
              STASH {giftCount}/{GIFTS.length}
            </span>
          </button>
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

        {isStash ? (
          <Stash progress={progress} />
        ) : (
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
                  <button
                    className="dexCue dexLetGo"
                    onClick={() => confirm(`Let go of “${track.title}”? It frees a slot in your crate.`) && onRelease(key)}
                    title="let it go (frees a slot)"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
            {buried > 0 && (
              <div className="dexBuried">
                <span className="q">???</span> × {buried} still buried{" "}
                {visited ? "— flip the crates here" : "in this realm"}
              </div>
            )}
            {!recs.length && <div className="dexEmpty">This realm&apos;s crates are empty for now.</div>}
            {recs.length > 0 && !dug.length && (
              <div className="dexEmpty">Nothing dug here yet. Open a crate, have a listen, and hit ✦ keep.</div>
            )}
          </div>
        </div>
        )}
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

/** Every gift in the bar — yours in full, the rest as "?" silhouettes. */
function Stash({ progress }: { progress: Progress }) {
  const gifts = [...GIFTS].sort((a, b) => {
    const oa = progress.gifts?.[a.id] ?? 0;
    const ob = progress.gifts?.[b.id] ?? 0;
    if (!!oa !== !!ob) return oa ? -1 : 1;
    return ob - oa;
  });
  const wear = GIFTS.filter((g) => g.kind === "wear");
  const keep = GIFTS.filter((g) => g.kind === "keepsake");
  const own = (list: typeof GIFTS) => list.filter((g) => progress.gifts?.[g.id]).length;
  return (
    <div className="stashBody">
      <div className="stashIntro">
        You arrived in basic clothes. Everything here was <b>gifted</b> — by the keepers, the
        crates, the secrets. Wear the gear (◇ your fit); the keepsakes each tell you a little more about
        what Sombra is.
        <span className="stashTally">
          {own(wear)}/{wear.length} to wear · {own(keep)}/{keep.length} keepsakes
        </span>
      </div>
      <div className="stashGrid">
        {gifts
          .filter((g) => progress.gifts?.[g.id])
          .map((g) => (
            <div className={"stashItem rarity-" + g.rarity} key={g.id}>
              <div className="stashIcon">{g.icon}</div>
              <div className="stashMeta">
                <div className="stashName">
                  {g.name}
                  <span className={"giftKind small " + (g.kind === "wear" ? "wear" : "keepsake")}>
                    {g.kind === "wear" ? `WEAR · ${g.slot}` : "KEEPSAKE"}
                  </span>
                </div>
                <div className="stashBlurb">{g.blurb}</div>
                {g.link && (
                  <a className="stashLink" href={g.link} target="_blank" rel="noopener noreferrer">
                    {g.link.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")} ↗
                  </a>
                )}
              </div>
            </div>
          ))}
      </div>
      {gifts.some((g) => !progress.gifts?.[g.id]) && (
        <>
          <div className="stashLockedHead">
            still out there — talk to every keeper, keep records, bring records, find the secrets
          </div>
          <div className="stashLocked">
            {gifts
              .filter((g) => !progress.gifts?.[g.id])
              .map((g) => (
                <div
                  className={"stashQ " + (g.kind === "wear" ? "wear" : "keepsake") + " rarity-" + g.rarity}
                  key={g.id}
                  title={g.kind === "wear" ? `something to wear (${g.slot})` : "a keepsake"}
                >
                  ?
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
