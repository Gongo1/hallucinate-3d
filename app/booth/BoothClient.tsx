"use client";

import { useState } from "react";
import Link from "next/link";
import { boothLogin, boothLogout, boothCommand } from "@/app/actions/booth";
import type { AdminCmd } from "@/lib/booth/commands";

// The booth — owner's god-mode panel. Authority is ENTIRELY server-side: this
// component just calls server actions that re-verify the owner cookie. Logged
// out, it only shows a passphrase form; there is no admin flag or secret in this
// bundle. boothCommand() returns {ok:false} for anyone unverified, so even a
// forged call from devtools does nothing.

export default function BoothClient({ initialOwner }: { initialOwner: boolean }) {
  const [owner, setOwner] = useState(initialOwner);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [live, setLive] = useState(false);
  const [locked, setLocked] = useState(false);

  const login = async () => {
    setBusy(true);
    setMsg("");
    const res = await boothLogin(pass);
    setBusy(false);
    setPass("");
    if (res.ok) {
      setOwner(true);
      setMsg("");
    } else {
      setMsg("Wrong passphrase.");
    }
  };
  const logout = async () => {
    await boothLogout();
    setOwner(false);
  };
  const cmd = async (c: AdminCmd, note: string) => {
    const res = await boothCommand(c);
    setMsg(res.ok ? `✓ ${note}` : "✗ rejected (not authorized)");
  };

  if (!owner) {
    return (
      <div className="boothWrap">
        <div className="boothCard">
          <div className="boothTitle">◉ THE BOOTH</div>
          <div className="boothSub">owner access only</div>
          <input
            className="boothInput"
            type="password"
            placeholder="passphrase"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && login()}
          />
          <button className="boothBtn primary" onClick={login} disabled={busy}>
            {busy ? "…" : "enter the booth"}
          </button>
          {msg && <div className="boothMsg">{msg}</div>}
          <Link className="boothBack" href="/">← back to the bar</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="boothWrap">
      <div className="boothCard wide">
        <div className="boothTitle">◉ GOD MODE</div>
        <div className="boothSub">commands affect the whole venue · everyone sees the effect</div>

        <div className="boothGrid">
          <button className="boothBtn" onClick={() => cmd({ kind: "forceSkip" }, "force-skipped")}>
            ⏭ FORCE SKIP
          </button>
          <button className="boothBtn" onClick={() => cmd({ kind: "clearCue" }, "cleared the cue")}>
            ✕ CLEAR CUE
          </button>
          <button
            className={"boothBtn" + (locked ? " on" : "")}
            onClick={() => {
              const next = !locked;
              setLocked(next);
              cmd({ kind: "lockCue", locked: next }, next ? "locked cueing" : "unlocked cueing");
            }}
          >
            {locked ? "🔒 CUEING LOCKED" : "🔓 LOCK CUEING"}
          </button>
          <button
            className={"boothBtn onair" + (live ? " on" : "")}
            onClick={() => {
              const next = !live;
              setLive(next);
              if (next) setLocked(true);
              cmd({ kind: "onAir", live: next, dj: "THE OWNER" }, next ? "ON AIR" : "off air");
            }}
          >
            {live ? "🔴 ON AIR — go off" : "⚫ GO ON AIR"}
          </button>
        </div>

        <div className="boothPin">
          <PinForm onPin={(t) => cmd({ kind: "pin", track: t }, `pinned ${t.title}`)}
                   onPlay={(t) => cmd({ kind: "forcePlay", track: t }, `now playing ${t.title}`)} />
        </div>

        {msg && <div className="boothMsg">{msg}</div>}
        <div className="boothRow">
          <Link className="boothBack" href="/">← back to the bar</Link>
          <button className="boothBtn ghost" onClick={logout}>log out</button>
        </div>
      </div>
    </div>
  );
}

function PinForm({
  onPin,
  onPlay,
}: {
  onPin: (t: { title: string; artist: string; ytId?: string }) => void;
  onPlay: (t: { title: string; artist: string; ytId?: string }) => void;
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const parseId = (u: string) =>
    u.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/)?.[1];
  const build = () => {
    const ytId = parseId(url);
    if (!ytId) return null;
    return { title: title || "owner pick", artist: "", ytId };
  };
  return (
    <div className="pinForm">
      <div className="boothSub">pin / force-play a YouTube link</div>
      <input className="boothInput" placeholder="youtube url" value={url} onChange={(e) => setUrl(e.target.value)} />
      <input className="boothInput" placeholder="title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="boothGrid">
        <button className="boothBtn" onClick={() => { const t = build(); if (t) onPin(t); }}>⤵ PIN NEXT</button>
        <button className="boothBtn" onClick={() => { const t = build(); if (t) onPlay(t); }}>▶ FORCE PLAY</button>
      </div>
    </div>
  );
}
