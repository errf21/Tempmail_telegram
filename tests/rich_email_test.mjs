/**
 * Rich email renderer tests (additive pipeline: parseRichEmail/sanitizeRichHtml).
 *
 * What this file verifies
 * -----------------------
 *  1. Seed4.Me regression: a multipart/mixed email whose image/png lives
 *     NESTED inside multipart/related is rendered with resolved inline
 *     images, while NO binary markers (PNG/IHDR/IEND/iVBOR) leak into the
 *     visible text (rich.text or tag-stripped rich.html).
 *  2. cid: resolves ONLY to same-email MIME parts; missing/fake cids render
 *     nothing and never become external URLs.
 *  3. Sanitizer allowlist: script/iframe/object/embed/form/javascript:/
 *     vbscript:/data:text/html/event-handlers are all neutralized.
 *  4. Remote tracking images are blocked + counted, never rendered.
 *  5. Oversized images are skipped without crash; plain fallback survives.
 *  6. Frozen pipeline untouched: parseEmailBody/extractFast still export and
 *     behave (contract smoke checks, no semantic assertions changed).
 *
 * Pattern follows the other suites: the worker source is loaded and the new
 * functions are re-exported via a temp harness (gitignored: .worker_*.mjs).
 */

import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const workerSrc = readFileSync(join(root, "_worker.js"), "utf8");

const harness = `
export { parseRichEmail, sanitizeRichHtml, parseEmailBody, extractFast, MAX_PARSE_BYTES };
`;
const tmp = join(root, ".worker_rich_test.mjs");
writeFileSync(tmp, workerSrc + harness);
let mod;
try {
  mod = await import(tmp + "?t=" + Date.now());
} finally {
  try { unlinkSync(tmp); } catch (_) {}
}

let failures = 0;
function check(name, cond) {
  if (cond) console.log("PASS - " + name);
  else { console.log("FAIL - " + name); failures++; }
}

function stripTags(s) {
  return String(s || "").replace(/<[^>]+>/g, " ");
}

// 1x1 transparent PNG (~70 bytes decoded)
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function buildSeed4Like() {
  const b64Lines = TINY_PNG_B64.replace(/(.{64})/g, "$1\r\n");
  return [
    "From: Seed4.Me <noreply@seed4.me>",
    "To: user@tmp.example",
    "Subject: Your VPN account",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="MIXED-OUTER"',
    "",
    "--MIXED-OUTER",
    'Content-Type: multipart/alternative; boundary="ALT-INNER"',
    "",
    "--ALT-INNER",
    'Content-Type: text/plain; charset="utf-8"',
    "",
    "Hello, your account is ready. Visit https://seed4.me/app for details.",
    "",
    "--ALT-INNER",
    'Content-Type: text/html; charset="utf-8"',
    "",
    '<html><body><p>Hello, your <b>account</b> is ready.</p><p><a href="https://seed4.me/app">Open app</a></p></body></html>',
    "",
    "--ALT-INNER--",
    "",
    "--MIXED-OUTER",
    'Content-Type: multipart/related; boundary="REL-INNER"',
    "",
    "--REL-INNER",
    'Content-Type: text/html; charset="utf-8"',
    "",
    '<html><body><p>Promo banner:</p><img src="cid:logo123" alt="logo"><p>Thanks!</p></body></html>',
    "",
    "--REL-INNER",
    'Content-Type: image/png; name="logo.png"',
    "Content-Transfer-Encoding: base64",
    "Content-ID: <logo123>",
    "Content-Disposition: inline",
    "",
    b64Lines,
    "",
    "--REL-INNER--",
    "",
    "--MIXED-OUTER--",
    "",
  ].join("\r\n");
}

// ---- 1. Seed4.Me regression ----
const seed4 = buildSeed4Like();
let rich;
try {
  rich = mod.parseRichEmail(seed4);
} catch (e) {
  rich = null;
  console.error(e);
}
check("rich parses without throwing", !!rich);
check("rich.hasHtml is true", rich && rich.hasHtml === true);
check("rich.html non-empty", rich && typeof rich.html === "string" && rich.html.length > 0);
check("inlineImages has >= 1", rich && Array.isArray(rich.inlineImages) && rich.inlineImages.length >= 1);
check(
  "cid resolved to data:image/png",
  rich && typeof rich.html === "string" && rich.html.includes("data:image/png;base64,")
);
check("no raw cid: left in html", rich && !/src="cid:/i.test(rich.html || ""));
check("remoteImagesBlocked is 0 here", rich && rich.remoteImagesBlocked === 0);

const visibleRich = stripTags(rich && rich.html) + "\n" + (rich && rich.text ? rich.text : "");
for (const marker of ["PNG", "IHDR", "IEND", "iVBOR"]) {
  check("binary marker not in rich text: " + marker, !visibleRich.includes(marker));
}

// ---- 2. missing / fake cid ----
const fakeCidRaw = [
  "From: a@b.c",
  "To: u@t.e",
  "Subject: x",
  "MIME-Version: 1.0",
  'Content-Type: multipart/related; boundary="B"',
  "",
  "--B",
  'Content-Type: text/html; charset="utf-8"',
  "",
  '<p>Hi</p><img src="cid:does-not-exist">',
  "",
  "--B--",
  "",
].join("\r\n");
const fakeCid = mod.parseRichEmail(fakeCidRaw);
check("fake cid: no img rendered", !/<img\b/i.test(fakeCid.html || ""));
check("fake cid: text kept", /Hi/.test(stripTags(fakeCid.html || "")));

// ---- 3. XSS sanitizer suite ----
const xssRaw = [
  "From: evil@x.y",
  "To: u@t.e",
  "Subject: x",
  "MIME-Version: 1.0",
  "Content-Type: text/html",
  "",
  [
    "<p>hi</p>",
    '<script>alert(1)</script>',
    '<a href="javascript:alert(1)">click</a>',
    '<a href="vbscript:msgbox(1)">click2</a>',
    '<div onclick="alert(1)" onerror="alert(2)">box</div>',
    "<iframe src=\"https://evil.example\"></iframe>",
    '<object data="https://evil.example/x"></object>',
    '<embed src="https://evil.example/x">',
    '<form action="https://evil.example/steal"><input type="text"></form>',
    '<img src="data:text/html;base64,PGI+MQ== pinnacle">',
    '<img src="https://tracker.example/pixel.gif">',
    "<style>p{color:red}</style>",
    "<link rel=\"stylesheet\" href=\"https://evil.example/a.css\">",
    "<meta http-equiv=\"refresh\" content=\"0;url=https://evil.example\">",
  ].join(""),
].join("\r\n");
const xss = mod.parseRichEmail(xssRaw);
const xh = xss.html || "";
check("no <script", !/<script/i.test(xh));
check("no onclick/onerror", !/\bon\w+\s*=/i.test(xh));
check("no <iframe", !/<iframe/i.test(xh));
check("no <object", !/<object/i.test(xh));
check("no <embed", !/<embed/i.test(xh));
check("no <form", !/<form/i.test(xh));
check("no javascript:", !/javascript:/i.test(xh));
check("no vbscript:", !/vbscript:/i.test(xh));
check("no data:text/html", !/data:text\/html/i.test(xh));
check("no remote tracker img", !/tracker\.example/i.test(xh));
check("tracking counted as blocked", xss.remoteImagesBlocked >= 1);
check("readable text survives xss strip", /hi/.test(stripTags(xh)));

// ---- 4. direct sanitize unit checks ----
const s1 = mod.sanitizeRichHtml('<p><a href="https://ok.example/a">t</a></p>', new Map());
check("allowed a kept", /<a href="https:\/\/ok\.example\/a"/.test(s1.html));
const s2 = mod.sanitizeRichHtml('<a href="JaVaScRiPt:alert(1)">t</a>', new Map());
check("mixed-case javascript: dropped", !/javascript:/i.test(s2.html) && /t/.test(stripTags(s2.html)));

// ---- 5. oversized input is safe: no throw, no binary leak, clean fallback ----
// NOTE: any single image over RICH_IMG_EACH_MAX_BYTES (500KB) necessarily
// pushes the whole raw MIME over MAX_PARSE_BYTES (256KB), so the parser
// takes the early-return path: hasHtml=false and the UI falls back to the
// frozen plain bodyText. That IS the specified over-cap behavior.
const bigRaw = [
  "From: a@b.c",
  "To: u@t.e",
  "Subject: big",
  "MIME-Version: 1.0",
  'Content-Type: multipart/related; boundary="BB"',
  "",
  "--BB",
  'Content-Type: text/html; charset="utf-8"',
  "",
  '<p>Body text here</p><img src="cid:big1">',
  "",
  "--BB",
  "Content-Type: image/png",
  "Content-Transfer-Encoding: base64",
  "Content-ID: <big1>",
  "Content-Disposition: inline",
  "",
  "QUJD".repeat(500 * 1024), // ~2MB base64 -> over MAX_PARSE_BYTES on purpose
  "",
  "--BB--",
  "",
].join("\r\n");
let big = null;
try {
  big = mod.parseRichEmail(bigRaw);
} catch (e) {
  big = null;
}
check("oversized input: no throw", !!big);
check("oversized input: hasHtml false (plain fallback)", big && big.hasHtml === false);
check("oversized input: empty html", big && big.html === "");
check(
  "oversized input: no binary markers anywhere",
  big && ![big.html, big.text].some((s) => /PNG|IHDR|IEND|iVBOR|QUJDQUJD/.test(s || ""))
);
// The per-image data: cap is also unit-covered via the sanitizer: a huge
// sender-inlined data: URL must be dropped, never rendered.
const hugeDataUrl = "data:image/png;base64," + "QUJD".repeat(200 * 1024);
const sBig = mod.sanitizeRichHtml('<p>t</p><img src="' + hugeDataUrl + '">', new Map());
check("oversized data: image dropped by sanitizer", !/<img\b/i.test(sBig.html || ""));

// ---- 6. large email respects MAX_PARSE_BYTES ----
const huge = "From: x@y.z\r\nTo: a@b.c\r\nSubject: h\r\nContent-Type: text/plain\r\n\r\n" + "a".repeat(300 * 1024);
const hugeOut = mod.parseRichEmail(huge);
check("huge email: hasHtml false (fast-path respected)", hugeOut && hugeOut.hasHtml === false);

// ---- 7. frozen pipeline still present & sane ----
check("parseEmailBody still exported", typeof mod.parseEmailBody === "function");
check("extractFast still exported", typeof mod.extractFast === "function");
const legacy = mod.parseEmailBody(seed4);
check("legacy parseEmailBody still returns {text,links}", legacy && typeof legacy.text === "string" && Array.isArray(legacy.links));
check("legacy still finds the seed4 link", legacy && legacy.links.some((u) => u.includes("seed4.me")));

if (failures > 0) {
  console.error(failures + " RICH TEST(S) FAILED");
  process.exit(1);
} else {
  console.log("All rich email tests passed.");
}
