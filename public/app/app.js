/* TempMail shared frontend — plain browser + Telegram Mini App.
   No dependencies, no build step. All email content is rendered as
   TEXT (textContent / <pre>) — email HTML is never injected as markup.
   Only http(s) URLs are ever turned into clickable anchors. */
"use strict";

/* Release marker: bump on every user-facing release. Used for asset
   cache-busting (?v=BUILD in index.html) and as a non-sensitive
   deployed-version proof (footer title + console). */
const BUILD = "20260906-gmail1";

/* Deploy-time config: set to the bot deep link, e.g. "https://t.me/YourBot".
   Shown on the no_session screen inside Telegram so users can jump to the
   bot, create an email, and come back. Empty = button hidden, text only. */
const BOT_URL = "https://t.me/Tempmeaill1_bot";

/* ---------------- i18n (frontend UI strings only; bot i18n untouched) ---------------- */
const STR = {
  fa: {
    brandName: "تمپ‌میل", loginTitle: "ایمیل موقت شما",
    loginDesc: "بدون ثبت‌نام، یک آدرس ایمیل موقت بسازید و کدهای تایید را فوری دریافت کنید.",
    restoreTokenLabel: "توکن بازگردانی", loginHint: "توکن را از ربات تلگرام گرفته‌اید؟ آن را وارد کنید تا به همان ایمیل وصل شوید.",
    btnLogin: "ورود با توکن", or: "یا", btnNoToken: "هنوز ایمیلی ندارم — راهنما",
    loginHelpText: "در ربات تلگرام دکمه «ساخت ایمیل جدید» را بزنید؛ توکن نمایش داده می‌شود. اگر از داخل تلگرام این صفحه را باز کرده‌اید، ورود خودکار انجام می‌شود.",
    yourEmail: "آدرس ایمیل شما", btnCopy: "کپی", btnRefresh: "به‌روزرسانی",
    btnCreate: "ساخت ایمیل جدید", btnRestore: "بازگردانی", btnDoRestore: "بازیابی", btnCancel: "انصراف",
    btnConfirmYes: "بله، بساز",
    newTokenLabel: "توکن ایمیل جدید — آن را نگه دارید:", inbox: "صندوق ورودی",
    btnLogout: "خروج", inboxEmpty: "صندوق ورودی خالی است",
    inboxEmptyHint: "ایمیل‌های دریافتی این آدرس اینجا نمایش داده می‌شوند.",
    btnBack: "بازگشت", from: "فرستنده:", date: "تاریخ:", otpLabel: "کد تایید:",
    bodyLabel: "متن پیام:", btnCopyBody: "کپی متن", footer: "تمپ‌میل — ایمیل موقت سریع و امن",
    confirmNew: "ایمیل فعلی و پیام‌هایش حذف می‌شوند. ایمیل جدید ساخته شود؟",
    statusLoading: "در حال بارگذاری…", statusLogin: "در حال ورود…",
    statusCopied: "کپی شد ✓", statusRefreshed: "به‌روزرسانی شد ✓",
    statusCreated: "ایمیل جدید ساخته شد ✓", statusRestored: "ایمیل بازیابی شد ✓",
    statusLang: "زبان تغییر کرد ✓", errNetwork: "خطای ارتباط با سرور. دوباره تلاش کنید.",
    errExpiredTg: "نشست تلگرام منقضی شده است. مینی‌اپ را ببندید و دوباره باز کنید.",
    errForbiddenTg: "دسترسی به این ربات ندارید.",
    errInvalidTg: "احراز هویت تلگرام ناموفق بود. مینی‌اپ را ببندید و دوباره باز کنید.",
    errSigTg: "امضای تلگرام معتبر نیست. مینی‌اپ را از دکمه همین ربات باز کنید، نه از جای دیگر.",
    errMissingTg: "اطلاعات تلگرام ناقص رسید. مینی‌اپ را ببندید و دوباره باز کنید.",
    errBadUserTg: "شناسه تلگرام نامعتبر است. از حساب دیگری وارد شوید.",
    errToken: "توکن نامعتبر است. فرمت: tmp_xxxxxx", errUnknown: "خطایی رخ داد.",
    errNoSession: "نشست فعالی برای این حساب نیست. ابتدا در ربات تلگرام یک ایمیل بسازید.",
    noEmail: "هنوز ایمیلی ندارید", noEmailText: "هنوز ایمیلی ندارید. با یک ضربه یکی بسازید.",
    activeReady: "فعال و آماده دریافت", createdAt: "ساخته شده:",
    openLink: "باز کردن لینک", copied: "کپی شد",
    noSessionTitle: "حسابی پیدا نشد",
    noSessionText: "ابتدا در ربات یک ایمیل بسازید، بعد به اینجا بازگردید.",
    btnOpenBot: "باز کردن ربات تلگرام",
  },
  en: {
    brandName: "TempMail", loginTitle: "Your temporary email",
    loginDesc: "No signup. Create a temporary address and receive verification codes instantly.",
    restoreTokenLabel: "Recovery token", loginHint: "Got a token from the Telegram bot? Enter it to reconnect to that email.",
    btnLogin: "Login with token", or: "or", btnNoToken: "No email yet — help",
    loginHelpText: "In the Telegram bot tap “Generate New Email”; a token is shown. If you opened this page inside Telegram, login is automatic.",
    yourEmail: "Your email address", btnCopy: "Copy", btnRefresh: "Refresh",
    btnCreate: "Create new email", btnRestore: "Restore", btnDoRestore: "Restore", btnCancel: "Cancel",
    btnConfirmYes: "Yes, create",
    newTokenLabel: "New email token — keep it safe:", inbox: "Inbox",
    btnLogout: "Logout", inboxEmpty: "Inbox is empty",
    inboxEmptyHint: "Incoming mail for this address will appear here.",
    btnBack: "Back", from: "From:", date: "Date:", otpLabel: "Verification code:",
    bodyLabel: "Message text:", btnCopyBody: "Copy text", footer: "TempMail — fast, secure temporary email",
    confirmNew: "The current email and its messages will be deleted. Create a new email?",
    statusLoading: "Loading…", statusLogin: "Signing in…",
    statusCopied: "Copied ✓", statusRefreshed: "Refreshed ✓",
    statusCreated: "New email created ✓", statusRestored: "Email restored ✓",
    statusLang: "Language switched ✓", errNetwork: "Server connection error. Try again.",
    errExpiredTg: "Telegram session expired. Close and reopen the Mini App.",
    errForbiddenTg: "You do not have access to this bot.",
    errInvalidTg: "Telegram authentication failed. Close and reopen the Mini App.",
    errSigTg: "Telegram signature invalid. Open the Mini App from this bot's button, not from elsewhere.",
    errMissingTg: "Incomplete Telegram data received. Close and reopen the Mini App.",
    errBadUserTg: "Invalid Telegram identity. Try a different account.",
    errToken: "Invalid token. Format: tmp_xxxxxx", errUnknown: "Something went wrong.",
    errNoSession: "No active session for this account. Create an email in the Telegram bot first.",
    noEmail: "No email yet", noEmailText: "No email yet. Create one with a single tap.",
    activeReady: "Active and ready", createdAt: "Created:",
    openLink: "Open link", copied: "Copied",
    noSessionTitle: "No account found",
    noSessionText: "Create an email in the bot first, then come back here.",
    btnOpenBot: "Open Telegram bot",
  },
};

/* ---------------- state ---------------- */
const S = {
  lang: (navigator.language || "fa").toLowerCase().startsWith("en") ? "en" : "fa",
  theme: localStorage.getItem("tm_theme") || "auto",
  token: sessionStorage.getItem("tm_session") || "",
  tg: null,          // Telegram.WebApp or null
  isTg: false,
  tgManual: null,    // explicit manual dark/light override inside Telegram (null = follow Telegram)
  me: null,          // {email, createdAt, lang, inboxCount}
  inbox: [],
  currentDetail: null,
  refreshTimer: 0,
};
function t(k) { return (STR[S.lang] && STR[S.lang][k]) || STR.fa[k] || k; }

/* ---------------- dom helpers (XSS-safe: textContent only) ---------------- */
const $ = (s) => document.querySelector(s);
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function show(view) {
  for (const id of ["view-login", "view-main", "view-detail"]) {
    $("#" + id).classList.toggle("hidden", id !== view);
  }
  window.scrollTo(0, 0);
  tgBack(view === "view-detail");
}
let statusTimer = 0;
function status(msg, kind) {
  const box = $("#status");
  clearTimeout(statusTimer);
  if (!msg) { box.classList.add("hidden"); return; }
  box.textContent = msg;
  box.className = "status " + (kind || "loading");
  if (kind === "ok" || kind === "error") {
    statusTimer = setTimeout(() => box.classList.add("hidden"), 3500);
  }
}
function isHttpUrl(u) {
  return typeof u === "string" && /^https?:\/\/[^\s<>"']+$/i.test(u.trim());
}
async function copyText(txt) {
  try {
    await navigator.clipboard.writeText(txt);
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = txt;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (_) {}
    ta.remove();
  }
  status(t("statusCopied"), "ok");
}

/* ---------------- Telegram WebApp ---------------- */
/* initData is ALWAYS re-read live from window.Telegram.WebApp at send
   time (getLiveInitData), never trusted from a stale snapshot: an empty
   value refuses to POST (the server would answer 401 invalid_init_data
   for ""). ready() is called before any read so the bridge is
   initialized. A pageshow listener re-checks after bfcache restores,
   which do not re-fire DOMContentLoaded. */
function getLiveInitData() {
  try {
    const wa = window.Telegram && window.Telegram.WebApp;
    const d = wa ? wa.initData : "";
    return (typeof d === "string" && d.length > 0) ? d : "";
  } catch (_) {
    return "";
  }
}
function initTelegram() {
  try {
    const wa = window.Telegram && window.Telegram.WebApp;
    if (wa && getLiveInitData().length > 0) {
      S.tg = wa; S.isTg = true;
      wa.ready();
      try { wa.expand(); } catch (_) {}
      applyTgTheme(wa);
      try { wa.onEvent("themeChanged", onTgThemeChanged); } catch (_) {}
      // Logout makes no sense inside Telegram (identity = Telegram user).
      const lo = $("#btn-logout");
      if (lo) lo.classList.add("hidden");
      return true;
    }
  } catch (_) {}
  return false;
}
/* Re-check initData when the page is restored from bfcache (stale
   auth_date would otherwise fail server-side freshness). If we are in
   the Mini App but initData is gone/empty, surface the reopen message
   instead of POSTing an empty value. */
function recheckTelegramInitData() {
  if (!S.isTg) return;
  if (!getLiveInitData()) {
    setToken("");
    status(t("errExpiredTg"), "error");
  }
}
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("pageshow", (ev) => {
    if (ev && ev.persisted) recheckTelegramInitData();
  });
}
function applyTgTheme(wa) {
  try {
    const p = wa.themeParams || {};
    const root = document.documentElement;
    if (p.bg_color) root.style.setProperty("--bg", "#" + p.bg_color);
    if (p.secondary_bg_color || p.section_bg_color)
      root.style.setProperty("--card", "#" + (p.secondary_bg_color || p.section_bg_color));
    if (p.text_color) root.style.setProperty("--text", "#" + p.text_color);
    if (p.hint_color) root.style.setProperty("--muted", "#" + p.hint_color);
    if (p.button_color) root.style.setProperty("--primary", "#" + p.button_color);
    if (p.button_text_color) root.style.setProperty("--primary-text", "#" + p.button_text_color);
    // Adopt Telegram's current colorScheme for BOTH dark and light, so a
    // stale tm_theme/auto value can never override Telegram. Never persists
    // to tm_theme (Telegram owns the theme until a manual override).
    root.setAttribute("data-theme", wa.colorScheme === "light" ? "light" : "dark");
    updateThemeToggle();
    syncThemeMeta();
  } catch (_) {}
}
/* Re-apply Telegram theme changes only when there is no active manual
   override; an explicit toggle choice (S.tgManual) always wins. */
function onTgThemeChanged() {
  if (S.tgManual === "dark" || S.tgManual === "light") return;
  try { if (S.tg) applyTgTheme(S.tg); } catch (_) {}
}
function tgBack(showBtn) {
  try {
    if (!S.tg || !S.tg.BackButton) return;
    if (showBtn) {
      S.tg.BackButton.show();
      S.tg.BackButton.onClick(backToMain);
    } else {
      S.tg.BackButton.hide();
    }
  } catch (_) {}
}
function tgHaptic() { try { S.tg && S.tg.HapticFeedback && S.tg.HapticFeedback.impactOccurred("light"); } catch (_) {} }

/* ---------------- theme + lang ---------------- */
/* Actual active theme: inside Telegram it is wa.colorScheme unless the user
   picked an explicit manual override; in a plain browser it is S.theme,
   with "auto" resolved from the OS (prefers-color-scheme). */
function getEffectiveTheme() {
  try {
    if (S.isTg && S.tg) {
      if (S.tgManual === "dark" || S.tgManual === "light") return S.tgManual;
      return S.tg.colorScheme === "light" ? "light" : "dark";
    }
  } catch (_) {}
  if (S.theme === "dark") return "dark";
  if (S.theme === "light") return "light";
  try {
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
  } catch (_) {}
  return "dark";
}
function updateThemeToggle() {
  try {
    const b = $("#btn-theme");
    if (b) b.textContent = getEffectiveTheme() === "dark" ? "☀️" : "🌙";
  } catch (_) {}
}
function syncThemeMeta() {
  try {
    let bg = "";
    try { bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(); } catch (_) {}
    if (!bg) bg = getEffectiveTheme() === "light" ? "#f4f6f9" : "#0b0e13";
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", bg);
  } catch (_) {}
}
/* Remove Telegram inline theme vars so a pure manual dark/light choice
   cannot mix with Telegram colors (no hybrid theme). */
function clearTgInlineTheme() {
  try {
    const root = document.documentElement;
    for (const k of ["--bg", "--card", "--text", "--muted", "--primary", "--primary-text"]) {
      root.style.removeProperty(k);
    }
  } catch (_) {}
}
function applyTheme() {
  // Plain browser: OS-based "auto" until the user explicitly chooses;
  // the choice persists to tm_theme. Inside Telegram the automatic
  // Telegram theme is never persisted; only a manual toggle sets the
  // in-memory S.tgManual override (pure vars, no hybrid).
  if (S.isTg && (S.tgManual === "dark" || S.tgManual === "light")) {
    clearTgInlineTheme();
    document.documentElement.setAttribute("data-theme", S.tgManual);
  } else if (!S.isTg) {
    document.documentElement.setAttribute("data-theme", S.theme);
    try { localStorage.setItem("tm_theme", S.theme); } catch (_) {}
  }
  // Inside Telegram without an override, data-theme stays owned by
  // applyTgTheme (called at init + on themeChanged).
  updateThemeToggle();
  syncThemeMeta();
}
function applyLang() {
  const rtl = S.lang !== "en";
  document.documentElement.lang = S.lang;
  document.documentElement.dir = rtl ? "rtl" : "ltr";
  document.querySelectorAll("[data-i18n]").forEach((n) => {
    const k = n.getAttribute("data-i18n");
    n.textContent = t(k);
  });
  $("#btn-lang").textContent = S.lang === "fa" ? "EN" : "فا";
  document.title = S.lang === "fa" ? "تمپ‌میل — ایمیل موقت" : "TempMail — Temporary Email";
}

/* ---------------- API client ---------------- */
async function api(path, opts) {
  opts = opts || {};
  const headers = { "Content-Type": "application/json" };
  if (S.token) headers["Authorization"] = "Bearer " + S.token;
  let res;
  try {
    res = await fetch(path, {
      method: opts.method || "GET",
      headers,
      credentials: "include",
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new Error("network");
  }
  let data = null;
  try { data = await res.json(); } catch (_) { data = null; }
  if (!res.ok) {
    const err = new Error((data && data.error) || ("http_" + res.status));
    err.code = data && data.error;
    err.status = res.status;
    throw err;
  }
  return data;
}
function setToken(tok) {
  S.token = tok || "";
  if (tok) sessionStorage.setItem("tm_session", tok);
  else sessionStorage.removeItem("tm_session");
}

/* ---------------- auth flows ---------------- */
/* Standalone website: the browser auto-ensures an anonymous web session
   (POST /api/v1/web/session) and lands directly on the dashboard — no
   Telegram account, Login Widget, or token is ever required. The server
   sets an HttpOnly cookie (the durable identity); the token in the reply
   is additionally kept in memory/sessionStorage for the Authorization
   header transport, exactly like Mini App session tokens. Nothing
   sensitive goes to localStorage. The Mini App never stops on the entry
   view: it authenticates with raw initData and lands on the dashboard
   directly (empty state for first-time users). */
async function ensureWebSession() {
  status(t("statusLoading"), "loading");
  const r = await api("/api/v1/web/session", { method: "POST" });
  setToken(r.sessionToken);
  S.me = r.user;
  if (r.user && r.user.lang) { S.lang = r.user.lang; applyLang(); }
  return r;
}
/* Mini App authentication with RAW initData (server verifies HMAC).
   Shared by boot() and the refreshAll() 401-recovery below so a rejected
   session token triggers exactly one silent re-auth instead of a dead end.
   initData is re-read live on every call; an empty value never POSTs
   (the server would answer 401 invalid_init_data for it). */
async function miniAuth() {
  const live = getLiveInitData();
  if (!live) {
    const err = new Error("empty_init_data");
    err.code = "empty_init_data";
    err.status = 0;
    throw err;
  }
  const r = await api("/api/v1/auth/telegram", {
    method: "POST",
    body: { initData: live },
  });
  setToken(r.sessionToken);
  S.me = r.user;
  if (r.user && r.user.lang) { S.lang = r.user.lang; applyLang(); }
  return r;
}
/* Distinct Mini App failure messages. Previously every code except
   no_session collapsed into errNetwork, hiding expired/forbidden cases. */
function miniAuthError(e) {
  if (!e) { status(t("errNetwork"), "error"); return; }
  if (e.code === "no_session") {
    // Legacy worker response; current backend issues pending instead.
    showNoSession();
    return;
  }
  if (e.code === "expired" || e.code === "empty_init_data") status(t("errExpiredTg"), "error");
  else if (e.code === "forbidden") status(t("errForbiddenTg"), "error");
  else if (e.code === "invalid_signature") status(t("errSigTg"), "error");
  else if (e.code === "missing_hash") status(t("errMissingTg"), "error");
  else if (e.code === "bad_user") status(t("errBadUserTg"), "error");
  else if (e.code === "invalid_init_data") status(t("errInvalidTg"), "error");
  else status(t("errNetwork"), "error");
  showEntry();
  const lh = $("#login-help");
  if (lh) lh.classList.remove("hidden");
}
function showEntry() {
  // Secondary recovery view (explicit user choice only). The normal
  // website flow never lands here on its own — boot() ensures a web
  // session and shows the dashboard instead.
  show("view-login");
}
function showNoSession() {
  // Legacy fallback (e.g. a cached worker that still returns no_session):
  // surface the entry view with guidance toward the bot. With the current
  // backend this path is not hit — first-time users get a pending session
  // and land on the dashboard empty state instead.
  showEntry();
  status(t("noSessionTitle") + " — " + t("noSessionText"), "error");
  const lh = $("#login-help");
  if (lh) lh.classList.remove("hidden");
  const botBtn = $("#btn-open-bot");
  if (botBtn) {
    if (BOT_URL && isHttpUrl(BOT_URL)) {
      botBtn.classList.remove("hidden");
      botBtn.href = BOT_URL;
    } else {
      botBtn.classList.add("hidden");
    }
  }
}
async function boot() {
  applyTheme(); applyLang();
  if (initTelegram()) {
    // Telegram Mini App: authenticate with RAW initData (server verifies HMAC).
    // First-time users receive a pending session (no email yet) and land on
    // the dashboard empty state — never on a recovery-token form.
    // NOTE: this path must never use /api/v1/web/session (Telegram identity).
    status(t("statusLogin"), "loading");
    try {
      await miniAuth();
      await enterMain();
    } catch (e) {
      miniAuthError(e);
    }
    return;
  }
  // Plain browser: standalone temp-mail flow. Returning visitors are
  // recognised via the HttpOnly cookie (or stored token) and land on
  // their dashboard; new visitors get a fresh anonymous web session and
  // land on the dashboard empty state with a Create button. Telegram is
  // never involved; recovery stays behind an explicit secondary toggle
  // (reachable from the dashboard restore button).
  if (S.token) {
    status(t("statusLoading"), "loading");
    try {
      S.me = await api("/api/v1/me");
      if (S.me && S.me.lang) { S.lang = S.me.lang; applyLang(); }
      await enterMain();
      return;
    } catch (e) {
      if (e.status !== 401) { status(t("errNetwork"), "error"); return; }
      setToken("");
      status("", "");
    }
  }
  try {
    await ensureWebSession();
    await enterMain();
  } catch (e) {
    status(t("errNetwork"), "error");
    showEntry();
  }
}
async function loginWithToken(tok) {
  tok = (tok || "").trim();
  if (!/^tmp_[a-z2-9]{6}$/.test(tok)) { status(t("errToken"), "error"); return; }
  status(t("statusLogin"), "loading");
  try {
    const r = await api("/api/v1/auth/token", { method: "POST", body: { token: tok } });
    setToken(r.sessionToken);
    S.me = r.user;
    if (r.user && r.user.lang) { S.lang = r.user.lang; applyLang(); }
    await enterMain();
  } catch (e) {
    status(e.code === "invalid_token" || e.code === "not_found" ? t("errToken") : t("errNetwork"), "error");
  }
}

/* ---------------- main ---------------- */
async function enterMain() {
  show("view-main");
  await refreshAll();
  clearInterval(S.refreshTimer);
  S.refreshTimer = setInterval(() => { if (!document.hidden) loadInbox(true); }, 30000);
}
async function refreshAll() {
  status(t("statusLoading"), "loading");
  try {
    S.me = await api("/api/v1/me");
    renderMe();
    await loadInbox(true);
    status("", "");
  } catch (e) {
    if (e.status === 401 && S.isTg && S.tg) {
      // Mini App session token rejected after a successful auth (dashboard
      // already shown): re-authenticate once with fresh initData instead of
      // wiping the token into a dead end. The token is only cleared if the
      // re-auth itself fails with unauthorized.
      try {
        await miniAuth();
        S.me = await api("/api/v1/me");
        renderMe();
        await loadInbox(true);
        status("", "");
      } catch (e2) {
        if (e2.status === 401) setToken("");
        miniAuthError(e2);
      }
      return;
    }
    if (e.status === 401) {
      setToken("");
      showEntry();
      return;
    }
    status(t("errNetwork"), "error");
  }
}
function renderMe() {
  const em = $("#current-email");
  const meta = $("#email-meta");
  const live = $("#email-live");
  const noBox = $("#no-email-box");
  const has = !!(S.me && S.me.email);
  em.textContent = has ? S.me.email : t("noEmail");
  em.classList.toggle("hidden", !has);
  if (noBox) noBox.classList.toggle("hidden", has);
  if (live) live.classList.toggle("hidden", !has);
  meta.textContent = "";
  if (has) {
    meta.textContent = t("activeReady") + (S.me.createdAt ? " · " + t("createdAt") + " " + S.me.createdAt : "");
  }
  hideConfirm();
}
async function loadInbox(silent) {
  let items = [];
  try {
    const r = await api("/api/v1/inbox?limit=20");
    items = (r && r.items) || [];
  } catch (e) {
    if (!silent) status(t("errNetwork"), "error");
    return;
  }
  S.inbox = items;
  const list = $("#inbox-list");
  list.textContent = "";
  $("#inbox-count").textContent = String(items.length);
  $("#inbox-empty").classList.toggle("hidden", items.length !== 0);
  for (const it of items) list.appendChild(renderItem(it));
}
/* Gmail-like hierarchy: sender + time on the top line, distinct subject,
   secondary truncated preview, compact badges, optional action row.
   The row root is a plain wrapper div; the message button and the action
   anchor are SIBLINGS (an <a> inside a <button> is invalid HTML and
   misbehaves on Safari/keyboard/middle-click). All email content via
   textContent only — no innerHTML, no arbitrary email HTML. */
function renderItem(it) {
  const wrap = el("div", "inbox-wrap");
  const b = el("button", "inbox-item");
  b.type = "button";
  // Top line: sender/service + timestamp.
  const top = el("div", "toprow");
  top.appendChild(el("span", "sender", it.sender || ""));
  top.appendChild(el("span", "time", it.date || ""));
  b.appendChild(top);
  // Distinct subject.
  b.appendChild(el("div", "subj", it.subject || "(No Subject)"));
  // Secondary preview, truncated; omitted entirely when empty (no gap).
  const prevText = it.preview || it.otpCode ? ("🔑 " + (it.otpCode || "") + " " + (it.preview || "")).trim() : "";
  if (prevText) b.appendChild(el("div", "prev", prevText));
  // Compact badges row (only when there is something to show).
  if (it.hasOtp || it.hasLink) {
    const meta = el("div", "meta");
    if (it.hasOtp) meta.appendChild(el("span", "badge", "🔑"));
    if (it.hasLink) meta.appendChild(el("span", "badge", "🔗"));
    b.appendChild(meta);
  }
  b.addEventListener("click", () => openDetail(it.id));
  wrap.appendChild(b);
  // Compact verification action (e.g. Aparat "✅ تایید حساب"): short label
  // only, gated by the existing HTTPS check. The long URL lives in href
  // (never as visible text) so it cannot stretch the layout.
  if (it.activationLink && isHttpUrl(it.activationLink)) {
    const a = el("a", "inbox-action", it.activationLabel || ("🔗 " + t("openLink")));
    a.href = it.activationLink;
    a.target = "_blank";
    a.rel = "noopener";
    wrap.appendChild(a);
  }
  return wrap;
}

/* ---------------- detail ---------------- */
async function openDetail(id) {
  status(t("statusLoading"), "loading");
  try {
    const d = await api("/api/v1/inbox/" + encodeURIComponent(id));
    S.currentDetail = d;
    renderDetail(d);
    status("", "");
    show("view-detail");
    tgHaptic();
  } catch (e) {
    status(t("errNetwork"), "error");
  }
}
function renderDetail(d) {
  $("#detail-service").textContent = d.sender || "";
  $("#detail-subject").textContent = d.subject || "(No Subject)";
  $("#detail-from").textContent = d.sender || "";
  $("#detail-date").textContent = d.date || "";
  // OTP (text only, copyable)
  const otpBox = $("#detail-otp-box");
  if (d.otpCode) { otpBox.classList.remove("hidden"); $("#detail-otp").textContent = d.otpCode; }
  else otpBox.classList.add("hidden");
  // Verification link: ALWAYS a real URL action (Aparat keeps its label).
  const linkBox = $("#detail-link-box");
  const a = $("#detail-link");
  const extra = $("#detail-links-extra");
  extra.textContent = "";
  if (d.activationLink && isHttpUrl(d.activationLink)) {
    linkBox.classList.remove("hidden");
    a.textContent = "🔗 " + (d.activationLabel || t("openLink"));
    a.href = d.activationLink;
    const seen = {};
    seen[d.activationLink] = 1;
    for (const u of (d.links || []).slice(0, 3)) {
      if (!isHttpUrl(u) || seen[u]) continue;
      seen[u] = 1;
      const x = el("a", "extra-link", u);
      x.href = u; x.target = "_blank"; x.rel = "noopener"; x.dir = "ltr";
      extra.appendChild(x);
    }
  } else linkBox.classList.add("hidden");
  // Body as inert text — never markup.
  $("#detail-body").textContent = d.bodyText || "";
}
function backToMain() { show("view-main"); }

/* ---------------- actions ---------------- */
function hideConfirm() {
  const c = $("#confirm-box");
  if (c) c.classList.add("hidden");
}
function askCreate() {
  // Inline two-step confirm (replaces the native confirm dialog):
  // with an active email ask first, without one create immediately.
  $("#new-token-box").classList.add("hidden");
  if (S.me && S.me.email) {
    $("#restore-box").classList.add("hidden");
    $("#confirm-box").classList.remove("hidden");
  } else {
    doCreate();
  }
}
async function doCreate() {
  hideConfirm();
  status(t("statusLoading"), "loading");
  try {
    const r = await api("/api/v1/emails", { method: "POST" });
    S.me = { email: r.email, createdAt: r.createdAt, lang: S.me ? S.me.lang : S.lang };
    if (r.recoveryToken) {
      $("#new-token-box").classList.remove("hidden");
      $("#new-token").textContent = r.recoveryToken;
    }
    renderMe();
    await loadInbox(true);
    status(t("statusCreated"), "ok");
    tgHaptic();
  } catch (e) { status(t("errNetwork"), "error"); }
}
async function doRestore(tok) {
  tok = (tok || "").trim();
  if (!/^tmp_[a-z2-9]{6}$/.test(tok)) { status(t("errToken"), "error"); return; }
  status(t("statusLoading"), "loading");
  try {
    const r = await api("/api/v1/emails/restore", { method: "POST", body: { token: tok } });
    S.me = { email: r.email, createdAt: r.createdAt, lang: S.me ? S.me.lang : S.lang };
    $("#restore-box").classList.add("hidden");
    $("#new-token-box").classList.add("hidden");
    renderMe();
    await loadInbox(true);
    status(t("statusRestored"), "ok");
  } catch (e) {
    status(e.code === "invalid_token" || e.code === "not_found" ? t("errToken") : t("errNetwork"), "error");
  }
}
async function doLang() {
  const next = S.lang === "fa" ? "en" : "fa";
  try { await api("/api/v1/settings/language", { method: "PUT", body: { lang: next } }); } catch (_) {}
  S.lang = next;
  applyLang(); renderMe(); loadInbox(true);
  status(t("statusLang"), "ok");
}

/* ---------------- wire up ---------------- */
document.addEventListener("DOMContentLoaded", () => {
  $("#btn-theme").addEventListener("click", () => {
    // Manual choice is an explicit override: inside Telegram it sets the
    // in-memory override (pure theme, never persisted to tm_theme);
    // in a plain browser it leaves "auto" for an explicit dark/light.
    const next = getEffectiveTheme() === "dark" ? "light" : "dark";
    if (S.isTg) S.tgManual = next;
    else S.theme = next;
    applyTheme();
  });
  $("#btn-lang").addEventListener("click", doLang);
  $("#btn-login").addEventListener("click", () => loginWithToken($("#input-token").value));
  $("#input-token").addEventListener("keydown", (e) => { if (e.key === "Enter") loginWithToken(e.target.value); });
  $("#btn-login-help").addEventListener("click", () => $("#login-help").classList.toggle("hidden"));
  $("#btn-copy-email").addEventListener("click", () => { if (S.me && S.me.email) copyText(S.me.email); });
  $("#btn-refresh").addEventListener("click", refreshAll);
  $("#btn-create-main").addEventListener("click", askCreate);
  $("#btn-confirm-yes").addEventListener("click", doCreate);
  $("#btn-confirm-no").addEventListener("click", hideConfirm);
  $("#btn-restore").addEventListener("click", () => {
    $("#new-token-box").classList.add("hidden");
    $("#restore-box").classList.toggle("hidden");
  });
  $("#btn-cancel-restore").addEventListener("click", () => $("#restore-box").classList.add("hidden"));
  $("#btn-do-restore").addEventListener("click", () => doRestore($("#input-restore").value));
  $("#btn-copy-new-token").addEventListener("click", () => copyText($("#new-token").textContent));
  $("#btn-copy-otp").addEventListener("click", () => copyText($("#detail-otp").textContent));
  $("#btn-copy-body").addEventListener("click", () => copyText($("#detail-body").textContent));
  $("#btn-back").addEventListener("click", backToMain);
  $("#btn-logout").addEventListener("click", async () => {
    // Web logout: ask the server to clear the HttpOnly cookie (JS cannot
    // clear it), drop the in-memory/stored token, and start a fresh
    // anonymous web session on the dashboard. The abandoned email stays
    // recoverable via its recovery token (shown once at creation).
    try { await api("/api/v1/web/logout", { method: "POST" }); } catch (_) {}
    setToken(""); S.me = null; S.inbox = [];
    clearInterval(S.refreshTimer);
    try {
      await ensureWebSession();
      await enterMain();
    } catch (_) {
      showEntry();
    }
  });
  boot();
  // Non-sensitive deployed-version proof: footer tooltip + console line
  // let anyone verify which release Telegram/a browser executes.
  try {
    console.log("[tempmail] build " + BUILD);
    const foot = document.querySelector(".footer span");
    if (foot) foot.title = "build " + BUILD;
  } catch (_) {}
});
