"use client";

// A gift being handed over — the big icon unwrapping out of a burst, what it is
// (something to WEAR, or a KEEPSAKE), and the little Sombra lesson it carries.

import { GIFTS, type Gift } from "@/lib/bar/gifts";

export interface GiftItem {
  key: number;
  gift: Gift;
  /** who handed it over ("Rio", "the bar", …) */
  from: string;
}

const SLOT_LABEL: Record<string, string> = {
  hat: "hat",
  top: "top",
  neck: "neck",
  eyes: "eyes",
  back: "back",
};

export function GiftCard({
  item,
  owned,
  wearing,
  onWear,
  onStash,
  onClose,
  onBackdrop,
}: {
  item: GiftItem;
  /** how many gifts you own now (for the n/total line) */
  owned: number;
  /** the wearable is already on */
  wearing: boolean;
  onWear: () => void;
  onStash: () => void;
  onClose: () => void;
  /** a tap on the dim backdrop (guarded — a mashed tap mustn't skip the gift) */
  onBackdrop?: () => void;
}) {
  const g = item.gift;
  const wear = g.kind === "wear";
  return (
    <div
      className="overlay open gGift"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) (onBackdrop ?? onClose)();
      }}
    >
      <div className="ovClose" onClick={onClose}>
        CLOSE ✕
      </div>
      <div className={"giftBox rarity-" + g.rarity} key={item.key}>
        <div className="giftFrom">
          🎁 A gift from <b>{item.from}</b>
        </div>
        <div className="giftStage">
          <div className="giftBurst" />
          <div className="giftSpark s1">✦</div>
          <div className="giftSpark s2">✦</div>
          <div className="giftSpark s3">✧</div>
          <div className="giftIcon" aria-hidden="true">
            {g.icon}
          </div>
        </div>
        <div className="giftName">{g.name}</div>
        <div className="giftChips">
          <span className={"giftKind " + (wear ? "wear" : "keepsake")}>
            {wear ? `WEAR · ${SLOT_LABEL[g.slot ?? ""] ?? ""}` : "KEEPSAKE"}
          </span>
          {g.rarity === 3 && <span className="giftRare">✦ rare</span>}
          <span className="giftCount">
            {owned}/{GIFTS.length} gifts
          </span>
        </div>
        <p className="giftBlurb">{g.blurb}</p>
        {g.link && (
          <a className="giftLink" href={g.link} target="_blank" rel="noopener noreferrer">
            {g.link.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")} ↗
          </a>
        )}
        <div className="giftActions">
          {wear &&
            (wearing ? (
              <button className="gBtn primary" onClick={onClose}>
                ✓ wearing it
              </button>
            ) : (
              <button className="gBtn primary" onClick={onWear}>
                wear it now
              </button>
            ))}
          {wear ? (
            <button className="gBtn ghost" onClick={onClose}>
              later
            </button>
          ) : (
            <button className="gBtn primary" onClick={onClose}>
              ✦ into the stash
            </button>
          )}
          <button className="gBtn ghost" onClick={onStash}>
            see your stash
          </button>
        </div>
      </div>
    </div>
  );
}
