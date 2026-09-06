/**
 * Focused regression tests for the production inbox/auth/keyboard fixes:
 *
 *   1. Long activation URLs never break the web Inbox layout (CSS clamps).
 *   2. Aparat activation_link reaches the web Inbox list action button
 *      (parser -> D1 -> /api/v1/inbox -> renderItem), gated by the existing
 *      HTTPS check, textContent-only (no innerHTML, no raw-URL preview).
 *   3. Mini App auth initialization timing: live initData re-read at send
 *      time, empty value never POSTs, bfcache pageshow re-check, and a
 *      non-sensitive server-side reason log (never secrets/ids).
 *   4. Telegram dashboard keyboard: Mini App web_app button paired with
 *      Generate in row 0 (no stretched full-width row), URL unchanged.
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
const cssSrc = readFileSync(join(root, "public/app/styles.css"), "utf8");
const indexSrc = readFileSync(join(root, "public/app/index.html"), "utf8");
const m1 = readFileSync(join(root, "migrations/0001_initial.sql"), "utf8");
const m2 = readFileSync(join(root, "migrations/0002_inbox_raw.sql"), "utf8");
const m3 = readFileSync(join(root, "migrations/0003_inbox_action.sql"), "utf8");
const m4 = readFileSync(join(root, "migrations/0004_email_tokens.sql"), "utf8");

const harness = `
export { db, handleWebApi, getDashboardPayload, MINI_APP_URL, i18n,
  apiPublicInboxItem, isWebChatId };
`;
const tmp = join(root, ".worker_inbox_ui_test.mjs");
writeFileSync(tmp, workerSrc + harness);

const mod = await import(tmp + "?t=" + Date.now());
const { makeD1FromSql } = await import("./d1_shim.mjs");

let failures = 0;
function check(name, cond) {
  if (cond) console.log("PASS - " + name);
  else { console.log("FAIL - " + name); failures++; }
}

const env = {
  DB: makeD1FromSql(m1 + ";\n" + m2 + ";\n" + m3 + ";\n" + m4),
  BOT_TOKEN: "123456:TEST-Only-Token-For-Inbox-Ui-ABCDEF",
  DOMAIN: "example.com",
  MULTI_USER: "true",
  TELEGRAM_USER_ID: "",
};

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
  return { status: res.status, json };
}

// A long unbroken Aparat verification URL of the kind that escaped the card.
const LONG_APARAT_URL =
  "https://www.aparat.com/auth/confirm?email=user%40example.com&token=abc123def456&hash=9f8e7d6c5b4a32109f8e7d6c5b4a3210&redirect=https%3A%2F%2Fwww.aparat.com%2Fdashboard%2Fverify%2Faccount";

// ================= 1. layout clamps (static CSS guards) =====================
check("css. inbox item cannot exceed its container",
  /\.inbox-item\s*\{[^}]*max-width:\s*100%/.test(cssSrc) &&
  /\.inbox-item\s*\{[^}]*min-width:\s*0/.test(cssSrc) &&
  /\.inbox-item\s*\{[^}]*overflow:\s*hidden/.test(cssSrc));
check("css. subject/preview clamp long unbroken URLs",
  /\.inbox-item\s+\.subj\s*\{[^}]*max-width:\s*100%/.test(cssSrc) &&
  /\.inbox-item\s+\.prev\s*\{[^}]*max-width:\s*100%/.test(cssSrc) &&
  cssSrc.includes("overflow-wrap: anywhere"));
check("css. flex row children can shrink (sender/time/badges)",
  /\.inbox-item\s+\.sender\s*\{[^}]*min-width:\s*0/.test(cssSrc) &&
  /\.inbox-item\s+\.time\s*\{[^}]*flex:\s*none/.test(cssSrc) &&
  /\.badge\s*\{[^}]*flex:\s*none/.test(cssSrc));
check("css. inbox action button itself is clamped",
  /\.inbox-action\s*\{[^}]*max-width:\s*100%/.test(cssSrc) &&
  /\.inbox-action\s*\{[^}]*text-overflow:\s*ellipsis/.test(cssSrc));
check("css. page-level horizontal backstop (never viewport scroll)",
  /html,\s*body\s*\{[^}]*overflow-x:\s*clip/.test(cssSrc));
check("css. detail sender/meta/otp clamp long content",
  /\.detail-service\s*\{[^}]*overflow:\s*hidden/.test(cssSrc) &&
  /\.otp-row\s*\{[^}]*flex-wrap:\s*wrap/.test(cssSrc) &&
  /\.otp-val\s*\{[^}]*max-width:\s*100%/.test(cssSrc));
check("css. action-row chips wrap on narrow screens",
  /\.action-row\s*\{[^}]*flex-wrap:\s*wrap/.test(cssSrc) &&
  /\.chip\s*\{[^}]*min-width:\s*0/.test(cssSrc));

// ================= 2. Aparat link end-to-end ================================
const wSession = await callApi("POST", "/api/v1/web/session", { body: {} });
const wTok = wSession.json.sessionToken;
const created = await callApi("POST", "/api/v1/emails", { token: wTok });
const webEmail = created.json.email;
await mod.db.appendInbox(env, webEmail, {
  id: "ap1", ts: 1000, from: "Aparat <no-reply@aparat.com>", subject: "تکمیل ثبت نام",
  body: "", links: [LONG_APARAT_URL], date: "d1", raw: "",
  otpCode: "", activationLink: LONG_APARAT_URL,
});
const rInbox = await callApi("GET", "/api/v1/inbox", { token: wTok });
const apItem = (rInbox.json.items || []).find((it) => it.id === "ap1");
check("api. list item carries the full activation URL as data (not preview)",
  !!apItem && apItem.activationLink === LONG_APARAT_URL);
check("api. list item carries the compact Aparat label + flags",
  !!apItem && apItem.activationLabel === "✅ تایید حساب" &&
  apItem.hasLink === true && apItem.isAparat === true);
check("api. raw MIME never leaks into list items", !!apItem && !("raw" in apItem));
check("api. subject containing a long URL is still served (layout is CSS-gated)",
  !!apItem && typeof apItem.subject === "string");

// Frontend renderItem: Gmail hierarchy (sender+time top, distinct subject,
// secondary preview, badges), action anchor as a SIBLING of the button
// (never nested interactive content), gated by isHttpUrl, short label,
// textContent only.
check("frontend. renderItem builds wrapper + button + sibling action (valid nesting)",
  appSrc.includes('el("div", "inbox-wrap")') &&
  appSrc.includes("wrap.appendChild(b)") &&
  appSrc.includes("wrap.appendChild(a)") &&
  !appSrc.includes("b.appendChild(a)"));
check("frontend. Gmail hierarchy order (toprow sender/time, subject, preview)",
  appSrc.includes('el("div", "toprow")') &&
  appSrc.includes('el("span", "sender"') &&
  appSrc.includes('el("span", "time"') &&
  appSrc.indexOf('"toprow"') < appSrc.indexOf('"subj"'));
check("frontend. empty preview node omitted (no phantom gap)",
  appSrc.includes("if (prevText)"));
check("frontend. renderItem builds a gated inbox-action anchor",
  appSrc.includes('el("a", "inbox-action"') &&
  appSrc.includes("it.activationLink && isHttpUrl(it.activationLink)") &&
  appSrc.includes("it.activationLabel"));
check("frontend. action href/target/rel set safely",
  appSrc.includes("a.href = it.activationLink") &&
  appSrc.includes('a.target = "_blank"') &&
  appSrc.includes('a.rel = "noopener"'));
const appCode = appSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|\s)\/\/.*$/gm, "$1");
check("frontend. no innerHTML anywhere (XSS-safe rendering preserved)",
  !/innerHTML|outerHTML|insertAdjacentHTML/.test(appCode));
check("frontend. long URL never used as visible button/preview text",
  !appSrc.includes("a.textContent = it.activationLink") &&
  !appSrc.includes("textContent = d.activationLink"));

// ================= 3. Mini App auth timing ==================================
check("frontend. live initData helper re-reads the bridge at send time",
  appSrc.includes("function getLiveInitData()") &&
  appSrc.includes("window.Telegram && window.Telegram.WebApp"));
check("frontend. empty initData never POSTs (throws before fetch)",
  appSrc.includes("empty_init_data") && appSrc.includes("if (!live)"));
check("frontend. empty-initData maps to the reopen message, not invalid-auth",
  appSrc.includes('e.code === "empty_init_data"') && appSrc.includes("errExpiredTg"));
check("frontend. bfcache/pageshow re-checks initData freshness",
  appSrc.includes('addEventListener("pageshow"') && appSrc.includes("recheckTelegramInitData"));
check("frontend. initTelegram gates on live non-empty initData",
  appSrc.includes("getLiveInitData().length > 0"));
check("frontend. raw initData still sent (never initDataUnsafe)",
  appSrc.includes("body: { initData: live }") && !appSrc.includes("initDataUnsafe"));
check("backend. initData rejection logs reason code only (no secrets)",
  workerSrc.includes("[auth/telegram] initData rejected:") &&
  workerSrc.includes("String(check.reason"));
check("backend. rejection log cannot contain secrets (reason enum only)",
  !/initData rejected:[^;]*initData[^;]*\+|initData rejected:[^;]*token|initData rejected:[^;]*userId|initData rejected:[^;]*BOT_TOKEN/.test(workerSrc));
check("backend. HMAC validation itself untouched",
  workerSrc.includes('"WebAppData"') && workerSrc.includes("validateTelegramInitData"));

// Distinct public initData error codes end-to-end (reason enum only;
// identical HMAC computation). Uses the test BOT_TOKEN signer.
const BOT_TOKEN = "123456:TEST-Only-Token-For-Inbox-Ui-ABCDEF";
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
const initOk = signInitData(tgFields(555001));
const rTampered = await callApi("POST", "/api/v1/auth/telegram",
  { body: { initData: initOk.replace("555001", "555002") } });
check("api. tampered initData -> 401 invalid_signature (distinct, no secret leak)",
  rTampered.status === 401 && rTampered.json && rTampered.json.error === "invalid_signature" &&
  !JSON.stringify(rTampered.json).includes(BOT_TOKEN));
check("api. missing hash -> 401 missing_hash",
  (await callApi("POST", "/api/v1/auth/telegram",
    { body: { initData: "auth_date=123&user=%7B%7D" } })).json.error === "missing_hash");
check("api. bad user id -> 401 bad_user",
  (await callApi("POST", "/api/v1/auth/telegram",
    { body: { initData: signInitData({ ...tgFields(1), user: JSON.stringify({ id: "abc" }) }) } })).json.error === "bad_user");
check("api. empty initData -> 401 empty_init_data (never a crash)",
  (await callApi("POST", "/api/v1/auth/telegram", { body: { initData: "" } })).json.error === "empty_init_data");
check("api. expired initData still maps to expired",
  (await callApi("POST", "/api/v1/auth/telegram",
    { body: { initData: signInitData(tgFields(555001, Math.floor(Date.now() / 1000) - 99999)) } })).json.error === "expired");
check("frontend. distinct messages for signature/missing/bad-user codes",
  appSrc.includes('e.code === "invalid_signature"') && appSrc.includes("errSigTg") &&
  appSrc.includes('e.code === "missing_hash"') && appSrc.includes("errMissingTg") &&
  appSrc.includes('e.code === "bad_user"') && appSrc.includes("errBadUserTg"));

// ================= 5. deployed-version proof =================================
check("version. BUILD marker constant present",
  /const BUILD = "20260906-gmail1";/.test(appSrc));
check("version. asset hrefs cache-busted with the BUILD id",
  indexSrc.includes('href="./styles.css?v=20260906-gmail1"') &&
  indexSrc.includes('src="./app.js?v=20260906-gmail1"'));
check("version. footer tooltip + console proof wired",
  appSrc.includes('console.log("[tempmail] build " + BUILD)') &&
  appSrc.includes('foot.title = "build " + BUILD'));

// ================= 4. dashboard keyboard ====================================
const dashFa = mod.getDashboardPayload({ email: "u@example.com", createdAt: "c", recoveryToken: "tmp_aaaa11" }, "fa");
const dashEn = mod.getDashboardPayload(null, "en");
for (const [name, dash, lang] of [["fa", dashFa, "fa"], ["en", dashEn, "en"]]) {
  const row0 = dash.keyboard.inline_keyboard[0];
  check(`keyboard (${name}). row 0 pairs Mini App web_app with Generate`,
    Array.isArray(row0) && row0.length === 2 &&
    row0[0].web_app && row0[0].web_app.url === "https://twenyonerrf.ir/app/" &&
    row0[0].text === mod.i18n[lang].btnMiniApp && !("callback_data" in row0[0]) &&
    row0[1].callback_data === "generate");
}
check("keyboard. Mini App URL unchanged",
  mod.MINI_APP_URL === "https://twenyonerrf.ir/app/");
check("keyboard. all legacy buttons still present",
  ["generate", "inbox", "refresh", "restore_ask", "toggle_lang", "help"].every((cb) =>
    JSON.stringify(dashFa.keyboard).includes('"callback_data":"' + cb + '"')));
check("keyboard. total rows compact (4, was 5)",
  dashFa.keyboard.inline_keyboard.length === 4);

if (failures > 0) {
  console.log(`\n${failures} INBOX UI TEST(S) FAILED`);
  process.exit(1);
} else {
  console.log("\nALL INBOX UI TESTS PASSED");
}
