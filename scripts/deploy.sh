#!/usr/bin/env bash
# ============================================================================
# deploy.sh — EVERY-DEPLOY pipeline (runs on every git push via
# Cloudflare Workers Builds, and locally via `npm run deploy`).
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
#   - CLOUDFLARE_API_TOKEN (or `wrangler login`) available in the environment
#
# This script is the SINGLE SOURCE OF TRUTH for how deploys happen.
# The Cloudflare Dashboard deploy command is:  bash scripts/deploy.sh
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

WORKER_NAME="temp-mail-bot"
# workers.dev URL is derived from the account subdomain; wrangler prints it on
# deploy. We capture it from the deploy output instead of hardcoding.
WORKER_URL="${WORKER_URL:-}"

echo "==> [1/4] Tests"
npm test

echo "==> [2/4] D1 migrations"
npx wrangler d1 migrations apply DB --remote

echo "==> [3/4] Deploy"
DEPLOY_OUTPUT="$(npx wrangler deploy 2>&1)"
echo "$DEPLOY_OUTPUT"

if [ -z "$WORKER_URL" ]; then
  # wrangler prints the workers.dev URL on a line like:
  #   https://temp-mail-bot.<account-subdomain>.workers.dev
  WORKER_URL="$(printf '%s\n' "$DEPLOY_OUTPUT" | grep -oE 'https://[a-zA-Z0-9.-]*\.workers\.dev' | head -1 || true)"
fi

echo "==> [4/4] Telegram webhook registration"
if [ -z "$WORKER_URL" ]; then
  echo "WARNING: could not determine workers.dev URL from deploy output." >&2
  echo "         Set WORKER_URL env var or register manually:" >&2
  echo "         curl https://<worker-url>/set-webhook" >&2
  # Do not fail the whole deploy just because URL extraction failed.
else
  echo "Registering webhook at: ${WORKER_URL}/webhook"
  curl -fsS "${WORKER_URL}/set-webhook"
  echo
fi

echo "==> Deploy complete: ${WORKER_NAME}"
