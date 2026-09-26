"use client";

// Non-blocking game HUD pieces: the Pokémon-style arrival sign and the toast
// stack (new realm, badge, secret, new title).

import { REALMS, REALM_ORDER } from "@/lib/bar/realms";

export interface Banner {
  key: number;
  room: string;
  first: boolean;
  stamped: number;
}

export function ArrivalBanner({ banner }: { banner: Banner }) {
  const r = REALMS[banner.room];
  if (!r) return null;
  return (
    <div
      key={banner.key}
      className={"arrival" + (banner.first ? " first" : "")}
      style={{ ["--accent" as string]: r.color }}
      aria-live="polite"
    >
      <div className="arrivalKanji">{r.kanji}</div>
      <div className="arrivalText">
        {banner.first && (
          <div className="arrivalNew">
            ✦ NEW REALM · {banner.stamped}/{REALM_ORDER.length} STAMPED
          </div>
        )}
        <div className="arrivalName">{r.name}</div>
        <div className="arrivalTag">{r.tagline}</div>
        {banner.first && <div className="arrivalSombra">{r.sombra}</div>}
      </div>
    </div>
  );
}

export interface Toast {
  id: number;
  text: string;
  tone: "gold" | "green" | "hint" | "plain";
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div id="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={"toast " + t.tone}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
