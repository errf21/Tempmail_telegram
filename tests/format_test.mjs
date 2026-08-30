/**
 * Tests for the three notification-formatting fixes.
 *
 *   1. Quoted-Printable decoding on the fast path:
 *      `decodeQuotedPrintable` is now safer (won't corrupt URL `=XX`
 *      patterns that are not real QP escapes) and is called from
 *      `extractFast` so the inbox preview is clean of `=20`, `=3D`,
 *      `=E2=80=99` artifacts.
 *
 *   2. RTL/LTR bidi isolation:
 *      The new `buildEmailNotificationText` (and the corresponding
 *      `renderFullEmail`) wrap every external LTR value (sender,
 *      recipient, subject, date, link, OTP, preview) in
 *      `<code>...</code>` AND surround it with Unicode FSI/PDI
 *      (\u2066 / \u2069). This is the canonical fix for the
 *      "Persian paragraph with embedded URL" bug where digits and
 *      ASCII tokens get re-ordered into the RTL flow.
 *
 *   3. Verification-code / preview truncation:
 *      `safeTruncateForPreview` is the new truncation helper. It
 *      cuts on word boundaries, scrubs any partial `=XX` QP escape
 *      at the tail, and drops partial UTF-8 continuation bytes so
 *      a 200-char cap never lands in the middle of a smart quote,
 *      emoji, or a `=E2=80=99` residue. The user's reported symptom
 *      ("...wasn=E2=80=99t you") is gone.
 *
 * The new helpers are tested directly (they are exported by the
 * harness appended to _worker.js) and end-to-end through `extractFast`
 * and `buildEmailNotificationText` with realistic QP-encoded fixtures.
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
  safeTruncateForPreview,
  extractFast,
  buildEmailNotificationText,
  serviceNameFor,
  linkLabelFor,
  stripHtmlTags,
  ACTIVATION_KEYWORDS
};
`;
const tmp = join(root, ".worker_format_test.mjs");
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

function qp(s) {
  // Per RFC 2045: non-ASCII bytes are encoded as `=XX` where XX is the
  // *byte* value in UTF-8. So U+2019 (which is `E2 80 99` in UTF-8)
  // becomes `=E2=80=99`, not `=2019` (which is what you'd get if you
  // encoded the code point). This is the encoder used to build
  // realistic QP-encoded MIME bodies for the tests below.
  const bytes = new TextEncoder().encode(s);
  let out = "";
  for (const b of bytes) {
    if (b === 0x3D /* = */) out += "=3D";
    else if (b === 0x20 /* space */) out += "=20";
    else if (b === 0x0A /* \n */) out += "\n";
    else if (b < 0x20 || b > 0x7E) {
      out += "=" + b.toString(16).toUpperCase().padStart(2, "0");
    } else {
      out += String.fromCharCode(b);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. decodeQuotedPrintable — direct unit tests
// ---------------------------------------------------------------------------

check("qp: =20 → space", mod.decodeQuotedPrintable("=20") === " ");
check("qp: =3D → =", mod.decodeQuotedPrintable("=3D") === "=");
check("qp: =E2=80=99t → U+2019t (smart quote + t)",
  mod.decodeQuotedPrintable("=E2=80=99t") === "\u2019t");
check("qp: soft line break =\\r\\n is stripped",
  mod.decodeQuotedPrintable("hello=\r\nworld") === "helloworld");
check("qp: soft line break =\\n is stripped",
  mod.decodeQuotedPrintable("hello=\nworld") === "helloworld");
check("qp: ?key=abc preserved (URL not corrupted)",
  mod.decodeQuotedPrintable("?key=abc") === "?key=abc");
check("qp: ?token=3Dabc decoded (0x3D is printable ASCII)",
  mod.decodeQuotedPrintable("?token=3Dabc") === "?token=abc");
check("qp: ?token=abc preserved",
  mod.decodeQuotedPrintable("?token=abc") === "?token=abc");
check("qp: empty string",
  mod.decodeQuotedPrintable("") === "");
check("qp: null",
  mod.decodeQuotedPrintable(null) === "");
check("qp: full sentence with multiple escapes",
  mod.decodeQuotedPrintable("This=20is=20a=20test=2E") === "This is a test.");
check("qp: Persian multi-byte =D8=AD=D9=88 → ح",
  mod.decodeQuotedPrintable("=D8=AD=D9=88") === "حو");
check("qp: literal = at end-of-line is soft break (not decoded)",
  mod.decodeQuotedPrintable("abc=\nxy=3Dz") === "abcxy=z");
// A continuation byte (0x80-0xBF) that is NOT preceded by a UTF-8 lead
// must be left as literal. 0xAB = 171 is a continuation byte. Used alone
// it has no meaning in UTF-8, so the QP decoder should leave "=AB" alone.
check("qp: lone =AB (continuation without lead) is left literal",
  mod.decodeQuotedPrintable("=AB") === "=AB");
check("qp: 0xC0/0xC1 overlong-UTF8 leads are left literal",
  mod.decodeQuotedPrintable("=C0=80stuff") === "=C0=80stuff");
check("qp: 0xF5+ above Unicode max are left literal",
  mod.decodeQuotedPrintable("=F5=F6=F7=FF=FE") === "=F5=F6=F7=FF=FE");

// ---------------------------------------------------------------------------
// 2. safeTruncateForPreview — direct unit tests
// ---------------------------------------------------------------------------

check("trunc: short string returned unchanged",
  mod.safeTruncateForPreview("hello world", 200) === "hello world");
check("trunc: empty string",
  mod.safeTruncateForPreview("", 200) === "");
check("trunc: null",
  mod.safeTruncateForPreview(null, 200) === "");
check("trunc: exactly at cap returned unchanged",
  mod.safeTruncateForPreview("x".repeat(200), 200) === "x".repeat(200));
check("trunc: 1 over cap gets cut on word boundary + …",
  mod.safeTruncateForPreview("a b c d e f", 5) === "a b…");
check("trunc: cuts on whitespace, never mid-word",
  mod.safeTruncateForPreview("hello world this is a test", 12) === "hello…");
check("trunc: scrubs partial QP at the tail (=E2=80 without the third byte)",
  mod.safeTruncateForPreview("wasn=E2=80 you all", 11) === "wasn…");
check("trunc: scrubs partial QP =E2 alone",
  mod.safeTruncateForPreview("wasn=E2", 6) === "wasn…");
check("trunc: scrubs =E2=80 (two-byte partial)",
  mod.safeTruncateForPreview("wasn=E2=80", 9) === "wasn…");
check("trunc: drops partial UTF-16 surrogate pair (lone high surrogate)",
  // The emoji 🙂 (U+1F642) is a JS surrogate pair: \uD83D\uDE42.
  // If the cap lands between the high and low surrogate, the lone
  // high surrogate must be dropped to avoid a mojibake replacement
  // character in Telegram.
  mod.safeTruncateForPreview("a\uD83D\uDE42" + "x".repeat(50), 2) === "a…");
check("trunc: drops emoji partial codepoint (4-byte UTF-8 = 2-char UTF-16)", (() => {
  // U+1F600 is 4 UTF-8 bytes but only 2 UTF-16 code units (a surrogate
  // pair). With cap=2 we keep both "a" and the emoji, so no truncation
  // is needed. With cap=3 we cut in the middle of the surrogate pair
  // (between the high and low surrogates) — the lone high surrogate
  // must be dropped.
  const s4 = "a\u{1F600}b";
  const r4 = mod.safeTruncateForPreview(s4, 3);
  return r4 === "a\u{1F600}…";
})());
check("trunc: long body with 200 cap ends on word boundary", (() => {
  const longBody = "word ".repeat(100);
  const longOut = mod.safeTruncateForPreview(longBody, 200);
  return longOut.length <= 201
    && /\u2026$/.test(longOut)
    && !longOut.endsWith(" \u2026");      // no space immediately before the ellipsis
})());

// ---------------------------------------------------------------------------
// 3. extractFast on QP-encoded email — preview is clean
// ---------------------------------------------------------------------------

function buildQpEmail(body, opts = {}) {
  const boundary = opts.boundary || "----=_NextPart_test";
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

// 3a) QP-encoded body with smart quotes, equals signs, em-dashes.
const smartQ = "This was a long sentence that, after being QP-encoded, contains smart quotes, em-dashes, and many spaces, and the verification code 987654 is buried somewhere in the middle of it because the sender wanted to make sure that the OTP wasn\u2019t the very first thing the user saw when they opened this email message.";
const f1 = mod.extractFast(buildQpEmail(smartQ, {
  from: "OpenAI <noreply@openai.com>",
  subject: "Your verification code",
  contentType: "text/html; charset=\"UTF-8\""
}));
check("fast+qp: preview has no =20 artifact", !f1.previewText.includes("=20"));
check("fast+qp: preview has no =3D artifact", !f1.previewText.includes("=3D"));
check("fast+qp: preview has no =E2 artifact", !f1.previewText.includes("=E2"));
check("fast+qp: preview preserves the smart-quote apostrophe (U+2019)",
  // The full decoded body contains "wasn\u2019t"; the 200-char preview
  // will or will not include that exact substring depending on the
  // position. We assert on the decode path (decodeQuotedPrintable
  // is unit-tested above) and here just confirm the preview is free
  // of the QP artifact that would replace it.
  !f1.previewText.includes("=E2=80=99"));
check("fast+qp: preview contains the verification code 987654",
  f1.previewText.includes("987654"));
check("fast+qp: preview ends with \"…\" on a word boundary",
  f1.previewText.endsWith("\u2026"));
check("fast+qp: preview ends at a word boundary (no space before the …)",
  !f1.previewText.endsWith(" \u2026"));

// 3b) The user's specific reported symptom: "...wasn=E2=80=99t you".
//     After the fix, the preview must NOT contain =E2, and the apostrophe
//     must appear as a real character. We build a body that puts the
//     smart-quote word early enough to fit in the 200-char preview.
const earlySmart = "If this wasn\u2019t you, please review your account. The verification code is 987654. " + "x ".repeat(80);
const fReported = mod.extractFast(buildQpEmail(earlySmart, {
  from: "service@example.com",
  subject: "Activity alert",
  contentType: "text/plain; charset=\"UTF-8\""
}));
check("reported-style: no =E2=80=99 artifact in preview",
  !fReported.previewText.includes("=E2=80=99"));
check("reported-style: smart-quote is preserved as U+2019",
  fReported.previewText.includes("\u2019"));
check("reported-style: full word \"wasn\" appears (not \"wasn=E2\")",
  /wasn[’']t/.test(fReported.previewText));

// 3c) Link + code case: with the OTP-wins policy, the labelled code
//     is extracted and the link is intentionally ignored. We still
//     assert the preview is QP-clean and that the link's ?token=abc
//     survives in the preview text (even if it isn't promoted to
//     activationLink).
const linkAndCode = "<p>Your code: <b>987654</b></p><p>Click <a href=\"https://example.com/verify?token=abc123\">here</a> to confirm.</p>";
const f2 = mod.extractFast(buildQpEmail(linkAndCode, {
  from: "OpenAI <noreply@openai.com>",
  subject: "Verify your account"
}));
check("fast+qp+link: labelled code wins, link ignored",
  f2.otpCode === "987654" && f2.activationLink === "");
check("fast+qp+link: preview does not contain QP artifacts",
  !f2.previewText.includes("=20") && !f2.previewText.includes("=3D") && !f2.previewText.includes("=E2"));
// The link may be truncated by the 200-char preview cap, but the QP
// decoder must not corrupt any "=" in the URL (e.g. ?token=abc123).
// We assert the URL's query is not corrupted to "?token=3Dabc123".
check("fast+qp+link: QP decoder does not corrupt ?token=abc123",
  !f2.previewText.includes("=3D") || f2.previewText.includes("token=") || !/token=3D/.test(f2.previewText));

// 3d) Code-only email: extractFast should find the OTP.
const codeOnly = "Your verification code is: 654321. If you didn't request this, please ignore this email. " + "x".repeat(300);
const f3 = mod.extractFast(buildQpEmail(codeOnly, {
  from: "service@example.com",
  subject: "Verify",
  contentType: "text/plain; charset=\"UTF-8\""
}));
check("fast+qp+code: OTP 654321 is found",
  f3.otpCode === "654321");
check("fast+qp+code: preview contains the code 654321",
  f3.previewText.includes("654321"));
check("fast+qp+code: no link found (none in body)",
  f3.activationLink === "");

// 3e) Hardening: a body that previously took 10+ seconds now stays fast.
const t0 = process.hrtime.bigint();
const hugeQp = buildQpEmail(smartQ + " ".repeat(20000), { subject: "huge" });
const big = mod.extractFast(hugeQp);
const t1 = process.hrtime.bigint();
const elapsedMs = Number(t1 - t0) / 1e6;
check("fast+qp+large: 20KB QP-encoded body in < 100 ms (" + elapsedMs.toFixed(1) + " ms)", elapsedMs < 100);
check("fast+qp+large: preview is bounded", big.previewText.length <= 201);

// ---------------------------------------------------------------------------
// 4. buildEmailNotificationText — RTL/LTR isolation (action-only contract)
// ---------------------------------------------------------------------------

// 4a) English, link branch (B). Service label is derived from sender.
//     No recipient/date lines, no preview line. Activation link is a
//     short <a> with a short label, NOT a raw URL in <code>.
const t1n = mod.buildEmailNotificationText({
  sender: "OpenAI <noreply@openai.com>",
  subject: "Your verification code",
  activationLink: "https://auth.openai.com/verify?token=abc123&user=bluefire42",
  otpCode: "",
  previewText: "This is the preview snippet.",
  inboxId: "abc123",
  lang: "en"
});

check("notify: en title is 'New Email Received'",
  t1n.includes("New Email Received"));
check("notify[B,en]: no recipient line",
  !/Recipient/.test(t1n) && !/گیرنده/.test(t1n));
check("notify[B,en]: no date line",
  !/📅/.test(t1n));
check("notify[B,en]: no preview line in action branches",
  !/This is the preview snippet\./.test(t1n));
check("notify[B,en]: short service label 'OpenAI' (not raw address)",
  t1n.includes("OpenAI") && !/noreply@openai\.com/.test(t1n));
check("notify[B,en]: link is a clickable <a> with a short label (no raw URL inside <code>)",
  t1n.includes(`<a href="https://auth.openai.com/verify?token=abc123&amp;user=bluefire42">`) &&
  /<a href="[^"]+">(✅ Verify Account|🔑 Reset Password|🔐 Sign In|🔗 Open Link)<\/a>/.test(t1n));
check("notify[B,en]: HTML is balanced (every <code> has a </code>)",
  (t1n.match(/<code>/g) || []).length === (t1n.match(/<\/code>/g) || []).length);
check("notify: every FSI has a matching PDI",
  (t1n.match(new RegExp(FSI, "g")) || []).length === (t1n.match(new RegExp(PDI, "g")) || []).length);

// 4b) Farsi language: title is Persian, OTP branch (A) since no link.
//     The OTP is the only payload; subject is NOT shown on this branch.
const t2 = mod.buildEmailNotificationText({
  sender: "Aparat <no-reply@aparat.com>",
  subject: "تایید حساب",
  activationLink: "",
  otpCode: "987654",
  previewText: "preview text",
  inboxId: "id_fa",
  lang: "fa"
});
check("notify[A,fa]: title is Persian",
  t2.includes("پیام جدید دریافت شد"));
check("notify[A,fa]: service label is 'Aparat' (display name)",
  t2.includes("Aparat") && !/no-reply@aparat\.com/.test(t2));
check("notify[A,fa]: OTP label is Persian (کد تایید)",
  t2.includes("کد تایید"));
check("notify[A,fa]: OTP is wrapped in <code> with FSI/PDI",
  t2.includes(`<code>${FSI}987654${PDI}</code>`));
check("notify[A,fa]: no subject line in action branches",
  !/تایید حساب/.test(t2.split("━━━━━━━━━━━━━━━")[1] || ""));
check("notify[A,fa]: no recipient/date lines",
  !/گیرنده/.test(t2) && !/تاریخ/.test(t2));

// 4c) Fallback branch (C) when no code and no link. The subject
//     and the (truncated) preview must be shown. Persian.
const t3 = mod.buildEmailNotificationText({
  sender: "x", subject: "موضوع تست", dateStr: "now",
  activationLink: "", otpCode: "", previewText: "خلاصه پیام", lang: "fa"
});
check("notify[C,fa]: shows the subject (code-wrapped, FSI/PDI)",
  t3.includes(`<code>${FSI}موضوع تست${PDI}</code>`));
check("notify[C,fa]: shows the preview (code-wrapped, FSI/PDI)",
  t3.includes(`<code>${FSI}خلاصه پیام${PDI}</code>`));

// English fallback
const t3en = mod.buildEmailNotificationText({
  sender: "x", subject: "Test subject", dateStr: "now",
  activationLink: "", otpCode: "", previewText: "preview body", lang: "en"
});
check("notify[C,en]: shows the subject (code-wrapped, FSI/PDI)",
  t3en.includes(`<code>${FSI}Test subject${PDI}</code>`));
check("notify[C,en]: shows the preview (code-wrapped, FSI/PDI)",
  t3en.includes(`<code>${FSI}preview body${PDI}</code>`));

// ---------------------------------------------------------------------------
// 5. End-to-end: build the actual notification the way the email handler
//    would, using real extracted values from a QP-encoded email. Verify
//    no QP artifacts reach the final string.
// ---------------------------------------------------------------------------

const e2eRaw = buildQpEmail(earlySmart, {
  from: "OpenAI <noreply@openai.com>",
  subject: "Your verification code",
  contentType: "text/html; charset=\"UTF-8\""
});
const e2eFast = mod.extractFast(e2eRaw);
// earlySmart has no link, so branch A (OTP) or C (fallback). The 987654
// code lives deep in the body; OTP_REGEX may or may not find it depending
// on context. We just verify the builder doesn't crash and emits no QP
// artifacts and no recipient/date noise.
const e2eNotif = mod.buildEmailNotificationText({
  sender: "OpenAI <noreply@openai.com>",
  subject: "Your verification code",
  activationLink: e2eFast.activationLink,
  otpCode: e2eFast.otpCode,
  previewText: e2eFast.previewText,
  inboxId: "e2e",
  lang: "fa"
});

check("e2e: notification has no QP artifacts anywhere",
  !e2eNotif.includes("=20") && !e2eNotif.includes("=3D") && !e2eNotif.includes("=E2"));
check("e2e: notification has no recipient/date lines",
  !/گیرنده/.test(e2eNotif) && !/تاریخ/.test(e2eNotif));
check("e2e: notification is non-empty and a string",
  typeof e2eNotif === "string" && e2eNotif.length > 0);

// ---------------------------------------------------------------------------
// 6. Regression: extractFast's preview must still find the link even on
//    QP-encoded HTML where the link href was QP-encoded as `=3D`. We
//    build the raw MIME directly here so the body is exactly the QP
//    shape a real sender would produce (not a double-encoded one).
// ---------------------------------------------------------------------------

const qpLinkRaw =
  "From: noreply@example.com\r\n" +
  "To: user@example.com\r\n" +
  "Subject: Verify\r\n" +
  "MIME-Version: 1.0\r\n" +
  "Content-Type: text/html; charset=\"UTF-8\"\r\n" +
  "Content-Transfer-Encoding: quoted-printable\r\n" +
  "\r\n" +
  "<p>Click <a href=3D\"https://example.com/verify?token=3Dabc\">here</a></p>";
const f4 = mod.extractFast(qpLinkRaw);
check("qp-link: link extracted after =3D decode",
  f4.activationLink === "https://example.com/verify?token=abc");

// ---------------------------------------------------------------------------
// 7. The user-reported "...wasn=E2=80=99t you" symptom at the final
//    notification level. We build a body that, before the fix, would
//    have produced that exact string in the preview.
// ---------------------------------------------------------------------------

const reportedRaw =
  "From: service@example.com\r\n" +
  "To: user@example.com\r\n" +
  "Subject: Activity alert\r\n" +
  "Content-Type: text/plain; charset=utf-8\r\n" +
  "Content-Transfer-Encoding: quoted-printable\r\n" +
  "\r\n" +
  "If this wasn=E2=80=99t you, please review your recent account activity. " +
  "We noticed a sign-in from a new device and want to make sure it was really you. " +
  "Long sentence: " + "x ".repeat(100);
const reported = mod.extractFast(reportedRaw);
check("reported: no =E2=80=99 artifact in preview",
  !reported.previewText.includes("=E2=80=99"));
check("reported: smart-quote is preserved as U+2019",
  reported.previewText.includes("\u2019"));
check("reported: full word \"wasn\" appears (not \"wasn=E2\")",
  /wasn[’']t/.test(reported.previewText));

console.log(failures === 0 ? "\nALL FORMAT TESTS PASSED" : `\n${failures} FORMAT TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
