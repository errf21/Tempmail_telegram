#!/usr/bin/env bash
# ============================================================================
# deploy.sh — EVERY-DEPLOY pipeline (runs on every git push to the production
# branch via Cloudflare Workers Builds, and locally via `npm run deploy`).
#
# Pipeline:
#   1. npm test                                  — regression gate (plain Node)
#   2. wrangler d1 migrations apply DB --remote  — D1 schema (idempotent)
#   3. wrangler deploy                           — code + bindings + vars
#   4. curl /set-webhook                         — Telegram webhook (idempotent)
#
# Requirements (one-time bootstrap, see scripts/bootstrap.sh):
#   - D1 database "tempmail-db" exists and its id is in wrangler.toml
#   - BOT_TOKEN secret already set on the Worker (survives every deploy)
#   - Auth available in the environment (Workers Builds injects its own
#     CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID automatically; locally use
#     `wrangler login`).
#
# IMPORTANT (Workers Builds token): the auto-generated build token does NOT
# include D1 permissions by default. Add "D1: Edit" to the build token
# (My Profile > API Tokens) or supply a custom token, otherwise step 2 fails.
#
# Branch safety: if this script is ever (mis)configured as the deploy command
# for NON-production branches, it exits without deploying — preview commits
# can never be promoted to production. Keep the non-production deploy command
# at its default (npx wrangler versions upload).
#
# NOTE: this script requires wrangler, which has no Android build — it can
# therefore NOT run fully inside Termux. That is by design: it runs in
# Cloudflare Workers Builds (Ubuntu) on every push. Use scripts/bootstrap.sh
# for the one-time Termux-side bootstrap (REST-based, no wrangler).
#
# This script is the SINGLE SOURCE OF TRUTH for how deploys happen.
# The Cloudflare Dashboard deploy command is:  bash scripts/deploy.sh
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

# Worker name from wrangler.toml (single source of truth)
WORKER_NAME="$(sed -n 's/^name[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' wrangler.toml | head -1)"
[ -n "$WORKER_NAME" ] || { echo "FATAL: cannot read worker name from wrangler.toml" >&2; exit 1; }

# Branch guard: Workers Builds injects WORKERS_CI_BRANCH; locally it is unset
# and this guard is inactive. Never promote non-production commits.
PRODUCTION_BRANCH="${PRODUCTION_BRANCH:-main}"
if [ -n "${WORKERS_CI_BRANCH:-}" ] && [ "${WORKERS_CI_BRANCH}" != "${PRODUCTION_BRANCH}" ]; then
  echo "Branch '${WORKERS_CI_BRANCH}' is not the production branch ('${PRODUCTION_BRANCH}')."
  echo "Skipping full deploy. Preview branches should use: npx wrangler versions upload"
  exit 0
fi

# workers.dev URL can be overridden via env; otherwise extracted from the
# `wrangler deploy` output at step 3.
WORKER_URL="${WORKER_URL:-}"

echo "==> [1/4] Tests"
if [ ! -d node_modules ]; then
  echo "    Installing dependencies (wrangler is pinned in package.json)..."
  npm ci --ignore-scripts || npm install --ignore-scripts
fi
npm test

echo "==> [2/4] D1 migrations"
npx wrangler d1 migrations apply DB --remote

echo "==> [3/4] Deploy"
DEPLOY_OUTPUT="$(npx wrangler deploy 2>&1)"
echo "$DEPLOY_OUTPUT"

if [ -z "$WORKER_URL" ]; then
  # wrangler prints the workers.dev URL, e.g.:
  #   https://temp-mail-bot.<account-subdomain>.workers.dev
  WORKER_URL="$(printf '%s\n' "$DEPLOY_OUTPUT" | grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' | head -1 || true)"
fi

echo "==> [4/4] Telegram webhook registration"
if [ -z "$WORKER_URL" ]; then
  echo "WARNING: could not determine workers.dev URL from deploy output." >&2
  echo "         Set WORKER_URL env var or register manually:" >&2
  echo "         curl https://<worker-url>/set-webhook" >&2
  # Do not fail the whole deploy just because URL extraction failed.
else
  echo "Registering webhook at: ${WORKER_URL}/webhook"
  # Retry a few times: brand-new deployments can take a moment to become
  # publicly reachable on the workers.dev subdomain.
  curl -fsS --retry 4 --retry-delay 2 --retry-connrefused "${WORKER_URL}/set-webhook"
  echo
fi

echo "==> Deploy complete: ${WORKER_NAME}"
