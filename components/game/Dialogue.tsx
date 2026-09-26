"use client";

// A keeper's dialogue box — portrait, name plate, typewriter text. Tap / E /
// Enter finishes the line, then turns the page; the last page offers the map or
// a random wander. The parent drives "advance" through advanceRef (the engine's
// E key lands in onCloseOverlays while an overlay is open).

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { REALMS } from "@/lib/bar/realms";
import { AvatarPreview } from "./shared";

const CPS = 46; // typewriter characters per second

export function Dialogue({
  room,
  advanceRef,
  onClose,
  onMap,
  onWander,
}: {
  room: string;
  advanceRef: MutableRefObject<(() => void) | null>;
  onClose: () => void;
  onMap: () => void;
  onWander: () => void;
}) {
  const realm = REALMS[room];
  const keeper = realm?.keeper;
  const lines = keeper?.lines ?? [];
  const [page, setPage] = useState(0);
  const [chars, setChars] = useState(0);
  const startRef = useRef(0); // typewriter clock (pushed far back to finish a line)
  const text = lines[page] ?? "";
  const done = chars >= text.length;
  const last = page >= lines.length - 1;

  // typewriter
  useEffect(() => {
    setChars(0);
    startRef.current = performance.now();
    let raf = 0;
    const step = () => {
      const n = Math.floor(((performance.now() - startRef.current) / 1000) * CPS);
      setChars(n);
      if (n < text.length) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text]);

  const advance = useCallback(() => {
    if (!done) {
      startRef.current = -1e9; // the running typewriter jumps to the end too
      setChars(text.length);
    }
    else if (!last) setPage((p) => p + 1);
    else onClose();
  }, [done, last, text.length, onClose]);

  const latest = useRef(advance);
  latest.current = advance;
  useEffect(() => {
    advanceRef.current = () => latest.current();
    return () => {
      advanceRef.current = null;
    };
  }, [advanceRef]);

  if (!realm || !keeper) return null;
  return (
    <div className="dlgScrim" onPointerDown={(e) => e.target === e.currentTarget && advance()}>
      <div className="dlgBox" style={{ ["--accent" as string]: realm.color }} onClick={advance}>
        <div className="dlgPortrait">
          {keeper.kind === "cat" ? (
            <div className="dlgCat" aria-hidden="true">
              🐈‍⬛
            </div>
          ) : (
            <AvatarPreview fit={keeper.fit} size={92} animate />
          )}
        </div>
        <div className="dlgBody">
          <div className="dlgName">
            {keeper.name}
            <span className="dlgTitle"> · {keeper.title}</span>
            <span className="dlgRealm">
              {realm.kanji} {realm.name}
            </span>
          </div>
          <div className="dlgText">
            {text.slice(0, chars)}
            <span className="dlgGhost">{text.slice(chars)}</span>
          </div>
          <div className="dlgFoot">
            <span className="dlgPages">
              {lines.map((_, i) => (
                <i key={i} className={i === page ? "on" : ""} />
              ))}
            </span>
            {done && last ? (
              <span className="dlgActions" onClick={(e) => e.stopPropagation()}>
                <button className="gBtn small" onClick={onMap}>
                  🗺 map
                </button>
                <button className="gBtn small" onClick={onWander}>
                  🎲 wander
                </button>
                <button className="gBtn small ghost" onClick={onClose}>
                  close
                </button>
              </span>
            ) : (
              <span className={"dlgNext" + (done ? " on" : "")}>▼</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
