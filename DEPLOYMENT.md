# Deployment Guide — temp-mail-bot (Cloudflare Workers Builds)

The GitHub repository is the **single source of truth**: worker code,
configuration (`wrangler.toml`), D1 schema (`migrations/`), and the deploy
pipeline itself (`scripts/deploy.sh`).

After the one-time bootstrap, every `git push` deploys everything with **zero
manual Cloudflare Dashboard work**.

```
Termux: edit → git push
  → GitHub
  → Cloudflare Workers Builds   (deploy command: "bash scripts/deploy.sh", set once)
      1. npm test                                  regression gate
      2. wrangler d1 migrations apply DB --remote  D1 schema (idempotent)
      3. wrangler deploy                           code + bindings + vars
      4. curl /set-webhook                         Telegram webhook (idempotent)
  → production
```

---

## File map

| Path | Role |
|---|---|
| `_worker.js` | Application code (LOCKED — do not modify for deployment reasons) |
| `wrangler.toml` | Declarative config: worker name, D1 binding + `migrations_dir`, plain vars (`DOMAIN`, `MULTI_USER`, `TELEGRAM_USER_ID`), `workers_dev = true` |
| `migrations/*.sql` | Version-controlled D1 schema (wrangler-tracked) |
| `scripts/deploy.sh` | Every-deploy pipeline (Dashboard deploy command points here). Runs wrangler inside Workers Builds (Ubuntu — wrangler has no Android build, so it cannot run fully inside Termux). Includes a branch guard: on non-production branches it exits without deploying — keep the non-production deploy command at its default (`npx wrangler versions upload`) |
| `scripts/bootstrap.sh` | One-time bootstrap for a new Cloudflare account. **REST-based (no wrangler) so it runs on Termux** via `scripts/lib/cf-rest.mjs`. Order: D1 create → migrations (recorded in `d1_migrations`) → first deploy (creates the Worker) → workers.dev subdomain → BOT_TOKEN secret → Email Routing catch-all → webhook. Existing secrets/catch-all rules are never overwritten without explicit confirmation |
| `scripts/lib/cf-rest.mjs` | Dependency-free Cloudflare REST helper used by bootstrap (D1, deploy, secrets, subdomain, migrations) |
| `.dev.vars.example` | Template for local dev secrets (real `.dev.vars` is git-ignored) |
| `deploy.py`, `apply_migration.py`, `metadata.json` | **LEGACY** — the old manual REST deploy path. Kept for history, no longer used. Their D1 ids are stale. |

---

## ONE-TIME bootstrap (per Cloudflare account)

Run **after** editing `wrangler.toml` and setting the real `DOMAIN`:

```bash
export CLOUDFLARE_API_TOKEN=...   # see permission list in scripts/bootstrap.sh header
bash scripts/bootstrap.sh
```

`bootstrap.sh` is idempotent, requires no wrangler (it uses the Cloudflare
REST API directly, because wrangler has no Android/Termux build), and
automates: D1 creation (writes the new `database_id` into `wrangler.toml` —
commit that change), migrations (tracked in `d1_migrations` exactly like
wrangler, so CI stays in sync), first deploy (creates the Worker), the
`BOT_TOKEN` secret (typed once, hidden, never stored, overwrite-confirmed),
workers.dev subdomain, Email Routing enable + catch-all → Worker (with
overwrite protection), and webhook registration.

## ONE-TIME GitHub / Workers Builds setup (browser)

1. Create the GitHub repo, push this directory.
2. Cloudflare Dashboard → Workers & Pages → Create → connect the repo,
   branch `main`.
3. Deploy command: **`bash scripts/deploy.sh`**
   (or leave the default and rely on wrangler — but the script adds tests,
   migrations and webhook registration). Workers Builds uses the Wrangler
   version pinned in `package.json` (currently `4.129.0`; the build image
   ships Node 24, which satisfies wrangler's Node ≥ 22 requirement).4. **Build token D1 permission (important):** the auto-generated build API
   token does NOT include D1 permissions, so `wrangler d1 migrations apply`
   inside the build would fail. After connecting, go to My Profile →
   API Tokens and add **D1: Edit** to the build token (or supply your own
   token with *Workers Scripts Edit + D1 Edit* when connecting).
5. Save. Never touch it again — pipeline changes are made by editing
   `scripts/deploy.sh` in git.

## EVERY-FUTURE-DEPLOY (fully automatic)

`git push` → the four pipeline steps above. Secrets (`BOT_TOKEN`) persist
across deploys — wrangler never touches existing secret bindings.

| Change type | What you do |
|---|---|
| Code | edit `_worker.js` → push |
| Config (vars) | edit `wrangler.toml` `[vars]` → push |
| Schema | add `migrations/000N_*.sql` → push (never edit applied migrations) |
| Pipeline | edit `scripts/deploy.sh` → push |
| Rollback | `wrangler rollback` locally, or `git revert` + push |

---

## Secrets policy

- **BOT_TOKEN is a Worker SECRET.** It is NEVER in `wrangler.toml`, git, or
  CI variables. `wrangler secret put BOT_TOKEN` (done once by bootstrap, with
  overwrite confirmation if a secret already exists).
- **Never add BOT_TOKEN to `[vars]`** — a placeholder there would overwrite
  the real secret on deploy; the Worker would deploy fine and then every
  Telegram API call would 401.
- `DOMAIN`, `MULTI_USER`, `TELEGRAM_USER_ID` are non-sensitive plain vars and
  live in `wrangler.toml`.

## Local development

```bash
npm install
npm test
```

NOTE: `wrangler dev` / local `wrangler deploy` do NOT work on Termux/Android
(wrangler has no Android build — "Unsupported platform: android arm64 LE").
Local verification = `npm test` (plain Node, no Cloudflare needed); local
deploy is not supported — use `git push`. On a Linux/macOS machine,
`cp .dev.vars.example .dev.vars` + `npx wrangler dev` work normally.

## Notes & invariants

- **workers.dev URL**: `workers_dev = true` keeps the subdomain enabled; the
  URL (`https://temp-mail-bot.<account-subdomain>.workers.dev`) is stable as
  long as the Worker name and account subdomain are unchanged, and its valid
  TLS certificate is accepted by Telegram for webhooks.
- **Email Routing API**: `POST /zones/{zone}/email/routing/enable` is marked
  deprecated but remains functional (adds+locks MX/SPF); bootstrap falls back
  to the DNS-records endpoint and prints manual Dashboard steps on failure.
  Catch-all → Worker uses `PUT /zones/{zone}/email/routing/rules/catch_all`
  (permission: *Email Routing Rules Write*); an existing non-worker catch-all
  is never overwritten without explicit confirmation.
- **Migrations on a fresh database**: all migrations run in filename order,
  exactly once, tracked in the `d1_migrations` table — safe for fresh and
  existing databases alike. The Termux bootstrap applies them via REST and
  records them in the same `d1_migrations` table wrangler uses, so CI's
  `wrangler d1 migrations apply` never re-runs or double-applies. Never edit
  an already-applied migration.
- `ensureSchema()` inside `_worker.js` only self-heals the `email_tokens`
  table (migration 0004). All other schema MUST come from `migrations/`.

## Troubleshooting

- **Deploy OK but bot dead (401s)** → BOT_TOKEN got overwritten by a var, or
  the secret was never set. Fix: `wrangler secret put BOT_TOKEN`.
- **Build fails at the migrations step** → build token lacks D1 permission
  (see setup step 4 above).
- **Deploy OK but no emails arrive** → Email Routing catch-all is not pointed
  at the Worker, `DOMAIN` in `wrangler.toml` doesn't match the mail zone, or
  migrations 0001–0003 were never applied to the database.
- **Deploy OK but Telegram silent** → webhook points at an old URL; the
  deploy pipeline re-registers it, or run
  `curl https://<worker-url>/set-webhook` once.
- **Worker 200 at `/` but every DB call throws** → D1 `database_id` wrong or
  migrations not applied. Check `npx wrangler d1 migrations list DB --remote`.
