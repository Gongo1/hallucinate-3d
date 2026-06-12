# Sombra connection

The bar is connected to the Sombra restaurant site **by wiring, not a code merge**.
Two separate codebases/deploys; they connect via a subdomain + a secret portal.

Story: **sombraproject.com (threshold) → ☉☽ → hallucinate.sombraproject.com (bar)
→ rave portal → hallucinate.site.**

## The subdomain (ops)
- `hallucinate.sombraproject.com` is attached to the **bar's** Vercel project; the
  apex `sombraproject.com` stays on the `sombra-website` project (untouched).
- DNS is at **GoDaddy** (nameservers `ns23/ns24.domaincontrol.com`). The record:
  **CNAME `hallucinate` → `cname.vercel-dns.com`** (matches the site's existing
  `www`). The owner adds this at GoDaddy; Vercel can't auto-config since NS aren't
  Vercel's.
- After DNS resolved, the cert stalled → fixed with `vercel certs issue
  hallucinate.sombraproject.com` (see [deploy-ops](deploy-ops.md) Gotcha 2). Now
  live over HTTPS; full ☉☽ crossing verified in-browser.

## The secret ☉☽ portal (in the Sombra repo)
The homepage celestial glyph (`<p className="celestial">☉☽`) became
`src/app/celestial-portal.tsx` — a client component: hover → pointer + glow +
whispered "enter ↗" hint, keyboard-focusable (`role=link`, aria-label), prefetch on
hover; click → ~700ms CSS radial-dissolve warp → **same-tab**
`window.location.href` to the subdomain. CSS in Sombra's `globals.css`. Rest of the
site untouched.

## Continuity touches (in the bar repo)
- `app/layout.tsx` — OG/canonical/metadataBase → `https://hallucinate.sombraproject.com`
  (the `.vercel.app` URL still works).
- `components/Bar.tsx` — "☉☽ SOMBRA PRESENTS" on the intro + a `#sombraDoor` ☉☽ link
  in the topbar back to `https://sombraproject.com` (worlds connect both ways).

## ⚠️ Editing the live Sombra site safely
`sombraproject.com` is **GitHub-connected** (`Gongo1/sombra-website`) → every push
to `main` auto-deploys to production. Its working tree has **pre-existing
uncommitted work that is NOT ours** (modified package.json, a deleted
`api/happy-hours/route.ts`, scrape scripts, `marketing/`, etc.).
**NEVER `git add -A` / blanket-commit there** — it would ship someone's
half-finished work. Always `git add` only the specific files you changed, verify
`git diff --cached --name-only`, then commit + push.

- Events page: `src/app/experiencias/page.tsx` holds a hardcoded `EVENTS: Event[]`
  (newest first). To add an event, prepend an object and commit only that file.
  (2026-06-01: added "HUM · A 360° Sound Healing" Jul 11; Sombra Eventbrite org
  `eventbrite.com/o/121402925084`.)
- Nav: `src/app/nav.tsx`. El Barrio tab is currently commented out (page still
  exists at `/el-barrio`, just unlinked).
