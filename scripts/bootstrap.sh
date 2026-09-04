#!/usr/bin/env bash
# ============================================================================
# bootstrap.sh — ONE-TIME bootstrap for a NEW Cloudflare account.
#
# Run ONCE from Termux:   bash scripts/bootstrap.sh
#
# What it does (idempotent — safe to re-run):
#   1. Verifies wrangler authentication
#   2. Creates the D1 database "tempmail-db" if missing and writes its id
#      into wrangler.toml
#   3. Applies all D1 migrations (0001..000N) to the remote database
#   4. Prompts for BOT_TOKEN and stores it as a Worker SECRET
#      (never written to disk or git)
#   5. [Zone config] Enables Email Routing on the DOMAIN zone and points the
#      catch-all rule at this Worker (uses CLOUDFLARE_API_TOKEN + REST API)
#   6. Performs the first `wrangler deploy`
#   7. Registers the Telegram webhook (from the deploy output URL)
#
# Prerequisites BEFORE running:
#   - Edit wrangler.toml [vars]: set DOMAIN to the real mail domain
#   - The domain's zone must exist in this Cloudflare account
#   - Auth: `wrangler login` (account-scoped actions), plus env
#     CLOUDFLARE_API_TOKEN for the zone/Email Routing API steps (needs
#     Zone > Email Routing Rules > Edit + Zone > DNS > Edit + Zone > Zone > Read)
#
# NO REAL SECRETS ARE EVER WRITTEN TO DISK OR GIT BY THIS SCRIPT.
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

WORKER_NAME="temp-mail-bot"
WRANGLER_TOML="wrangler.toml"

fail() { echo "ERROR: $*" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v node >/dev/null 2>&1 || fail "node is required"

echo "==> [0/7] Pre-flight checks"
grep -q '^DOMAIN *= *"yourdomain\.com"' "$WRANGLER_TOML" 2>/dev/null && \
  fail "wrangler.toml still has the placeholder DOMAIN. Set the real domain first."
DOMAIN="$(sed -n 's/^DOMAIN *= *"\([^"]*\)".*/\1/p' "$WRANGLER_TOML" | head -1)"
[ -n "$DOMAIN" ] || fail "Could not read DOMAIN from wrangler.toml"
echo "    DOMAIN = ${DOMAIN}"

echo "==> [1/7] Wrangler auth check"
npx wrangler whoami || fail "Not authenticated. Run: npx wrangler login (and/or export CLOUDFLARE_API_TOKEN)"

echo "==> [2/7] D1 database"
DB_ID="$(npx wrangler d1 list --json 2>/dev/null | node -e '
  let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
    try{const j=JSON.parse(d);const list=Array.isArray(j)?j:(j.result||[]);
    const db=list.find(x=>x&&x.name==="tempmail-db")||null;
    console.log(db?(db.uuid||db.database_id||""):"")}catch(e){console.log("")}})')"
if [ -n "$DB_ID" ]; then
  echo "    D1 'tempmail-db' exists: ${DB_ID}"
else
  echo "    Creating D1 database 'tempmail-db'..."
  CREATE_OUT="$(npx wrangler d1 create tempmail-db 2>&1)" || fail "d1 create failed: ${CREATE_OUT}"
  echo "$CREATE_OUT"
  DB_ID="$(printf '%s\n' "$CREATE_OUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)"
  [ -n "$DB_ID" ] || fail "Could not parse database_id from 'wrangler d1 create' output"
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

echo "==> [3/7] D1 migrations (remote)"
npx wrangler d1 migrations apply DB --remote

echo "==> [4/7] BOT_TOKEN secret"
echo -n "Enter BOT_TOKEN (hidden input; stored as Worker secret, never written to disk or git): "
read -rs BOT_TOKEN; echo
[ -n "$BOT_TOKEN" ] || fail "BOT_TOKEN cannot be empty"
printf '%s' "$BOT_TOKEN" | npx wrangler secret put BOT_TOKEN
unset BOT_TOKEN

echo "==> [5/7] Email Routing + catch-all -> Worker (zone API)"
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "    SKIPPED: CLOUDFLARE_API_TOKEN not set." >&2
  echo "    Configure Email Routing manually in the Dashboard:" >&2
  echo "      1. Enable Email Routing on the '${DOMAIN}' zone (adds MX/SPF records)" >&2
  echo "      2. Routing rules -> Catch-all -> Send to Worker '${WORKER_NAME}'" >&2
else
  API="https://api.cloudflare.com/client/v4"
  AUTH=(-H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H "Content-Type: application/json")
  ZONE_ID="$(curl -fsS "${AUTH[@]}" "${API}/zones?name=${DOMAIN}" | node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      try{const j=JSON.parse(d);console.log(j.result&&j.result[0]?j.result[0].id:"")}
      catch(e){console.log("")}})')"
  [ -n "$ZONE_ID" ] || fail "Zone '${DOMAIN}' not found in this account (is the domain on Cloudflare yet?)"
  echo "    zone: ${ZONE_ID}"

  # 5a. Enable Email Routing (idempotent; adds required MX/SPF DNS records)
  if curl -fsS -X POST "${AUTH[@]}" "${API}/zones/${ZONE_ID}/email/routing/enable" >/dev/null 2>&1; then
    echo "    Email Routing enabled"
  else
    echo "    Email Routing enable returned non-2xx (usually already enabled) — continuing"
  fi

  # 5b. Point the catch-all rule at this Worker (idempotent upsert)
  curl -fsS -X PUT "${AUTH[@]}" \
    "${API}/zones/${ZONE_ID}/email/routing/rules/catch_all" \
    --data "{\"matchers\":[{\"type\":\"all\"}],\"actions\":[{\"type\":\"worker\",\"value\":[\"${WORKER_NAME}\"]}],\"enabled\":true,\"name\":\"catch-all to ${WORKER_NAME}\"}" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);console.log(j.success?"    catch-all -> worker OK":"    catch-all FAILED: "+JSON.stringify(j.errors))}catch(e){console.log("    catch-all response: "+d)}})'
fi

echo "==> [6/7] First deploy"
DEPLOY_OUTPUT="$(npx wrangler deploy 2>&1)"
echo "$DEPLOY_OUTPUT"
WORKER_URL="$(printf '%s\n' "$DEPLOY_OUTPUT" | grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' | head -1 || true)"

echo "==> [7/7] Telegram webhook"
if [ -n "$WORKER_URL" ]; then
  echo "    Registering ${WORKER_URL}/webhook"
  curl -fsS "${WORKER_URL}/set-webhook" && echo
else
  echo "    Could not determine workers.dev URL from deploy output." >&2
  echo "    Run once manually:  curl https://<worker-url>/set-webhook" >&2
fi

echo ""
echo "======================================================================"
echo " Bootstrap complete."
echo " Next: create the GitHub repo, push, and connect Workers Builds with"
echo " the deploy command:   bash scripts/deploy.sh"
echo " See DEPLOYMENT.md for details."
echo "======================================================================"
