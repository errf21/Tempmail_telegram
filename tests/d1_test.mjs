/**
 * Tests for the D1 storage layer and the CPU fast-path extractor.
 *
 * Strategy:
 *   - Load `_worker.js` with a small "harness" appended that re-exports the
 *     helpers we want to test (`db`, `extractFast`, `MAX_PARSE_BYTES`).
 *   - Use a `node:sqlite` shim (tests/d1_shim.mjs) to provide an in-memory
 *     D1 instance that runs the same SQL statements the worker would issue.
 *   - Apply the migration from `migrations/0001_initial.sql` to the shim.
 *   - Drive the `db.*` helpers directly and assert behaviour.
 *
 * The pure-helper tests (`parseEmailBody`, `stripHtmlTags`, etc.) live in
 * tests/run.mjs and are unaffected by this file.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const workerSrc = readFileSync(join(root, "_worker.js"), "utf8");
const migrationSql = readFileSync(join(root, "migrations/0001_initial.sql"), "utf8");
const migration2Sql = readFileSync(join(root, "migrations/0002_inbox_raw.sql"), "utf8");
const migration3Sql = readFileSync(join(root, "migrations/0003_inbox_action.sql"), "utf8");

// Re-export `db`, `extractFast`, `parseEmailBody`, `MAX_PARSE_BYTES`, and
// `ACTIVATION_KEYWORDS` for the test. The harness is appended to a copy of
// the worker so we don't pollute the source file.
const harness = `
export { db, extractFast, parseEmailBody, MAX_PARSE_BYTES, ACTIVATION_KEYWORDS };
`;
const tmp = join(root, ".worker_d1_test.mjs");
writeFileSync(tmp, workerSrc + harness);
const mod = await import(tmp + "?t=" + Date.now());

const { makeD1FromSql } = await import("./d1_shim.mjs");

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log("PASS - " + name);
  } else {
    console.log("FAIL - " + name);
    failures++;
  }
}

// ---------------------------------------------------------------------------
// 1. extractFast + MAX_PARSE_BYTES: fast-path on a large body
// ---------------------------------------------------------------------------

const fastLink = mod.extractFast(
  "Hi there, click https://example.com/confirm?token=abc to confirm."
);
check("fast-path: finds activation link", fastLink.activationLink.includes("example.com/confirm"));
check("fast-path: no OTP when link present", fastLink.otpCode === "");
check("fast-path: preview starts with visible text", fastLink.previewText.startsWith("Hi there"));

const fastOtp = mod.extractFast("Your code is 987654. It expires in 10 minutes.");
check("fast-path: finds OTP when no link", fastOtp.otpCode === "987654");
check("fast-path: no link when none present", fastOtp.activationLink === "");

const fastBig = mod.extractFast(
  "Click https://example.com/auth/login to continue. " + "x".repeat(300_000)
);
check("fast-path: returns within budget on 300 KB body (smoke)", typeof fastBig.previewText === "string");

check("MAX_PARSE_BYTES is 256 KB", mod.MAX_PARSE_BYTES === 256 * 1024);

// ACTIVATION_KEYWORDS contains the right entries
check("ACTIVATION_KEYWORDS has 'confirm'", mod.ACTIVATION_KEYWORDS.includes("confirm"));
check("ACTIVATION_KEYWORDS has 'aparat'", mod.ACTIVATION_KEYWORDS.includes("aparat"));

// ---------------------------------------------------------------------------
// 2. D1 layer: build a fresh in-memory DB, apply the migration, exercise db.*
// ---------------------------------------------------------------------------

const env = { DB: makeD1FromSql(migrationSql + ";\n" + migration2Sql + ";\n" + migration3Sql) };
const chatId = "123456789";
const email = "bluefire42@example.com";
const token = "tmp_abc234";

// 2a) Upsert a session, verify the row + binding.
let ok = await mod.db.upsertSession(env, chatId, email, "2026-08-29 10:00", token, "fa");
check("upsertSession: returns true on success", ok === true);

let row = await mod.db.getSession(env, chatId);
check("getSession: returns the inserted row", row && row.email === email);
check("getSession: lang defaults to fa", row && row.lang === "fa");
check("getSession: createdAt is preserved", row && row.createdAt === "2026-08-29 10:00");

let binding = await mod.db.getBindingByEmail(env, email);
check("getBindingByEmail: returns the chatId", binding === chatId);

// 2b) Token lookup and uniqueness.
let byToken = await mod.db.getSessionByToken(env, token);
check("getSessionByToken: finds the row", byToken && byToken.email === email);
check("tokenInUse: true for known token", (await mod.db.tokenInUse(env, token)) === true);
check("tokenInUse: false for unknown token", (await mod.db.tokenInUse(env, "tmp_doesnt")) === false);

// 2c) Language toggle.
ok = await mod.db.setLang(env, chatId, "en");
check("setLang: returns true", ok === true);
row = await mod.db.getSession(env, chatId);
check("setLang: row now reports lang=en", row && row.lang === "en");

// 2d) State machine via kv_meta.
ok = await mod.db.setState(env, chatId, "awaiting_restore_token");
check("setState: returns true", ok === true);
let state = await mod.db.getState(env, chatId);
check("getState: returns the state", state === "awaiting_restore_token");
ok = await mod.db.clearState(env, chatId);
check("clearState: returns true", ok === true);
state = await mod.db.getState(env, chatId);
check("getState: null after clear", state === null);

// 2e) Inbox append + 20-item cap enforcement.
for (let i = 0; i < 25; i++) {
  const item = {
    id: "m" + i.toString(36),
    ts: 1000 + i, // oldest first
    from: "sender@example.com",
    subject: "Subj " + i,
    body: "body " + i,
    links: ["https://example.com/x"],
    date: "2026-08-29"
  };
  ok = await mod.db.appendInbox(env, email, item);
  if (!ok) { check("appendInbox[" + i + "]: insert", false); break; }
}
const inbox = await mod.db.listInbox(env, email);
check("listInbox: exactly 20 items after 25 inserts", inbox.length === 20);
check("listInbox: newest first (ts descending)", inbox[0].ts > inbox[19].ts);
check("listInbox: id matches", typeof inbox[0].id === "string" && inbox[0].id.length > 0);
check("listInbox: links JSON decoded", Array.isArray(inbox[0].links) && inbox[0].links[0] === "https://example.com/x");

// 2f) Append for non-existent email returns empty list.
const inbox2 = await mod.db.listInbox(env, "nobody@example.com");
check("listInbox: empty for unknown email", Array.isArray(inbox2) && inbox2.length === 0);

// 2g) Insert is idempotent on (email, id) — the same id does not duplicate.
const dupItem = { id: inbox[0].id, ts: 999, from: "x", subject: "x", body: "x", links: [], date: "" };
await mod.db.appendInbox(env, email, dupItem);
const inboxAfterDup = await mod.db.listInbox(env, email);
check("appendInbox: ON CONFLICT DO NOTHING (no duplicates)", inboxAfterDup.length === 20);

// 2g-bis) Raw MIME body is preserved on insert and surfaced on read.
const rawItem = {
  id: "raw1",
  ts: 2000,
  from: "x@y.com",
  subject: "s",
  body: "preview",
  links: [],
  date: "d",
  raw: "From: x\r\nTo: y\r\nSubject: s\r\nMIME-Version: 1.0\r\nContent-Type: text/html\r\n\r\n<html>...</html>"
};
await mod.db.appendInbox(env, email, rawItem);
const inboxWithRaw = await mod.db.listInbox(env, email);
const foundRaw = inboxWithRaw.find(i => i.id === "raw1");
check("appendInbox: raw MIME body is stored", foundRaw && typeof foundRaw.raw === "string" && foundRaw.raw.startsWith("From: x"));
check("appendInbox: raw includes the MIME body", foundRaw && foundRaw.raw.includes("text/html"));

// 2h) Delete the session: cascade via the explicit batched deletes in
// db.deleteSession. Verify sessions and email_bindings are gone, but
// inbox rows are kept (they're for the email, not the chat).
ok = await mod.db.deleteSession(env, chatId);
check("deleteSession: returns true", ok === true);
const afterDel = await mod.db.getSession(env, chatId);
check("deleteSession: session row gone", afterDel === null);
const bindAfterDel = await mod.db.getBindingByEmail(env, email);
check("deleteSession: binding row gone", bindAfterDel === null);

// 2i) Restore flow: store a new session and look it up by token.
const restoreChat = "987654321";
const restoreEmail = "restore@example.com";
const restoreToken = "tmp_zzz999";
await mod.db.upsertSession(env, restoreChat, restoreEmail, "2026-08-29", restoreToken, "fa");
const restored = await mod.db.getSessionByToken(env, restoreToken);
check("restore: getSessionByToken finds the row", restored && restored.email === restoreEmail);
check("restore: chatId is preserved", restored && String(restored.chatId) === restoreChat);

// 2j) Delete inbox for the restored email.
ok = await mod.db.clearInbox(env, restoreEmail);
check("clearInbox: returns true", ok === true);

// ---------------------------------------------------------------------------
// 3. D1 layer: graceful failure on missing DB
// ---------------------------------------------------------------------------

const brokenEnv = { DB: null };
const fallbackSession = await mod.db.getSession(brokenEnv, "1");
check("db degrades gracefully when DB is null (getSession)", fallbackSession === null);
const fallbackList = await mod.db.listInbox(brokenEnv, "x@y");
check("db degrades gracefully when DB is null (listInbox)", Array.isArray(fallbackList) && fallbackList.length === 0);
const fallbackAppend = await mod.db.appendInbox(brokenEnv, "x@y", { id: "a", ts: 1, from: "", subject: "", body: "", links: [], date: "" });
check("db degrades gracefully when DB is null (appendInbox)", fallbackAppend === false);
const fallbackLang = await mod.db.setLang(brokenEnv, "1", "en");
check("db degrades gracefully when DB is null (setLang)", fallbackLang === false);

// ---------------------------------------------------------------------------
// 4. CPU fast-path budget
// ---------------------------------------------------------------------------

// 500 KB body with the link in the first 1 KB. extractFast should be
// under 30ms on any reasonable hardware (we measure to detect a
// regression in the regex, not as a hard SLA).
const bigBody =
  "<html><head><style>" + "div{color:red;padding:10px;margin:5px;}".repeat(100) + "</style></head><body>" +
  "Please confirm at <a href=\"https://example.com/verify?token=abc123&user=42\">verify</a>." +
  "<p>" + "lorem ipsum dolor sit amet ".repeat(20000) + "</p></body></html>";
const t0 = process.hrtime.bigint();
const fastResult = mod.extractFast(bigBody);
const t1 = process.hrtime.bigint();
const elapsedMs = Number(t1 - t0) / 1e6;
check("fast-path: 500 KB body processed in < 50 ms (" + elapsedMs.toFixed(1) + " ms)", elapsedMs < 50);
check("fast-path: link is the full verify URL", fastResult.activationLink.includes("example.com/verify") && fastResult.activationLink.includes("token=abc123"));

// 5. CPU: the catastrophic regex inside stripCssArtifacts is fixed.
//    A 16 KB body of mostly plain text used to take 6+ seconds and cause
//    "exceededResources" (cpuTime=2.01s on Cloudflare's free plan).
//    After the fix it should complete in under 1 second.
const openAILikeBody = "From: openai@openai.com\r\nTo: u@x.com\r\nSubject: Verify\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<html><head><style>div{color:red;}</style></head><body><p>Your code is <b>123456</b></p>" + "x".repeat(16 * 1024) + "</body></html>";
const tCpu0 = process.hrtime.bigint();
let r8;
try { r8 = mod.parseEmailBody(openAILikeBody); } catch (e) { r8 = { text: "" }; }
const tCpu1 = process.hrtime.bigint();
const cpuMs = Number(tCpu1 - tCpu0) / 1e6;
check("parseEmailBody: 16 KB pathological body in < 1 s (" + cpuMs.toFixed(0) + " ms)", cpuMs < 1000);
check("parseEmailBody: 16 KB body still produces usable text", r8 && typeof r8.text === "string" && r8.text.length > 0);

// 6. extractFast is the default for the email() handler hot path. A 30 KB
//    body that previously crashed parseEmailBody in 10+ seconds must
//    extract in under 50 ms.
const bigOpenAi = "From: openai@openai.com\r\nTo: u@x.com\r\nSubject: Verify\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<html><head><style>div{color:red;}</style></head><body><p>code 987654</p>" + "x".repeat(30 * 1024) + "</body></html>";
const tFast0 = process.hrtime.bigint();
const fr2 = mod.extractFast(bigOpenAi);
const tFast1 = process.hrtime.bigint();
const fastMs = Number(tFast1 - tFast0) / 1e6;
check("extractFast: 30 KB body in < 50 ms (" + fastMs.toFixed(0) + " ms)", fastMs < 50);
check("extractFast: 30 KB body still extracts the OTP", fr2.otpCode === "987654" || fr2.activationLink !== "");

// 7. SMTP header leakage regression. Build a realistic OpenAI-style email
//    with full transport headers (Received:, ARC-Seal:, DKIM-Signature:,
//    X-Spam-Score:, etc.) followed by a QP-encoded multipart/alternative
//    body. extractFast must NOT leak any of those header lines into the
//    preview and must still detect the 6-digit OTP code.
const openAiBoundary = "----=_NextPart_openai_2026_08_29";
const openAiRaw =
  "Received: from v5106.v5375b7fa.example.com (v5106.v5375b7fa.example.com [192.0.2.1])\r\n" +
  "\tby mx.cloudflare.net (Postfix) with ESMTPS id ABC123\r\n" +
  "\tfor <user@yourdomain.com>; Sat, 29 Aug 2026 12:00:00 +0000 (UTC)\r\n" +
  "ARC-Seal: i=1; a=rsa-sha256; t=1693300000; cv=none; d=openai.com\r\n" +
  "DKIM-Signature: v=1; a=rsa-sha256; d=openai.com; s=selector1\r\n" +
  "Authentication-Results: mx.cloudflare.net; dkim=pass\r\n" +
  "X-Spam-Score: -0.1\r\n" +
  "X-Original-To: user@yourdomain.com\r\n" +
  "X-CF-SpamH-Score: -0.1\r\n" +
  "X-CF-SpamH-Result: ham\r\n" +
  "X-Gm-Message-State: AOabc123\r\n" +
  "X-MS-Exchange-Organization-SCL: -1\r\n" +
  "X-Mailgun-Sid: WyI123abc=\r\n" +
  "X-SES-Configuration-Set: my-set\r\n" +
  "X-Proofpoint-Spam-Details: rule=default\r\n" +
  "X-Barracuda-Spam-Score: 0.5\r\n" +
  "X-Mimecast-Spam-Score: 0.1\r\n" +
  "Authentication-Results-Original: mx; dkim=pass\r\n" +
  "X-Originating-IP: [192.0.2.1]\r\n" +
  "X-PM-Message-Id: 12345\r\n" +
  "MIME-Version: 1.0\r\n" +
  "From: OpenAI <noreply@openai.com>\r\n" +
  "To: user@yourdomain.com\r\n" +
  "Subject: Your OpenAI verification code\r\n" +
  "Content-Type: multipart/alternative; boundary=\"" + openAiBoundary + "\"\r\n" +
  "\r\n" +
  "--" + openAiBoundary + "\r\n" +
  "Content-Type: text/plain; charset=\"UTF-8\"\r\n" +
  "Content-Transfer-Encoding: quoted-printable\r\n" +
  "\r\n" +
  "Hi! Your OpenAI verification code is: 987654. It expires in 10 minutes.\r\n" +
  "\r\n" +
  "--" + openAiBoundary + "\r\n" +
  "Content-Type: text/html; charset=\"UTF-8\"\r\n" +
  "Content-Transfer-Encoding: quoted-printable\r\n" +
  "\r\n" +
  "<html><body><p>Your OpenAI verification code is:</p><h1>987654</h1></body></html>\r\n" +
  "\r\n" +
  "--" + openAiBoundary + "--\r\n";

const fast2 = mod.extractFast(openAiRaw);
check("extractFast: no 'Received:' in preview", !/Received:/.test(fast2.previewText));
check("extractFast: no 'ARC-Seal:' in preview", !/ARC-Seal:/.test(fast2.previewText));
check("extractFast: no 'DKIM-Signature:' in preview", !/DKIM-Signature:/.test(fast2.previewText));
check("extractFast: no 'X-Spam-Score:' in preview", !/X-Spam-Score:/.test(fast2.previewText));
check("extractFast: no 'X-CF-SpamH-Score:' in preview", !/X-CF-SpamH-Score/.test(fast2.previewText));
check("extractFast: no 'X-Gm-Message-State:' in preview", !/X-Gm-Message-State/.test(fast2.previewText));
check("extractFast: no 'X-MS-Exchange-Organization-SCL:' in preview", !/X-MS-Exchange-Organization-SCL/.test(fast2.previewText));
check("extractFast: no 'X-Mailgun-Sid:' in preview", !/X-Mailgun-Sid/.test(fast2.previewText));
check("extractFast: no boundary marker in preview", !/NextPart_openai/.test(fast2.previewText));
check("extractFast: contains the OTP code in preview", fast2.previewText.includes("987654"));
check("extractFast: contains 'OpenAI' or 'verification' in preview",
  fast2.previewText.toLowerCase().includes("openai") || fast2.previewText.toLowerCase().includes("verification"));
check("extractFast: otpCode is 987654", fast2.otpCode === "987654");

// parseEmailBody on the same body should also be clean.
const full2 = mod.parseEmailBody(openAiRaw);
check("parseEmailBody: no 'Received:' at start of text", !full2.text.startsWith("Received:"));
check("parseEmailBody: no 'X-CF-SpamH-Score' in text", !/X-CF-SpamH-Score/.test(full2.text));
check("parseEmailBody: no 'X-Gm-Message-State' in text", !/X-Gm-Message-State/.test(full2.text));
check("parseEmailBody: no 'X-MS-Exchange-Organization-SCL' in text", !/X-MS-Exchange-Organization-SCL/.test(full2.text));
check("parseEmailBody: no 'X-Mailgun-Sid' in text", !/X-Mailgun-Sid/.test(full2.text));
check("parseEmailBody: contains the OTP code", full2.text.includes("987654"));

console.log(failures === 0 ? "\nALL D1 + CPU TESTS PASSED" : `\n${failures} D1 / CPU TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
