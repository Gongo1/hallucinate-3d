"use client";

// Small pieces the game UI shares: the progress hook, the flow-aware cue label,
// record links, the record sleeve, and the live 3D fit portrait.

import { useEffect, useRef, useSyncExternalStore } from "react";
import { getProgress, subscribeProgress, TIERS, type Progress, type Tier } from "@/lib/bar/progress";
import { drawFit } from "@/lib/bar/three/preview";
import { shade } from "@/lib/bar/color";
import type { Fit } from "@/lib/bar/fits";

/** flow-rule numbers mirrored into the UI (derived from lib/bar/flow.ts) */
export interface FlowUi {
  myCue: number;
  cueCap: number;
  canCue: boolean;
  skipHave: number;
  skipNeed: number;
  cooldownLeft: number;
  cueWaitLeft: number;
}

const EMPTY: Progress = { visited: {}, seen: {}, dug: {}, secrets: {}, talked: {}, badges: {}, gifts: {}, giftMiss: 0 };

/** Your dig (progress.ts), re-rendering on every change. Empty during SSR. */
export function useProgress(): Progress {
  return useSyncExternalStore(subscribeProgress, getProgress, () => EMPTY);
}

/** the cue button label — same wording as the crate overlay (solo hides limits) */
export function cueLabel(flow: FlowUi, solo: boolean, base = "⤵ CUE NEXT"): string {
  const waitSec = Math.ceil(flow.cueWaitLeft / 1000);
  if (solo) return base;
  if (waitSec > 0) return `⤵ wait ${waitSec}s to cue`;
  if (!flow.canCue) return "wait for one to play";
  return `${base} (${flow.myCue}/${flow.cueCap})`;
}

export function recordLink(t: { ytId?: string; scUrl?: string }): string | null {
  if (t.scUrl) return t.scUrl;
  if (t.ytId) return `https://www.youtube.com/watch?v=${t.ytId}`;
  return null;
}

export function TierChip({ tier, small = false }: { tier: Tier; small?: boolean }) {
  const t = TIERS[tier];
  return (
    <span
      className={"tierChip" + (tier === "white" || tier === "test" ? " foil" : "") + (small ? " small" : "")}
      style={{ color: t.color, borderColor: t.color }}
    >
      {small ? t.short : t.name}
    </span>
  );
}

/** A record sleeve in its crate colour with the disc peeking out. */
export function Sleeve({
  color,
  artist,
  title,
  tier,
  size = 236,
  className = "",
  chip = true,
}: {
  color: string;
  artist: string;
  title: string;
  tier?: Tier;
  size?: number;
  className?: string;
  /** show the tier chip on the sleeve (off when it's shown nearby) */
  chip?: boolean;
}) {
  const big = (artist || title).split(/[\s&]/)[0].toUpperCase();
  return (
    <div
      className={"gSleeve " + className + (tier === "white" || tier === "test" ? " foil" : "")}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${color}, ${shade(color, -58)})`,
        ["--tier" as string]: tier ? TIERS[tier].color : "transparent",
      }}
    >
      <div className="vinyl" />
      <div className="big" style={{ color: shade(color, 95), fontSize: Math.max(16, size * 0.13) }}>
        {big}
      </div>
      {tier && chip && (
        <div className="gSleeveTier">
          <TierChip tier={tier} small={size < 160} />
        </div>
      )}
    </div>
  );
}

/** The live low-poly character for a fit (one shared WebGL renderer). The big
 *  previews idle + turn; tiny ones are stills. */
export function AvatarPreview({ fit, size = 96, animate = false }: { fit: Fit; size?: number; animate?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(size * dpr);
    cv.height = Math.round(size * dpr);
    let raf = 0;
    const t0 = performance.now();
    const draw = () => {
      drawFit(cv, fit, (performance.now() - t0) / 1000, animate);
      if (animate) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [fit, size, animate]);
  return (
    <canvas
      ref={ref}
      style={{ width: size, height: size, display: "block", flex: "0 0 auto" }}
      aria-hidden="true"
    />
  );
}
