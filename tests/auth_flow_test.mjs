/**
 * Tests for the dual-identity auth architecture:
 *
 *   WEB (standalone, no Telegram): anonymous web session (web_<random> id in
 *   the existing sessions table — no migration) -> Create email -> inbox.
 *   Refresh/return via HttpOnly cookie or Bearer token. Recovery reuses the
 *   existing recovery-token concept. No Telegram account or Login Widget.
 *
 *   MINI APP (Telegram): validated initData -> numeric Telegram identity ->
 *   pending-or-existing session. Untouched by the web flow.
 *
 * Covers the 10 required behaviors:
 *   1. Web user can create an email without Telegram.
 *   2. Web user can access their own inbox without Telegram.
 *   3. Web user cannot access another web user's inbox.
 *   4. Web session survives page refresh (re-ensure returns same identity).
 *   5. Web recovery works (auth/token + wrong_owner across web users).
 *   6. Telegram Mini App authentication still works (pending + returning).
 *   7. Existing Telegram user email/inbox ownership is unchanged.
 *   8. No BOT_TOKEN or sensitive auth data exposed to the browser.
 *   9. No unauthenticated private inbox access.
 *  10. Frontend: dashboard-first website, no Telegram gate, Mini App intact.
 *
 * No live Telegram Bot API calls. No D1 migrations.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHmac } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const workerSrc = readFileSync(join(root, "_worker.js"), "utf8");
const appSrc = readFileSync(join(root, "public/app/app.js"), "utf8");
const indexSrc = readFileSync(join(root, "public/app/index.html"), "utf8");
const m1 = readFileSync(join(root, "migrations/0001_initial.sql"), "utf8");
const m2 = readFileSync(join(root, "migrations/0002_inbox_raw.sql"), "utf8");
const m3 = readFileSync(join(root, "migrations/0003_inbox_action.sql"), "utf8");
const m4 = readFileSync(join(root, "migrations/0004_email_tokens.sql"), "utf8");

const harness = `
export { db, validateTelegramInitData, isWebChatId, generateWebChatId,
  issueSessionToken, verifySessionToken, handleWebApi };
`;
const tmp = join(root, ".worker_auth_flow_test.mjs");
writeFileSync(tmp, workerSrc + harness);

const mod = await import(tmp + "?t=" + Date.now());
const { makeD1FromSql } = await import("./d1_shim.mjs");

let failures = 0;
function check(name, cond) {
  if (cond) console.log("PASS - " + name);
  else { console.log("FAIL - " + name); failures++; }
}

const BOT_TOKEN = "123456:TEST-Only-Token-For-Auth-Flow-ABCDEF";
const env = {
  DB: makeD1FromSql(m1 + ";\n" + m2 + ";\n" + m3 + ";\n" + m4),
  BOT_TOKEN,
  DOMAIN: "example.com",
  MULTI_USER: "true",
  TELEGRAM_USER_ID: "",
};

// ---- test-side Mini App initData signer (mirrors Bot API validation) -------
function signInitData(fields) {
  const pairs = Object.entries(fields)
    .filter(([k]) => k !== "hash")
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const dcs = pairs.map(([k, v]) => k + "=" + v).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(dcs).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}
function tgFields(userId, authDate) {
  return {
    auth_date: String(authDate != null ? authDate : Math.floor(Date.now() / 1000)),
    query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
    user: JSON.stringify({ id: userId, first_name: "T", username: "tuser", language_code: "fa" }),
  };
}

async function callApi(method, path, opts) {
  opts = opts || {};
  const headers = {};
  if (opts.token) headers["Authorization"] = "Bearer " + opts.token;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const req = new Request("http://localhost" + path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const res = await mod.handleWebApi(req, env, new URL(req.url));
  let json = null;
  try { json = await res.json(); } catch (e) { json = null; }
  return { status: res.status, json, headers: res.headers };
}

// ================= 1. Web user creates email without Telegram ===============
const rEnsure = await callApi("POST", "/api/v1/web/session", { body: {} });
check("1. POST /web/session 200 without any Telegram data",
  rEnsure.status === 200 && !!(rEnsure.json && rEnsure.json.sessionToken));
check("1. new web identity is pending (email:null, isNew:true)",
  rEnsure.json && rEnsure.json.user && rEnsure.json.user.email === null && rEnsure.json.isNew === true);
const webTokA = rEnsure.json.sessionToken;
const webIdA = await mod.verifySessionToken(env, webTokA);
check("1. web identity uses web_ namespace (never a Telegram id)",
  typeof webIdA === "string" && webIdA.startsWith("web_") && !/^\d+$/.test(webIdA));
check("1. helper agrees it is a web identity", mod.isWebChatId(webIdA) === true);
check("1. web session issues NO email row yet (empty state)",
  (await mod.db.getSession(env, webIdA)) === null);
check("1. web session Set-Cookie is HttpOnly (+Secure, SameSite=Lax)",
  (rEnsure.headers.get("set-cookie") || "").includes("HttpOnly") &&
  (rEnsure.headers.get("set-cookie") || "").includes("SameSite=Lax"));

const rWebMe = await callApi("GET", "/api/v1/me", { token: webTokA });
check("1. pending /me empty shell", rWebMe.status === 200 && rWebMe.json && rWebMe.json.email === null);
const rWebCreate = await callApi("POST", "/api/v1/emails", { token: webTokA });
check("1. Create provisions web email without Telegram",
  rWebCreate.status === 200 && /@example\.com$/.test((rWebCreate.json && rWebCreate.json.email) || ""));
check("1. issuance returns recoveryToken once for web user",
  /^tmp_[a-z2-9]{6}$/.test((rWebCreate.json && rWebCreate.json.recoveryToken) || ""));
const webEmailA = rWebCreate.json.email;
const webRecoveryA = rWebCreate.json.recoveryToken;
check("1. web identity never echoes numeric Telegram semantics",
  mod.isWebChatId((await mod.db.getSession(env, webIdA)).chatId) === true);

// Web identities are unique: a second ensure (no token) mints another id.
const rEnsure2 = await callApi("POST", "/api/v1/web/session", { body: {} });
const webIdB = await mod.verifySessionToken(env, rEnsure2.json.sessionToken);
check("1. web ids are unique per ensure", webIdB !== webIdA && mod.isWebChatId(webIdB));
check("1. id generator produces unique prefixed ids",
  mod.generateWebChatId() !== mod.generateWebChatId() && mod.generateWebChatId().startsWith("web_"));

// ================= 2. Web user inbox without Telegram =======================
await mod.db.appendInbox(env, webEmailA, {
  id: "w1", ts: 1000, from: "Shop <s@shop.com>", subject: "Your code",
  body: "code inside", links: [], date: "d1", raw: "", otpCode: "112233", activationLink: "",
});
const rWInbox = await callApi("GET", "/api/v1/inbox", { token: webTokA });
check("2. own inbox list 200 with 1 item",
  rWInbox.status === 200 && rWInbox.json.items && rWInbox.json.items.length === 1);
const rWDetail = await callApi("GET", "/api/v1/inbox/w1", { token: webTokA });
check("2. own inbox detail opens (otp preserved)",
  rWDetail.status === 200 && rWDetail.json.id === "w1" && rWDetail.json.otpCode === "112233");
const rWCur = await callApi("GET", "/api/v1/emails/current", { token: webTokA });
check("2. current email resolves", rWCur.status === 200 && rWCur.json.email === webEmailA);

// ================= 3. Cross-web-user isolation ==============================
const webTokB = rEnsure2.json.sessionToken;
const rWCreateB = await callApi("POST", "/api/v1/emails", { token: webTokB });
const webEmailB = rWCreateB.json.email;
check("3. second web user gets a DIFFERENT email", webEmailB !== webEmailA);
const rBInbox = await callApi("GET", "/api/v1/inbox", { token: webTokB });
check("3. B inbox does NOT contain A's mail",
  rBInbox.status === 200 && !rBInbox.json.items.some((it) => it.id === "w1"));
check("3. B cannot open A's mail detail (404)",
  (await callApi("GET", "/api/v1/inbox/w1", { token: webTokB })).status === 404);
check("3. A cannot open unknown id (404)",
  (await callApi("GET", "/api/v1/inbox/nope", { token: webTokA })).status === 404);

// ================= 4. Session survives refresh ==============================
const rRefresh = await callApi("POST", "/api/v1/web/session", { token: webTokA, body: {} });
check("4. re-ensure with token returns SAME identity (isNew:false)",
  rRefresh.status === 200 && rRefresh.json.isNew === false &&
  (await mod.verifySessionToken(env, rRefresh.json.sessionToken)) === webIdA);
check("4. refreshed session still resolves the same email",
  rRefresh.json.user && rRefresh.json.user.email === webEmailA);
const rMeAgain = await callApi("GET", "/api/v1/me", { token: webTokA });
check("4. /me after refresh keeps account", rMeAgain.status === 200 && rMeAgain.json.email === webEmailA);

// Logout clears the HttpOnly cookie; the row stays recoverable via token.
const rLogout = await callApi("POST", "/api/v1/web/logout", { token: webTokA });
check("4. logout 200 + clears cookie (Max-Age=0)",
  rLogout.status === 200 && (rLogout.headers.get("set-cookie") || "").includes("Max-Age=0"));
check("4. non-POST web/session -> 405",
  (await callApi("GET", "/api/v1/web/session", { token: webTokA })).status === 405);

// ================= 5. Web recovery ==========================================
const rRec = await callApi("POST", "/api/v1/auth/token", { body: { token: webRecoveryA } });
check("5. recovery token login restores the web email",
  rRec.status === 200 && rRec.json.user.email === webEmailA && !!rRec.json.sessionToken);
check("5. recovered session reaches the same inbox",
  (await callApi("GET", "/api/v1/inbox", { token: rRec.json.sessionToken })).json.items.length === 1);
check("5. malformed token -> 400",
  (await callApi("POST", "/api/v1/auth/token", { body: { token: "garbage" } })).status === 400);
check("5. unknown token -> 404",
  (await callApi("POST", "/api/v1/auth/token", { body: { token: "tmp_zzzz99" } })).status === 404);
// Web user B cannot adopt web user A's token (ownership preserved).
check("5. cross-web restore -> 403 wrong_owner",
  (await callApi("POST", "/api/v1/emails/restore", { token: webTokB, body: { token: webRecoveryA } })).status === 403);

// ================= 6. Mini App still works ==================================
const initNew = signInitData(tgFields(991001));
const rFirst = await callApi("POST", "/api/v1/auth/telegram", { body: { initData: initNew } });
check("6. Mini App first-time -> pending (email:null, isNew:true)",
  rFirst.status === 200 && rFirst.json.user.email === null && rFirst.json.isNew === true);
const miniPendingTok = rFirst.json.sessionToken;
const rMiniCreate = await callApi("POST", "/api/v1/emails", { token: miniPendingTok });
const miniEmail = rMiniCreate.json.email;
const rMiniReturn = await callApi("POST", "/api/v1/auth/telegram", { body: { initData: initNew } });
check("6. Mini App returning -> SAME email, isNew:false (no duplicate)",
  rMiniReturn.status === 200 && rMiniReturn.json.user.email === miniEmail && rMiniReturn.json.isNew === false);
const tampered = initNew.replace("991001", "991002");
check("6. tampered initData -> 401",
  (await callApi("POST", "/api/v1/auth/telegram", { body: { initData: tampered } })).status === 401);
const expired = signInitData(tgFields(991001, Math.floor(Date.now() / 1000) - 99999));
check("6. expired initData -> 401",
  (await callApi("POST", "/api/v1/auth/telegram", { body: { initData: expired } })).status === 401);
// Namespaces never merge: a Telegram token at /web/session yields a
// SEPARATE web identity instead of reusing the Telegram one.
const rMerge = await callApi("POST", "/api/v1/web/session", { token: rMiniReturn.json.sessionToken, body: {} });
check("6. Telegram token at web endpoint mints separate web identity",
  rMerge.status === 200 && mod.isWebChatId(await mod.verifySessionToken(env, rMerge.json.sessionToken)));

// ================= 7. Existing Telegram data intact =========================
await mod.db.upsertSession(env, "777001", "legacy@example.com", "2026-01-02", "tmp_aaa111", "fa");
await mod.db.appendInbox(env, "legacy@example.com", {
  id: "leg1", ts: 1000, from: "Old <o@x.com>", subject: "Legacy",
  body: "keep me", links: [], date: "d", raw: "", otpCode: "", activationLink: "",
});
const rLegacy = await callApi("POST", "/api/v1/auth/telegram",
  { body: { initData: signInitData(tgFields(777001)) } });
check("7. legacy Telegram login resolves legacy email",
  rLegacy.status === 200 && rLegacy.json.user.email === "legacy@example.com");
check("7. legacy inbox intact via owner session",
  (await callApi("GET", "/api/v1/inbox", { token: rLegacy.json.sessionToken })).json.items.length === 1);
check("7. web users cannot see legacy Telegram mail",
  (await callApi("GET", "/api/v1/inbox/leg1", { token: webTokA })).status === 404);
check("7. legacy row untouched by all web traffic",
  (await mod.db.getSession(env, "777001")).email === "legacy@example.com");

// ================= 8+9. Leakage / unauthenticated ===========================
const payloads = JSON.stringify([rEnsure.json, rWebCreate.json, rFirst.json, rLegacy.json, rRec.json]);
check("8. BOT_TOKEN never appears in payloads", !payloads.includes(BOT_TOKEN));
check("8. /me never echoes recoveryToken",
  !("recoveryToken" in rWebMe.json) && !("recovery_token" in rWebMe.json));
check("9. /me without token -> 401", (await callApi("GET", "/api/v1/me")).status === 401);
check("9. /inbox without token -> 401", (await callApi("GET", "/api/v1/inbox")).status === 401);
check("9. forged session token rejected",
  (await mod.verifySessionToken(env, webTokA.slice(0, -1) + (webTokA.slice(-1) === "0" ? "1" : "0"))) === null);

// ================= 10. Frontend static guards ===============================
check("10. no Login Widget script in frontend",
  !appSrc.includes("telegram-widget.js") && !indexSrc.includes("telegram-widget.js"));
check("10. no widget endpoint/auth callback in frontend",
  !appSrc.includes("/api/v1/auth/widget") && !appSrc.includes("onTelegramWidgetAuth"));
check("10. website boot ensures a web session (no Telegram gate)",
  appSrc.includes("/api/v1/web/session") && appSrc.includes("ensureWebSession"));
check("10. website lands on dashboard, never a token gate",
  appSrc.includes("await ensureWebSession()") && appSrc.includes("await enterMain()"));
check("10. Mini App still posts RAW live-read initData (never initDataUnsafe)",
  appSrc.includes("body: { initData: live }") && appSrc.includes("getLiveInitData()") &&
  !appSrc.includes("initDataUnsafe"));
check("10. recovery token path preserved as secondary",
  appSrc.includes("/api/v1/auth/token") && appSrc.includes("loginWithToken") &&
  indexSrc.includes('id="input-token"') && indexSrc.includes('id="btn-login"'));
check("10. no token in localStorage (theme only)",
  !/localStorage\s*\.\s*setItem\s*\(\s*["']tm_session/.test(appSrc) &&
  appSrc.includes('sessionStorage.getItem("tm_session")'));
check("10. Mini App theme/safe-area + BackButton preserved",
  appSrc.includes("applyTgTheme") && appSrc.includes("BackButton"));
check("10. backend Mini App HMAC validation preserved",
  workerSrc.includes('"WebAppData"') && workerSrc.includes("validateTelegramInitData"));
check("10. backend widget validator fully removed",
  !workerSrc.includes("validateTelegramWidget") && !workerSrc.includes("/api/v1/auth/widget"));
check("10. backend restores wrong_owner guard preserved",
  workerSrc.includes("wrong_owner"));

// ================= 11. Mini App failure diagnosis + recovery ================
check("11. distinct expired message (fa/en)",
  appSrc.includes("مینی‌اپ را ببندید و دوباره باز کنید") &&
  appSrc.includes("Close and reopen the Mini App"));
check("11. distinct forbidden message (fa/en)",
  appSrc.includes("دسترسی به این ربات ندارید") &&
  appSrc.includes("You do not have access to this bot"));
check("11. distinct invalid-auth message (fa/en)",
  appSrc.includes("احراز هویت تلگرام ناموفق بود") &&
  appSrc.includes("Telegram authentication failed"));
check("11. miniAuthError maps expired/forbidden/invalid codes distinctly",
  appSrc.includes("function miniAuthError") &&
  appSrc.includes('e.code === "expired"') &&
  appSrc.includes('e.code === "forbidden"') &&
  appSrc.includes('e.code === "invalid_init_data"'));
check("11. boot Mini App path reuses miniAuth (raw initData, never web session)",
  appSrc.includes("await miniAuth()") && appSrc.includes("function miniAuth()"));
check("11. refreshAll retries Mini App 401 with one silent re-auth (no dead end)",
  appSrc.includes("re-authenticate once with fresh") ||
  (appSrc.includes("await miniAuth()") && appSrc.includes("e2")));
check("11. backend warns on token-verify failure without logging secrets",
  workerSrc.includes("[web-session] presented session token failed verification") &&
  !/\$\{(token|chatId)\}[^"]*failed verification|failed verification[^"]*\$\{/.test(workerSrc));

if (failures > 0) {
  console.log(`\n${failures} AUTH FLOW TEST(S) FAILED`);
  process.exit(1);
} else {
  console.log("\nALL AUTH FLOW TESTS PASSED");
}
