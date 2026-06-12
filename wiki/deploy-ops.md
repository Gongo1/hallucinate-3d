# Deploy & ops

## Vercel
- The bar deploys via the **Vercel CLI** (`vercel --prod --yes`), authed as account
  `gongo1`, project `hallucinate-listening-bar` (`prj_sBKlzQPAdvaiMBCSRcpbLKAHyZBy`,
  team `team_0yXOZYgUgBDTIhC15HStyZdZ`). NOT GitHub-connected → no preview deploys;
  production + development env only.
- Public alias to share: **https://hallucinate.sombraproject.com** (and the
  `…-gongo1s-projects.vercel.app` immutable URLs return 401 due to deployment
  protection — share the alias).
- The Vercel MCP has **no env-var or add-domain tool** — use the CLI
  (`vercel env add`, `vercel domains add`, `vercel certs issue`).
- **Next.js version:** stay on a patched 15.x (Vercel blocks deploys of versions
  with known CVEs). Currently 15.5.x line.

### ⚠️ Gotcha 1 — stale build output
`vercel --prod` has shipped a **stale `.next`** more than once (deployed code that
didn't include the latest changes; live behavior tests then fail mysteriously).
**Fix: `rm -rf .next` before `npm run build` / deploy.** If a live test fails but
the code looks right, FIRST confirm the deploy actually shipped (grep a preserved
HTML id in the served output) before debugging logic.

### ⚠️ Gotcha 2 — SSL cert stalls with external DNS
When a custom domain's DNS is at an external registrar (GoDaddy here), Vercel's
auto cert-issuance can stall: plain HTTP(80) returns 200 (routing is fine) but
HTTPS gives `SSL_ERROR_SYSCALL` and `vercel certs ls` shows no cert. **A redeploy
does NOT fix this** (the cert is independent of deployments).
**Fix: `vercel certs issue <domain>`** — issues in seconds, then HTTPS works.

## Supabase
- Shared project with the Sombra site: ref **`rlqaxhnpwylhkjvzzfzp`** (us-east-2),
  `https://rlqaxhnpwylhkjvzzfzp.supabase.co`.
- hallucinate uses **supabase-js + RLS** (anon key client-side; also needed for
  Realtime). Sombra uses Prisma on the same DB — hallucinate's tables (`shelves`,
  `records`) are **additive**; never touch/migrate Sombra's tables, scope all RLS to
  ours.
- Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (client),
  `ADMIN_SECRET` (server-only, god mode). No service-role key is set or needed.
- Use the **Supabase MCP** for SQL/migrations (`execute_sql`, `apply_migration`).

## MCPs
Supabase + Vercel MCPs are connected this era (a Phase-0 session lacked them; that's
historical). Vercel MCP is read/deploy-only for domains — domain/env/cert ops go
through the CLI.
