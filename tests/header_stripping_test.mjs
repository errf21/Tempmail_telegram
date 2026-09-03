/**
 * Tests for the strict MIME / SMTP header stripping + OTP-over-link
 * priority + strict verification-URL classifier.
 *
 * Three bug classes this file locks down:
 *
 *   1. Raw header dumping. Real senders (Cloudflare, Gmail, Exchange,
 *      Mailgun, SES, Mimecast, Proofpoint, Barracuda, Cisco) emit
 *      X-CF-*, X-Gm-*, X-MS-Exchange-*, X-Mailgun-*, X-SES-*,
 *      X-Proofpoint-*, X-Barracuda-*, X-CMAE-*, X-Mimecast-*,
 *      Authentication-Results-Original, X-Originating-IP, X-PM-*
 *      headers. The previous closed allowlist missed them and they
 *      leaked into the "Read full email" body.
 *
 *   2. OTP vs link priority. The spec says "if an email contains a
 *      verification code, the bot must surface ONLY the OTP block". The
 *      previous code let any URL with a "verify" or "token" substring
 *      win over a labelled code — including tracking pixels.
 *
 *   3. URL false-positives. The previous keyword-overlap check
 *      (lower.includes(k)) was too permissive and picked up tracking
 *      URLs (t.co, /r/, /redirect, ?tracking_token=...) as if they
 *      were activation links.
 *
 * Harness mirrors tests/format_test.mjs and tests/notification_test.mjs.
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
  parseEmailBody,
  buildEmailNotificationText,
  serviceNameFor,
  linkLabelFor,
  stripHtmlTags,
  escapeHtml,
  escapeAttribute,
  stripInnerHeaderLines,
  lastResortExtract,
  cleanText,
  isStrictVerificationUrl,
  LABELLED_OTP_REGEX,
  ACTIVATION_KEYWORDS,
  MIME_HEADER_NAMES,
  i18n
};
`;
const tmp = join(root, ".worker_header_stripping_test.mjs");
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
// 1. MIME_HEADER_NAMES is comprehensive
// ===========================================================================

const NAMES = mod.MIME_HEADER_NAMES;
check("header-list: includes Received", NAMES.includes("Received"));
check("header-list: includes DKIM-Signature", NAMES.includes("DKIM-Signature"));
check("header-list: includes ARC-Seal", NAMES.includes("ARC-Seal"));
check("header-list: includes X-CF-SpamH-Score", NAMES.includes("X-CF-SpamH-Score"));
check("header-list: includes X-Gm-Message-State", NAMES.includes("X-Gm-Message-State"));
check("header-list: includes X-MS-Exchange-Organization-SCL", NAMES.includes("X-MS-Exchange-Organization-SCL"));
check("header-list: includes X-Mailgun-Sid", NAMES.includes("X-Mailgun-Sid"));
check("header-list: includes X-SES-Configuration-Set", NAMES.includes("X-SES-Configuration-Set"));
check("header-list: includes X-Proofpoint-Spam-Details", NAMES.includes("X-Proofpoint-Spam-Details"));
check("header-list: includes X-Barracuda-Spam-Score", NAMES.includes("X-Barracuda-Spam-Score"));
check("header-list: includes X-Mimecast-Spam-Score", NAMES.includes("X-Mimecast-Spam-Score"));
check("header-list: includes X-CMAE-Analysis", NAMES.includes("X-CMAE-Analysis"));
check("header-list: includes X-CF-SpamH-Result", NAMES.includes("X-CF-SpamH-Result"));
check("header-list: includes X-CF-SpamH-Rule", NAMES.includes("X-CF-SpamH-Rule"));
check("header-list: includes Authentication-Results-Original", NAMES.includes("Authentication-Results-Original"));
check("header-list: includes X-Originating-IP", NAMES.includes("X-Originating-IP"));
check("header-list: includes X-Source-IP", NAMES.includes("X-Source-IP"));
check("header-list: includes X-PM-Message-Id", NAMES.includes("X-PM-Message-Id"));
check("header-list: at least 60 names (regression: list shrinking)", NAMES.length >= 60);

// ===========================================================================
// 2. stripInnerHeaderLines — direct unit tests for every reported header
// ===========================================================================

// 2a) Each header, individually, dropped from a body.
const ONE_HEADERS = [
  "Received: from v5106.v5375b7fa.example.com (v5106.v5375b7fa.example.com [192.0.2.1])",
  "ARC-Seal: i=1; a=rsa-sha256; t=1693300000; cv=none; d=openai.com",
  "DKIM-Signature: v=1; a=rsa-sha256; d=openai.com; s=selector1",
  "X-CF-SpamH-Score: -0.1",
  "X-CF-SpamH-Result: ham",
  "X-CF-SpamH-Rule: 1",
  "X-Gm-Message-State: AOabc123",
  "X-Google-DKIM-Signature: v=1; a=rsa-sha256",
  "X-MS-Exchange-Organization-SCL: -1",
  "X-MS-Has-Attach: yes",
  "X-MS-TNEF-Correlator: abc",
  "X-Exchange-Antispam-Report: CIP:1.2.3.4",
  "X-Facebook-Notify: 1",
  "Authentication-Results: mx; dkim=pass",
  "Authentication-Results-Original: mx; dkim=pass",
  "X-Mailgun-Sid: WyI123abc=",
  "X-Mailgun-Variables: {}",
  "X-Mailgun-Tag: welcome",
  "X-SES-Configuration-Set: my-set",
  "X-SES-Outgoing: 2026.123",
  "X-Proofpoint-Spam-Details: rule=def",
  "X-Proofpoint-Virus-Version: 1.2.3",
  "X-Barracuda-Spam-Score: 0.5",
  "X-Barracuda-Spam-Status: no",
  "X-Mimecast-Spam-Score: 0.1",
  "X-Mimecast-Signature: abc",
  "X-Originating-IP: [192.0.2.1]",
  "X-Source-IP: 192.0.2.1",
  "X-Source-Sender: test",
  "X-PM-Message-Id: 12345",
  "X-PM-Signature: xyz",
  "X-CMAE-Analysis: clean",
  "X-CM-Header-Analysis: clean",
  "X-CM-Transcript-ID: abc",
  "X-Google-Smtp-Source: abc",
  "X-Mailgun-Sscore: 1.0",
  "X-Original-To: user@yourdomain.com",
  "X-Original-Message-ID: <abc@example.com>",
  "X-Feedback-ID: abc:def",
  "X-Source-Args: /bin/foo",
  "X-Source-Dir: /home/x",
  "List-Id: foo",
  "List-Unsubscribe: <mailto:u@x>",
  "Return-Path: <bounce@x.com>",
  "Thread-Topic: Hi",
  "X-Received: from x"
];

ONE_HEADERS.forEach((header, idx) => {
  const body = header + "\r\n" + "Hi! Your OpenAI verification code is: 987654.";
  const stripped = mod.stripInnerHeaderLines(body);
  check(`strip: drops "${header.split(":")[0]}" (case #${idx + 1})`,
    !stripped.includes(header.split(":")[0] + ":"));
});

check("strip: known header dropped, body kept",
  mod.stripInnerHeaderLines("X-CF-SpamH-Score: -0.1\r\nHello world").includes("Hello world"));

// 2b) X-* unknown future header is also dropped (the future-proof rule)
check("strip: unknown X-Future-Header: dropped",
  !mod.stripInnerHeaderLines("X-Future-Header: foo\r\nHello").includes("X-Future-Header"));
check("strip: unknown X-Provider-2027-Token: dropped",
  !mod.stripInnerHeaderLines("X-Provider-2027-Token: abc\r\nBody").includes("X-Provider-2027-Token"));

// 2c) Body text that happens to contain a colon is NOT touched
check("strip: body line with colon preserved",
  mod.stripInnerHeaderLines("Hello: world").includes("Hello: world"));
check("strip: code-style label in body preserved",
  mod.stripInnerHeaderLines("Time: 12:34 PM").includes("Time: 12:34 PM"));

// 2d) Folded header (RFC 5322 §2.2.3) — the second line must also go
const folded = "X-CF-SpamH-Score: -0.1\r\n\tvery long value that wraps\r\nHello world";
const foldedOut = mod.stripInnerHeaderLines(folded);
check("strip: folded X-* header — first line gone", !/X-CF-SpamH-Score/.test(foldedOut));
check("strip: folded X-* header — continuation line gone", !/very long value that wraps/.test(foldedOut));
check("strip: folded X-* header — body preserved", foldedOut.includes("Hello world"));

// 2e) Long DKIM-Signature (>500 chars, base64) — must still be dropped
const longDkim = "DKIM-Signature: v=1; a=rsa-sha256; bh=" + "A".repeat(1500) + "; b=" + "B".repeat(600) + ";";
const longOut = mod.stripInnerHeaderLines(longDkim + "\r\nBody text");
check("strip: long DKIM-Signature (1.5 KB base64) dropped", !/DKIM-Signature:/.test(longOut));
check("strip: long DKIM-Signature — body preserved", longOut.includes("Body text"));

// 2f) Mixed headers + body + a colon-containing body line, all in one blob
const mixed =
  "Received: from x\r\n" +
  "X-CF-SpamH-Score: 0.1\r\n" +
  "X-Gm-Message-State: AOabc\r\n" +
  "\r\n" +
  "Hello there. Your code is 654321. Time: 12:34 PM.\r\n" +
  "Visit https://example.com/verify?token=abc to confirm.\r\n";
const mixedOut = mod.stripInnerHeaderLines(mixed);
check("strip: mixed — no Received", !/Received:/.test(mixedOut));
check("strip: mixed — no X-CF-", !/X-CF-SpamH-Score/.test(mixedOut));
check("strip: mixed — no X-Gm-", !/X-Gm-Message-State/.test(mixedOut));
check("strip: mixed — body kept", mixedOut.includes("Hello there"));
check("strip: mixed — code kept", mixedOut.includes("654321"));
check("strip: mixed — colon body line kept", mixedOut.includes("Time: 12:34 PM"));
check("strip: mixed — link kept", mixedOut.includes("https://example.com/verify?token=abc"));

// 2g) Empty / null / non-string safe
check("strip: empty string", mod.stripInnerHeaderLines("") === "");
check("strip: null", mod.stripInnerHeaderLines(null) === "");
check("strip: undefined", mod.stripInnerHeaderLines(undefined) === undefined || mod.stripInnerHeaderLines(undefined) === "");

// ===========================================================================
// 3. extractFast — no headers in preview
// ===========================================================================

// 3a) OpenAI-style email with all the new headers
const openAiBoundary = "----=_NextPart_openai_2026_08_29";
const openAiRaw =
  "Received: from v5106.v5375b7fa.example.com ([192.0.2.1])\r\n" +
  "ARC-Seal: i=1; a=rsa-sha256; t=1693300000; cv=none; d=openai.com\r\n" +
  "DKIM-Signature: v=1; a=rsa-sha256; d=openai.com; s=selector1\r\n" +
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

const fast = mod.extractFast(openAiRaw);
check("extractFast: no 'Received:' in preview", !/Received:/.test(fast.previewText));
check("extractFast: no 'ARC-Seal:' in preview", !/ARC-Seal:/.test(fast.previewText));
check("extractFast: no 'DKIM-Signature:' in preview", !/DKIM-Signature:/.test(fast.previewText));
check("extractFast: no 'X-CF-SpamH-Score:' in preview", !/X-CF-SpamH-Score/.test(fast.previewText));
check("extractFast: no 'X-CF-SpamH-Result:' in preview", !/X-CF-SpamH-Result/.test(fast.previewText));
check("extractFast: no 'X-Gm-Message-State:' in preview", !/X-Gm-Message-State/.test(fast.previewText));
check("extractFast: no 'X-MS-Exchange-Organization-SCL:' in preview", !/X-MS-Exchange-Organization-SCL/.test(fast.previewText));
check("extractFast: no 'X-Mailgun-Sid:' in preview", !/X-Mailgun-Sid/.test(fast.previewText));
check("extractFast: no 'X-SES-Configuration-Set:' in preview", !/X-SES-Configuration-Set/.test(fast.previewText));
check("extractFast: no 'X-Proofpoint-Spam-Details:' in preview", !/X-Proofpoint-Spam-Details/.test(fast.previewText));
check("extractFast: no 'X-Barracuda-Spam-Score:' in preview", !/X-Barracuda-Spam-Score/.test(fast.previewText));
check("extractFast: no 'X-Mimecast-Spam-Score:' in preview", !/X-Mimecast-Spam-Score/.test(fast.previewText));
check("extractFast: no 'Authentication-Results-Original:' in preview", !/Authentication-Results-Original/.test(fast.previewText));
check("extractFast: no 'X-Originating-IP:' in preview", !/X-Originating-IP/.test(fast.previewText));
check("extractFast: no 'X-PM-Message-Id:' in preview", !/X-PM-Message-Id/.test(fast.previewText));
check("extractFast: no 'X-CMAE-Analysis:' in preview", !/X-CMAE-Analysis/.test(fast.previewText));
check("extractFast: contains the code '987654' in preview", fast.previewText.includes("987654"));
check("extractFast: otpCode is '987654'", fast.otpCode === "987654");
check("extractFast: no link picked (OTP wins)", fast.activationLink === "");

// 3b) Per-part header leak: a malformed multipart where the second part
//     starts with a Content-Type: line. extractFast must drop it.
const malBoundary = "----=_Part_001";
const malRaw =
  "From: x@y\r\nTo: u@v\r\nSubject: s\r\nMIME-Version: 1.0\r\n" +
  "Content-Type: multipart/alternative; boundary=\"" + malBoundary + "\"\r\n" +
  "\r\n" +
  "--" + malBoundary + "\r\n" +
  "Content-Type: text/plain; charset=\"UTF-8\"\r\n" +
  "Content-Transfer-Encoding: quoted-printable\r\n" +
  "\r\n" +
  "Your code is 555888.\r\n" +
  "\r\n" +
  "--" + malBoundary + "\r\n" +
  "Content-Type: text/html; charset=\"UTF-8\"\r\n" +
  "Content-Transfer-Encoding: quoted-printable\r\n" +
  "\r\n" +
  "<p>Your code is <b>555888</b></p>\r\n" +
  "\r\n" +
  "--" + malBoundary + "--\r\n";
const malFast = mod.extractFast(malRaw);
check("extractFast: no 'Content-Type:' leak in preview", !/Content-Type:/.test(malFast.previewText));
check("extractFast: no 'Content-Transfer-Encoding:' leak in preview", !/Content-Transfer-Encoding:/.test(malFast.previewText));
check("extractFast: code 555888 found in malformed multipart", malFast.otpCode === "555888");

// ===========================================================================
// 4. parseEmailBody — no headers in text
// ===========================================================================

const full1 = mod.parseEmailBody(openAiRaw);
check("parseEmailBody: text does not start with 'Received:'", !full1.text.startsWith("Received:"));
check("parseEmailBody: no 'ARC-Seal:' in text", !/ARC-Seal:/.test(full1.text));
check("parseEmailBody: no 'DKIM-Signature:' in text", !/DKIM-Signature:/.test(full1.text));
check("parseEmailBody: no 'X-CF-SpamH-Score:' in text", !/X-CF-SpamH-Score/.test(full1.text));
check("parseEmailBody: no 'X-Gm-Message-State:' in text", !/X-Gm-Message-State/.test(full1.text));
check("parseEmailBody: no 'X-MS-Exchange-Organization-SCL:' in text", !/X-MS-Exchange-Organization-SCL/.test(full1.text));
check("parseEmailBody: no 'X-Mailgun-Sid:' in text", !/X-Mailgun-Sid/.test(full1.text));
check("parseEmailBody: no 'X-SES-Configuration-Set:' in text", !/X-SES-Configuration-Set/.test(full1.text));
check("parseEmailBody: contains the OTP code 987654", full1.text.includes("987654"));

// 4b) Body with a stray SMTP header line (some senders put headers
//     before the multipart preamble). parseEmailBody should drop them.
const stray =
  "From: x@y\r\nTo: u@v\r\nSubject: s\r\nMIME-Version: 1.0\r\n" +
  "Content-Type: text/html; charset=\"UTF-8\"\r\n" +
  "\r\n" +
  "X-CF-SpamH-Score: 0.5\r\n" +
  "X-Gm-Message-State: AOabc\r\n" +
  "<html><body>Your code: <b>777111</b></body></html>";
const strayFull = mod.parseEmailBody(stray);
check("parseEmailBody: stray X-CF-SpamH-Score dropped", !/X-CF-SpamH-Score/.test(strayFull.text));
check("parseEmailBody: stray X-Gm-Message-State dropped", !/X-Gm-Message-State/.test(strayFull.text));
check("parseEmailBody: code 777111 preserved", strayFull.text.includes("777111"));

// ===========================================================================
// 5. cleanText and lastResortExtract — final safety nets
// ===========================================================================

// 5a) cleanText with a body that has a leaked header line in the middle.
//     This is the fix for Bug 2: cleanText now calls stripInnerHeaderLines
//     so even if parseEmailBody missed it, the user never sees it.
const cleanInput = "Hello world.\r\n" +
  "X-CF-SpamH-Score: 0.1\r\n" +
  "X-Gm-Message-State: AOabc\r\n" +
  "Your code is 333555.";
const cleanOut = mod.cleanText(cleanInput);
check("cleanText: X-CF-SpamH-Score dropped", !/X-CF-SpamH-Score/.test(cleanOut));
check("cleanText: X-Gm-Message-State dropped", !/X-Gm-Message-State/.test(cleanOut));
check("cleanText: body kept", cleanOut.includes("Hello world"));
check("cleanText: code kept", cleanOut.includes("333555"));

// 5b) lastResortExtract also drops headers (Bug 2's fix in the safety net)
const lrInput = "<html><head><style>body{color:red}</style></head>" +
  "<body><p>Hello</p>" +
  "X-CF-SpamH-Score: 0.1\r\n" +
  "X-Mailgun-Sid: abc\r\n" +
  "<p>Code: <b>444222</b></p></body></html>";
const lrOut = mod.lastResortExtract(lrInput);
check("lastResortExtract: X-CF-SpamH-Score dropped", !/X-CF-SpamH-Score/.test(lrOut));
check("lastResortExtract: X-Mailgun-Sid dropped", !/X-Mailgun-Sid/.test(lrOut));
check("lastResortExtract: 'Hello' preserved", lrOut.includes("Hello"));
check("lastResortExtract: code 444222 preserved", lrOut.includes("444222"));

// ===========================================================================
// 6. OTP-over-link priority
// ===========================================================================

// 6a) Labelled code + verify URL → OTP wins, link ignored.
const codeAndLink =
  "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n" +
  "<p>Your verification code is <b>815646</b>. " +
  "If you didn't request this, visit https://example.com/verify?token=abc.</p>";
const codeAndLinkFast = mod.extractFast(codeAndLink);
check("priority: labelled code wins", codeAndLinkFast.otpCode === "815646");
check("priority: verify link ALSO extracted alongside code (Stage 2 both-shown)",
  codeAndLinkFast.activationLink === "https://example.com/verify?token=abc");

// 6b) Persian-labelled code + verify URL → OTP wins.
const codeAndLinkFa =
  "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n" +
  "<p>کد تایید: <b>815646</b>. " +
  "اگر این درخواست از شما نیست، به https://example.com/verify?token=abc مراجعه کنید.</p>";
const codeAndLinkFaFast = mod.extractFast(codeAndLinkFa);
check("priority[fa]: labelled code wins", codeAndLinkFaFast.otpCode === "815646");
check("priority[fa]: verify link ALSO extracted (Stage 2 both-shown)",
  codeAndLinkFaFast.activationLink === "https://example.com/verify?token=abc");

// 6c) Code + tracking URL → OTP wins, tracker rejected.
const codeAndTracker =
  "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n" +
  "<p>Your code: <b>123456</b>. Read more at https://t.co/abc.</p>";
const codeAndTrackerFast = mod.extractFast(codeAndTracker);
check("priority: code wins over t.co", codeAndTrackerFast.otpCode === "123456");
check("priority: t.co link rejected", codeAndTrackerFast.activationLink === "");

// 6d) Code only, no link → OTP only, no link.
const codeOnly =
  "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/plain\r\n\r\n" +
  "Your verification code is 987654. Expires in 10 minutes. " + "x ".repeat(50);
const codeOnlyFast = mod.extractFast(codeOnly);
check("priority: code-only — otpCode set", codeOnlyFast.otpCode === "987654");
check("priority: code-only — no link", codeOnlyFast.activationLink === "");

// 6e) Link only, no code → link only, no OTP.
const linkOnly =
  "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n" +
  "<p>Click <a href=\"https://example.com/verify?token=abc\">here</a> to confirm.</p>";
const linkOnlyFast = mod.extractFast(linkOnly);
check("priority: link-only — link set", linkOnlyFast.activationLink === "https://example.com/verify?token=abc");
check("priority: link-only — no OTP", linkOnlyFast.otpCode === "");

// 6f) Bare 6-digit number + verify URL → OTP only wins if the digit is
//     on a line that contains a code label (code/otp/pin/token/etc.).
//     "Order ID: 654321" has no such label, so by the new line-aware
//     policy the digit is NOT picked as an OTP and the link wins.
const bareAndLink =
  "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n" +
  "<p>Order ID: 654321. Click <a href=\"https://example.com/verify?token=abc\">here</a>.</p>";
const bareAndLinkFast = mod.extractFast(bareAndLink);
check("priority: unlabelled 'Order ID: 654321' — line-aware scan rejects it, link wins",
  bareAndLinkFast.activationLink === "https://example.com/verify?token=abc" &&
  bareAndLinkFast.otpCode === "");

// 6g) Same digits but on a labelled line ("Code: 654321") → OTP wins.
const labelledBare =
  "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n" +
  "<p>Order ID: 123456. Code: 654321. Click <a href=\"https://example.com/verify?token=abc\">here</a>.</p>";
const labelledBareFast = mod.extractFast(labelledBare);
check("priority: labelled 'Code: 654321' on the same line beats unlabelled 'Order ID: 123456'",
  labelledBareFast.otpCode === "654321" &&
  labelledBareFast.activationLink === "https://example.com/verify?token=abc");

// ===========================================================================
// 7. Strict URL classifier (isStrictVerificationUrl)
// ===========================================================================

check("url: verify path accepted",
  mod.isStrictVerificationUrl("https://example.com/verify?token=abc") === true);
check("url: confirm path accepted",
  mod.isStrictVerificationUrl("https://example.com/auth/confirm?email=x") === true);
check("url: activate path accepted",
  mod.isStrictVerificationUrl("https://example.com/account/activate?key=1") === true);
check("url: reset path accepted",
  mod.isStrictVerificationUrl("https://example.com/account/reset-password") === true);
check("url: magic path accepted",
  mod.isStrictVerificationUrl("https://magic.link/c/abc") === true);
check("url: aparat auth/confirm accepted",
  mod.isStrictVerificationUrl("https://www.aparat.com/auth/confirm?token=abc") === true);
check("url: ?token= query accepted",
  mod.isStrictVerificationUrl("https://example.com/foo?token=abc") === true);
check("url: ?code= query accepted",
  mod.isStrictVerificationUrl("https://example.com/foo?code=1234") === true);

check("url: t.co (tracker host) rejected",
  mod.isStrictVerificationUrl("https://t.co/abc") === false);
check("url: bit.ly (tracker host) rejected",
  mod.isStrictVerificationUrl("https://bit.ly/abc") === false);
check("url: /track path rejected",
  mod.isStrictVerificationUrl("https://example.com/track?uid=1") === false);
check("url: /click path rejected",
  mod.isStrictVerificationUrl("https://example.com/click?cid=1") === false);
check("url: /open path rejected",
  mod.isStrictVerificationUrl("https://example.com/open?id=1") === false);
check("url: /r/ path rejected",
  mod.isStrictVerificationUrl("https://example.com/r/abc") === false);
check("url: /redirect path rejected",
  mod.isStrictVerificationUrl("https://example.com/redirect?url=https://x.com") === false);
check("url: /pixel path rejected",
  mod.isStrictVerificationUrl("https://example.com/pixel?id=1") === false);
check("url: /unsubscribe path rejected",
  mod.isStrictVerificationUrl("https://example.com/unsubscribe?id=1") === false);
check("url: /assets/ path rejected",
  mod.isStrictVerificationUrl("https://example.com/assets/web/ui/style.css") === false);
check("url: tracker path with verify query still rejected",
  mod.isStrictVerificationUrl("https://example.com/track?token=abc") === false);

check("url: empty", mod.isStrictVerificationUrl("") === false);
check("url: null", mod.isStrictVerificationUrl(null) === false);
check("url: ftp protocol rejected",
  mod.isStrictVerificationUrl("ftp://example.com/verify?token=abc") === false);
check("url: garbage", mod.isStrictVerificationUrl("not-a-url") === false);

// 7a) extractFast uses the strict classifier
const trackerBody =
  "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n" +
  "<p>Newsletter. Track us: https://example.com/track?uid=1</p>";
const trackerFast = mod.extractFast(trackerBody);
check("extractFast: /track URL rejected (no link extracted)",
  trackerFast.activationLink === "");

const tcoBody =
  "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n" +
  "<p>Read more: https://t.co/abc</p>";
const tcoFast = mod.extractFast(tcoBody);
check("extractFast: t.co URL rejected (no link extracted)",
  tcoFast.activationLink === "");

// 7b) When there is ONLY a tracker URL and no code, both stay empty
//     (we don't fall back to "any URL" anymore — the spec says only
//     verification URLs count, and a tracker is not one).
const onlyTracker =
  "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n" +
  "<p>Read more: https://example.com/track?uid=1</p>";
const onlyTrackerFast = mod.extractFast(onlyTracker);
check("extractFast: only tracker, no fallback to any URL",
  onlyTrackerFast.activationLink === "" && onlyTrackerFast.otpCode === "");

// 7c) Aparat auth/confirm still extracted (regression for the real
//     verification path used in production)
const aparat =
  "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n" +
  "<a href=\"https://www.aparat.com/auth/confirm?token=abc123\">Verify</a>";
const aparatFast = mod.extractFast(aparat);
check("extractFast: Aparat auth/confirm still extracted",
  aparatFast.activationLink === "https://www.aparat.com/auth/confirm?token=abc123");

// ===========================================================================
// 8. LABELLED_OTP_REGEX sanity
// ===========================================================================

check("labelled: 'Your code is 123456'", mod.LABELLED_OTP_REGEX.test("Your code is 123456"));
check("labelled: 'verification code: 654321'", mod.LABELLED_OTP_REGEX.test("verification code: 654321"));
check("labelled: 'کد تایید 815646'", mod.LABELLED_OTP_REGEX.test("کد تایید 815646"));
check("labelled: 'کد: 123456'", mod.LABELLED_OTP_REGEX.test("کد: 123456"));
check("labelled: 'one-time code 555888'", mod.LABELLED_OTP_REGEX.test("one-time code 555888"));
check("labelled: 'رمز یکبار مصرف: 111222'",
  mod.LABELLED_OTP_REGEX.test("رمز یکبار مصرف: 111222"));
check("labelled: 'login OTP 999000'", mod.LABELLED_OTP_REGEX.test("login OTP 999000"));
check("labelled: NOT matched on bare '123456' (no label)",
  mod.LABELLED_OTP_REGEX.test("Your number is 123456") === false);
check("labelled: NOT matched on too-short '12'",
  mod.LABELLED_OTP_REGEX.test("code 12") === false);
check("labelled: NOT matched on too-long '1234567890'",
  mod.LABELLED_OTP_REGEX.test("code 1234567890") === false);

console.log(failures === 0 ? "\nALL HEADER-STRIPPING TESTS PASSED" : `\n${failures} HEADER-STRIPPING TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
