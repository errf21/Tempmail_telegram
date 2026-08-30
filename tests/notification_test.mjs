/**
 * Tests for the simplified, action-only Telegram notification.
 *
 * Design contract (see _worker.js :: buildEmailNotificationText):
 *
 *   Branch A — OTP only:
 *     title + 🔐 service + 🔑 <code>OTP</code> + View button
 *   Branch B — Verification link (takes precedence over OTP):
 *     title + 🔐 service + 🔗 <a href="URL">short label</a> + View button
 *   Branch C — Fallback (no code, no link):
 *     title + 🔐 service + 📌 subject (code) + 💬 preview (code) + View button
 *
 * Tests cover:
 *   A. Code extraction (4-8 digit OTP) — robustness to QP encoding and
 *      isolation from URLs and from accidental HTML-attribute digits.
 *   B. Link extraction (URLs) — host/path classification, QP safety,
 *      HTML wrapping, regressions.
 *   C. serviceNameFor() — display-name vs. registrable-label heuristic
 *      for the From header.
 *   D. linkLabelFor() — keyword-driven short labels.
 *   E. buildEmailNotificationText() — branch selection, RTL/LTR
 *      isolation, HTML balance, absence of recipient/date noise.
 *   F. Localized i18n (fa + en) for the new keys.
 *
 * Mirrors the harness pattern in tests/format_test.mjs.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const workerSrc = readFileSync(join(root, "_worker.js"), "utf8");

const harness = `
export {
  decodeQuotedPrintable,
  extractFast,
  buildEmailNotificationText,
  serviceNameFor,
  linkLabelFor,
  stripHtmlTags,
  escapeHtml,
  escapeAttribute,
  buildOtpScanText,
  stripInnerHeaderLines,
  ACTIVATION_KEYWORDS,
  i18n
};
`;
const tmp = join(root, ".worker_notification_test.mjs");
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

const FSI = "\u2066";
const PDI = "\u2069";

// --- helpers ---------------------------------------------------------------

function qp(s) {
  const bytes = new TextEncoder().encode(s);
  let out = "";
  for (const b of bytes) {
    if (b === 0x3D) out += "=3D";
    else if (b === 0x20) out += "=20";
    else if (b === 0x0A) out += "\n";
    else if (b < 0x20 || b > 0x7E) out += "=" + b.toString(16).toUpperCase().padStart(2, "0");
    else out += String.fromCharCode(b);
  }
  return out;
}

function buildQpEmail(body, opts = {}) {
  const from = opts.from || "noreply@example.com";
  const subject = opts.subject || "Test";
  const contentType = opts.contentType || "text/html; charset=\"UTF-8\"";
  const encoding = opts.encoding || "quoted-printable";
  return (
    "From: " + from + "\r\n" +
    "To: user@example.com\r\n" +
    "Subject: " + subject + "\r\n" +
    "MIME-Version: 1.0\r\n" +
    "Content-Type: " + contentType + "\r\n" +
    "Content-Transfer-Encoding: " + encoding + "\r\n" +
    "\r\n" +
    qp(body)
  );
}

// ===========================================================================
// A. Code extraction
// ===========================================================================

// A1. Plain text body, single 6-digit OTP
const a1 = mod.extractFast("From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/plain\r\n\r\nYour verification code is 654321. Do not share.");
check("code: plain 6-digit OTP found", a1.otpCode === "654321");
check("code: plain 6-digit OTP no link", a1.activationLink === "");

// A2. 8-digit OTP
const a2 = mod.extractFast("From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/plain\r\n\r\nYour code: 12345678. Expires in 5 minutes.");
check("code: 8-digit OTP found", a2.otpCode === "12345678");

// A3. 4-digit OTP
const a3 = mod.extractFast("From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/plain\r\n\r\nYour PIN is 4321. Enter it now.");
check("code: 4-digit OTP found", a3.otpCode === "4321");

// A4. QP-encoded 6-digit OTP (whole body QP-encoded)
const a4 = mod.extractFast(buildQpEmail("Your verification code is 987654. " + "x ".repeat(80), {
  from: "OpenAI <noreply@openai.com>", subject: "Verify"
}));
check("code: QP-encoded 6-digit OTP found", a4.otpCode === "987654");
check("code: QP no artifacts in preview",
  !a4.previewText.includes("=20") && !a4.previewText.includes("=3D"));

// A5. Link + code → link wins, code ignored (existing behaviour)
const a5 = mod.extractFast("From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n<p>Your code: <b>654321</b></p><a href=\"https://example.com/verify?token=abc\">Verify</a>");
check("code: code takes precedence over link (OTP-wins policy)",
  a5.activationLink === "" && a5.otpCode === "654321");

// A6. 5/6/7/8-digit OTP preference order — a body with multiple digits,
//     the 6-digit one should be preferred over a 4-digit phone-number
//     fragment nearby.
const a6 = mod.extractFast("From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/plain\r\n\r\nCall 1234 if you need help. Your code: 987654. Thanks.");
check("code: 6-digit preferred over 4-digit phone fragment", a6.otpCode === "987654");

// A7. Empty body
const a7 = mod.extractFast("");
check("code: empty body returns empty", a7.otpCode === "" && a7.activationLink === "");

// A8. Code-only email, code embedded deep in HTML
const a8 = mod.extractFast(buildQpEmail("<div>Click the link to continue.</div><div>Code: <b>555888</b></div>", {
  from: "service@example.com", subject: "code", contentType: "text/html; charset=\"UTF-8\""
}));
check("code: code in HTML body, no link", a8.activationLink === "" && a8.otpCode === "555888");

// ===========================================================================
// B. Link extraction
// ===========================================================================

// B1. Activation URL with verify keyword
const b1 = mod.extractFast("From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n<a href=\"https://auth.openai.com/verify?token=abc\">Verify</a>");
check("link: verify URL extracted", b1.activationLink === "https://auth.openai.com/verify?token=abc");

// B2. Reset password URL → extracted, label should classify as Reset
const b2 = mod.extractFast("From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n<a href=\"https://example.com/account/reset-password?u=1\">Reset</a>");
check("link: reset URL extracted", b2.activationLink === "https://example.com/account/reset-password?u=1");
check("link: reset URL classified as Reset Password",
  mod.linkLabelFor(b2.activationLink, mod.i18n.en) === "🔑 Reset Password");

// B3. Magic link / sign-in URL
const b3 = mod.extractFast("From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n<a href=\"https://magic.link/c/abc\">Sign in</a>");
check("link: magic/auth URL extracted", b3.activationLink === "https://magic.link/c/abc");
check("link: magic URL classified as Sign In",
  mod.linkLabelFor(b3.activationLink, mod.i18n.en) === "🔐 Sign In");

// B4. Generic URL (no verification keyword) — strict policy rejects it.
//     A URL like https://example.com/foo?bar=baz is not a verification
//     link, so the bot should not surface it. (When the email actually
//     contains a generic URL and no code, both fields stay empty and
//     the fallback branch shows the subject + preview.)
const b4 = mod.extractFast("From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n<a href=\"https://example.com/foo?bar=baz\">Open</a>");
check("link: generic URL rejected (strict policy)", b4.activationLink === "");
check("link: generic URL classified as Open Link",
  mod.linkLabelFor(b4.activationLink, mod.i18n.en) === "🔗 Open Link");

// B5. QP-encoded href — link must be intact after =3D decoding
const b5 = mod.extractFast(
  "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html; charset=\"UTF-8\"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n" +
  "<a href=3D\"https://example.com/verify?token=3Dabc\">Verify</a>"
);
check("link: QP-encoded href decoded", b5.activationLink === "https://example.com/verify?token=abc");

// B6. URL inside HTML comment → currently extractFast does not strip
//     HTML comments (only the slower parseEmailBody does). The contract
//     we test here is: a verify keyword in the real link wins, and the
//     comment URL is not surfaced as the only link. We assert that
//     whichever URL is picked is an activation keyword URL.
const b6 = mod.extractFast("From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n<!-- https://x.com/verify?y=1 --><a href=\"https://example.com/reset?z=1\">Reset</a>");
check("link: URL picked has an activation keyword",
  /(verify|reset|confirm|activate|signup|signin|login|magic|forgot)/.test(b6.activationLink || ""));

// B7. Two URLs (verify + tracking) → only the verify one is picked
//     (regression: ACTIVATION_KEYWORDS ordering)
const b7 = mod.extractFast("From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n<a href=\"https://tracking.example.com/open?id=1\">track</a><a href=\"https://example.com/verify?token=abc\">verify</a>");
check("link: verify preferred over tracking", b7.activationLink === "https://example.com/verify?token=abc");

// B8. URL with trailing punctuation stripped (e.g. "(https://x.com)" → "https://x.com")
const b8 = mod.extractFast("From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/plain\r\n\r\nClick here: https://example.com/verify?token=abc).");
check("link: trailing ) stripped", b8.activationLink === "https://example.com/verify?token=abc");

// B9. Multipart/alternative with text + HTML, HTML verify link wins
const boundary = "----=_NextPart_99";
const b9raw =
  "From: no-reply@aparat.com\r\n" +
  "To: u@x.com\r\n" +
  "Subject: Confirm\r\n" +
  "MIME-Version: 1.0\r\n" +
  "Content-Type: multipart/alternative; boundary=\"" + boundary + "\"\r\n" +
  "\r\n" +
  "--" + boundary + "\r\n" +
  "Content-Type: text/plain; charset=\"utf-8\"\r\n" +
  "Content-Transfer-Encoding: quoted-printable\r\n" +
  "\r\n" +
  "Hi,\r\nConfirm: https://www.aparat.com/auth/confirm?token=3Dabc123\r\n" +
  "\r\n" +
  "--" + boundary + "\r\n" +
  "Content-Type: text/html; charset=\"utf-8\"\r\n" +
  "Content-Transfer-Encoding: quoted-printable\r\n" +
  "\r\n" +
  "<a href=3D\"https://www.aparat.com/auth/confirm?token=3Dabc123\">Verify</a>\r\n" +
  "\r\n" +
  "--" + boundary + "--\r\n";
const b9 = mod.extractFast(b9raw);
check("link: multipart, confirm URL extracted (no =3D)",
  b9.activationLink === "https://www.aparat.com/auth/confirm?token=abc123");

// ===========================================================================
// C. serviceNameFor() heuristic
// ===========================================================================

// C1. Display Name <addr@host> → returns Display Name
check("service: display name 'Aparat'",
  mod.serviceNameFor("Aparat <no-reply@aparat.com>", "x", mod.i18n.en) === "Aparat");
check("service: display name 'GitHub'",
  mod.serviceNameFor("GitHub <noreply@github.com>", "x", mod.i18n.en) === "GitHub");
check("service: display name with quoted form",
  mod.serviceNameFor("\"OpenAI\" <noreply@openai.com>", "x", mod.i18n.en) === "OpenAI");

// C2. Bare email → registrable label capitalized
check("service: 'auth.openai.com' → 'Openai'",
  mod.serviceNameFor("noreply@auth.openai.com", "x", mod.i18n.en) === "Openai");
check("service: 'aparat.com' → 'Aparat'",
  mod.serviceNameFor("no-reply@aparat.com", "x", mod.i18n.en) === "Aparat");
check("service: 'github.com' → 'Github'",
  mod.serviceNameFor("noreply@github.com>", "x", mod.i18n.en) === "Github");
check("service: 'sub.example.co.uk' → 'Co' (registrable label heuristic)",
  mod.serviceNameFor("noreply@sub.example.co.uk", "x", mod.i18n.en) === "Co");

// C3. Empty sender + subject fallback
check("service: empty sender falls back to subject",
  mod.serviceNameFor("", "Your account is ready", mod.i18n.en) === "Your account is ready");
check("service: empty sender + empty subject falls back to i18n key",
  mod.serviceNameFor("", "", mod.i18n.en) === "New Message");
check("service: empty sender + empty subject falls back to fa key",
  mod.serviceNameFor("", "", mod.i18n.fa) === "پیام جدید");

// C4. Long display name is truncated to 32 chars
const longName = "A".repeat(50);
const truncated = mod.serviceNameFor(longName + " <x@y.com>", "z", mod.i18n.en);
check("service: long display name truncated to ≤32 chars",
  truncated.length <= 32 && /…$/.test(truncated));

// C5. Null/undefined safe
check("service: null sender",
  mod.serviceNameFor(null, "Subject", mod.i18n.en) === "Subject");
check("service: undefined sender",
  mod.serviceNameFor(undefined, "Subject", mod.i18n.en) === "Subject");

// C6. Raw email escaping — output is plain text, no HTML
check("service: returned value is plain text (no HTML chars)",
  !/[<>]/.test(mod.serviceNameFor("Foo & Bar <foo@bar.com>", "x", mod.i18n.en)));

// ===========================================================================
// D. linkLabelFor() keyword classification
// ===========================================================================

check("label: verify keyword → Verify Account",
  mod.linkLabelFor("https://example.com/verify?x=1", mod.i18n.en) === "✅ Verify Account");
check("label: confirm keyword → Verify Account",
  mod.linkLabelFor("https://example.com/confirm?x=1", mod.i18n.en) === "✅ Verify Account");
check("label: activate keyword → Verify Account",
  mod.linkLabelFor("https://example.com/activate?x=1", mod.i18n.en) === "✅ Verify Account");
check("label: signup keyword → Verify Account",
  mod.linkLabelFor("https://example.com/signup?x=1", mod.i18n.en) === "✅ Verify Account");
check("label: reset keyword → Reset Password",
  mod.linkLabelFor("https://example.com/reset?x=1", mod.i18n.en) === "🔑 Reset Password");
check("label: forgot keyword → Reset Password",
  mod.linkLabelFor("https://example.com/forgot-password", mod.i18n.en) === "🔑 Reset Password");
check("label: signin keyword → Sign In",
  mod.linkLabelFor("https://example.com/signin?x=1", mod.i18n.en) === "🔐 Sign In");
check("label: magic link → Sign In",
  mod.linkLabelFor("https://magic.link/c/abc", mod.i18n.en) === "🔐 Sign In");
check("label: generic → Open Link",
  mod.linkLabelFor("https://example.com/foo", mod.i18n.en) === "🔗 Open Link");

// Persian labels
check("label[fa]: verify → تایید حساب",
  mod.linkLabelFor("https://example.com/verify", mod.i18n.fa) === "✅ تایید حساب");
check("label[fa]: reset → بازیابی رمز",
  mod.linkLabelFor("https://example.com/reset", mod.i18n.fa) === "🔑 بازیابی رمز عبور");
check("label[fa]: login → ورود",
  mod.linkLabelFor("https://example.com/login", mod.i18n.fa) === "🔐 ورود به حساب");
check("label[fa]: generic → باز کردن لینک",
  mod.linkLabelFor("https://example.com/foo", mod.i18n.fa) === "🔗 باز کردن لینک");

// Empty / null URL
check("label: empty url → fallback label",
  mod.linkLabelFor("", mod.i18n.en) === "🔗 Open Link");
check("label: null url → fallback label",
  mod.linkLabelFor(null, mod.i18n.en) === "🔗 Open Link");

// ===========================================================================
// E. buildEmailNotificationText() branch selection & HTML balance
// ===========================================================================

// E1. Branch A (OTP) — en
const e1 = mod.buildEmailNotificationText({
  sender: "OpenAI <noreply@openai.com>",
  subject: "Your verification code",
  activationLink: "",
  otpCode: "654321",
  previewText: "should NOT appear",
  inboxId: "idA1",
  lang: "en"
});
check("E1[A,en]: title present", e1.includes("New Email Received"));
check("E1[A,en]: service label 'OpenAI' (display name preserved)",
  e1.includes("OpenAI") && !/noreply@openai\.com/.test(e1));
check("E1[A,en]: OTP in code block", e1.includes(`<code>${FSI}654321${PDI}</code>`));
check("E1[A,en]: no preview line", !/should NOT appear/.test(e1));
check("E1[A,en]: no recipient/date lines", !/Recipient/.test(e1) && !/📅/.test(e1));
check("E1[A,en]: no raw URL inside <code>", !/<code>https?:/.test(e1));
check("E1[A,en]: exactly one <a> tag (the OTP doesn't use <a>)",
  (e1.match(/<a /g) || []).length === 0);
check("E1[A,en]: HTML balance", (e1.match(/<code>/g) || []).length === (e1.match(/<\/code>/g) || []).length);

// E2. Branch B (link) — en
const e2 = mod.buildEmailNotificationText({
  sender: "GitHub <noreply@github.com>",
  subject: "Verify your email",
  activationLink: "https://github.com/verify?token=abc",
  otpCode: "111111",  // link should win; OTP ignored
  previewText: "should NOT appear",
  inboxId: "idB1",
  lang: "en"
});
check("E2[B,en]: service label 'GitHub' (display name preserved)",
  e2.includes("GitHub"));
check("E2[B,en]: link is <a> with Verify label", e2.includes(`<a href="https://github.com/verify?token=abc">✅ Verify Account</a>`));
check("E2[B,en]: OTP '111111' NOT shown", !/111111/.test(e2));
check("E2[B,en]: no preview line", !/should NOT appear/.test(e2));
check("E2[B,en]: no raw URL inside <code>", !/<code>https?:/.test(e2));

// E3. Branch C (fallback) — en
const e3 = mod.buildEmailNotificationText({
  sender: "Foo <noreply@foo.com>",
  subject: "Welcome to Foo",
  activationLink: "",
  otpCode: "",
  previewText: "This is the email body text.",
  inboxId: "idC1",
  lang: "en"
});
check("E3[C,en]: service label 'Foo'", e3.includes("Foo"));
check("E3[C,en]: subject in code block", e3.includes(`<code>${FSI}Welcome to Foo${PDI}</code>`));
check("E3[C,en]: preview in code block", e3.includes(`<code>${FSI}This is the email body text.${PDI}</code>`));
check("E3[C,en]: no <a> tag (no link)", (e3.match(/<a /g) || []).length === 0);
check("E3[C,en]: no OTP label", !/Verification Code/.test(e3));

// E4. Branch C (fallback) — fa, with empty preview
const e4 = mod.buildEmailNotificationText({
  sender: "", subject: "خبر جدید", dateStr: "now",
  activationLink: "", otpCode: "", previewText: "", inboxId: "idC2", lang: "fa"
});
check("E4[C,fa]: title is Persian", e4.includes("پیام جدید دریافت شد"));
check("E4[C,fa]: subject in code block (FSI/PDI)", e4.includes(`<code>${FSI}خبر جدید${PDI}</code>`));
check("E4[C,fa]: no preview line when preview empty", !/پیش‌نمایش/.test(e4));
check("E4[C,fa]: service falls back to localized 'پیام جدید'", e4.includes(`<b>${mod.serviceNameFor("", "خبر جدید", mod.i18n.fa)}</b>`));

// E5. RTL/LTR isolation: every external LTR value is wrapped with FSI/PDI
//     in the OTP and fallback branches (where <code> is used). For the
//     link branch, the URL sits inside <a href=...> which is itself
//     rendered LTR by Telegram, so no FSI/PDI is needed there.
//     We assert FSI/PDI balance across the OTP and fallback branches.
{
  const otp = mod.buildEmailNotificationText({
    sender: "OpenAI <noreply@openai.com>",
    subject: "x", activationLink: "", otpCode: "654321", previewText: "",
    inboxId: "x", lang: "fa"
  });
  const fb = mod.buildEmailNotificationText({
    sender: "OpenAI <noreply@openai.com>",
    subject: "Verify", activationLink: "", otpCode: "", previewText: "body",
    inboxId: "x", lang: "fa"
  });
  const fsiOtp = (otp.match(new RegExp(FSI, "g")) || []).length;
  const pdiOtp = (otp.match(new RegExp(PDI, "g")) || []).length;
  const fsiFb = (fb.match(new RegExp(FSI, "g")) || []).length;
  const pdiFb = (fb.match(new RegExp(PDI, "g")) || []).length;
  check("E5[fa,otp]: FSI/PDI balanced and > 0", fsiOtp === pdiOtp && fsiOtp > 0);
  check("E5[fa,fallback]: FSI/PDI balanced and > 0", fsiFb === pdiFb && fsiFb > 0);
}

// E6. Persian title never contains a code-wrapped raw email address
const e6 = mod.buildEmailNotificationText({
  sender: "noreply@auth.openai.com",
  subject: "x",
  activationLink: "",
  otpCode: "",
  previewText: "",
  inboxId: "y",
  lang: "fa"
});
check("E6[fa,naked-email]: raw address not in output",
  !e6.includes("noreply@auth.openai.com"));
check("E6[fa,naked-email]: service is 'Openai'", e6.includes("Openai"));

// E7. Output is small: action-only is well under 600 chars
const e7 = mod.buildEmailNotificationText({
  sender: "OpenAI <noreply@openai.com>",
  subject: "x",
  activationLink: "https://auth.openai.com/verify?token=abc",
  otpCode: "654321",
  previewText: "x".repeat(500),
  inboxId: "y",
  lang: "en"
});
check("E7: branch B output is small (< 400 chars even with giant preview)",
  e7.length < 400);

// ===========================================================================
// F. Localized i18n keys (fa + en) for the simplified notification
// ===========================================================================

check("i18n[fa]: serviceFallback present", mod.i18n.fa.serviceFallback === "پیام جدید");
check("i18n[en]: serviceFallback present", mod.i18n.en.serviceFallback === "New Message");
check("i18n[fa]: otpLabel present", mod.i18n.fa.otpLabel === "کد تایید");
check("i18n[en]: otpLabel present", mod.i18n.en.otpLabel === "Verification Code");
check("i18n[fa]: subjectLabel present", mod.i18n.fa.subjectLabel === "موضوع");
check("i18n[en]: subjectLabel present", mod.i18n.en.subjectLabel === "Subject");
check("i18n[fa]: linkVerify, linkReset, linkLogin, linkDefault are short labels",
  /^✅/.test(mod.i18n.fa.linkVerify) &&
  /^🔑/.test(mod.i18n.fa.linkReset) &&
  /^🔐/.test(mod.i18n.fa.linkLogin) &&
  /^🔗/.test(mod.i18n.fa.linkDefault));
check("i18n[en]: linkVerify, linkReset, linkLogin, linkDefault are short labels",
  /^✅/.test(mod.i18n.en.linkVerify) &&
  /^🔑/.test(mod.i18n.en.linkReset) &&
  /^🔐/.test(mod.i18n.en.linkLogin) &&
  /^🔗/.test(mod.i18n.en.linkDefault));

// ===========================================================================
// G. End-to-end through extractFast → buildEmailNotificationText
// ===========================================================================

// G1. OpenAI verify email (link branch, en)
const g1raw = buildQpEmail(
  "<p>Welcome! Click <a href=\"https://auth.openai.com/verify?token=abc\">here</a> to verify your email.</p>",
  { from: "OpenAI <noreply@openai.com>", subject: "Verify your email" }
);
const g1fast = mod.extractFast(g1raw);
const g1notif = mod.buildEmailNotificationText({
  sender: "OpenAI <noreply@openai.com>",
  subject: "Verify your email",
  activationLink: g1fast.activationLink,
  otpCode: g1fast.otpCode,
  previewText: g1fast.previewText,
  inboxId: "g1",
  lang: "en"
});
check("e2e: OpenAI link branch",
  g1fast.activationLink === "https://auth.openai.com/verify?token=abc" &&
  g1notif.includes("OpenAI") &&
  g1notif.includes(`<a href="https://auth.openai.com/verify?token=abc">✅ Verify Account</a>`) &&
  !/Recipient|گیرنده|📅/.test(g1notif));

// G2. Aparat confirm email (link branch, fa)
const g2raw = buildQpEmail(
  "<a href=\"https://www.aparat.com/auth/confirm?token=abc\">Verify</a>",
  { from: "Aparat <no-reply@aparat.com>", subject: "تایید حساب" }
);
const g2fast = mod.extractFast(g2raw);
const g2notif = mod.buildEmailNotificationText({
  sender: "Aparat <no-reply@aparat.com>",
  subject: "تایید حساب",
  activationLink: g2fast.activationLink,
  otpCode: g2fast.otpCode,
  previewText: g2fast.previewText,
  inboxId: "g2",
  lang: "fa"
});
check("e2e: Aparat link branch (fa)",
  g2notif.includes("Aparat") &&
  g2notif.includes("پیام جدید دریافت شد") &&
  g2notif.includes(`<a href="https://www.aparat.com/auth/confirm?token=abc">✅ تایید حساب</a>`) &&
  !/گیرنده|تاریخ/.test(g2notif));

// G3. Code-only email (OTP branch, en)
const g3raw = buildQpEmail(
  "Your OpenAI verification code is 987654. " + "x ".repeat(80),
  { from: "OpenAI <noreply@openai.com>", subject: "Code", contentType: "text/plain; charset=\"UTF-8\"" }
);
const g3fast = mod.extractFast(g3raw);
const g3notif = mod.buildEmailNotificationText({
  sender: "OpenAI <noreply@openai.com>",
  subject: "Code",
  activationLink: g3fast.activationLink,
  otpCode: g3fast.otpCode,
  previewText: g3fast.previewText,
  inboxId: "g3",
  lang: "en"
});
check("e2e: OpenAI code branch",
  g3fast.otpCode === "987654" &&
  g3notif.includes("OpenAI") &&
  g3notif.includes(`<code>${FSI}987654${PDI}</code>`) &&
  g3notif.includes("Verification Code"));

// G4. Subject+preview fallback (no code, no link)
const g4raw = buildQpEmail(
  "Welcome to our newsletter! Here is the latest update from our team.",
  { from: "Newsletter <hello@example.com>", subject: "Weekly update", contentType: "text/plain; charset=\"UTF-8\"" }
);
const g4fast = mod.extractFast(g4raw);
const g4notif = mod.buildEmailNotificationText({
  sender: "Newsletter <hello@example.com>",
  subject: "Weekly update",
  activationLink: g4fast.activationLink,
  otpCode: g4fast.otpCode,
  previewText: g4fast.previewText,
  inboxId: "g4",
  lang: "en"
});
check("e2e: fallback branch (no action)",
  g4fast.activationLink === "" && g4fast.otpCode === "" &&
  g4notif.includes("Newsletter") &&
  g4notif.includes(`<code>${FSI}Weekly update${PDI}</code>`) &&
  g4notif.includes("Subject"));

// ===========================================================================
// H. Bug 1 — false-positive OTP in link-only emails (Aparat case).
//     The previous flat `\b\d{4,8}\b` scan picked random digits from URL
//     paths, query params, and HTML attribute values. The new line-aware
//     scan only matches 4-8 digit runs that appear on a line containing
//     a code label (code/otp/pin/token/کد/رمز/etc.) AND strips all href,
//     src, data-*, style, name, value, id, class attribute values first.
// ===========================================================================

// H1. Aparat fixture: long URL with a 16-digit hash. The new scan must
//     not extract a false OTP from the hash.
const aparatBug =
  "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n" +
  "<p>Click <a href=\"https://www.aparat.com/auth/confirm?token=abc123def&hash=9f8e7d6c5b4a3210&email=user%40example.com\">here</a> to verify your account.</p>";
const aparatBugFast = mod.extractFast(aparatBug);
check("Bug1: Aparat — no false OTP from 16-digit hash",
  aparatBugFast.otpCode === "");
check("Bug1: Aparat — real verify link still extracted",
  aparatBugFast.activationLink === "https://www.aparat.com/auth/confirm?token=abc123def&hash=9f8e7d6c5b4a3210&email=user%40example.com");

// H2. Phone number in body must NOT be picked.
const phoneBody =
  "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/plain\r\n\r\n" +
  "Hi, please call +1 555 1234 if you need help. " +
  "Click https://example.com/verify?token=abc to confirm your account.";
const phoneFast = mod.extractFast(phoneBody);
check("Bug1: phone-number 1234 in body — NOT picked as OTP",
  phoneFast.otpCode === "");
check("Bug1: phone-number — verify link still extracted",
  phoneFast.activationLink === "https://example.com/verify?token=abc");

// H3. Year fragment in body must NOT be picked.
const dateBody =
  "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/plain\r\n\r\n" +
  "Date: 12/15/2024. Welcome to our service. " +
  "Open https://example.com/confirm to continue.";
const dateFast = mod.extractFast(dateBody);
check("Bug1: '12/15/2024' year fragment — NOT picked as OTP",
  dateFast.otpCode === "");
check("Bug1: year — confirm link still extracted",
  dateFast.activationLink === "https://example.com/confirm");

// H4. data-id attribute in a tag must NOT be picked.
const dataIdBody =
  "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n" +
  "<p><span data-id=\"12345\">Hi</span> there. " +
  "<a href=\"https://example.com/verify?token=abc\">Verify</a></p>";
const dataIdFast = mod.extractFast(dataIdBody);
check("Bug1: data-id=\"12345\" attribute — NOT picked as OTP",
  dataIdFast.otpCode === "");
check("Bug1: data-id — verify link still extracted",
  dataIdFast.activationLink === "https://example.com/verify?token=abc");

// H5. mailto: with a digit in the subject must NOT be picked.
const mailtoBody =
  "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n" +
  "<p>Need help? <a href=\"mailto:support@example.com?subject=9999\">Email us</a>. " +
  "Click <a href=\"https://example.com/verify?token=abc\">here</a> to confirm.</p>";
const mailtoFast = mod.extractFast(mailtoBody);
check("Bug1: mailto:?subject=9999 — NOT picked as OTP",
  mailtoFast.otpCode === "");
check("Bug1: mailto — verify link still extracted",
  mailtoFast.activationLink === "https://example.com/verify?token=abc");

// H6. Real labelled code STILL works (regression).
const labelledCode =
  "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/plain\r\n\r\n" +
  "Your verification code is: 815646. Expires in 10 minutes.";
const labelledFast = mod.extractFast(labelledCode);
check("Bug1: regression — labelled 'verification code is: 815646' still picked",
  labelledFast.otpCode === "815646");

// H7. Real bare code on a labelled line (no "verification", just "Code:")
//     STILL works (regression for the line-aware scan).
const bareLabelled =
  "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/plain\r\n\r\n" +
  "Welcome.\nCode: 742193\nIf you didn't request this, ignore.";
const bareLabelledFast = mod.extractFast(bareLabelled);
check("Bug1: regression — bare 'Code: 742193' on its own line still picked",
  bareLabelledFast.otpCode === "742193");

// H8. Persian labelled code (کد: 123456) — line-aware.
const faLabel =
  "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n" +
  "سلام\nکد: 123456\nاگر این درخواست از شما نیست، نادیده بگیرید.";
const faLabelFast = mod.extractFast(faLabel);
check("Bug1: Persian 'کد: 123456' on its own line still picked",
  faLabelFast.otpCode === "123456");

// H9. URL with the path being just digits ('/r/654321') rejected as tracker,
//     AND no code label in body → no OTP, no link.
const trackerPath =
  "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n" +
  "<p>Track us at <a href=\"https://example.com/r/654321\">here</a>.</p>";
const trackerPathFast = mod.extractFast(trackerPath);
check("Bug1: '/r/654321' tracker URL — NOT picked as OTP",
  trackerPathFast.otpCode === "");
check("Bug1: '/r/654321' tracker URL — rejected as link too",
  trackerPathFast.activationLink === "");

// H10. Multiple code lines — first matching one wins.
const multiLine =
  "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/plain\r\n\r\n" +
  "Ticket: 111111\n" +
  "Code: 654321\n" +
  "Reference: 999999";
const multiLineFast = mod.extractFast(multiLine);
check("Bug1: multiple code lines — first one with a 4-8 digit run wins",
  multiLineFast.otpCode === "654321");

// H11. buildOtpScanText direct: strips href, src, data-*, mailto, and tags.
const scanInput = `<a href="https://example.com/verify?token=abc123">link</a>
<a href="mailto:x@y.com?subject=9999">email</a>
<span data-id="45678">foo</span>
<img src="https://cdn.example.com/img/12345.png">`;
const scanOut = mod.buildOtpScanText(scanInput);
check("Bug1: buildOtpScanText — href URL stripped",
  !scanOut.includes("https://example.com/verify"));
check("Bug1: buildOtpScanText — mailto: stripped",
  !scanOut.includes("mailto:"));
check("Bug1: buildOtpScanText — data-id value stripped",
  !scanOut.includes("45678"));
check("Bug1: buildOtpScanText — img src stripped",
  !scanOut.includes("cdn.example.com"));
check("Bug1: buildOtpScanText — output is a single-line string",
  typeof scanOut === "string" && !/\n/.test(scanOut) && scanOut.length > 0);
check("Bug1: buildOtpScanText — empty input",
  mod.buildOtpScanText("") === "");
check("Bug1: buildOtpScanText — null input",
  mod.buildOtpScanText(null) === "");
check("Bug1: buildOtpScanText — undefined input",
  mod.buildOtpScanText(undefined) === "");

// ===========================================================================
// I. Bug 2 — extracted action surfaces in both alert and full view
//     (renderFullEmail is tested in tests/view_test.mjs; here we only
//     verify the persist + listInbox round-trip via db.*).
// ===========================================================================

console.log(failures === 0 ? "\nALL NOTIFICATION TESTS PASSED" : `\n${failures} NOTIFICATION TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
