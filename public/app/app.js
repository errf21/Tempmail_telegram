/* TempMail shared frontend — plain browser + Telegram Mini App.
   No dependencies, no build step. All email content is rendered as
   TEXT (textContent / <pre>) — email HTML is never injected as markup.
   Only http(s) URLs are ever turned into clickable anchors. */
"use strict";

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
    btnNew: "ایمیل جدید", btnRestore: "بازگردانی", btnDoRestore: "بازیابی", btnCancel: "انصراف",
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
    errToken: "توکن نامعتبر است. فرمت: tmp_xxxxxx", errUnknown: "خطایی رخ داد.",
    errNoSession: "نشست فعالی برای این حساب نیست. ابتدا در ربات تلگرام یک ایمیل بسازید.",
    noEmail: "هنوز ایمیلی ندارید", activeReady: "فعال و آماده دریافت", createdAt: "ساخته شده:",
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
    btnNew: "New email", btnRestore: "Restore", btnDoRestore: "Restore", btnCancel: "Cancel",
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
    errToken: "Invalid token. Format: tmp_xxxxxx", errUnknown: "Something went wrong.",
    errNoSession: "No active session for this account. Create an email in the Telegram bot first.",
    noEmail: "No email yet", activeReady: "Active and ready", createdAt: "Created:",
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
function initTelegram() {
  try {
    const wa = window.Telegram && window.Telegram.WebApp;
    if (wa && typeof wa.initData === "string" && wa.initData.length > 0) {
      S.tg = wa; S.isTg = true;
      wa.ready();
      try { wa.expand(); } catch (_) {}
      applyTgTheme(wa);
      // Logout makes no sense inside Telegram (identity = Telegram user).
      const lo = $("#btn-logout");
      if (lo) lo.classList.add("hidden");
      return true;
    }
  } catch (_) {}
  return false;
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
    if (wa.colorScheme === "dark") root.setAttribute("data-theme", "dark");
  } catch (_) {}
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
function applyTheme() {
  document.documentElement.setAttribute("data-theme", S.theme);
  $("#btn-theme").textContent = S.theme === "dark" ? "☀️" : "🌙";
  localStorage.setItem("tm_theme", S.theme);
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
function showNoSession() {
  show("view-login");
  status(t("noSessionTitle") + " — " + t("noSessionText"), "error");
  $("#login-help").classList.remove("hidden");
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
    status(t("statusLogin"), "loading");
    try {
      const r = await api("/api/v1/auth/telegram", {
        method: "POST",
        body: { initData: S.tg.initData },
      });
      setToken(r.sessionToken);
      S.me = r.user;
      if (r.user && r.user.lang) { S.lang = r.user.lang; applyLang(); }
      await enterMain();
    } catch (e) {
      if (e.code === "no_session") {
        // Mini App without a prior bot session: the bot is the single
        // authority that creates emails — guide the user there.
        showNoSession();
      } else {
        status(t("errNetwork"), "error");
        show("view-login");
        $("#login-help").classList.remove("hidden");
      }
    }
    return;
  }
  // Plain browser: recovery-token login.
  if (S.token) {
    status(t("statusLoading"), "loading");
    try {
      S.me = await api("/api/v1/me");
      if (S.me.lang) { S.lang = S.me.lang; applyLang(); }
      await enterMain();
    } catch (e) {
      setToken("");
      status("", "");
      show("view-login");
    }
  } else {
    show("view-login");
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
    if (e.status === 401) {
      setToken("");
      if (S.isTg) { status(t("errNetwork"), "error"); } else show("view-login");
      return;
    }
    status(t("errNetwork"), "error");
  }
}
function renderMe() {
  const em = $("#current-email");
  const meta = $("#email-meta");
  em.textContent = "";
  meta.textContent = "";
  if (S.me && S.me.email) {
    em.textContent = S.me.email;
    meta.textContent = "🟢 " + t("activeReady") + (S.me.createdAt ? " · " + t("createdAt") + " " + S.me.createdAt : "");
  } else {
    em.textContent = t("noEmail");
    meta.textContent = "";
  }
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
function renderItem(it) {
  const b = el("button", "inbox-item");
  b.type = "button";
  b.appendChild(el("div", "subj", it.subject || "(No Subject)"));
  b.appendChild(el("div", "prev", it.preview || it.otpCode ? ("🔑 " + (it.otpCode || "") + " " + (it.preview || "")) : ""));
  const row = el("div", "row");
  row.appendChild(el("span", "", it.sender || ""));
  const right = el("span", "");
  right.appendChild(el("span", "", it.date || ""));
  if (it.hasOtp) right.appendChild(el("span", "badge", "🔑"));
  if (it.hasLink) right.appendChild(el("span", "badge", "🔗"));
  row.appendChild(right);
  b.appendChild(row);
  b.addEventListener("click", () => openDetail(it.id));
  return b;
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
async function doCreate() {
  if (!confirm(t("confirmNew"))) return;
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
    S.theme = S.theme === "dark" ? "light" : "dark";
    applyTheme();
  });
  $("#btn-lang").addEventListener("click", doLang);
  $("#btn-login").addEventListener("click", () => loginWithToken($("#input-token").value));
  $("#input-token").addEventListener("keydown", (e) => { if (e.key === "Enter") loginWithToken(e.target.value); });
  $("#btn-login-help").addEventListener("click", () => $("#login-help").classList.toggle("hidden"));
  $("#btn-copy-email").addEventListener("click", () => { if (S.me && S.me.email) copyText(S.me.email); });
  $("#btn-refresh").addEventListener("click", refreshAll);
  $("#btn-new").addEventListener("click", doCreate);
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
  $("#btn-logout").addEventListener("click", () => {
    setToken(""); S.me = null; S.inbox = [];
    clearInterval(S.refreshTimer);
    show("view-login");
  });
  boot();
});
