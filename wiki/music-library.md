# Music library & curation

## Hard rules (from the owner — non-negotiable)
1. **ALWAYS ask before adding/downloading ANY music.** Sourcing tracks and
   inserting them without explicit approval is not OK, even when a task seems to
   call for it. Present candidates (artist — title + source) and wait.
2. **The venue is STRICTLY HOUSE.** No melodic bass, dubstep, DnB, trap, pop, or
   "copyright-free/NCS" filler. When the owner names a channel/playlist/link, pull
   from THAT; never improvise sources.

Why: it's the owner's venue + taste, and off-genre tracks pollute the one shared
radio everyone hears. (This rule exists because an early auto-pull added ~20
off-genre tracks from MrSuicideSheep/NCS/etc. — all removed.)

## Current shelves (room → shelf)
- **Kissa:** `house`, `stacks`, `deepdown` (DEEP DOWN), `flipwax` (FLIP THE WAX),
  `detroit` (right-wall shelf), `new` (新着 NEW ARRIVALS — the live paste crate).
- **Garden:** `goldenhour` (GOLDEN HOUR) + `organica` (ORGANICA) — 50/50 from the
  owner's deep-house playlist.

Counts drift as people add records; query the DB for the live state. All shelves
feed the one shared radio.

## The import / validate pipeline (when approved)
Reusable flow for pulling a YouTube channel or playlist:
1. Resolve the source: `@handle/videos` or `/channel/UC…/videos` or
   `/playlist?list=…`. For a handle, scrape `"(channelId|externalId)":"(UC…)"`.
2. Gather candidate video IDs from the page's `ytInitialData` **and** the RSS feed
   (`feeds/videos.xml?channel_id=…`) — RSS gives ~15 latest with clean titles;
   ytInitialData/playlist gives more.
3. **Validate every ID via oEmbed** (`youtube.com/oembed?format=json&url=…`, keep
   only HTTP 200) — never trust scraped IDs/titles; oEmbed title is authoritative.
4. Resolve duration (keyless: scrape the watch page's `"lengthSeconds"`; or the
   YouTube Data API if `YT_API_KEY` is set). **Reject ≥ 900s** (the 15-min library
   rule). Optionally drop very short clips.
5. Parse "Artist - Title" on `\s[–—-]\s`, strip `#hashtag`/"| NCS" suffixes, drop
   livestream placeholders.
6. **Dedupe by ytId AND normalized artist|title.** Show the list, ASK, then insert
   idempotent SQL (`where not exists … yt_id`) via the Supabase MCP `execute_sql`.

## Sources used so far
- DEEP DOWN — @DeepDownUR2 · FLIP THE WAX — @FlipTheWax (+ @UC09Ldf… short set clips)
- DETROIT — youtube.com/channel/UCJp1ISlPtHPs4ZLdlAmd4-g
- House additions — @DesertEssence971channel (note: the "channel" suffix is part of
  the handle)
- Garden (Golden Hour + Organica) — the owner's playlist
  `PLMBh0GOA5xDpxzv52zcXGhKfhJiTljyeU` (deep/organic house; 100 tracks, split 50/50)

The full validated 100-track playlist dump is in `../outputs/garden-playlist-2026-06-01.md`.
