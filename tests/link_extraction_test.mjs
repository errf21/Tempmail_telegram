/**
 * Tests for the "verification link missing in link-based emails" bug.
 *
 * The user reported that emails whose call-to-action is a verification
 * LINK (e.g. Aparat "تکمیل ثبت نام", many onboarding flows, X/Twitter
 * email-confirm, etc.) had no link in the received Telegram message,
 * even though OTP-bearing emails rendered the code perfectly.
 *
 * Root cause: extractFast() uses isStrictVerificationUrl() to filter
 * candidate URLs down to the single activation link. The classifier
 * was too strict — it required the URL path or query to contain a
 * verification keyword. Real-world services often use totally
 * arbitrary paths like "/users/email-confirm/abc123" or
 * "/c/abcd?hash=xyz" with no keyword in the path or query, and the
 * link was rejected as a tracker.
 *
 * The fix has three layers:
 *   1. Expanded VERIFY_PATH_KEYWORDS (more path variants:
 *      /email-verify, /verify-email, /account-activation, /welcome,
 *      /onboard, /active, /enable, /complete-registration, etc.)
 *   2. Expanded VERIFY_QUERY_KEYWORDS (more query params:
 *      confirmation=, verify=, signup=, register=, activation=,
 *      auth=, email_token=, redirect_uri=, etc.)
 *   3. Context-keyword fallback in isStrictVerificationUrl(): when
 *      the URL has no keyword, accept it if the surrounding body
 *      text/anchor text contains an activation keyword (English or
 *      Persian: "verify", "confirm", "click here to confirm",
 *      "تکمیل ثبت نام", "تایید حساب", "تأیید ایمیل", etc.).
 *
 * These tests exercise the fast path (extractFast) AND the full
 * parseEmailBody path with realistic fixtures for the bug class.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const workerSrc = readFileSync(join(root, "_worker.js"), "utf8");

const harness = `
export {
  extractFast,
  parseEmailBody,
  isStrictVerificationUrl,
  scoreVerificationUrl,
  VERIFY_PATH_KEYWORDS,
  VERIFY_QUERY_KEYWORDS,
  VERIFY_QUERY_STRONG,
  VERIFY_QUERY_WEAK,
  ACTIVATION_CONTEXT_KEYWORDS,
  MAX_PARSE_BYTES
};
`;
const tmp = join(root, ".worker_link_extraction_test.mjs");
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
// 1. Keyword set sanity: the new keyword lists must include the obvious
//    entries used by every major service.
// ---------------------------------------------------------------------------
check("VERIFY_PATH_KEYWORDS contains /email-verify", mod.VERIFY_PATH_KEYWORDS.includes("/email-verify"));
check("VERIFY_PATH_KEYWORDS contains /verify-email", mod.VERIFY_PATH_KEYWORDS.includes("/verify-email"));
check("VERIFY_PATH_KEYWORDS contains /account-activation", mod.VERIFY_PATH_KEYWORDS.includes("/account-activation"));
check("VERIFY_PATH_KEYWORDS contains /welcome", mod.VERIFY_PATH_KEYWORDS.includes("/welcome"));
check("VERIFY_PATH_KEYWORDS contains /active", mod.VERIFY_PATH_KEYWORDS.includes("/active"));
check("VERIFY_PATH_KEYWORDS contains /enable", mod.VERIFY_PATH_KEYWORDS.includes("/enable"));
check("VERIFY_PATH_KEYWORDS contains /onboard", mod.VERIFY_PATH_KEYWORDS.includes("/onboard"));
check("VERIFY_PATH_KEYWORDS contains /complete-registration", mod.VERIFY_PATH_KEYWORDS.includes("/complete-registration"));

check("VERIFY_QUERY_KEYWORDS contains confirmation=", mod.VERIFY_QUERY_KEYWORDS.includes("confirmation="));
check("VERIFY_QUERY_KEYWORDS contains verify=", mod.VERIFY_QUERY_KEYWORDS.includes("verify="));
check("VERIFY_QUERY_KEYWORDS contains signup=", mod.VERIFY_QUERY_KEYWORDS.includes("signup="));
check("VERIFY_QUERY_KEYWORDS contains register=", mod.VERIFY_QUERY_KEYWORDS.includes("register="));
check("VERIFY_QUERY_KEYWORDS contains activation=", mod.VERIFY_QUERY_KEYWORDS.includes("activation="));
check("VERIFY_QUERY_KEYWORDS contains email_token=", mod.VERIFY_QUERY_KEYWORDS.includes("email_token="));
check("VERIFY_QUERY_KEYWORDS contains redirect_uri=", mod.VERIFY_QUERY_KEYWORDS.includes("redirect_uri="));

check("ACTIVATION_CONTEXT_KEYWORDS contains 'verify'",
  mod.ACTIVATION_CONTEXT_KEYWORDS.includes("verify"));
check("ACTIVATION_CONTEXT_KEYWORDS contains 'تکمیل ثبت نام'",
  mod.ACTIVATION_CONTEXT_KEYWORDS.includes("تکمیل ثبت نام"));
check("ACTIVATION_CONTEXT_KEYWORDS contains 'تایید حساب'",
  mod.ACTIVATION_CONTEXT_KEYWORDS.includes("تایید حساب"));
check("ACTIVATION_CONTEXT_KEYWORDS contains 'click here to confirm'",
  mod.ACTIVATION_CONTEXT_KEYWORDS.includes("click here to confirm"));

// ---------------------------------------------------------------------------
// 2. isStrictVerificationUrl() — direct unit tests for the classifier.
// ---------------------------------------------------------------------------

// 2a) The original cases that already worked must still work.
check("classifier: /auth/confirm?token=… accepted (original case)",
  mod.isStrictVerificationUrl("https://www.aparat.com/auth/confirm?token=abc",
    "Please verify your account."));
check("classifier: /verify?code=… accepted",
  mod.isStrictVerificationUrl("https://example.com/verify?code=1234",
    "Your code is below."));
check("classifier: /activate?secret=… accepted",
  mod.isStrictVerificationUrl("https://example.com/activate?secret=xyz",
    "Activate your account."));

// 2b) New path keywords.
check("classifier: /email-verify/abc123 accepted (no query)",
  mod.isStrictVerificationUrl("https://example.com/email-verify/abc123", ""));
check("classifier: /verify-email/abc123 accepted (no query)",
  mod.isStrictVerificationUrl("https://example.com/verify-email/abc123", ""));
check("classifier: /account-activation/abc accepted (no query)",
  mod.isStrictVerificationUrl("https://example.com/account-activation/abc", ""));
check("classifier: /welcome/abc accepted (no query)",
  mod.isStrictVerificationUrl("https://example.com/welcome/abc", ""));

// 2c) New query keywords.
check("classifier: /users/active?confirmation=abc accepted (path has no kw)",
  mod.isStrictVerificationUrl("https://example.com/users/active?confirmation=abc", ""));
check("classifier: /onboard?verify=abc accepted",
  mod.isStrictVerificationUrl("https://example.com/onboard?verify=abc", ""));
check("classifier: /welcome?signup=abc accepted",
  mod.isStrictVerificationUrl("https://example.com/welcome?signup=abc", ""));
check("classifier: /finish?email_token=abc accepted",
  mod.isStrictVerificationUrl("https://example.com/finish?email_token=abc", ""));

// 2d) Context fallback — the bug class.
check("classifier[FALLBACK]: random path + 'تکمیل ثبت نام' context accepted",
  mod.isStrictVerificationUrl(
    "https://www.aparat.com/c/abcd/efgh/ijk",
    "<a>تکمیل ثبت نام</a>"));
check("classifier[FALLBACK]: random path + 'verify' context accepted",
  mod.isStrictVerificationUrl(
    "https://example.com/some/random/path/12345",
    "Please verify your email address"));
check("classifier[FALLBACK]: random path + 'confirm' context accepted",
  mod.isStrictVerificationUrl(
    "https://example.com/some/random/path/12345",
    "Click here to confirm your account"));
check("classifier[FALLBACK]: random path + 'تایید' context accepted",
  mod.isStrictVerificationUrl(
    "https://example.com/c/abcd",
    "لطفا برای تایید حساب کاربری خود اقدام کنید"));
check("classifier[FALLBACK]: random path + 'تأیید' context accepted",
  mod.isStrictVerificationUrl(
    "https://example.com/c/abcd",
    "برای تأیید ایمیل خود کلیک کنید"));
check("classifier[FALLBACK]: random path + 'فعال سازی' context accepted",
  mod.isStrictVerificationUrl(
    "https://example.com/c/abcd",
    "برای فعال سازی حساب خود کلیک کنید"));
check("classifier[FALLBACK]: random path + 'click here to confirm' context accepted",
  mod.isStrictVerificationUrl(
    "https://example.com/c/abcd",
    "<a>Click here to confirm your account</a>"));

// 2e) Rejection cases — must still be rejected (no false positives).
check("classifier[REJECT]: tracker shortener rejected even with context",
  !mod.isStrictVerificationUrl("https://bit.ly/abc123", "verify your account"));
check("classifier[REJECT]: pure asset URL rejected (no context kw)",
  !mod.isStrictVerificationUrl("https://example.com/assets/logo.png", ""));
check("classifier[REJECT]: unrelated blog post URL rejected",
  !mod.isStrictVerificationUrl("https://example.com/blog/2024/01/hello", "Read our latest article"));
check("classifier[REJECT]: URL with no path/query AND no context kw",
  !mod.isStrictVerificationUrl("https://example.com", ""));
check("classifier[REJECT]: empty url",
  !mod.isStrictVerificationUrl("", "verify your account"));

// ---------------------------------------------------------------------------
// 3. extractFast() — the original bug: an Aparat-style email whose URL
//    has no path keyword and no query keyword should NOW be detected via
//    the context fallback. Without the fix, extractFast would return
//    activationLink = "" and the user would see no link.
// ---------------------------------------------------------------------------

// 3a) Aparat-style: link inside an <a> with Persian "تکمیل ثبت نام" text.
const aparatNoKeywordUrl = "https://www.aparat.com/c/abcd1234efgh5678/ijklmnop";
const aparatNoKeywordBody =
  "From: Aparat <no-reply@aparat.com>\r\n" +
  "To: u@x.com\r\n" +
  "Subject: تکمیل ثبت نام\r\n" +
  "MIME-Version: 1.0\r\n" +
  "Content-Type: text/html; charset=\"utf-8\"\r\n" +
  "\r\n" +
  "<html><body dir=\"rtl\">" +
  "<p>سلام،</p>" +
  "<p>برای تکمیل ثبت نام روی لینک زیر کلیک کنید:</p>" +
  "<a href=\"" + aparatNoKeywordUrl + "\">تکمیل ثبت نام</a>" +
  "</body></html>";

const aparatNoKeywordFast = mod.extractFast(aparatNoKeywordBody);
check("extractFast[aparat-no-kw]: finds the URL via context fallback",
  aparatNoKeywordFast.activationLink === aparatNoKeywordUrl);
check("extractFast[aparat-no-kw]: no false OTP",
  aparatNoKeywordFast.otpCode === "");
check("extractFast[aparat-no-kw]: preview is non-empty",
  typeof aparatNoKeywordFast.previewText === "string" && aparatNoKeywordFast.previewText.length > 0);

// 3b) Generic "email-confirm" link in a button. Uses a hypothetical
//     domain that's NOT in any blacklist (x.com and twitter.com are
//     blacklisted by isValidActionUrl for full-view links; the fast
//     path's isStrictVerificationUrl doesn't have that blacklist, but
//     the test still works with a clean domain for both paths).
const xConfirmUrl = "https://app.somebrand.com/account/email_confirm/eyJhbGciOiJIUzI1NiJ9.payload.signature";
const xConfirmBody =
  "From: SomeBrand <info@somebrand.com>\r\n" +
  "To: u@somebrand.com\r\n" +
  "Subject: Confirm your SomeBrand account\r\n" +
  "Content-Type: text/html; charset=\"utf-8\"\r\n" +
  "\r\n" +
  "<html><body>" +
  "<p>Please confirm your email address to activate your account.</p>" +
  "<a href=\"" + xConfirmUrl + "\" style=\"background:#1da1f2;color:#fff\">" +
  "Confirm your email address</a>" +
  "</body></html>";

const xConfirmFast = mod.extractFast(xConfirmBody);
check("extractFast[x-confirm]: finds the URL via context fallback",
  xConfirmFast.activationLink === xConfirmUrl);

// 3c) A service that uses /welcome/abc?user_id=123 (path has new kw
//     /welcome, query has new kw user_id=). Tests new keyword lists.
const welcomeUrl = "https://app.example.com/welcome/abc?user_id=12345&locale=en";
const welcomeBody =
  "From: Example <hello@example.com>\r\n" +
  "Subject: Welcome!\r\n" +
  "Content-Type: text/html; charset=\"utf-8\"\r\n" +
  "\r\n" +
  "<html><body>" +
  "<p>Welcome to Example! Click below to get started.</p>" +
  "<a href=\"" + welcomeUrl + "\">Get started</a>" +
  "</body></html>";

const welcomeFast = mod.extractFast(welcomeBody);
check("extractFast[welcome/user_id]: finds the URL via new path kw",
  welcomeFast.activationLink === welcomeUrl);

// 3d) Original Aparat case (the one that already worked) must still work.
const originalAparatUrl = "https://www.aparat.com/auth/confirm?token=abc123def";
const originalAparatBody =
  "From: Aparat <no-reply@aparat.com>\r\n" +
  "Subject: تکمیل ثبت نام\r\n" +
  "Content-Type: text/html; charset=\"utf-8\"\r\n" +
  "\r\n" +
  "<html><body dir=\"rtl\">" +
  "<a href=\"" + originalAparatUrl + "\">تکمیل ثبت نام</a>" +
  "</body></html>";

const originalAparatFast = mod.extractFast(originalAparatBody);
check("extractFast[original-aparat]: still finds the URL (no regression)",
  originalAparatFast.activationLink === originalAparatUrl);

// 3e) OpenAI-style OTP-only email must still extract the OTP and not a
//     random URL (regression check on the OTP-wins policy).
const openAiOtpBody =
  "From: OpenAI <noreply@openai.com>\r\n" +
  "Subject: Your verification code\r\n" +
  "Content-Type: text/html; charset=\"utf-8\"\r\n" +
  "\r\n" +
  "<html><body>" +
  "<p>Your verification code is: 123456</p>" +
  "<p>It expires in 10 minutes.</p>" +
  "<a href=\"https://help.openai.com/en\">Need help?</a>" +
  "</body></html>";

const openAiOtpFast = mod.extractFast(openAiOtpBody);
check("extractFast[openai-otp]: extracts OTP",
  openAiOtpFast.otpCode === "123456");
check("extractFast[openai-otp]: help/footer URL NOT promoted (no verify signal)",
  openAiOtpFast.activationLink === "");

// ---------------------------------------------------------------------------
// 4. parseEmailBody() — the full-view path must also surface the URL.
// ---------------------------------------------------------------------------

// 4a) Aparat no-keyword URL must be returned in the links list.
const aparatParsed = mod.parseEmailBody(aparatNoKeywordBody);
check("parseEmailBody[aparat-no-kw]: links list contains the URL",
  Array.isArray(aparatParsed.links) && aparatParsed.links.includes(aparatNoKeywordUrl));
check("parseEmailBody[aparat-no-kw]: body shows the Persian button text",
  /تکمیل ثبت نام/.test(aparatParsed.text));

// 4b) Email-confirm URL must be returned in the links list.
const xConfirmParsed = mod.parseEmailBody(xConfirmBody);
check("parseEmailBody[x-confirm]: links list contains the URL",
  Array.isArray(xConfirmParsed.links) && xConfirmParsed.links.includes(xConfirmUrl));

// ===========================================================================
// 8. Stage 2 — structural query classification, coexistence, best-selection
// ===========================================================================

// 8a) Structural param matching: weak/single-letter params never qualify.
check("S2[classifier]: ?id= alone does NOT qualify (weak)",
  mod.isStrictVerificationUrl("https://example.com/page?id=12345", "") === false);
check("S2[classifier]: ?u= single-letter param dropped entirely",
  mod.isStrictVerificationUrl("https://example.com/page?u=abc", "") === false);
check("S2[classifier]: ?utm_source= alone does NOT qualify",
  mod.isStrictVerificationUrl("https://example.com/page?utm_source=newsletter", "") === false);
check("S2[classifier]: ?token= qualifies (structural, strong)",
  mod.isStrictVerificationUrl("https://example.com/page?token=abc", "") === true);
check("S2[classifier]: weak param corroborated by activation context qualifies",
  mod.isStrictVerificationUrl("https://example.com/page?id=123", "تکمیل ثبت نام") === true);
check("S2[classifier]: unsubscribe URL rejected even with token",
  mod.isStrictVerificationUrl("https://example.com/u/unsubscribe?token=abc", "verify") === false);
check("S2[classifier]: real verify link with utm tracking params still accepted",
  mod.isStrictVerificationUrl("https://example.com/verify?token=abc&utm_source=email", "") === true);

// 8b) Ranking: utm_-bearing URL ranks BELOW the same URL without utm.
check("S2[rank]: utm demotes score",
  mod.scoreVerificationUrl("https://example.com/verify?token=abc", "").score <
  mod.scoreVerificationUrl("https://example.com/verify?token=abc&utm_source=email", "") === false &&
  mod.scoreVerificationUrl("https://example.com/verify?token=abc", "").score >
  mod.scoreVerificationUrl("https://example.com/verify?token=abc&utm_source=email", "").score);

// 8c) Coexistence: code + verify link → BOTH returned.
const s2both = mod.extractFast(
  "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n" +
  "<p>Your code: <b>654321</b></p><p>Verify: <a href=\"https://example.com/verify?token=abc\">Confirm account</a></p>");
check("S2[fast]: OTP and link coexist (both-shown policy)",
  s2both.otpCode === "654321" &&
  s2both.activationLink === "https://example.com/verify?token=abc");
check("S2[fast]: activationLinks contains only qualified URLs (best-first)",
  Array.isArray(s2both.activationLinks) &&
  s2both.activationLinks.length === 1 &&
  s2both.activationLinks[0] === "https://example.com/verify?token=abc");

// 8d) Best-selection: a tracking/marketing URL appearing EARLIER in the
//     body must not steal the primary slot from the real verify link.
const s2order = mod.extractFast(
  "From: x@y\r\nTo: u@v\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n" +
  "<p>Special offer! <a href=\"https://promos.example.com/deal?id=77\">50% off</a></p>" +
  "<p>Confirm your account: <a href=\"https://example.com/auth/confirm?token=xyz\">تایید حساب</a></p>");
check("S2[fast]: best URL wins even when a tracking URL appears first",
  s2order.activationLink === "https://example.com/auth/confirm?token=xyz");
check("S2[fast]: tracking URL excluded from activationLinks",
  Array.isArray(s2order.activationLinks) &&
  !s2order.activationLinks.includes("https://promos.example.com/deal?id=77"));

console.log(failures === 0 ? "\nALL LINK-EXTRACTION TESTS PASSED" : `\n${failures} LINK-EXTRACTION TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
