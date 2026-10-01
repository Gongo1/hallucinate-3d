# Members, keys, the Sombra list (Sep 2026)

Anonymous membership, shipped c18ee75. Spec: `KB/Sombra/outputs/html/2026-09-29-hallucinate-next-phase.html`.

## Data (`supabase/migrations/20260930_members_list_board.sql`)
- `hallu_members`: `number` is a sequence starting at 3. #001 and #002 are reserved rows.
- `hallu_keys`: invites. A row with `claims_member` set is a hand-off: redeeming it takes over that membership.
- `sombra_list`: emails.
- `hallu_events`: scored actions, unique per (member, kind, ref, week).
- `hallu_board(week)`: this week's top 20 by score.
- **RLS is on with no public policies.** Only `lib/members/store.ts` `adminClient()` (the service-role key) touches these tables. The anon key is refused (verified).
- Schema changes go through Austin pasting SQL into the Supabase SQL editor. There's no CLI or MCP here.

## Flow
- **Cookies:** `hallu_member` is `m.<uuid>.<hmac>`, signed with ADMIN_SECRET under its own tag, httpOnly, 400 days. `hallu_key` is a /k/ code waiting at the door (7 days).
- **`page.tsx` `doorGuest`** reads the cookies, so the door says "Welcome back, #042", "#017 saved you a key" or "#002 is waiting for you" in the server-rendered first paint.
- **The knock** calls `knockIn()` after `playStation`, never awaited. It resolves the returning member, else a waiting key (hand-off or invite), else creates the next number with 3 keys.
- **`/k/<code>`** is a page with tags and a per-code `opengraph-image`, which then bounces to `/k/<code>/enter`. That route sets `hallu_key` and redirects to `/`. The key is only spent on the knock.
- **Fit panel `MemberCard`:** keys with copy link, brought-in count, list status. **`ListCard`:** shown once after the first dig (`hallu-list-asked` in localStorage), and from the "☉☽ the list" menu button.
- **Scoring:** `scoreAction` (dig/keep/gift/secret/badge) has a 4-per-10s burst cap. `earnSetKey` fires after 10 minutes of ON AIR and adds a key once per set. Points live in `lib/members/tag.ts` `POINTS`.
- **Booth:** `boothTakeNumber(1)` and `boothHandoffLink(2)`.
- **Everything degrades to "no membership"** if the key or tables are missing. The bar never breaks over it.

## Testing locally
Run the dev server with `SUPABASE_SERVICE_ROLE_KEY` in the process env (pulled to a temp file, never written into `.env.local`). Tests create real members, so delete them and `setval('hallu_member_number_seq', 3, false)` afterwards.

## Founding numbers + folding (96f001f)
- **A device can knock before claiming its founding number** (Gongo got #003). `/booth` "Make this device #001" and a #002 hand-off link both call `foldMember(old, founding)`: points and the list signup move over, unused keys go, and the old row is deleted unless someone joined on its key.
- `hallu_rewind_numbers()` (migration `20260930b_number_fold.sql`, installed) then sets the sequence to max(number)+1, so no number is left held by nobody.
- **Hand-off keys take priority over an existing membership** in `knockIn`, and the door shows "#002 is waiting for you" even to a member.
- **Real members as of 2026-09-29:** #003 (Gongo's phone, to be folded into #001) and #004 (unknown: Gongo's other device, or Paula?).

## The weekly board (03951ae)
- **Whiteboard:** chalk on slate on the Listening Room's back wall, left of the sign (`KISSA_BOARD`). The kissa builder draws the top 3 diggers (records kept) and top 3 trinket collectors, and `RoomView.setBoard` redraws it via `engine.setBoard` → `world.setBoard` (view-only; world keeps the last board across room swaps).
- **Walk up + E** (zone `board`) → `BoardOverlay`: top 10 of each, your row highlighted, your overall place + points, the scoring legend, and the reset time.
- **The master** (pour-over `bar` zone) → `MasterTalk`: who's been digging all week, who's carrying the most trinkets, where you stand, when it's wiped. "Pour me a pick" keeps the old skip.
- **Data:** `weekBoard()` = `hallu_board(weekKey())` top 20 by score + your own row. Refreshed once you're inside and every 60s. The board resets on the drop-week boundary (Friday 17:00 UTC).

## The drop box: suggested records (8cce899, Sep 30)
- **Visitors can't add to crates** (`ingestLinks` is owner-only). They *suggest*: through the drop box beside THIS WEEK (`KISSA_DROPBOX`, zone `dropbox`), "add a record" from the master, the "＋ add a record" button, or the 新着 crate. All open `SubmitCard`: follow @sombra.atx on Instagram, up to 5 links, plus an optional note and IG handle.
- **The copy:** reviewed every week into THIS WEEK or the Sombra Selection.
- **Data:** `hallu_submissions` (migration `20260930d`, server-only). A member cookie is required, 10 links a day, and a pending duplicate isn't re-queued.
- **Review:** `/booth` "the drop box" list → THIS WEEK / SELECTION (runs `ingestLinks` with the booth cookie) or pass.
- **Owner check:** `page.tsx` passes `owner` (booth cookie), and the owner keeps the direct add box.
- Typing in any field no longer fires Bar's M / C / R hotkeys.

## Profiles: username + verified email (Oct 1)
Migration `supabase/migrations/20261001_profiles.sql` (`hallu_profiles`, RLS on, no policies). Actions are in `app/actions/profile.ts`. The UI is `components/game/Settings.tsx`: the ⚙ in the map header, "Save your progress" in the World menu, and the one-time offer after the first mission (skippable).
- **A profile hangs off the member row** (`member_id` primary key), so a profile carries the member number, keys and points with it.
- **Create:** `startProfile` claims the username (unique ignoring case; an unverified claim lapses after 24h) and calls Supabase Auth `signInWithOtp` with `emailRedirectTo = <this site>/?profile=confirm`.
- **Confirm:** the link comes back with `#access_token` in the hash (implicit flow). `Bar.tsx` hands it to `confirmProfile`, which checks it with `auth.getUser`. That verifies the pending row, or signs this device in by switching the member cookie and folding a throwaway membership in. The client then merges the saves (`mergeProgress`: a union, earliest timestamps, the furthest mission step).
- **Sign in on a new device:** `startSignIn` gives the same answer whether or not the email exists.
- **Sync:** `saveProfileProgress` pushes `{progress, fit}` 4s after changes, for pending or verified rows, capped at 256KB.
- **Sign out of a device** clears the member cookie and the local save, then reloads.
- **Rate limits:** one link email per profile per minute.
- **Setup this needs (Supabase dashboard, shared Sombra project):**
  - Add this site's URLs (prod + `http://localhost:3100`) to Auth → URL Configuration → Redirect URLs. Otherwise the link falls back to the project's Site URL.
  - The built-in mailer only sends a few emails an hour, so set up custom SMTP before launch.
