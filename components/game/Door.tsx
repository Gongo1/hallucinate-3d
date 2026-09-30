"use client";

import type { CSSProperties } from "react";
import type { Fit } from "@/lib/bar/fits";
import { AvatarPreview } from "./shared";

/** Where the door is in the arrival ritual (Bar.tsx sequences it). */
export type DoorPhase = "shut" | "knock" | "hold" | "open" | "gone";

// The shoji door that replaces the old fade-out intro. The live room renders
// behind it the whole time; the panels slide apart to reveal it.
//
// It stays id="intro" and stays a CLICK target: the knock is the gesture that
// unlocks audio on phones (pointerdown carries no user activation on touch),
// and the capture rig + scripts/shot.mjs click #intro to enter.
export function Door({
  phase,
  slideMs,
  live,
  line,
  onAir,
  fit,
  onKnock,
  onFit,
}: {
  phase: DoorPhase;
  slideMs: number;
  /** "6 inside · Sunset" — null until the lurk roster arrives */
  live: string | null;
  /** the personal line under it ("Welcome back", "The room is yours") */
  line: string | null;
  onAir: boolean;
  fit: Fit | null;
  onKnock: () => void;
  onFit: () => void;
}) {
  return (
    <div
      id="intro"
      className={`door-${phase}${onAir ? " onAir" : ""}`}
      style={{ "--slide": `${slideMs}ms` } as CSSProperties}
      onClick={onKnock}
    >
      <div className="doorPanel l" />
      <div className="doorPanel r" />
      <div className="doorSeam" />
      <div className="doorText">
        <div className="doorPresents">☉☽ SOMBRA PRESENTS</div>
        <div className="doorKanji">音楽喫茶</div>
        <h1 className="doorTitle">HALLUCINATE</h1>
        <div className="doorLive">
          {live && (
            <>
              <span className="doorDot" />
              {live}
            </>
          )}
        </div>
        <div className="doorLine">{phase === "hold" ? "someone's coming…" : line}</div>
        {/* a real button so keyboard Enter knocks too; its click bubbles to the door */}
        <button className="doorKnock" type="button">
          knock
        </button>
        {fit && (
          <button
            id="introFit"
            type="button"
            onClick={(e) => {
              e.stopPropagation(); // choosing a fit isn't knocking
              onFit();
            }}
          >
            <AvatarPreview fit={fit} size={18} /> your fit
          </button>
        )}
      </div>
    </div>
  );
}
