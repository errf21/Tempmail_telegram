import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const workerSrc = readFileSync(join(root, "_worker.js"), "utf8");

const harness = `
export { parseEmailBody, stripCssArtifacts, stripCssBlocks, looksLikeCssSelector, looksLikeCssLine, lastSelectorTokenEnd, cleanText, stripHtmlTags, generateRecoveryToken, isValidRecoveryToken, RECOVERY_TOKEN_REGEX, RECOVERY_TOKEN_ALPHABET, lastResortExtract, getDashboardPayload, MINI_APP_URL, i18n };
`;
const tmp = join(root, ".worker_test.mjs");
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

// 1. The ReferenceError regression: lastSelectorTokenEnd must be defined.
check("lastSelectorTokenEnd is defined", typeof mod.lastSelectorTokenEnd === "function");

// 2. looksLikeCssSelector correctness
check("selector body", mod.looksLikeCssSelector("body") === true);
check("selector .foo", mod.looksLikeCssSelector(".foo") === true);
check("selector #id", mod.looksLikeCssSelector("#id") === true);
check("selector a:hover", mod.looksLikeCssSelector("a:hover") === true);
check("selector @media", mod.looksLikeCssSelector("@media (max-width: 600px) ") === true);
check("selector div p", mod.looksLikeCssSelector("div p") === true);
check("not selector prose 1", mod.looksLikeCssSelector("click the button") === false);
check("not selector prose 2", mod.looksLikeCssSelector("Hello there friend") === false);

// 3. stripCssBlocks removes blocks but keeps surrounding text
const blockInput = "Hello world\nbody{color:red}\n@media (max-width:600px){.bar{display:none}}\nlink";
const blockOut = mod.stripCssBlocks(blockInput);
check("stripCssBlocks keeps text", blockOut.includes("Hello world") && blockOut.includes("link"));
check("stripCssBlocks removes body rule", !blockOut.includes("color:red"));
check("stripCssBlocks removes @media", !blockOut.includes("@media"));

// 4. Full email parse with CSS-in-HTML
const html = [
  "body{color:red}",
  ".foo{margin:0}",
  "<p>Hello <style>a{color:red}</style> world</p>",
  "@media (max-width:600px){.bar{display:none}}",
  "<a href=\"https://example.com\">link</a>",
].join("\n");
const raw = "From: a@b.com\r\nTo: c@d.com\r\nSubject: Test\r\nContent-Type: text/html\r\n\r\n" + html;
let parseErr = null;
let parsed;
try {
  parsed = mod.parseEmailBody(raw);
} catch (e) {
  parseErr = e;
}
check("parseEmailBody does not throw", parseErr === null);
if (parseErr) console.error(parseErr.stack);
const parsedText = parsed ? parsed.text : "";
console.log("parsed text:", JSON.stringify(parsedText));
check("parsed text has no css braces", !/[{]/.test(parsedText) && !/[}]/.test(parsedText));
check("parsed text has no @media", !/@media/.test(parsedText));
check("parsed text keeps Hello world", parsedText.includes("Hello world"));
check("parsed text keeps link text", parsedText.includes("link"));

// 5. Quoted-printable + CSS mixed
const qp = "Content-Type: text/html\r\n\r\n<p>Hi=20there</p>\r\n<style>div{color:blue}</style>\r\n<p>Bye</p>";
const qpRaw = "From: x@y.com\r\nTo: z@w.com\r\nSubject: QP\r\nMIME-Version: 1.0\r\n" + qp;
let qpParsed;
try { qpParsed = mod.parseEmailBody(qpRaw); } catch (e) { qpParsed = { text: "ERR:" + e.message }; }
console.log("qp parsed:", JSON.stringify(qpParsed.text));
check("qp parse no css", !/[{]/.test(qpParsed.text));
check("qp parse keeps text", qpParsed.text.includes("there") && qpParsed.text.includes("Bye"));

// 6. Verification-code must survive CSS stripping (regression for dropped codes)
const chatgptHtml = [
  "<div style=\"font-family:Arial\">",
  "<p>Your OpenAI verification code is:</p>",
  "<div style=\"font-size:24px;letter-spacing:4px;\"><b>654321</b></div>",
  "<style>.c{color:red}@media (max-width:600px){.c{font-size:12px}}</style>",
  "</div>",
].join("\n");
const cgRaw = "From: no-reply@openai.com\r\nTo: u@x.com\r\nSubject: Verify\r\nContent-Type: text/html\r\n\r\n" + chatgptHtml;
let cg;
try { cg = mod.parseEmailBody(cgRaw); } catch (e) { cg = { text: "ERR:" + e.message }; }
console.log("chatgpt parsed:", JSON.stringify(cg.text));
check("verification code preserved (styled div)", cg.text.includes("654321"));
check("verification code label preserved", cg.text.includes("verification code"));
check("verification css removed", !/\{/.test(cg.text) && !/@media/.test(cg.text));

// 7. Code line immediately before a leftover CSS rule must NOT be dropped
const stress = "Your verification code: 654321\n.foo { color: red; }\nUse it to sign in.";
const stressOut = mod.stripCssBlocks(stress);
console.log("stress out:", JSON.stringify(stressOut));
check("code kept when adjacent to css rule", stressOut.includes("654321") && stressOut.includes("Your verification code: 654321"));

// 8. Bare code line should never be treated as css
check("bare code not css selector", mod.looksLikeCssSelector("654321") === false);
check("code-with-colon not pure selector", mod.isPureSelectorLine ? mod.isPureSelectorLine("Your code: 654321") === false : true);

// 9. Recovery token generation
const tok1 = mod.generateRecoveryToken();
check("token format", mod.RECOVERY_TOKEN_REGEX.test(tok1));
check("token length 10", tok1.length === 10);
check("token starts with tmp_", tok1.startsWith("tmp_"));
check("token charset only valid", /^[a-z2-9]+$/.test(tok1.substring(4)));

// 10. Token generator should not produce the same token twice (probabilistic)
let allUnique = true;
const tokens = new Set();
for (let i = 0; i < 200; i++) {
  const t = mod.generateRecoveryToken();
  if (!mod.RECOVERY_TOKEN_REGEX.test(t)) { allUnique = false; break; }
  if (tokens.has(t)) { allUnique = false; break; }
  tokens.add(t);
}
check("200 tokens are all unique and valid", allUnique);
check("200 tokens produce 200 unique values", tokens.size === 200);

// 11. isValidRecoveryToken
check("valid token accepted", mod.isValidRecoveryToken("tmp_abc234") === true);
check("valid token with leading/trailing space", mod.isValidRecoveryToken("  tmp_abc234  ") === true);
check("invalid token rejected (too short)", mod.isValidRecoveryToken("tmp_ab2") === false);
check("invalid token rejected (too long)", mod.isValidRecoveryToken("tmp_abc2345") === false);
check("invalid token rejected (no prefix)", mod.isValidRecoveryToken("abc234") === false);
check("invalid token rejected (wrong prefix)", mod.isValidRecoveryToken("xxx_abc234") === false);
check("invalid token rejected (uppercase)", mod.isValidRecoveryToken("TMP_ABC234") === false);
check("invalid token rejected (non-string)", mod.isValidRecoveryToken(null) === false);
check("invalid token rejected (empty)", mod.isValidRecoveryToken("") === false);
check("invalid token rejected (number)", mod.isValidRecoveryToken(123) === false);
check("invalid token rejected (undefined)", mod.isValidRecoveryToken(undefined) === false);

// 12. RECOVERY_TOKEN_ALPHABET excludes ambiguous chars
const alpha = mod.RECOVERY_TOKEN_ALPHABET;
check("alphabet excludes 0", !alpha.includes("0"));
check("alphabet excludes o", !alpha.includes("o"));
check("alphabet excludes 1", !alpha.includes("1"));
check("alphabet excludes l", !alpha.includes("l"));
check("alphabet excludes i", !alpha.includes("i"));

// 13. Delete confirmation i18n keys exist and are localized correctly
const faI18n = workerSrc.match(/fa:\s*\{([\s\S]*?)\},\s*en:/);
const enI18n = workerSrc.match(/en:\s*\{([\s\S]*?)\n\s*\}\s*\};/);
check("fa pack extractable", !!faI18n);
check("en pack extractable", !!enI18n);
const faBlock = faI18n ? faI18n[1] : "";
const enBlock = enI18n ? enI18n[1] : "";

// 14. Delete-callback assertions have been removed. The dashboard no
//     longer exposes a "Delete" button — generating a new email is the
//     only way to rotate an address, and that path already archives the
//     old token and clears the old inbox. See the case "delete" removal
//     in handleCallbackQuery.

// 15. Help feature i18n keys (FA/EN)
check("fa: btnHelp present", faBlock.includes("btnHelp: \"ℹ️ راهنما\""));
check("fa: btnClose present", faBlock.includes("btnClose: \"❌ بستن\""));
check("fa: helpTitle present", faBlock.includes("helpTitle: \"ℹ️ <b>راهنمای استفاده از ربات</b>\""));
check("fa: helpIntro present", faBlock.includes("helpIntro:"));
check("fa: helpTemp present", faBlock.includes("helpTemp:"));
check("fa: helpHowSection present", faBlock.includes("helpHowSection:"));
check("fa: helpBtnGenerate present", faBlock.includes("helpBtnGenerate:"));
check("fa: helpBtnInbox present", faBlock.includes("helpBtnInbox:"));
check("fa: helpBtnRefresh present", faBlock.includes("helpBtnRefresh:"));
check("fa: helpBtnRestore present", faBlock.includes("helpBtnRestore:"));
check("fa: helpBtnLang present", faBlock.includes("helpBtnLang:"));
check("fa: helpTokenSection present", faBlock.includes("helpTokenSection:"));
check("fa: helpTokenExplained present", faBlock.includes("helpTokenExplained:"));
check("fa: helpTip present", faBlock.includes("helpTip:"));
check("en: btnHelp present", enBlock.includes("btnHelp: \"ℹ️ Help\""));
check("en: btnClose present", enBlock.includes("btnClose: \"❌ Close\""));
check("en: helpTitle present", enBlock.includes("helpTitle: \"ℹ️ <b>How to use this bot</b>\""));
check("en: helpIntro present", enBlock.includes("helpIntro:"));
check("en: helpTemp present", enBlock.includes("helpTemp:"));
check("en: helpHowSection present", enBlock.includes("helpHowSection:"));
check("en: helpBtnGenerate present", enBlock.includes("helpBtnGenerate:"));
check("en: helpBtnInbox present", enBlock.includes("helpBtnInbox:"));
check("en: helpBtnRefresh present", enBlock.includes("helpBtnRefresh:"));
check("en: helpBtnRestore present", enBlock.includes("helpBtnRestore:"));
check("en: helpBtnLang present", enBlock.includes("helpBtnLang:"));
check("en: helpTokenSection present", enBlock.includes("helpTokenSection:"));
check("en: helpTokenExplained present", enBlock.includes("helpTokenExplained:"));
check("en: helpTip present", enBlock.includes("helpTip:"));

// 16. Help wiring (button + callbacks + helper)
check("help button in dashboard keyboard", workerSrc.includes('text: t.btnHelp, callback_data: "help"'));
check("help callback case exists", workerSrc.includes('case "help":'));
check("close_help callback case exists", workerSrc.includes('case "close_help":'));
check("sendLocalizedGuide helper defined", workerSrc.includes("async function sendLocalizedGuide"));
check("deleteTelegramMessage helper defined", workerSrc.includes("async function deleteTelegramMessage"));
check("help callback calls sendLocalizedGuide", workerSrc.match(/case "help":\s*\{[\s\S]*?await sendLocalizedGuide/));
check("close_help calls deleteTelegramMessage", workerSrc.match(/case "close_help":\s*\{[\s\S]*?await deleteTelegramMessage/));

// 17. Help-text logical consistency: emails are restorable at any time
//     (the helpTemp/helpTokenExplained must NOT claim the email is only valid while in use,
//     and MUST mention restore-at-any-time / token never expires).
const helpTempFaMatch = faBlock.match(/helpTemp:\s*"([^"]+)"/);
const helpTempEnMatch = enBlock.match(/helpTemp:\s*"([^"]+)"/);
const helpTokenFaMatch = faBlock.match(/helpTokenExplained:\s*"([\s\S]+?)",\s*helpTip/);
const helpTokenEnMatch = enBlock.match(/helpTokenExplained:\s*"([\s\S]+?)",\s*helpTip/);

const helpTempFa = helpTempFaMatch ? helpTempFaMatch[1] : "";
const helpTempEn = helpTempEnMatch ? helpTempEnMatch[1] : "";
const helpTokenFa = helpTokenFaMatch ? helpTokenFaMatch[1] : "";
const helpTokenEn = helpTokenEnMatch ? helpTokenEnMatch[1] : "";

check("fa: helpTemp extracted", helpTempFa.length > 0);
check("en: helpTemp extracted", helpTempEn.length > 0);
check("fa: helpTokenExplained extracted", helpTokenFa.length > 0);
check("en: helpTokenExplained extracted", helpTokenEn.length > 0);

check("fa: helpTemp no longer says 'only while you use it'", !helpTempFa.includes("فقط برای مدتی که"));
check("en: helpTemp no longer says 'only as long as you keep using it'", !helpTempEn.includes("only as long as you keep using it"));

check("fa: helpTemp mentions restore / any time", /بازگردانی|هر زمان/.test(helpTempFa));
check("en: helpTemp mentions restore / any time", /restore|any time/.test(helpTempEn));
check("fa: helpTokenExplained mentions no expiry", /تاریخ انقضا/.test(helpTokenFa));
check("en: helpTokenExplained mentions never expires", /never expires/.test(helpTokenEn));

// 17b. The recovery token help must mention the 50-token per-chat limit
//     so users understand how many old emails they can restore.
check("fa: helpTokenExplained mentions the 50-token limit", /۵۰/.test(helpTokenFa));
check("en: helpTokenExplained mentions the 50-token limit", /50/.test(helpTokenEn));
check("fa: helpTokenExplained mentions archiving older tokens",
  /حذف می‌شود|آرشیو/.test(helpTokenFa));
check("en: helpTokenExplained mentions archiving older tokens",
  /deleted|oldest|limit/i.test(helpTokenEn));

// 18. Debug logging in email() handler
check("[email-in] entry log line present", workerSrc.includes("console.log(`[email-in] to="));
check("[email-in] binding log line present", workerSrc.includes("console.log(`[email-in] binding="));
check("[email-in] otp log line present", workerSrc.includes("otp="));
check("[email-in] notified log line present", workerSrc.includes("console.log(`[email-in] notified chatId="));
check("[email-in] outer error log line present", workerSrc.includes("[email-in] outer error"));

// 19. lastResortExtract helper
check("lastResortExtract defined", typeof mod.lastResortExtract === "function");
check("lastResortExtract empty input", mod.lastResortExtract("") === "");
check("lastResortExtract null input", mod.lastResortExtract(null) === "");
check("lastResortExtract strips <style>", !/<style/i.test(mod.lastResortExtract("<style>color:red</style><p>Hello</p>")));
check("lastResortExtract keeps text after <style>", /Hello/.test(mod.lastResortExtract("<style>color:red</style><p>Hello</p>")));
check("lastResortExtract strips <script>", !/alert/.test(mod.lastResortExtract("<script>alert(1)</script><p>Body</p>")));
check("lastResortExtract keeps text after <script>", /Body/.test(mod.lastResortExtract("<script>alert(1)</script><p>Body</p>")));
check("lastResortExtract decodes &amp;", mod.lastResortExtract("Tom &amp; Jerry").includes("Tom & Jerry"));
check("lastResortExtract decodes &nbsp;", /a b/.test(mod.lastResortExtract("a&nbsp;b")));

// 20. lastResortExtract + parseEmailBody safety net on a tricky OpenAI-style HTML
//     (a <style>-laden <div> with the verification code inside; the main pipeline
//     may strip it via stripCssBlocks, so the safety net should rescue the text).
const trickyHtml = [
  "<html><head><style>",
  "div { color: #222; font-family: Arial; }",
  "code { font-size: 24px; letter-spacing: 4px; }",
  "</style></head><body>",
  "<div style=\"background:#fff;\">",
  "<p>Your OpenAI verification code is:</p>",
  "<div style=\"font-size:24px;letter-spacing:4px;\"><b>987654</b></div>",
  "</div>",
  "</body></html>"
].join("\n");
const trickyRaw = "From: no-reply@openai.com\r\nTo: u@x.com\r\nSubject: Verify\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n" + trickyHtml;
const trickyParsed = mod.parseEmailBody(trickyRaw);
console.log("tricky openai-html parsed:", JSON.stringify(trickyParsed.text));
check("tricky openai: parsed text not empty", trickyParsed.text.length > 0 && trickyParsed.text !== "(no content)");
check("tricky openai: verification code 987654 preserved", trickyParsed.text.includes("987654"));

// 21. lastResortExtract works on totally raw input (no MIME headers)
const bareHtml = "<html><body><div>Your code: <b>123456</b></div></body></html>";
const bareRaw = "From: a@b.com\r\nTo: c@d.com\r\nSubject: x\r\nContent-Type: text/html\r\n\r\n" + bareHtml;
const bareParsed = mod.parseEmailBody(bareRaw);
check("bare html: code preserved", bareParsed.text.includes("123456"));
check("bare html: label preserved", bareParsed.text.includes("Your code"));

// 22. Aparat-style multipart/alternative with quoted-printable encoding
//     (regression for the "garbled preview / truncated link" bug).
const aparatHtml =
  "<html><body>" +
  "<p>Hi there,</p>" +
  "<p>Click to confirm: <a href=3D\"https://www.aparat.com/auth/confirm?email=3Duser%40example.com&token=3Dabc123def&hash=3D9f8e7d6c5b4a3210&redirect=3Dhttps%3A%2F%2Fwww.aparat.com%2Fdashboard\">Verify</a></p>" +
  "<p>Asset URL: <a href=3D\"https://www.aparat.com/assets/web/ui/style.css\">CSS</a></p>" +
  "<p>Social: <a href=3D\"https://instagram.com/aparat\">IG</a></p>" +
  "</body></html>";
const aparatBoundary = "----=_NextPart_aparat_2026";
const aparatRaw =
  "From: no-reply@aparat.com\r\n" +
  "To: u@x.com\r\n" +
  "Subject: =?utf-8?Q?Confirm?=\r\n" +
  "MIME-Version: 1.0\r\n" +
  "Content-Type: multipart/alternative; boundary=\"" + aparatBoundary + "\"\r\n" +
  "\r\n" +
  "--" + aparatBoundary + "\r\n" +
  "Content-Type: text/plain; charset=\"utf-8\"\r\n" +
  "Content-Transfer-Encoding: quoted-printable\r\n" +
  "\r\n" +
  "Hi there,\r\n" +
  "Confirm: https://www.aparat.com/auth/confirm?token=3Dabc123def\r\n" +
  "\r\n" +
  "--" + aparatBoundary + "\r\n" +
  "Content-Type: text/html; charset=\"utf-8\"\r\n" +
  "Content-Transfer-Encoding: quoted-printable\r\n" +
  "\r\n" +
  aparatHtml + "\r\n" +
  "\r\n" +
  "--" + aparatBoundary + "--\r\n";
const aparatParsed = mod.parseEmailBody(aparatRaw);
console.log("aparat parsed:", JSON.stringify(aparatParsed.text.substring(0, 200)));
console.log("aparat links:", aparatParsed.links);
check("aparat: no QP artifact in text", !aparatParsed.text.includes("=3D") && !aparatParsed.text.includes("=20"));
check("aparat: no SMTP headers in text", !aparatParsed.text.includes("MIME-Version") && !aparatParsed.text.includes("Received:"));
check("aparat: full activation link present",
  aparatParsed.links.some(l => l.includes("aparat.com/auth/confirm") && l.includes("token=abc123def") && l.includes("hash=9f8e7d6c5b4a3210")));
check("aparat: asset CSS link filtered out",
  !aparatParsed.links.some(l => l.includes("/assets/web/ui")));
check("aparat: instagram social link filtered out",
  !aparatParsed.links.some(l => l.includes("instagram.com")));

// 18. Mini App entry points: dashboard web_app button + menu-button route.
//     /start renders the dashboard (handleMessage has no command parsing),
//     so the dashboard button IS the /start button.
check("miniapp: exact URL constant", mod.MINI_APP_URL === "https://twenyonerrf.ir/app/");
check("miniapp: fa btnMiniApp present", faBlock.includes("btnMiniApp: \"📱 ورود به مینی‌اپ\""));
check("miniapp: en btnMiniApp present", enBlock.includes("btnMiniApp: \"📱 Open Mini App\""));
check("miniapp: web_app button in dashboard keyboard",
  workerSrc.includes("text: t.btnMiniApp, web_app: { url: MINI_APP_URL }"));
const dashFa = mod.getDashboardPayload({ email: "u@twenyonerrf.ir", createdAt: "c", recoveryToken: "tmp_aaaa11" }, "fa");
const dashEn = mod.getDashboardPayload(null, "en");
// Row 0 pairs the Web App entry with Generate so the Mini App button
// renders as a normal side-by-side button, not a stretched full-width row.
const row0Fa = dashFa.keyboard.inline_keyboard[0];
const row0En = dashEn.keyboard.inline_keyboard[0];
const miniFa = row0Fa && row0Fa[0];
const miniEn = row0En && row0En[0];
check("miniapp: dashboard first row pairs web_app button with generate (fa, with email)",
  Array.isArray(row0Fa) && row0Fa.length === 2 &&
  miniFa && miniFa.web_app && miniFa.web_app.url === "https://twenyonerrf.ir/app/" &&
  miniFa.text === mod.i18n.fa.btnMiniApp && !("callback_data" in miniFa) &&
  row0Fa[1] && row0Fa[1].callback_data === "generate");
check("miniapp: dashboard first row pairs web_app button with generate (en, no email)",
  Array.isArray(row0En) && row0En.length === 2 &&
  miniEn && miniEn.web_app && miniEn.web_app.url === "https://twenyonerrf.ir/app/" &&
  miniEn.text === mod.i18n.en.btnMiniApp &&
  row0En[1] && row0En[1].callback_data === "generate");
check("miniapp: Mini App URL unchanged by pairing",
  JSON.stringify(dashFa.keyboard).includes('"url":"https://twenyonerrf.ir/app/"'));
check("miniapp: old buttons still present after insert",
  JSON.stringify(dashFa.keyboard).includes('"callback_data":"generate"') &&
  JSON.stringify(dashFa.keyboard).includes('"callback_data":"inbox"') &&
  JSON.stringify(dashFa.keyboard).includes('"callback_data":"help"'));
check("miniapp: set-menu-button route exists", workerSrc.includes('url.pathname === "/set-menu-button"'));
check("miniapp: menu button uses setChatMenuButton web_app",
  workerSrc.includes("setChatMenuButton") && workerSrc.includes('type: "web_app"') &&
  workerSrc.includes("web_app: { url: MINI_APP_URL }"));

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
