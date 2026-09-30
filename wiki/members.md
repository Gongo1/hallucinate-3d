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
