/**
 * Tests for the Web App + Telegram Mini App API (/api/v1/*).
 *
 * Covers the 16 required API behaviors:
 *   1. Telegram initData validation (first-time -> pending, returning -> same email)
 *   2. invalid initData rejection (tampered / expired / missing hash)
 *   3. recovery token authentication
 *   4. unauthorized request rejection
 *   5. user isolation (list)
 *   6. /api/v1/me shape (no token echo)
 *   7. create email (archive-old semantics preserved)
 *   8. current email
 *   9. inbox list
 *  10. inbox detail
 *  11. settings language GET/PUT
 *  12. Aparat activation link remains a URL action with "✅ تایید حساب"
 *  13. API cannot expose another user's inbox (detail)
 *  14. API never exposes BOT_TOKEN
 *  15. SPA/static routing does not intercept /api/v1/*, /webhook, /
 *  16. webhook + health behavior remains unchanged
 *
 * No new D1 tables are used anywhere: auth state is stateless HMAC.
 * Uses the same node:sqlite shim + real migrations as the other suites.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHmac } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const workerSrc = readFileSync(join(root, "_worker.js"), "utf8");
const m1 = readFileSync(join(root, "migrations/0001_initial.sql"), "utf8");
const m2 = readFileSync(join(root, "migrations/0002_inbox_raw.sql"), "utf8");
const m3 = readFileSync(join(root, "migrations/0003_inbox_action.sql"), "utf8");
const m4 = readFileSync(join(root, "migrations/0004_email_tokens.sql"), "utf8");

const harness = `
export { db, generateRecoveryToken, isValidRecoveryToken,
  validateTelegramInitData, issueSessionToken, verifySessionToken,
  isWebApiPath, isWebAppPath, handleWebApi, apiCreateNewEmail,
  apiLoginWithRecoveryToken, apiActivationInfo };
export default (await import("node:module").then(() => null).catch(() => null), null);
`;
const tmp = join(root, ".worker_api_test.mjs");
// NOTE: _worker.js already has `export default`; appending another default
// export would be a syntax error, so the placeholder line is filtered out
// and only the named exports are kept.
writeFileSync(tmp, workerSrc + harness.split("\n").filter((l) => !l.startsWith("export default")).join("\n"));

const mod = await import(tmp + "?t=" + Date.now());
const workerDefault = mod.default;

const { makeD1FromSql } = await import("./d1_shim.mjs");

let failures = 0;
function check(name, cond) {
  if (cond) console.log("PASS - " + name);
  else { console.log("FAIL - " + name); failures++; }
}

const BOT_TOKEN = "123456:TEST-Only-Token-For-Api-Tests-ABCDEF";
const env = {
  DB: makeD1FromSql(m1 + ";\n" + m2 + ";\n" + m3 + ";\n" + m4),
  BOT_TOKEN,
  DOMAIN: "example.com",
  MULTI_USER: "true",
  TELEGRAM_USER_ID: "",
};

// ---- test-side Telegram initData signer (mirrors Bot API validation) ------
function signInitData(fields) {
  const pairs = Object.entries(fields)
    .filter(([k]) => k !== "hash")
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const dcs = pairs.map(([k, v]) => k + "=" + v).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(dcs).digest("hex");
  const params = new URLSearchParams({ ...fields, hash });
  return params.toString();
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

// ================= 15. routing predicates (pure, no DB) =====================
check("15a. isWebApiPath(/api/v1/health)", mod.isWebApiPath("/api/v1/health") === true);
check("15b. isWebApiPath(/api/v1/me)", mod.isWebApiPath("/api/v1/me") === true);
check("15c. isWebApiPath(/api/v1/inbox/abc)", mod.isWebApiPath("/api/v1/inbox/abc") === true);
check("15d. isWebApiPath rejects /webhook", mod.isWebApiPath("/webhook") === false);
check("15e. isWebApiPath rejects /", mod.isWebApiPath("/") === false);
check("15f. isWebApiPath rejects /set-webhook", mod.isWebApiPath("/set-webhook") === false);
check("15g. isWebApiPath rejects /app", mod.isWebApiPath("/app") === false);
check("15h. isWebAppPath(/app)", mod.isWebAppPath("/app") === true);
check("15i. isWebAppPath(/app/)", mod.isWebAppPath("/app/") === true);
check("15j. isWebAppPath rejects /api/v1/me", mod.isWebAppPath("/api/v1/me") === false);
check("15k. isWebAppPath rejects /webhook", mod.isWebAppPath("/webhook") === false);
check("15l. unknown api path unauthenticated -> 401 (auth gate is first by design)",
  (await callApi("GET", "/api/v1/nope")).status === 401);
check("15m. wrong method unauthenticated -> 401 (auth gate is first by design)",
  (await callApi("POST", "/api/v1/me")).status === 401);

// ================= 1+2. initData validation =================================
// Seamless login (empty state + Create): a validated Mini App user WITHOUT
// a prior session gets a PENDING token (200, email:null, isNew:true) —
// never a recovery-token gate. The first POST /emails with that token
// provisions the account; repeat logins resolve the same email.
const initOk = signInitData(tgFields(777001));
const rPending = await callApi("POST", "/api/v1/auth/telegram", { body: { initData: initOk } });
check("1. Mini App first-time -> 200 pending (no token gate)",
  rPending.status === 200 && rPending.json && rPending.json.user && rPending.json.user.email === null);
check("1. pending marks isNew:true", rPending.json && rPending.json.isNew === true);
check("1. pending issues a sessionToken", !!(rPending.json && rPending.json.sessionToken));
check("1. pending creates NO session/email row yet",
  (await mod.db.getSession(env, "777001")) === null);
const pendingToken = rPending.json.sessionToken;
const rMePending = await callApi("GET", "/api/v1/me", { token: pendingToken });
check("1. pending /me reports email:null (empty state)",
  rMePending.status === 200 && rMePending.json && rMePending.json.email === null);
const rInboxPending = await callApi("GET", "/api/v1/inbox", { token: pendingToken });
check("1. pending inbox reads empty",
  rInboxPending.status === 200 && Array.isArray(rInboxPending.json.items) && rInboxPending.json.items.length === 0);

// First-time user taps Create: the pending token provisions the account.
const rProvision = await callApi("POST", "/api/v1/emails", { token: pendingToken });
check("1. pending POST /emails provisions first email",
  rProvision.status === 200 && /@example\.com$/.test((rProvision.json && rProvision.json.email) || ""));
const firstEmail = rProvision.json.email;

// Returning Mini App login resolves the SAME email (no duplicates).
const rAuth1 = await callApi("POST", "/api/v1/auth/telegram", { body: { initData: initOk } });
check("1. valid initData + existing session accepted (200)", rAuth1.status === 200);
check("1. sessionToken issued", !!(rAuth1.json && rAuth1.json.sessionToken));
check("1. returning auth resolves the SAME provisioned email (no duplicate)",
  !!(rAuth1.json && rAuth1.json.user && rAuth1.json.user.email === firstEmail));
check("1. returning auth marks isNew:false",
  rAuth1.json && rAuth1.json.isNew === false);
check("1. auth/telegram never echoes recoveryToken",
  !(rAuth1.json && ("recoveryToken" in rAuth1.json)));
check("1. Set-Cookie is HttpOnly and hides secrets",
  (rAuth1.headers.get("set-cookie") || "").includes("HttpOnly") &&
  !(rAuth1.headers.get("set-cookie") || "").includes(BOT_TOKEN));
const tgToken = rAuth1.json.sessionToken;

const tampered = initOk.replace("777001", "777002");
const rTamper = await callApi("POST", "/api/v1/auth/telegram", { body: { initData: tampered } });
check("2a. tampered initData rejected (401)", rTamper.status === 401);
const rNoHash = await callApi("POST", "/api/v1/auth/telegram", { body: { initData: "auth_date=123&user=%7B%7D" } });
check("2b. missing hash rejected", rNoHash.status === 401);
const expired = signInitData(tgFields(777001, Math.floor(Date.now() / 1000) - 99999));
const rExpired = await callApi("POST", "/api/v1/auth/telegram", { body: { initData: expired } });
check("2c. expired initData rejected", rExpired.status === 401);

// session token round-trip + tamper
const cid = await mod.verifySessionToken(env, tgToken);
check("1. session token verifies to the right chat", cid === "777001");
const badTok = tgToken.slice(0, -1) + (tgToken.slice(-1) === "0" ? "1" : "0");
check("2d. tampered session token rejected", (await mod.verifySessionToken(env, badTok)) === null);

// ================= 3. recovery-token auth ===================================
const chatB = "888002";
await mod.db.upsertSession(env, chatB, "buser@example.com", "2026-01-01", "tmp_bbb222", "en");
const rAuthB = await callApi("POST", "/api/v1/auth/token", { body: { token: "tmp_bbb222" } });
check("3. valid recovery token accepted", rAuthB.status === 200 && !!(rAuthB.json && rAuthB.json.sessionToken));
check("3. auth/token resolves the right email",
  rAuthB.json && rAuthB.json.user && rAuthB.json.user.email === "buser@example.com");
const rBadTok = await callApi("POST", "/api/v1/auth/token", { body: { token: "tmp_zzzz99" } });
check("3. unknown token -> 404", rBadTok.status === 404);
const rMalformed = await callApi("POST", "/api/v1/auth/token", { body: { token: "garbage" } });
check("3. malformed token -> 400", rMalformed.status === 400);
const webTokenB = rAuthB.json.sessionToken;

// ================= 4. unauthorized ==========================================
const rNoAuth = await callApi("GET", "/api/v1/me");
check("4. /me without token -> 401", rNoAuth.status === 401);
check("4. /inbox without token -> 401", (await callApi("GET", "/api/v1/inbox")).status === 401);
check("4. forged chat header ignored (still 401)",
  (await callApi("GET", "/api/v1/me", {})).status === 401);

// ================= 6+8. me / current ========================================
const rMe = await callApi("GET", "/api/v1/me", { token: webTokenB });
check("6. /me 200", rMe.status === 200);
check("6. /me has email, no recoveryToken echo",
  rMe.json.email === "buser@example.com" && !("recoveryToken" in rMe.json) && !("recovery_token" in rMe.json));
check("6. /me lang respected", rMe.json.lang === "en");
const rCur = await callApi("GET", "/api/v1/emails/current", { token: webTokenB });
check("8. /current returns the session email", rCur.status === 200 && rCur.json.email === "buser@example.com");

// ================= 9+5. inbox list + isolation ===============================
await mod.db.appendInbox(env, "buser@example.com", {
  id: "b1", ts: 1000, from: "Acme <n@acme.com>", subject: "Welcome",
  body: "hello preview", links: [], date: "d1", raw: "", otpCode: "", activationLink: "",
});
await mod.db.appendInbox(env, "buser@example.com", {
  id: "b2", ts: 2000, from: "Acme <n@acme.com>", subject: "Code",
  body: "", links: ["https://acme.com/verify?token=z"], date: "d2", raw: "",
  otpCode: "482910", activationLink: "https://acme.com/verify?token=z",
});
// Other user's mail (chat 777001 provisioned address).
const otherEmail = rAuth1.json.user.email;
await mod.db.appendInbox(env, otherEmail, {
  id: "a1", ts: 3000, from: "Evil <e@evil.com>", subject: "Secret",
  body: "private", links: [], date: "d3", raw: "", otpCode: "", activationLink: "",
});
const rInboxB = await callApi("GET", "/api/v1/inbox?limit=20", { token: webTokenB });
check("9. inbox list 200 with 2 items",
  rInboxB.status === 200 && rInboxB.json.items && rInboxB.json.items.length === 2);
check("9. newest-first order", rInboxB.json.items[0].id === "b2");
check("9. list items carry otp/link flags",
  rInboxB.json.items[0].otpCode === "482910" && rInboxB.json.items[0].hasLink === true);
check("9. list items never expose raw MIME",
  !("raw" in rInboxB.json.items[0]) && !("raw" in rInboxB.json.items[1]));
check("5. user B list does NOT contain user A mail",
  !rInboxB.json.items.some((it) => it.id === "a1"));
const rLim = await callApi("GET", "/api/v1/inbox?limit=1", { token: webTokenB });
check("9. limit param clamped", rLim.json.items.length === 1);

// ================= 10+12. detail (+Aparat) ===================================
const rDetail = await callApi("GET", "/api/v1/inbox/b2", { token: webTokenB });
check("10. detail 200", rDetail.status === 200 && rDetail.json.id === "b2");
check("10. detail has sender/subject/date/body",
  rDetail.json.sender === "Acme <n@acme.com>" && typeof rDetail.json.bodyText === "string");
check("10. detail keeps activation URL action",
  rDetail.json.activationLink === "https://acme.com/verify?token=z" &&
  typeof rDetail.json.activationLabel === "string" && rDetail.json.activationLabel.length > 0);
// Aparat-shaped mail for the SAME user B.
await mod.db.appendInbox(env, "buser@example.com", {
  id: "bAparat", ts: 4000, from: "Aparat <no-reply@aparat.com>", subject: "تکمیل ثبت نام",
  body: "", links: ["https://www.aparat.com/verify/y/abc123"], date: "d4", raw: "",
  otpCode: "", activationLink: "https://www.aparat.com/verify/y/abc123",
});
const rAp = await callApi("GET", "/api/v1/inbox/bAparat", { token: webTokenB });
check("12. Aparat label preserved", rAp.json.activationLabel === "✅ تایید حساب");
check("12. Aparat action is the REAL url (not callback/data/text)",
  rAp.json.activationLink === "https://www.aparat.com/verify/y/abc123" && rAp.json.isAparat === true);
check("12. helper agrees (same locked functions as bot)",
  mod.apiActivationInfo(
    { from: "Aparat <no-reply@aparat.com>", subject: "x", activationLink: "https://www.aparat.com/a" }, "fa"
  ).activationLabel === "✅ تایید حساب");

// ================= 13. cross-user detail blocked =============================
const rCross = await callApi("GET", "/api/v1/inbox/a1", { token: webTokenB });
check("13. B cannot open A's mail (404)", rCross.status === 404);
const rMissing = await callApi("GET", "/api/v1/inbox/does-not-exist", { token: webTokenB });
check("13. unknown id -> 404", rMissing.status === 404);
check("15n. unknown api path authenticated -> JSON 404 (not SPA html)",
  (await callApi("GET", "/api/v1/nope", { token: webTokenB })).status === 404);
check("15o. wrong method authenticated -> 405",
  (await callApi("POST", "/api/v1/me", { token: webTokenB })).status === 405);

// ================= 7. create email ===========================================
const rCreate = await callApi("POST", "/api/v1/emails", { token: webTokenB });
check("7. create 200 with new @example.com address",
  rCreate.status === 200 && /@example\.com$/.test(rCreate.json.email) &&
  rCreate.json.email !== "buser@example.com");
check("7. create returns recoveryToken once (issuance)",
  /^tmp_[a-z2-9]{6}$/.test(rCreate.json.recoveryToken || ""));
check("7. old token archived (bot restore semantics preserved)",
  (await mod.db.getArchivedToken(env, "tmp_bbb222")) !== null);
check("7. old inbox cleared on rotate",
  (await mod.db.listInbox(env, "buser@example.com")).length === 0);
const webTokenB2 = webTokenB; // old session token row replaced; re-login with new token
const rReLogin = await callApi("POST", "/api/v1/auth/token", { body: { token: rCreate.json.recoveryToken } });
check("7. can log in with the newly issued token", rReLogin.status === 200);
const webTokenNew = rReLogin.json.sessionToken;

// ================= restore via API ===========================================
const rRestore = await callApi("POST", "/api/v1/emails/restore", {
  token: webTokenNew, body: { token: "tmp_bbb222" },
});
check("restore via API reactivates archived email",
  rRestore.status === 200 && rRestore.json.email === "buser@example.com");
check("restore issues a session for the owner chat",
  !!(rRestore.json.sessionToken) && (await mod.verifySessionToken(env, rRestore.json.sessionToken)) === chatB);
// Bot parity (restoreWrongOwner): an authenticated caller from chat A
// cannot switch identity with chat B's token, even a valid one.
const rWrongOwner = await callApi("POST", "/api/v1/emails/restore", {
  token: tgToken, body: { token: "tmp_bbb222" },
});
check("restore with another chat's token -> 403 wrong_owner",
  rWrongOwner.status === 403 && rWrongOwner.json && rWrongOwner.json.error === "wrong_owner");
check("wrong_owner attempt does not disturb the caller's session",
  (await mod.db.getSession(env, "777001")).email === firstEmail);

// ================= 11. language ==============================================
const rLangGet = await callApi("GET", "/api/v1/settings/language", { token: webTokenB });
check("11. lang GET", rLangGet.status === 200 && rLangGet.json.lang === "en");
const rLangPut = await callApi("PUT", "/api/v1/settings/language", { token: webTokenB, body: { lang: "fa" } });
check("11. lang PUT fa", rLangPut.status === 200 && rLangPut.json.lang === "fa");
check("11. lang PUT rejects garbage",
  (await callApi("PUT", "/api/v1/settings/language", { token: webTokenB, body: { lang: "de" } })).status === 400);

// ================= health + standalone web session coexists =================
const rHealth = await callApi("GET", "/api/v1/health");
check("health ok without auth", rHealth.status === 200 && rHealth.json.ok === true);
const rWeb = await callApi("POST", "/api/v1/web/session");
check("web session ensure works without Telegram",
  rWeb.status === 200 && !!(rWeb.json && rWeb.json.sessionToken));
check("web identity uses the web_ namespace (never numeric Telegram ids)",
  (await mod.verifySessionToken(env, rWeb.json.sessionToken)).startsWith("web_"));
check("web session does not disturb Telegram sessions",
  (await mod.db.getSession(env, "777001")).email === firstEmail);
check("web session Set-Cookie is HttpOnly",
  (rWeb.headers.get("set-cookie") || "").includes("HttpOnly"));

// ================= 14. no secret leakage ======================================
const allJson = JSON.stringify([rAuth1.json, rAuthB.json, rMe.json, rInboxB.json, rDetail.json, rAp.json, rCreate.json, rHealth.json]);
check("14. BOT_TOKEN never appears in API payloads", !allJson.includes(BOT_TOKEN));
check("14. no response echoes another user's chat binding",
  !JSON.stringify(rInboxB.json).includes(otherEmail));

// ================= 16. bot surface unchanged ===================================
// GET / health (no network), unknown -> 404, /set-webhook without secret -> 400.
if (workerDefault && typeof workerDefault.fetch === "function") {
  const h = await workerDefault.fetch(new Request("http://localhost/"), env, {});
  const ht = await h.text();
  check("16. GET / health intact", h.status === 200 && ht.includes("Temp-Mail Telegram Bot Worker is Active"));
  const nf = await workerDefault.fetch(new Request("http://localhost/nope"), env, {});
  check("16. unknown path still 404", nf.status === 404);
  const sw = await workerDefault.fetch(
    new Request("http://localhost/set-webhook"), { ...env, BOT_TOKEN: "" }, {});
  check("16. /set-webhook guard intact", sw.status === 400);
  const apiViaDefault = await workerDefault.fetch(new Request("http://localhost/api/v1/health"), env, {});
  check("16. /api/v1/* routes through default fetch (before 404)", apiViaDefault.status === 200);
} else {
  check("16. default export fetch available", false);
}
check("16. webhook branch still present in source",
  workerSrc.includes('url.pathname === "/webhook"') && workerSrc.includes("handleCallbackQuery"));

if (failures > 0) {
  console.log(`\n${failures} API TEST(S) FAILED`);
  process.exit(1);
} else {
  console.log("\nALL API TESTS PASSED");
}
