#!/usr/bin/env bash
# ============================================================================
# bootstrap.sh — ONE-TIME bootstrap for a NEW Cloudflare account.
#
# Run ONCE from Termux:   bash scripts/bootstrap.sh
#
# IMPORTANT: this script does NOT use wrangler. Cloudflare wrangler has no
# Android build ("Unsupported platform: android arm64 LE"), so on Termux all
# Cloudflare operations are performed via the REST API through
# scripts/lib/cf-rest.mjs (Node >= 18, no dependencies) + curl. The regular
# every-push pipeline (scripts/deploy.sh) runs wrangler inside Cloudflare
# Workers Builds, where it works normally.
#
# Ordering is deliberate (safe on a brand-new account where nothing exists):
#   1. Token verification + account id
#   2. D1 database "tempmail-db" created if missing; id written to wrangler.toml
#   3. D1 migrations applied via REST (recorded in d1_migrations exactly like
#      wrangler does, so CI's `wrangler d1 migrations apply` stays in sync)
#   4. FIRST deploy via REST — creates the Worker
#      (required before secrets, which need an existing script)
#   5. workers.dev subdomain enabled for the script
#   6. BOT_TOKEN stored as a Worker SECRET (overwrite confirmation)
#   7. Email Routing enabled + catch-all pointed at the Worker
#      (an existing non-worker catch-all is NEVER silently overwritten)
#   8. Telegram webhook registered
#
# Prerequisites BEFORE running:
#   - Edit wrangler.toml [vars]: set DOMAIN to the real mail domain
#   - The domain's zone must exist in this Cloudflare account
#   - env CLOUDFLARE_API_TOKEN with: Account > Workers Scripts (Edit),
#     Account > D1 (Edit), Account > Account Settings (Read),
#     Zone > Zone (Read), Zone > DNS (Edit), Zone > Email Routing Rules (Edit)
#   - Optional: CLOUDFLARE_ACCOUNT_ID (auto-detected from the token otherwise)
#
# Idempotent: safe to re-run.
# NO REAL SECRETS ARE EVER WRITTEN TO DISK OR GIT BY THIS SCRIPT.
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

WRANGLER_TOML="wrangler.toml"
CF="node scripts/lib/cf-rest.mjs"

fail() { echo "ERROR: $*" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v node >/dev/null 2>&1 || fail "node is required"
[ -f scripts/lib/cf-rest.mjs ] || fail "scripts/lib/cf-rest.mjs missing"
[ -f "$WRANGLER_TOML" ] || fail "wrangler.toml missing"
[ -f "_worker.js" ] || fail "_worker.js missing"

WORKER_NAME="$(sed -n 's/^name[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$WRANGLER_TOML" | head -1)"
[ -n "$WORKER_NAME" ] || fail "cannot read worker name from wrangler.toml"

echo "==> [0/9] Pre-flight checks"
grep -q '^DOMAIN *= *"yourdomain\.com"' "$WRANGLER_TOML" 2>/dev/null && \
  fail "wrangler.toml still has the placeholder DOMAIN. Set the real domain first."
DOMAIN="$(sed -n 's/^DOMAIN *= *"\([^"]*\)".*/\1/p' "$WRANGLER_TOML" | head -1)"
[ -n "$DOMAIN" ] || fail "Could not read DOMAIN from wrangler.toml"
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || fail "CLOUDFLARE_API_TOKEN is not set (see the permission list in the header of this file)"
echo "    worker: ${WORKER_NAME} | DOMAIN: ${DOMAIN}"

echo "==> [1/9] Token verification + account id"
ACCOUNT_ID="$($CF whoami)" || fail "token verification failed"
[ -n "$ACCOUNT_ID" ] || fail "could not determine account id"
echo "    account: ${ACCOUNT_ID}"

echo "==> [2/9] D1 database"
DB_ID="$($CF d1-list | awk -F'\t' '$1=="tempmail-db"{print $2}')"
if [ -n "$DB_ID" ]; then
  echo "    D1 'tempmail-db' exists: ${DB_ID}"
else
  echo "    Creating D1 database 'tempmail-db'..."
  DB_ID="$($CF d1-create tempmail-db)"
  [ -n "$DB_ID" ] || fail "D1 create returned no id"
  echo "    Created: ${DB_ID}"
fi
if grep -q "\"${DB_ID}\"" "$WRANGLER_TOML"; then
  echo "    wrangler.toml already points at ${DB_ID}"
else
  node -e '
    const fs=require("fs");const f=process.argv[2];const id=process.argv[1];
    let t=fs.readFileSync(f,"utf8");
    const before=t;
    t=t.replace(/(database_id *= *")[0-9a-f-]{36}(")/, `$1${id}$2`);
    if(t===before)process.exit(1);
    fs.writeFileSync(f,t);
  ' "$DB_ID" "$WRANGLER_TOML" || fail "Could not write database_id into wrangler.toml"
  echo "    wrangler.toml database_id -> ${DB_ID}  (remember to git commit this change)"
fi

echo "==> [3/9] D1 migrations (via REST, tracked in d1_migrations)"
$CF migrate "$ACCOUNT_ID" "$DB_ID"

echo "==> [4/9] First deploy (creates the Worker; BOT_TOKEN not yet set — expected)"
$CF deploy "$ACCOUNT_ID" "$WORKER_NAME"

echo "==> [5/9] workers.dev subdomain"
SUBDOMAIN="$($CF subdomain "$ACCOUNT_ID" "$WORKER_NAME" 2>/dev/null || true)"
if [ -n "$SUBDOMAIN" ] && [ "$SUBDOMAIN" != "NO_SUBDOMAIN" ]; then
  WORKER_URL="https://${WORKER_NAME}.${SUBDOMAIN}.workers.dev"
  echo "    ${WORKER_URL}"
else
  WORKER_URL=""
  echo "    Could not resolve/register the workers.dev subdomain automatically." >&2
  echo "    Register it in Dashboard (Workers & Pages > Subdomain) — the URL" >&2
  echo "    also appears in the first Workers Builds deploy." >&2
fi

echo "==> [6/9] BOT_TOKEN secret"
if $CF secret-list "$ACCOUNT_ID" "$WORKER_NAME" | grep -qx "BOT_TOKEN"; then
  echo "    BOT_TOKEN secret ALREADY EXISTS on '${WORKER_NAME}'."
  if [ -t 0 ]; then
    read -r -p "    Overwrite it with a new value? [y/N] " ANSWER
    case "${ANSWER:-N}" in y|Y) DO_SECRET=1 ;; *) DO_SECRET=0 ;; esac
  else
    echo "    Non-interactive session: keeping the existing secret (set CONFIRM_OVERWRITE=1 to force)."
    DO_SECRET="${CONFIRM_OVERWRITE:-0}"
  fi
else
  DO_SECRET=1
fi
if [ "${DO_SECRET}" = "1" ]; then
  echo -n "Enter BOT_TOKEN (hidden input; stored as Worker secret, never written to disk or git): "
  read -rs BOT_TOKEN; echo
  [ -n "$BOT_TOKEN" ] || fail "BOT_TOKEN cannot be empty"
  printf '%s' "$BOT_TOKEN" | $CF secret-put "$ACCOUNT_ID" "$WORKER_NAME" BOT_TOKEN
  unset BOT_TOKEN
else
  echo "    Keeping existing BOT_TOKEN secret."
fi

echo "==> [7/9] Email Routing + catch-all -> Worker (zone API)"
API="https://api.cloudflare.com/client/v4"
AUTH=(-H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H "Content-Type: application/json")
ZONE_ID="$(curl -fsS "${AUTH[@]}" "${API}/zones?name=${DOMAIN}" | node -e '
  let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
    try{const j=JSON.parse(d);console.log(j.result&&j.result[0]?j.result[0].id:"")}
    catch(e){console.log("")}})')"
[ -n "$ZONE_ID" ] || fail "Zone '${DOMAIN}' not found in this account (is the domain on Cloudflare yet?)"
echo "    zone: ${ZONE_ID}"

# 7a. Current catch-all state — never silently overwrite a different rule.
CURRENT_ACTION="$(curl -fsS "${AUTH[@]}" "${API}/zones/${ZONE_ID}/email/routing/rules/catch_all" | node -e '
  let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
    try{const j=JSON.parse(d);const a=j.result&&j.result.actions?j.result.actions[0]:null;
    console.log(a?a.type+":"+(a.value?a.value.join(","):""):"none")}
    catch(e){console.log("none")}})')"
if [ "${CURRENT_ACTION}" = "worker:${WORKER_NAME}" ]; then
  echo "    catch-all already points at '${WORKER_NAME}' — nothing to do"
else
  if [ "${CURRENT_ACTION}" != "none" ] && [ "${CURRENT_ACTION}" != "worker:" ] && [ "${CURRENT_ACTION}" != "drop:" ]; then
    echo "    WARNING: existing catch-all action is '${CURRENT_ACTION}' (not this Worker)." >&2
    if [ -t 0 ]; then
      read -r -p "    Overwrite it with catch-all -> Worker '${WORKER_NAME}'? [yes/N] " ANSWER
      [ "${ANSWER:-N}" = "yes" ] || fail "Aborted: catch-all left unchanged. Configure Email Routing manually."
    else
      fail "Existing catch-all points elsewhere ('${CURRENT_ACTION}'). Set CONFIRM_OVERWRITE=1 to overwrite."
    fi
  fi

  # 7b. Enable Email Routing (idempotent; adds+locks required MX/SPF records).
  #     The /enable endpoint is marked deprecated but remains the functional
  #     one-step call; fall back to the DNS-records endpoint, then to manual.
  if curl -fsS -X POST "${AUTH[@]}" "${API}/zones/${ZONE_ID}/email/routing/enable" >/dev/null 2>&1; then
    echo "    Email Routing enabled (MX/SPF records added/verified)"
  elif curl -fsS -X POST "${AUTH[@]}" "${API}/zones/${ZONE_ID}/email/routing/dns" >/dev/null 2>&1; then
    echo "    Email Routing DNS records created via fallback endpoint"
  else
    echo "    Email Routing API calls failed — enable it manually in the Dashboard:" >&2
    echo "      Email > Email Routing > Enable (zone '${DOMAIN}')" >&2
  fi

  # 7c. Point the catch-all rule at this Worker (idempotent upsert).
  curl -fsS -X PUT "${AUTH[@]}" \
    "${API}/zones/${ZONE_ID}/email/routing/rules/catch_all" \
    --data "{\"matchers\":[{\"type\":\"all\"}],\"actions\":[{\"type\":\"worker\",\"value\":[\"${WORKER_NAME}\"]}],\"enabled\":true,\"name\":\"catch-all to ${WORKER_NAME}\",\"source\":\"api\"}" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);console.log(j.success?"    catch-all -> worker OK":"    catch-all FAILED: "+JSON.stringify(j.errors))}catch(e){console.log("    catch-all response: "+d)}})'
fi

echo "==> [8/9] Telegram webhook"
if [ -n "$WORKER_URL" ]; then
  echo "    Registering ${WORKER_URL}/webhook"
  curl -fsS --retry 4 --retry-delay 2 --retry-connrefused "${WORKER_URL}/set-webhook" && echo
else
  echo "    SKIPPED: no workers.dev URL yet. After the first Workers Builds deploy:" >&2
  echo "    curl https://<worker-url>/set-webhook  (or re-run this script)" >&2
fi

echo "==> [9/9] Summary"
echo "    Worker : ${WORKER_NAME}"
echo "    URL    : ${WORKER_URL:-<available after first Workers Builds deploy>}"
echo "    D1     : tempmail-db (${DB_ID})"
echo "    Domain : ${DOMAIN}"
echo "======================================================================"
echo " Bootstrap complete."
echo " Next: push to GitHub, connect Workers Builds with deploy command:"
echo "     bash scripts/deploy.sh"
echo " and add 'D1: Edit' permission to the build API token (see DEPLOYMENT.md)."
echo "======================================================================"
