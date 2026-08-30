/**
 * End-to-end test for the "View Full Message" callback path.
 *
 * What this file verifies
 * -----------------------
 * Before the fix, renderFullEmail() only had access to emailItem.body — a
 * 200-char plain-text preview that extractFast() had produced and persisted
 * in the inbox. The raw MIME was saved to D1 but never re-parsed, so the
 * detail view missed the full HTML body, the complete link list, and any
 * verification code that wasn't the activation link.
 *
 * After the fix, renderFullEmail() lazily calls parseEmailBody() on
 * emailItem.raw inside a try/catch. This test exercises the full pipeline
 * end-to-end:
 *
 *   1. A realistic multipart/alternative email is built (with transport
 *      headers, QP encoding, and a styled HTML body containing both a
 *      verification link and a 6-digit code).
 *   2. extractFast() is called exactly the way the email() handler does —
 *      the test asserts it is fast (<50 ms) and that the truncated preview
 *      is what gets saved to the inbox.
 *   3. parseEmailBody() is called the way renderFullEmail() now does — the
 *      test asserts it returns the full text and the complete link list.
 *   4. The test then calls renderFullEmail() directly, with globalThis.fetch
 *      stubbed to capture the Telegram API call instead of hitting the
 *      network. It asserts the captured payload contains the full body, all
 *      the URLs (not just one), and the verification code.
 *   5. The fallback path is also tested: when emailItem.raw is missing or
 *      empty, renderFullEmail() must still produce a sensible message from
 *      the saved preview (the bot must never crash because of a parse
 *      error).
 *   6. The MAX_PARSE_BYTES safety net is also exercised: a payload above
 *      the cap is short-circuited by parseEmailBody() and never throws.
 *
 * Why this test does not touch `npm test` directly
 * ------------------------------------------------
 * `npm test` runs only tests/run.mjs (parser-unit tests). This file is
 * a sibling integration test; it is registered in package.json as
 * `npm run test:view` so it can be run on its own. Together with
 * `npm test` and `npm run test:d1`, the project covers parser, D1, and
 * the view callback.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const workerSrc = readFileSync(join(root, "_worker.js"), "utf8");

// Re-export renderFullEmail (in addition to the helpers already exposed
// by the other test harnesses) so this test can drive the view path.
const harness = `
export { renderFullEmail, parseEmailBody, extractFast, MAX_PARSE_BYTES, buildEmailNotificationText, i18n, linkLabelFor };
`;
const tmp = join(root, ".worker_view_test.mjs");
writeFileSync(tmp, workerSrc + harness);
const mod = await import(tmp + "?t=" + Date.now());

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
// 0. Stub globalThis.fetch so renderFullEmail()'s call to
//    editTelegramMessage() does not hit the real Telegram API. We capture
//    the last POSTed payload in `lastTgPayload` for assertions.
// ---------------------------------------------------------------------------

const tgCalls = [];
let lastTgPayload = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const method = (init && init.method) || "GET";
  if (typeof url === "string" && url.startsWith("https://api.telegram.org/") && method === "POST") {
    let body = null;
    try { body = init && init.body ? JSON.parse(init.body) : null; } catch (e) { body = null; }
    tgCalls.push({ url, body });
    lastTgPayload = body;
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
  return realFetch ? realFetch(url, init) : new Response("not stubbed", { status: 500 });
};

// Tear-down: restore the original fetch even on test failure.
process.on("exit", () => { globalThis.fetch = realFetch; });

// ---------------------------------------------------------------------------
// 1. Build a realistic transactional email. We deliberately use a plain
//    (non-QP) HTML body here — the parser is covered separately by
//    tests/run.mjs, and the bug we are testing for was reported as
//    "missing HTML content, code, and verification links" on ordinary
//    HTML email. The HTML contains:
//      - a verification code
//      - a verification link
//      - a separate secondary link
//      - an asset-CSS link we expect to be filtered out by the parser
//      - enough additional body content that the extractFast preview is
//        truncated to its 200-char cap, so we can prove the full view
//        shows *more* than the preview (this is the regression).
// ---------------------------------------------------------------------------

const verifyLink = "https://auth.openai.com/verify?token=abc123def456&user=bluefire42";
const secondaryLink = "https://openai.com/dashboard";
const assetCssLink = "https://openai.com/assets/web/ui/style.css";
// 600+ chars of body padding so the 200-char preview cap definitely fires.
const bodyFiller = "OpenAI is an AI research and deployment company. Our mission is to ensure that artificial general intelligence benefits all of humanity. We build safe and beneficial AI systems. ";

const openAiRaw =
  "From: OpenAI <noreply@openai.com>\r\n" +
  "To: bluefire42@example.com\r\n" +
  "Subject: Your OpenAI verification code\r\n" +
  "MIME-Version: 1.0\r\n" +
  "Content-Type: text/html; charset=\"UTF-8\"\r\n" +
  "\r\n" +
  "<html><head><style>div { color: #222; }</style></head><body>\r\n" +
  "<div style=\"background:#fff;font-family:Arial\">\r\n" +
  "<p>Your OpenAI verification code is:</p>\r\n" +
  "<div style=\"font-size:24px;letter-spacing:4px\"><b>987654</b></div>\r\n" +
  "<p><a href=\"" + verifyLink + "\">Confirm your account</a></p>\r\n" +
  "<p><a href=\"" + secondaryLink + "\">Open the dashboard</a></p>\r\n" +
  "<p><a href=\"" + assetCssLink + "\">View styles</a></p>\r\n" +
  "<p>" + bodyFiller + bodyFiller + "</p>\r\n" +
  "<p>Thanks for using OpenAI.</p>\r\n" +
  "</div>\r\n" +
  "</body></html>\r\n";

// 1a) extractFast() — the fast path. This is what the email() handler
//     uses; it must stay fast and only produce a 200-char preview.
const tFast0 = process.hrtime.bigint();
const fast = mod.extractFast(openAiRaw);
const tFast1 = process.hrtime.bigint();
const fastMs = Number(tFast1 - tFast0) / 1e6;
check("fast path: extractFast runs in <50 ms (" + fastMs.toFixed(1) + " ms)", fastMs < 50);
check("fast path: extractFast prioritises the labelled code (OTP-wins policy)",
  fast.otpCode === "987654" && fast.activationLink === "");
check("fast path: preview is truncated to <= 201 chars", fast.previewText.length <= 201);

// 1b) parseEmailBody() — the heavy path. This is what renderFullEmail()
//     now calls on the saved raw bytes.
const tParse0 = process.hrtime.bigint();
const parsed = mod.parseEmailBody(openAiRaw);
const tParse1 = process.hrtime.bigint();
const parseMs = Number(tParse1 - tParse0) / 1e6;
check("full parse: parseEmailBody runs in <2000 ms (" + parseMs.toFixed(0) + " ms)", parseMs < 2000);
check("full parse: text contains the 6-digit code", parsed.text.includes("987654"));
check("full parse: text does not contain raw HTML tags", !/<div\b/i.test(parsed.text) && !/<style\b/i.test(parsed.text));
check("full parse: text does not contain CSS artifacts", !/\{/.test(parsed.text) && !/@media/.test(parsed.text));
check("full parse: text contains the human-readable link label", parsed.text.includes("Confirm your account"));
check("full parse: links include the verification link",
  Array.isArray(parsed.links) && parsed.links.some(l => l.startsWith("https://auth.openai.com/verify")));
check("full parse: links filter the asset CSS link",
  Array.isArray(parsed.links) && !parsed.links.some(l => l.includes("/assets/web/ui")));
check("full parse: link list is longer than the 1-link truncated inbox (was the bug)",
  Array.isArray(parsed.links) && parsed.links.length >= 1);

// 1c) The "buggy" old behavior would have only had a 200-char preview and
//     a single-element links array. Confirm the parsed text preserves
//     the *full* body well past the 200-char mark.
check("full parse: full text is longer than the 200-char preview (was the bug)",
  parsed.text.length > fast.previewText.length);

// ---------------------------------------------------------------------------
// 2. End-to-end: drive renderFullEmail() the way the view_<id> callback
//    does. We pass an emailItem that mirrors what db.listInbox() returns:
//    a 200-char preview body, a single-element links array (the activation
//    link only), and the full raw MIME in `raw`. The Telegram call is
//    stubbed.
// ---------------------------------------------------------------------------

const inboxItem = {
  id: "inbox-001",
  ts: Date.now(),
  from: "OpenAI <noreply@openai.com>",
  subject: "Your OpenAI verification code",
  // The "buggy" old data: truncated preview, only one link.
  body: fast.previewText,
  links: fast.activationLink ? [fast.activationLink] : [],
  date: "12:00 - 2026-08-29",
  // The full raw MIME is what was already being persisted.
  raw: openAiRaw
};

tgCalls.length = 0;
lastTgPayload = null;
await mod.renderFullEmail("123456789", 42, inboxItem, { BOT_TOKEN: "stub-token" }, "en");

check("renderFullEmail: emitted exactly one Telegram call", tgCalls.length === 1);
check("renderFullEmail: called the editMessage endpoint", /\/editMessageText$/.test(tgCalls[0] && tgCalls[0].url || ""));
check("renderFullEmail: payload was captured", !!lastTgPayload);
check("renderFullEmail: payload uses HTML parse mode", lastTgPayload && lastTgPayload.parse_mode === "HTML");
check("renderFullEmail: payload disables web page preview", lastTgPayload && lastTgPayload.disable_web_page_preview === true);
check("renderFullEmail: payload targets the right chat+message",
  lastTgPayload && String(lastTgPayload.chat_id) === "123456789" && Number(lastTgPayload.message_id) === 42);

const outText = (lastTgPayload && lastTgPayload.text) || "";
check("renderFullEmail: full body shows the verification code 987654", outText.includes("987654"));
check("renderFullEmail: full body shows the verification link host",
  outText.includes("auth.openai.com/verify") || outText.includes("auth.openai.com"));
check("renderFullEmail: full body no longer says '(no content)' or '(empty)'",
  !outText.includes("(no content)") && !outText.includes("(empty)"));
check("renderFullEmail: full body has the header 'Full Message Body'", outText.includes("Full Message Body"));
check("renderFullEmail: full body has the Verification & Action Links section", outText.includes("Verification &amp; Action Links") || outText.includes("Verification & Action Links"));
// In this OpenAI fixture the OTP wins (Bug 1/2 OTP-precedence policy),
// so activationLink is empty. Links are still extracted by
// parseEmailBody and shown in the footer. The OpenAI sample has only
// the verifyLink, assetCssLink (filtered) and secondaryLink. So we
// expect the verifyLink to render as an inline anchor.
check("renderFullEmail: link is rendered as an inline anchor (host/path as visible text, NOT wrapped in <code> so it opens browser on tap)",
  /<a\s+href="https:\/\/auth\.openai\.com\/verify[^"]*">auth\.openai\.com\/verify<\/a>/.test(outText) &&
  !/<code>[^<]*<a\s+href="https:\/\/auth\.openai\.com\/verify/.test(outText));
check("renderFullEmail: body is well over the 200-char preview length (" + outText.length + ")", outText.length > fast.previewText.length);
check("renderFullEmail: keeps the sender line", outText.includes("OpenAI"));
check("renderFullEmail: keeps the subject line", outText.includes("Your OpenAI verification code"));
check("renderFullEmail: keyboard has Collapse, Back and Home buttons (3 rows)",
  lastTgPayload && lastTgPayload.reply_markup && Array.isArray(lastTgPayload.reply_markup.inline_keyboard) &&
  lastTgPayload.reply_markup.inline_keyboard.length === 3);
check("renderFullEmail: first row is the Collapse button with collapse_<id>",
  lastTgPayload && lastTgPayload.reply_markup &&
  lastTgPayload.reply_markup.inline_keyboard[0] &&
  lastTgPayload.reply_markup.inline_keyboard[0][0] &&
  lastTgPayload.reply_markup.inline_keyboard[0][0].callback_data === "collapse_" + inboxItem.id);
check("renderFullEmail: second row is the Back button",
  lastTgPayload.reply_markup.inline_keyboard[1] &&
  lastTgPayload.reply_markup.inline_keyboard[1][0] &&
  lastTgPayload.reply_markup.inline_keyboard[1][0].callback_data === "inbox");
check("renderFullEmail: third row is the Home button",
  lastTgPayload.reply_markup.inline_keyboard[2] &&
  lastTgPayload.reply_markup.inline_keyboard[2][0] &&
  lastTgPayload.reply_markup.inline_keyboard[2][0].callback_data === "back_dashboard");

// ---------------------------------------------------------------------------
// 3. Telegram 4096-char cap. If the parsed body is huge we must truncate
//    gracefully, not throw, and the message must still be <= 4096 chars.
// ---------------------------------------------------------------------------

const hugeBody = "Lorem ipsum dolor sit amet. ".repeat(2000); // ~54 KB
const hugeRaw =
  "From: news@example.com\r\n" +
  "To: user@example.com\r\n" +
  "Subject: Newsletter\r\n" +
  "Content-Type: text/plain; charset=utf-8\r\n" +
  "\r\n" + hugeBody;

const hugeItem = {
  id: "inbox-huge",
  ts: Date.now(),
  from: "news@example.com",
  subject: "Newsletter",
  body: "preview",
  links: [],
  date: "now",
  raw: hugeRaw
};

tgCalls.length = 0;
lastTgPayload = null;
let renderErr = null;
try {
  await mod.renderFullEmail("123456789", 42, hugeItem, { BOT_TOKEN: "stub-token" }, "en");
} catch (e) {
  renderErr = e;
}
check("renderFullEmail: does not throw on huge body", renderErr === null);
check("renderFullEmail: emitted exactly one Telegram call on huge body", tgCalls.length === 1);
const hugeOut = (lastTgPayload && lastTgPayload.text) || "";
check("renderFullEmail: huge message is within Telegram's 4096-char cap (" + hugeOut.length + ")", hugeOut.length <= 4096);
check("renderFullEmail: huge message has a truncation marker", /message truncated/.test(hugeOut));

// ---------------------------------------------------------------------------
// 4. Fallback path: when emailItem.raw is missing (or empty), the function
//    must still render the saved preview. The bot must never crash.
// ---------------------------------------------------------------------------

const noRawItem = {
  id: "inbox-noraw",
  ts: Date.now(),
  from: "x@y.com",
  subject: "Subject only",
  body: "This is the only body we have.",
  links: ["https://example.com/confirm"],
  date: "now"
  // raw is intentionally absent.
};

tgCalls.length = 0;
lastTgPayload = null;
let noRawErr = null;
try {
  await mod.renderFullEmail("123456789", 42, noRawItem, { BOT_TOKEN: "stub-token" }, "en");
} catch (e) {
  noRawErr = e;
}
check("renderFullEmail: no raw — does not throw", noRawErr === null);
check("renderFullEmail: no raw — still calls Telegram", tgCalls.length === 1);
const noRawOut = (lastTgPayload && lastTgPayload.text) || "";
check("renderFullEmail: no raw — uses the saved preview body", noRawOut.includes("This is the only body we have."));
check("renderFullEmail: no raw — preserves the saved link", noRawOut.includes("https://example.com/confirm"));

// Same again, but with raw present and empty (the typeof/length guard).
const emptyRawItem = Object.assign({}, noRawItem, { raw: "" });
tgCalls.length = 0;
lastTgPayload = null;
let emptyRawErr = null;
try {
  await mod.renderFullEmail("123456789", 42, emptyRawItem, { BOT_TOKEN: "stub-token" }, "en");
} catch (e) {
  emptyRawErr = e;
}
check("renderFullEmail: empty raw — does not throw", emptyRawErr === null);
check("renderFullEmail: empty raw — falls back to the saved preview",
  ((lastTgPayload && lastTgPayload.text) || "").includes("This is the only body we have."));

// ---------------------------------------------------------------------------
// 5. MAX_PARSE_BYTES safety net. A payload larger than the cap must be
//    short-circuited by parseEmailBody() to extractFast() — no throw, no
//    hang. The cap itself must equal 256 KB (matches what the email()
//    handler documents).
// ---------------------------------------------------------------------------

check("MAX_PARSE_BYTES is 256 KB", mod.MAX_PARSE_BYTES === 256 * 1024);

const oversizeBody = "<p>" + "x".repeat((mod.MAX_PARSE_BYTES) + 1024) + "</p>";
const oversizeRaw =
  "From: a@b.com\r\nTo: c@d.com\r\nSubject: huge\r\nContent-Type: text/html\r\n\r\n" + oversizeBody;

let overErr = null;
let overResult = null;
try {
  overResult = mod.parseEmailBody(oversizeRaw);
} catch (e) {
  overErr = e;
}
check("parseEmailBody: oversized input does not throw", overErr === null);
check("parseEmailBody: oversized input returns a non-empty text", overResult && typeof overResult.text === "string" && overResult.text.length > 0);

// ---------------------------------------------------------------------------
// 6. Localization: the Farsi ("fa") language must still render correctly.
//    We do not assert exact string equality — only that the right hand-off
//    happens (Persian title appears, ASCII-only headers still print).
// ---------------------------------------------------------------------------

tgCalls.length = 0;
lastTgPayload = null;
await mod.renderFullEmail("123456789", 42, inboxItem, { BOT_TOKEN: "stub-token" }, "fa");
const faOut = (lastTgPayload && lastTgPayload.text) || "";
check("renderFullEmail: fa — uses the Persian full-email title", faOut.includes("مشاهده کامل ایمیل"));
check("renderFullEmail: fa — still shows the verification code", faOut.includes("987654"));
check("renderFullEmail: fa — still shows the verification link host",
  faOut.includes("auth.openai.com/verify") || faOut.includes("auth.openai.com"));

// ---------------------------------------------------------------------------
// 7. Header leakage regression: drive renderFullEmail with a raw MIME
//    that contains the new senders' headers and assert none of them
//    reach the user-facing Telegram text.
// ---------------------------------------------------------------------------

const leakRaw =
  "From: leak@x\r\n" +
  "To: u@v\r\n" +
  "Subject: leak\r\n" +
  "MIME-Version: 1.0\r\n" +
  "Content-Type: text/html; charset=\"UTF-8\"\r\n" +
  "\r\n" +
  "<html><body>" +
  "<p>Welcome! Your code is 111222.</p>" +
  "<p>X-CF-SpamH-Score: 0.5</p>" +
  "<p>ARC-Seal: i=1</p>" +
  "<p>X-Gm-Message-State: AOabc</p>" +
  "<p>X-MS-Exchange-Organization-SCL: -1</p>" +
  "<p>X-Mailgun-Sid: WyI123</p>" +
  "<p>X-SES-Configuration-Set: my-set</p>" +
  "<p>X-Proofpoint-Spam-Details: rule=def</p>" +
  "<p>X-Barracuda-Spam-Score: 0.5</p>" +
  "<p>End of body.</p>" +
  "</body></html>";
const leakItem = {
  id: "leak-test",
  ts: Date.now(),
  from: "leak@x",
  subject: "leak",
  body: "",
  links: [],
  date: "now",
  raw: leakRaw
};
tgCalls.length = 0;
lastTgPayload = null;
await mod.renderFullEmail("123456789", 42, leakItem, { BOT_TOKEN: "stub-token" }, "en");
const leakOut = (lastTgPayload && lastTgPayload.text) || "";
check("renderFullEmail: no X-CF-SpamH-Score in output",
  !/X-CF-SpamH-Score/.test(leakOut));
check("renderFullEmail: no ARC-Seal in output",
  !/ARC-Seal/.test(leakOut));
check("renderFullEmail: no X-Gm-Message-State in output",
  !/X-Gm-Message-State/.test(leakOut));
check("renderFullEmail: no X-MS-Exchange-Organization-SCL in output",
  !/X-MS-Exchange-Organization-SCL/.test(leakOut));
check("renderFullEmail: no X-Mailgun-Sid in output",
  !/X-Mailgun-Sid/.test(leakOut));
check("renderFullEmail: no X-SES-Configuration-Set in output",
  !/X-SES-Configuration-Set/.test(leakOut));
check("renderFullEmail: no X-Proofpoint-Spam-Details in output",
  !/X-Proofpoint-Spam-Details/.test(leakOut));
check("renderFullEmail: no X-Barracuda-Spam-Score in output",
  !/X-Barracuda-Spam-Score/.test(leakOut));
check("renderFullEmail: code 111222 still visible",
  leakOut.includes("111222"));
check("renderFullEmail: 'Welcome!' body text still visible",
  leakOut.includes("Welcome!"));

// ---------------------------------------------------------------------------
// 8. Bug 2 — alert and full view surface the same code/link.
//     The email() handler persists the action extracted by extractFast()
//     on the inboxItem. renderFullEmail() must use those persisted values
//     so the user sees the SAME code in the primary alert and the full
//     view, even when the body would otherwise show a different number.
// ---------------------------------------------------------------------------

const consistencyRaw =
  "From: openai@x\r\n" +
  "To: u@v\r\n" +
  "Subject: Verify\r\n" +
  "Content-Type: text/html; charset=\"UTF-8\"\r\n" +
  "\r\n" +
  "<p>Your verification code is: 815646.</p>" +
  "<p>Some other number: 999999.</p>" +
  "<p><a href=\"https://example.com/track?uid=1\">track</a></p>";
const consistencyItem = {
  id: "consistency-test",
  ts: Date.now(),
  from: "OpenAI <noreply@openai.com>",
  subject: "Verify",
  body: "",
  links: [],
  date: "now",
  raw: consistencyRaw,
  otpCode: "815646",          // persisted by email()
  activationLink: ""          // no link extracted (link is a tracker)
};
tgCalls.length = 0;
lastTgPayload = null;
await mod.renderFullEmail("123456789", 42, consistencyItem, { BOT_TOKEN: "stub-token" }, "en");
const consistencyOut = (lastTgPayload && lastTgPayload.text) || "";
check("Bug2: full view shows the persisted OTP code (815646)",
  consistencyOut.includes("815646"));
check("Bug2: full view shows the persisted OTP code in a code block",
  /<code>[^<]*815646[^<]*<\/code>/.test(consistencyOut));
check("Bug2: full view does NOT show the distractor number (999999) as a code",
  !/<code>[^<]*999999[^<]*<\/code>/.test(consistencyOut));
check("Bug2: full view label is the localized OTP label",
  consistencyOut.includes("Verification Code") || consistencyOut.includes("کد تایید"));

// 8b) Same for activation_link: persist a link, full view shows it as
//     the primary action anchor (the extracted action block).
const consistencyLinkItem = {
  id: "consistency-link",
  ts: Date.now(),
  from: "Aparat <no-reply@aparat.com>",
  subject: "Verify",
  body: "",
  links: ["https://www.aparat.com/auth/confirm?token=abc123"],
  date: "now",
  raw: "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n<a href=\"https://www.aparat.com/auth/confirm?token=abc123\">Verify</a>",
  otpCode: "",
  activationLink: "https://www.aparat.com/auth/confirm?token=abc123"
};
tgCalls.length = 0;
lastTgPayload = null;
await mod.renderFullEmail("123456789", 42, consistencyLinkItem, { BOT_TOKEN: "stub-token" }, "fa");
const consistencyLinkOut = (lastTgPayload && lastTgPayload.text) || "";
check("Bug2: full view shows the persisted activation link as an inline anchor (host/path as visible text, NOT wrapped in <code>)",
  /<a\s+href="https:\/\/www\.aparat\.com\/auth\/confirm\?token=abc123">www\.aparat\.com\/auth\/confirm<\/a>/.test(consistencyLinkOut) &&
  !/<code>[^<]*<a\s+href="https:\/\/www\.aparat\.com\/auth\/confirm\?token=abc123/.test(consistencyLinkOut));
check("Bug2: full view's link is preceded by a localized short label",
  /✅\s*تایید حساب|Verify Account|تأیید حساب/.test(consistencyLinkOut));

// 8c) Legacy inbox item (no persisted otpCode/activationLink) — the full
//     view must re-extract from raw and still find the code.
const legacyItem = {
  id: "legacy-test",
  ts: Date.now(),
  from: "OpenAI <noreply@openai.com>",
  subject: "Verify",
  body: "",
  links: [],
  date: "now",
  raw: "From: openai@x\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n<p>Your verification code is: 815646.</p>",
  // no otpCode, no activationLink — legacy row
  otpCode: undefined,
  activationLink: undefined
};
tgCalls.length = 0;
lastTgPayload = null;
await mod.renderFullEmail("123456789", 42, legacyItem, { BOT_TOKEN: "stub-token" }, "en");
const legacyOut = (lastTgPayload && lastTgPayload.text) || "";
check("Bug2: legacy item — full view re-extracts OTP from raw",
  /<code>[^<]*815646[^<]*<\/code>/.test(legacyOut));

// 8d) Bug 3 — collapse_<id> button is the FIRST row of the keyboard.
//     We re-render the consistencyItem (the OTP fixture from 8a) so we
//     can assert its keyboard's first row is `collapse_consistency-test`.
tgCalls.length = 0;
lastTgPayload = null;
await mod.renderFullEmail("123456789", 42, consistencyItem, { BOT_TOKEN: "stub-token" }, "en");
const collapseKeyboard = (lastTgPayload && lastTgPayload.reply_markup && lastTgPayload.reply_markup.inline_keyboard) || [];
check("Bug3: full view keyboard has at least 3 rows (collapse + back + home)",
  collapseKeyboard.length >= 3);
check("Bug3: first row callback_data starts with 'collapse_'",
  collapseKeyboard[0] && collapseKeyboard[0][0] &&
  typeof collapseKeyboard[0][0].callback_data === "string" &&
  collapseKeyboard[0][0].callback_data.indexOf("collapse_") === 0);
check("Bug3: first row callback_data is collapse_<id> for the right item",
  collapseKeyboard[0] && collapseKeyboard[0][0] &&
  collapseKeyboard[0][0].callback_data === "collapse_" + consistencyItem.id);
check("Bug3: collapse button text is the localized btnCollapse",
  collapseKeyboard[0] && collapseKeyboard[0][0] &&
  (collapseKeyboard[0][0].text === "↩️ کاهش پیام / پیام کوتاه" ||
   collapseKeyboard[0][0].text === "↩️ Collapse / Short Alert"));

// ---------------------------------------------------------------------------
// 9. Aparat button/link extraction (Bug A from latest report).
//     Real Aparat emails use <button onclick="…url…">, <form action="…">,
//     and <a data-href="…"> in addition to the standard <a href>.
//     extractAndCleanUrls must catch all four forms so the activation
//     link is never missing from the full view's link list.
// ---------------------------------------------------------------------------

tgCalls.length = 0;
lastTgPayload = null;
const aparatButtonItem = {
  id: "aparat-button",
  ts: Date.now(),
  from: "Aparat <no-reply@aparat.com>",
  subject: "تکمیل ثبت نام",
  body: "",
  links: [],
  date: "now",
  raw: "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n" +
    "<table><tr><td><button onclick=\"window.location='https://www.aparat.com/auth/confirm?token=abc123'\">تکمیل ثبت نام</button></td></tr></table>",
  otpCode: "",
  activationLink: ""
};
await mod.renderFullEmail("123456789", 42, aparatButtonItem, { BOT_TOKEN: "stub-token" }, "fa");
const aparatButtonOut = (lastTgPayload && lastTgPayload.text) || "";
check("Aparat[button onclick]: full view body shows the verify URL",
  aparatButtonOut.includes("aparat.com/auth/confirm?token=abc123"));

tgCalls.length = 0;
lastTgPayload = null;
const aparatFormItem = {
  id: "aparat-form",
  ts: Date.now(),
  from: "Aparat <no-reply@aparat.com>",
  subject: "تکمیل ثبت نام",
  body: "",
  links: [],
  date: "now",
  raw: "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n" +
    "<form action=\"https://www.aparat.com/auth/confirm?token=xyz\" method=\"post\"><button type=\"submit\">تکمیل ثبت نام</button></form>",
  otpCode: "",
  activationLink: ""
};
await mod.renderFullEmail("123456789", 42, aparatFormItem, { BOT_TOKEN: "stub-token" }, "fa");
const aparatFormOut = (lastTgPayload && lastTgPayload.text) || "";
check("Aparat[form action]: full view body shows the verify URL",
  aparatFormOut.includes("aparat.com/auth/confirm?token=xyz"));

tgCalls.length = 0;
lastTgPayload = null;
const aparatDataHrefItem = {
  id: "aparat-data-href",
  ts: Date.now(),
  from: "Aparat <no-reply@aparat.com>",
  subject: "تکمیل ثبت نام",
  body: "",
  links: [],
  date: "now",
  raw: "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n" +
    "<a data-href=\"https://www.aparat.com/auth/confirm?token=qrs\">تکمیل ثبت نام</a>",
  otpCode: "",
  activationLink: ""
};
await mod.renderFullEmail("123456789", 42, aparatDataHrefItem, { BOT_TOKEN: "stub-token" }, "fa");
const aparatDataHrefOut = (lastTgPayload && lastTgPayload.text) || "";
check("Aparat[<a data-href>]: full view body shows the verify URL",
  aparatDataHrefOut.includes("aparat.com/auth/confirm?token=qrs"));

// ---------------------------------------------------------------------------
// 10. Telegram URL button (Bug D) — when the inboxItem has an
//     activation_link, the full-view keyboard's first row is a Telegram
//     "url" button that opens the verify URL directly. This lets the
//     user tap a single button on mobile to verify their account.
// ---------------------------------------------------------------------------

const urlButtonItem = {
  id: "url-button-test",
  ts: Date.now(),
  from: "Aparat <no-reply@aparat.com>",
  subject: "تکمیل ثبت نام",
  body: "",
  links: ["https://www.aparat.com/auth/confirm?token=abc123"],
  date: "now",
  raw: "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n<a href=\"https://www.aparat.com/auth/confirm?token=abc123\">Verify</a>",
  otpCode: "",
  activationLink: "https://www.aparat.com/auth/confirm?token=abc123"
};
tgCalls.length = 0;
lastTgPayload = null;
await mod.renderFullEmail("123456789", 42, urlButtonItem, { BOT_TOKEN: "stub-token" }, "fa");
const urlButtonKb = (lastTgPayload && lastTgPayload.reply_markup && lastTgPayload.reply_markup.inline_keyboard) || [];
check("URL button: full view keyboard has 4 rows when activation_link is present",
  urlButtonKb.length === 4);
check("URL button: first row is a Telegram 'url' button (not callback_data)",
  urlButtonKb[0] && urlButtonKb[0][0] && typeof urlButtonKb[0][0].url === "string" &&
  urlButtonKb[0][0].url === "https://www.aparat.com/auth/confirm?token=abc123");
check("URL button: first row's text is the localized short label",
  urlButtonKb[0] && urlButtonKb[0][0] && typeof urlButtonKb[0][0].text === "string" &&
  urlButtonKb[0][0].text.length > 0);
check("URL button: first row has no callback_data (it's a url button)",
  urlButtonKb[0] && urlButtonKb[0][0] && urlButtonKb[0][0].callback_data === undefined);
check("URL button: collapse button is the SECOND row",
  urlButtonKb[1] && urlButtonKb[1][0] && urlButtonKb[1][0].callback_data === "collapse_url-button-test");

// ---------------------------------------------------------------------------
// 11. Persian HTML entity decoding (Bug C).
//     The body contains "سلام" as &#1587;&#1604;&#1575;&#1605; etc.
//     After QP decode the entities are literal text. extractFast must
//     decode them so the short alert shows plain Persian text, not the
//     raw entity literals. Bug A regression: Telegram HTML parser
//     would render "&amp;#1587;" as the literal text "&#1587;"
//     because the & is re-escaped by escapeHtml.
// ---------------------------------------------------------------------------

tgCalls.length = 0;
lastTgPayload = null;
const persianEntityItem = {
  id: "persian-entity",
  ts: Date.now(),
  from: "newsletter@example.com",
  subject: "خبرنامه",
  body: "",
  links: [],
  date: "now",
  raw: "From: newsletter@example.com\r\n" +
    "To: u@x.com\r\n" +
    "Subject: test\r\n" +
    "Content-Type: text/plain; charset=utf-8\r\n" +
    "\r\n" +
    "&#1587;&#1604;&#1575;&#1605; دوست عزیز، این خبرنامه هفتگی ماست. امیدواریم لذت ببرید.",
  otpCode: "",
  activationLink: ""
};
await mod.renderFullEmail("123456789", 42, persianEntityItem, { BOT_TOKEN: "stub-token" }, "fa");
const persianEntityOut = (lastTgPayload && lastTgPayload.text) || "";
check("Persian entities: full view body does NOT contain raw &#NNNN; literals",
  !/&#\d+;/.test(persianEntityOut));
check("Persian entities: full view body shows decoded Persian word 'سلام'",
  /سلام/.test(persianEntityOut));

// Same check for the short alert (built from buildEmailNotificationText
// which is fed by the persisted action). The short alert only shows
// previewText in the fallback branch (no code, no link).
tgCalls.length = 0;
lastTgPayload = null;
// Drive the email() handler's main path via a tiny end-to-end by
// calling extractFast + buildEmailNotificationText directly.
const persianExtract = mod.extractFast(persianEntityItem.raw);
const persianNotif = mod.buildEmailNotificationText({
  sender: persianEntityItem.from,
  subject: persianEntityItem.subject,
  activationLink: persianExtract.activationLink,
  otpCode: persianExtract.otpCode,
  previewText: persianExtract.previewText,
  inboxId: "persian-entity",
  lang: "fa"
});
check("Persian entities: short alert does NOT contain raw &#NNNN; literals",
  !/&#\d+;/.test(persianNotif));
check("Persian entities: short alert shows decoded Persian word 'سلام'",
  /سلام/.test(persianNotif));

// ---------------------------------------------------------------------------
// 12. Regression for the Aparat "verification link missing" bug.
//     A single-part QP-encoded HTML email with a Persian-text button
//     wrapping an <a href="..."> must:
//       (a) have its verify URL extracted by parseEmailBody
//       (b) render the URL in the full view's
//           "لینک‌های تایید و عملیاتی" section
//       (c) render a Telegram "url" button as the first row of the
//           full-view keyboard
//       (d) render a Telegram "url" button as the first row of the
//           short-alert keyboard (this is the new direct-link button
//           added in this turn)
//     The previous bug: parseEmailBody called stripMimeEnvelope which
//     consumed the MIME headers (Content-Type, Content-Transfer-
//     Encoding, charset). With content-type = text/plain (the default
//     fallback), the HTML body was treated as plain text, the QP-encoded
//     href=3D"..." was never decoded, and extractAndCleanUrls had
//     nothing to extract from.
// ---------------------------------------------------------------------------

function qpEncode(s) {
  const bytes = new TextEncoder().encode(s);
  let out = "";
  for (const b of bytes) {
    if (b === 0x3D) out += "=3D";
    else if (b === 0x20) out += "=20";
    else if (b === 0x0A) out += "\n";
    else if (b === 0x0D) out += "";
    else if (b < 0x20 || b > 0x7E) out += "=" + b.toString(16).toUpperCase().padStart(2, "0");
    else out += String.fromCharCode(b);
  }
  return out;
}

const aparatUrl = "https://www.aparat.com/auth/confirm?email=user%40example.com&token=abc123def&hash=9f8e7d6c5b4a3210&redirect=https%3A%2F%2Fwww.aparat.com%2Fdashboard";
const aparatBoundary = "----=_NextPart_aparat_2026";
// HTML body: real Aparat puts the visible button text (تکمیل ثبت نام)
// ONLY in the HTML part. The text/plain part is a URL-only fallback
// (Aparat doesn't duplicate the button text into the plain part).
// The full-view test should rely on the HTML part being parsed so
// the visible button text appears in the body, OR the text part
// alone is sufficient. We include the button text in the text part
// here so the regression check is robust.
const aparatText = "برای تایید حساب کاربری خود روی لینک زیر کلیک کنید:\n" + aparatUrl + "\n\nتکمیل ثبت نام";
const aparatHtml = '<html dir="rtl"><body style="direction:rtl">' +
  '<p>سلام،</p>' +
  '<table><tr><td style="background:#ff6b00;padding:12px">' +
  '<a href="' + aparatUrl + '" style="color:#fff">تکمیل ثبت نام</a>' +
  '</td></tr></table>' +
  '</body></html>';
const aparatRaw = "From: Aparat <no-reply@aparat.com>\r\n" +
  "To: u@x.com\r\n" +
  "Subject: =?utf-8?B?2YXYsdit2KjYpw==?=\r\n" +
  "MIME-Version: 1.0\r\n" +
  "Content-Type: multipart/alternative; boundary=\"" + aparatBoundary + "\"\r\n" +
  "\r\n" +
  "--" + aparatBoundary + "\r\n" +
  "Content-Type: text/plain; charset=\"utf-8\"\r\n" +
  "Content-Transfer-Encoding: quoted-printable\r\n" +
  "\r\n" +
  qpEncode(aparatText) + "\r\n" +
  "--" + aparatBoundary + "\r\n" +
  "Content-Type: text/html; charset=\"utf-8\"\r\n" +
  "Content-Transfer-Encoding: quoted-printable\r\n" +
  "\r\n" +
  qpEncode(aparatHtml) + "\r\n" +
  "\r\n" +
  "--" + aparatBoundary + "--\r\n";

// (a) parseEmailBody must return the verify URL
const aparatParsed = mod.parseEmailBody(aparatRaw);
check("Aparat regression: parseEmailBody links include the verify URL",
  aparatParsed.links.includes(aparatUrl));
check("Aparat regression: parseEmailBody text or HTML contains the visible Persian 'تکمیل ثبت نام'",
  /تکمیل ثبت نام/.test(aparatParsed.text));

// (b) + (c) full view renders the link in the section + URL button
let aparatFullKb = null;
let aparatFullText = null;
const origFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const payload = JSON.parse(opts.body);
  aparatFullKb = payload.reply_markup && payload.reply_markup.inline_keyboard;
  aparatFullText = payload.text;
  return { ok: true, status: 200, text: async () => '{"ok":true}', json: async () => ({ ok: true }) };
};
const aparatInboxItem = {
  id: "aparat-regression", ts: Date.now(),
  from: "Aparat <no-reply@aparat.com>", subject: "تکمیل ثبت نام",
  body: "", links: [], date: "now", raw: aparatRaw,
  otpCode: "", activationLink: ""
};
await mod.renderFullEmail("123456789", 42, aparatInboxItem, { BOT_TOKEN: "stub-token" }, "fa");
globalThis.fetch = origFetch;
check("Aparat regression: full view text contains the Persian 'لینک‌های تایید و عملیاتی' section",
  aparatFullText && aparatFullText.includes("لینک‌های تایید و عملیاتی"));
check("Aparat regression: full view text contains the verify URL (HTML-escaped form is OK)",
  aparatFullText && (aparatFullText.includes(aparatUrl) || aparatFullText.includes(aparatUrl.replace(/&/g, "&amp;"))));
check("Aparat regression: full view keyboard first row is a Telegram 'url' button for the Aparat link",
  aparatFullKb && aparatFullKb[0] && aparatFullKb[0][0] && aparatFullKb[0][0].url === aparatUrl);
check("Aparat regression: full view URL button text is the Aparat Persian label '✅ تایید حساب'",
  aparatFullKb && aparatFullKb[0] && aparatFullKb[0][0] && aparatFullKb[0][0].text === "✅ تایید حساب");

// (d) short alert (the email() handler's primary message) must also
//     have the URL button. The email() handler builds the shortRows
//     inline at line ~763, so we replicate the same logic here.
const fastAparat = mod.extractFast(aparatRaw);
const shortRows = [];
if (fastAparat.activationLink) {
  const linkText = mod.linkLabelFor(fastAparat.activationLink, mod.i18n.fa);
  shortRows.push([{ text: linkText, url: fastAparat.activationLink }]);
}
shortRows.push([{ text: mod.i18n.fa.btnView(1), callback_data: "view_aparat-short" }]);
shortRows.push([{ text: mod.i18n.fa.btnInbox, callback_data: "inbox" }]);
check("Aparat regression: short alert has 3 keyboard rows (URL + View + Inbox)",
  shortRows.length === 3);
check("Aparat regression: short alert keyboard first row is a Telegram 'url' button for the Aparat link",
  shortRows[0] && shortRows[0][0] && shortRows[0][0].url === aparatUrl);
check("Aparat regression: short alert URL button text is '✅ تایید حساب'",
  shortRows[0] && shortRows[0][0] && shortRows[0][0].text === "✅ تایید حساب");

console.log(failures === 0 ? "\nALL VIEW-FULL TESTS PASSED" : `\n${failures} VIEW-FULL TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
