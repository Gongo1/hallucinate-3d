# God mode & ON AIR

Owner-only venue control. **Authority is 100% server-side** — the client never
decides who is admin; the server verifies every admin action.

## Auth (server-only)
- Hidden route **`/booth`**. Anonymous visitors see only a passphrase form; the
  god-mode panel renders ONLY after server-verified login.
- `lib/booth/auth.ts` (`import "server-only"`): login compares the posted passphrase
  to **`ADMIN_SECRET`** (server env), mints an HMAC-signed token, stores it as a
  **signed httpOnly cookie** (`booth_session`, 12h). `verifyToken` re-checks
  signature+expiry (constant-time) on every action.
- No Supabase Auth needed (venue is anonymous). No service-role key needed/used
  (the Supabase MCP only exposes the anon key anyway). `ADMIN_SECRET` is set on
  Vercel (production + development), NOT `NEXT_PUBLIC`. The passphrase lives in
  `.env.local` — **never** in the KB or any Realtime payload.

## How a command flows
1. Owner clicks a control in the booth → calls the server action `boothCommand`
   (`app/actions/booth.ts`).
2. The action **re-verifies the cookie**, then publishes a server-origin `admin`
   event to the `hallucinate-bar` channel via Supabase's **HTTP broadcast API**
   (`POST {SUPABASE_URL}/realtime/v1/api/broadcast`, anon key — broadcast needs no
   elevated DB perms). Returns `{ok:false}` and broadcasts nothing if unverified.
3. The **host** applies the admin command (`presence.ts onAdmin`) authoritatively —
   bypassing vote-skip/cooldown/cue-cap (the only thing allowed to) — and
   rebroadcasts the new RoomState. Everyone sees the effect; only the owner caused it.

## Powers
force-skip · clear cue · remove a cued track · pin (front of cue) · force-play (now)
· lock cueing (room-wide) · toggle ON AIR.

## ON AIR primitive (minimal, seat left for the future)
`RoomState` carries `live / dj / liveStartedAt / cueLocked`. Default OFF →
collaborative cue. An in-world **ON AIR sign** above the deck (`engine.drawOnAir`,
dark by default → red+pulsing when live; pushed via `engine.setOnAir` from Bar's
`onRoom` — the engine never reads shared state) + a DOM banner. Going live sets
`cueLocked=true` (the room listens to the owner); off restores collaboration. Not
built yet: scheduled sets, guest-DJ role, an independent live audio source.

## Verified guarantees
Logged out / as a normal user there is no way to issue an admin command — proven by
capturing a real owner server-action request and replaying it with the cookie
stripped: the server **rejected it, zero broadcast**. The secret never appears in
the client bundle. Engine has no auth/admin authority.
