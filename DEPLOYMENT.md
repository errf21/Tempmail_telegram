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
| `scripts/deploy.sh` | Every-deploy pipeline (Dashboard deploy command points here) |
| `scripts/bootstrap.sh` | One-time bootstrap for a new Cloudflare account |
| `.dev.vars.example` | Template for local dev secrets (real `.dev.vars` is git-ignored) |
| `deploy.py`, `apply_migration.py`, `metadata.json` | **LEGACY** — the old manual REST deploy path. Kept for history, no longer used. Their D1 ids are stale. |

---

## ONE-TIME bootstrap (per Cloudflare account)

Run **after** editing `wrangler.toml` and setting the real `DOMAIN`:

```bash
npx wrangler login                      # or export CLOUDFLARE_API_TOKEN
export CLOUDFLARE_API_TOKEN=...         # zone-scoped token for Email Routing steps
bash scripts/bootstrap.sh
```

`bootstrap.sh` is idempotent and automates: D1 creation (writes the new
`database_id` into `wrangler.toml` — commit that change), migrations, the
`BOT_TOKEN` secret (typed once, hidden, never stored), Email Routing enable +
catch-all → Worker (via API, if `CLOUDFLARE_API_TOKEN` is set), first deploy,
webhook registration.

## ONE-TIME GitHub / Workers Builds setup (browser)

1. Create the GitHub repo, push this directory.
2. Cloudflare Dashboard → Workers & Pages → Create → connect the repo,
   branch `main`.
3. Deploy command: **`bash scripts/deploy.sh`**
   (or leave the default and rely on wrangler — but the script adds tests,
   migrations and webhook registration).
4. Save. Never touch it again — pipeline changes are made by editing
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
  CI variables. `wrangler secret put BOT_TOKEN` (done once by bootstrap).
- **Never add BOT_TOKEN to `[vars]`** — a placeholder there would overwrite
  the real secret on deploy; the Worker would deploy fine and then every
  Telegram API call would 401.
- `DOMAIN`, `MULTI_USER`, `TELEGRAM_USER_ID` are non-sensitive plain vars and
  live in `wrangler.toml`.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # then edit .dev.vars with a dev bot token
npx wrangler dev
npm test
```

## Troubleshooting / invariants

- **Deploy OK but bot dead (401s)** → BOT_TOKEN got overwritten by a var, or
  the secret was never set. Fix: `wrangler secret put BOT_TOKEN`.
- **Deploy OK but no emails arrive** → Email Routing catch-all is not pointed
  at the Worker, `DOMAIN` in `wrangler.toml` doesn't match the mail zone, or
  migrations 0001–0003 were never applied to the database.
- **Deploy OK but Telegram silent** → webhook points at an old URL; the
  deploy pipeline re-registers it, or run
  `curl https://<worker-url>/set-webhook` once.
- **Worker 200 at `/` but every DB call throws** → D1 `database_id` wrong or
  migrations not applied. Check `npx wrangler d1 migrations list DB --remote`.
- `ensureSchema()` inside `_worker.js` only self-heals the `email_tokens`
  table (migration 0004). All other schema MUST come from `migrations/`.
