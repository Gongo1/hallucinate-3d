"use client";

// THE MAP — every realm as a node, doors as roads, found secret passages as
// dashed gold. Visited realms show their kanji + how much you've dug; click one
// to travel there. Unstamped realms stay a "?" until you find your way in.

import { useMemo, useState } from "react";
import { REALMS, REALM_ORDER, SECRETS } from "@/lib/bar/realms";
import { ROOMS } from "@/lib/bar/rooms";
import { realmStats, type Progress } from "@/lib/bar/progress";
import type { Shelf } from "@/lib/bar/types";

// landscape by default; on a tall phone screen the graph is transposed so it
// fills the sheet instead of floating as a thin strip
const LAND = { w: 1000, h: 640 };
const PORT = { w: 640, h: 1000 };
function layout(portrait: boolean) {
  const { w, h } = portrait ? PORT : LAND;
  return (id: string) => {
    const m = REALMS[id].map;
    const [u, v] = portrait ? [m.y, m.x] : [m.x, m.y];
    return { x: 70 + u * (w - 140), y: 60 + v * (h - 120) };
  };
}

/** a gently bowed road between two nodes */
function road(a: { x: number; y: number }, b: { x: number; y: number }, bow = 0.12): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return `M${a.x},${a.y} Q${mx - dy * bow},${my + dx * bow} ${b.x},${b.y}`;
}

export function WorldMap({
  progress,
  shelves,
  room,
  onTravel,
  onWander,
  onClose,
  onDex,
}: {
  progress: Progress;
  shelves: Shelf[];
  room: string;
  onTravel: (id: string) => void;
  onWander: () => void;
  onClose: () => void;
  onDex: () => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const [portrait] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(max-aspect-ratio: 4/5)").matches);
  const pos = useMemo(() => layout(portrait), [portrait]);
  const { w: W, h: H } = portrait ? PORT : LAND;
  const edges = useMemo(() => {
    const seen = new Set<string>();
    const out: [string, string][] = [];
    for (const id of Object.keys(ROOMS)) {
      for (const d of ROOMS[id].doors) {
        if (!REALMS[id] || !REALMS[d.to]) continue;
        const k = [id, d.to].sort().join("|");
        if (seen.has(k)) continue;
        seen.add(k);
        out.push([id, d.to]);
      }
    }
    return out;
  }, []);
  // cheap (a few hundred records) — recomputed each render so rings track your save
  const stats: Record<string, { total: number; dug: number }> = {};
  for (const id of REALM_ORDER) stats[id] = realmStats(id, shelves);
  const stamped = REALM_ORDER.filter((r) => progress.visited[r]).length;
  const focus = hover ?? room;
  const fr = REALMS[focus];
  const fv = !!progress.visited[focus];

  return (
    <div
      className="overlay open gMap"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ovClose" onClick={onClose}>
        CLOSE ✕
      </div>
      <div className="mapBox">
        <div className="mapHead">
          <div>
            <div className="mapName">THE REALMS</div>
            <div className="mapSub">
              {stamped}/{REALM_ORDER.length} stamped · click a stamped realm to travel
            </div>
          </div>
          <div className="mapBtns">
            <button className="gBtn small" onClick={onWander}>
              🎲 wander
            </button>
            <button className="gBtn small ghost" onClick={onDex}>
              💿 dex
            </button>
          </div>
        </div>
        <svg className={"mapSvg" + (portrait ? " portrait" : "")} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
          <defs>
            <radialGradient id="mapGlow">
              <stop offset="0" stopColor="#ffb35e" stopOpacity="0.16" />
              <stop offset="1" stopColor="#ffb35e" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx={pos("kissa").x} cy={pos("kissa").y} r={320} fill="url(#mapGlow)" />
          {edges.map(([a, b]) => {
            const known = progress.visited[a] || progress.visited[b];
            return (
              <path
                key={a + b}
                d={road(pos(a), pos(b))}
                className={"mapRoad" + (known ? " known" : "")}
              />
            );
          })}
          {SECRETS.filter((s) => progress.secrets[s.id]).map((s) => (
            <path key={s.id} d={road(pos(s.a.room), pos(s.b.room), -0.22)} className="mapSecret" />
          ))}
          {REALM_ORDER.map((id) => {
            const r = REALMS[id];
            const p = pos(id);
            const v = !!progress.visited[id];
            const st = stats[id];
            const frac = st.total ? st.dug / st.total : 0;
            const C = 2 * Math.PI * 38;
            return (
              <g
                key={id}
                className={"mapNode" + (v ? " visited" : "") + (id === room ? " here" : "") + (progress.badges[id] ? " badge" : "")}
                transform={`translate(${p.x},${p.y})`}
                style={{ ["--accent" as string]: r.color }}
                onMouseEnter={() => setHover(id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => v && onTravel(id)}
              >
                {id === room && <circle className="mapPulse" r={44} />}
                <circle className="mapRingBg" r={38} />
                {v && st.total > 0 && (
                  <circle
                    className="mapRing"
                    r={38}
                    strokeDasharray={`${C * frac} ${C}`}
                    transform="rotate(-90)"
                  />
                )}
                <circle className="mapDot" r={31} />
                <text className="mapKanji" y={7}>
                  {v ? r.kanji.slice(0, 2) : "?"}
                </text>
                <text className="mapLabel" y={60}>
                  {v ? r.name : "???"}
                </text>
                {progress.badges[id] && (
                  <text className="mapBadge" x={26} y={-24}>
                    🏅
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        <div className="mapInfo" style={{ ["--accent" as string]: fr.color }}>
          {fv ? (
            <>
              <b>
                {fr.kanji} {fr.name}
              </b>{" "}
              · {fr.tagline} · dug {stats[focus].dug}/{stats[focus].total}
              {focus === room ? " · you are here" : ""}
            </>
          ) : (
            <>an unstamped realm — find a door, a secret, or roll the dice</>
          )}
        </div>
      </div>
    </div>
  );
}
