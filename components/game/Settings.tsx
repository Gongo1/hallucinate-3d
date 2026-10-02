"use client";

// SETTINGS — reachable any time (the map's ⚙, the World menu). Its headline is
// the profile: a username + email so your dig follows you to other devices.
// The same profile card doubles as the one-time offer after the first mission
// (`offer`), where it can be skipped.

import { useState } from "react";
import { startProfile, startSignIn, signOutProfile, type MyProfile } from "@/app/actions/profile";

type Mode = "create" | "signin";

export function ProfileCard({
  profile,
  memberLabel,
  offer = false,
  onSkip,
  onSignedOut,
  onPending,
}: {
  profile: MyProfile | null;
  /** "#042", for the fine print */
  memberLabel: string | null;
  /** the post-mission offer: a bigger pitch and a "skip for now" */
  offer?: boolean;
  onSkip?: () => void;
  onSignedOut: () => void;
  /** a link went out for this username + email */
  onPending: (p: MyProfile) => void;
}) {
  const [mode, setMode] = useState<Mode>("create");
  const [name, setName] = useState("");
  const [email, setEmail] = useState(profile?.email ?? "");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState(false); // past the "check your email" note

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("busy");
    const r =
      mode === "create"
        ? await startProfile(name, email).catch(() => ({ ok: false, message: "Couldn't reach the bar. Try again." }))
        : await startSignIn(email).catch(() => ({ ok: false, message: "Couldn't reach the bar. Try again." }));
    if (!r.ok) {
      setState("error");
      setMsg(r.message ?? "Couldn't do that just now.");
      return;
    }
    setState("sent");
    if (mode === "create") onPending({ username: name.trim(), email: email.trim().toLowerCase(), verified: false });
  };

  if (profile?.verified)
    return (
      <div className="pfCard">
        <div className="pfWho">
          <span className="pfAt">@{profile.username}</span>
          <span className="pfOk">✓ saved to your profile</span>
        </div>
        <div className="lcFine">
          {profile.email} · your dig saves as you play, and signing in on another device brings it with you
        </div>
        <button
          type="button"
          className="gBtn small ghost"
          onClick={async () => {
            await signOutProfile().catch(() => {});
            onSignedOut();
          }}
        >
          sign out of this device
        </button>
      </div>
    );

  if (state === "sent" || (profile && !profile.verified && !editing && state === "idle"))
    return (
      <div className="pfCard">
        <div className="lcBody">
          {mode === "signin" ? (
            <>If that email has a profile, a sign-in link is on its way. Open it on this device to bring your dig here.</>
          ) : (
            <>
              Check <b>{profile?.email ?? email}</b> for a link and open it to finish{" "}
              {profile?.username ? <b>@{profile.username}</b> : "your profile"}. Your progress already saves to it.
            </>
          )}
        </div>
        <button type="button" className="gBtn small ghost" onClick={() => {
            setEditing(true);
            setState("idle");
          }}>
          {mode === "signin" ? "use a different email" : "change the name or email"}
        </button>
      </div>
    );

  return (
    <form className="pfCard" onSubmit={submit}>
      {offer && (
        <div className="lcBody">
          Make a profile and your crate, gifts and missions follow you to any device. Takes a username and an email.
        </div>
      )}
      <div className="pfTabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === "create"} className={mode === "create" ? "on" : ""} onClick={() => setMode("create")}>
          create a profile
        </button>
        <button type="button" role="tab" aria-selected={mode === "signin"} className={mode === "signin" ? "on" : ""} onClick={() => setMode("signin")}>
          I have one
        </button>
      </div>
      {mode === "create" && (
        <input
          className="pfInput"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="username"
          aria-label="Username"
          maxLength={20}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      )}
      <input
        className="pfInput"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@email.com"
        aria-label="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      {state === "error" && <div className="lcErr">{msg}</div>}
      <div className="pfActs">
        <button type="submit" className="gBtn primary" disabled={state === "busy"}>
          {state === "busy" ? "…" : mode === "create" ? "Email me a link" : "Send a sign-in link"}
        </button>
        {offer && onSkip && (
          <button type="button" className="gBtn ghost" onClick={onSkip}>
            skip for now
          </button>
        )}
      </div>
      <div className="lcFine">
        We only use it to save your dig and sign you in{memberLabel ? ` · member ${memberLabel}` : ""}.
        {offer ? " You can do this later from ⚙ settings." : ""}
      </div>
    </form>
  );
}

export function Settings({
  profile,
  memberLabel,
  slots,
  view,
  muted,
  onToggleView,
  onToggleMute,
  onClose,
  onSignedOut,
  onPending,
}: {
  profile: MyProfile | null;
  memberLabel: string | null;
  slots: { used: number; cap: number };
  view: "close" | "overview";
  muted: boolean;
  onToggleView: () => void;
  onToggleMute: () => void;
  onClose: () => void;
  onSignedOut: () => void;
  onPending: (p: MyProfile) => void;
}) {
  return (
    <div className="overlay open" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pickBox" id="settings" role="dialog" aria-label="Settings">
        <button type="button" className="lcX" onClick={onClose}>
          close ✕
        </button>
        <div className="lcKicker">⚙ SETTINGS</div>

        <section className="stSec">
          <div className="stHead">Profile</div>
          <ProfileCard profile={profile} memberLabel={memberLabel} onSignedOut={onSignedOut} onPending={onPending} />
        </section>

        <section className="stSec">
          <div className="stHead">Your crate</div>
          <div className="stRow">
            <span>
              {slots.used}/{slots.cap} slots used
            </span>
            <span className="stHint">finish missions to hold more</span>
          </div>
          <div className="dexBar">
            <i style={{ width: `${Math.min(100, (slots.used / Math.max(1, slots.cap)) * 100)}%`, background: "var(--lantern)" }} />
          </div>
        </section>

        <section className="stSec">
          <div className="stHead">Room</div>
          <div className="stRow">
            <span>Camera</span>
            <button type="button" className="gBtn small ghost" onClick={onToggleView}>
              {view === "close" ? "close-up · V" : "overview · V"}
            </button>
          </div>
          <div className="stRow">
            <span>Sound (just you)</span>
            <button type="button" className="gBtn small ghost" onClick={onToggleMute}>
              {muted ? "muted · Space" : "on · Space"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
