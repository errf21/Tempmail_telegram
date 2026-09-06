/**
 * Production-Ready Cloudflare Worker for Temp-Mail Telegram Bot
 * Clean, modern, minimal UI with robust self-contained MIME & Quoted-Printable decoder
 * Supports Multi-Language (Persian 🇮🇷 & English 🇬🇧) and Strict Admin Access (ID: 7323774108)
 *
 * D1 migrations (apply with `wrangler d1 migrations apply DB --remote`):
 *   0001_initial.sql   — sessions, email_bindings, inbox, kv_meta
 *   0002_inbox_raw.sql — adds `raw` column to inbox for the lazy full-view
 *   0003_inbox_action.sql — adds `otp_code` and `activation_link` columns so
 *                          the primary alert and the full email view
 *                          always surface the SAME extracted code/link.
 */

const i18n = {
  fa: {
    botTitle: "💎 <b>ربات ایمیل موقت</b>",
    activeEmail: "📧 <b>آدرس ایمیل شما:</b>",
    createdAt: "⏰ <b>زمان ساخت:</b>",
    statusActive: "🟢 <b>وضعیت:</b> فعال و آماده دریافت",
    statusInactive: "🔴 <b>وضعیت:</b> هیچ ایمیلی فعال نیست",
    copyTip: "💡 <i>برای کپی آدرس، کافی است روی باکس ایمیل بالا بزنید.</i>",
    generateTip: "💡 <i>برای ساخت یک ایمیل موقت جدید، روی دکمه زیر بزنید.</i>",
    btnGenerate: "🎲 ساخت ایمیل جدید",
    btnInbox: "📥 صندوق ورودی",
    btnRefresh: "🔄 به‌روزرسانی",
    btnRestore: "🔄 بازگردانی ایمیل",
    btnLang: "🌐 English",
    btnAdmin: "⚙️ تنظیمات مدیریت",
    btnBack: "🔙 بازگشت",
    btnHome: "🏠 بازگشت به منوی اصلی",
    btnCollapse: "↩️ کاهش پیام / پیام کوتاه",
    msgCollapsed: "↩️ بازگشت به پیام کوتاه",
    btnOpenLink: "🔗 باز کردن لینک",
    btnView: (n) => `📖 مشاهده کامل پیام ${n}`,
    btnRefreshInbox: "🔄 به‌روزرسانی صندوق",
    btnConfirmYes: "✅ بله، جدید بساز",
    btnConfirmNo: "❌ انصراف",
    btnCancelRestore: "❌ انصراف",
    confirmNewTitle: "⚠️ <b>تایید ساخت ایمیل جدید</b>",
    confirmNewDesc: "با ساخت ایمیل جدید، ایمیل فعلی و پیام‌های دریافتی آن حذف خواهند شد.\n\nآیا مطمئن هستید؟",
    msgGenerated: "✨ ایمیل جدید ساخته شد!",
    msgNoEmailCreate: "❌ ابتدا یک ایمیل بسازید!",
    msgInboxEmpty: "📭 صندوق ورودی خالی است",
    msgInboxCount: (c) => `📬 ${c} پیام یافت شد`,
    msgRefreshed: "🔄 به‌روزرسانی شد",
    msgDeleted: "🗑 ایمیل حذف شد!",
    msgEmailNotFound: "❌ ایمیل یافت نشد",
    msgViewFull: "📖 نمایش کامل ایمیل",
    msgInvalidCmd: "دستور نامعتبر",
    msgAccessDenied: "⛔️ دسترسی غیرمجاز. تنظیمات و ویرایش ربات فقط برای مدیر (شناسه ۷۳۲۳۷۷۴۱۰۸) مجاز است.",
    msgCancelled: "🚫 عملیات لغو شد",
    msgTokenLabel: "🔑 <b>توکن بازگردانی:</b>",
    msgTokenTip: "💡 <i>برای بازگردانی این ایمیل در آینده، این توکن را نزد خود نگه دارید.</i>",
    inboxTitle: "💎 <b>صندوق ورودی</b>",
    inboxTotal: (c) => `<i>مجموع پیام‌های دریافتی: ${c}</i>`,
    fullEmailTitle: "💎 <b>مشاهده کامل ایمیل</b>",
    restoreAskTitle: "🔄 <b>بازگردانی ایمیل</b>",
    restoreAskDesc: "لطفاً توکن بازگردانی ایمیل خود را ارسال کنید.\n\nفرمت توکن: <code>tmp_xxxxxx</code>",
    restoreSuccess: (email) => `✅ ایمیل شما با موفقیت بازگردانی شد!\n\n📧 <b>آدرس:</b> <code>${email}</code>`,
    restoreNotFound: "❌ توکن یافت نشد. لطفاً دوباره بررسی کنید.",
    restoreInvalid: "❌ فرمت توکن نامعتبر است. توکن باید به شکل <code>tmp_xxxxxx</code> باشد.",
    restoreWrongOwner: "❌ این توکن متعلق به حساب شما نیست.",
    btnHelp: "ℹ️ راهنما",
    btnMiniApp: "📱 ورود به مینی‌اپ",
    btnClose: "❌ بستن",
    helpTitle: "ℹ️ <b>راهنمای استفاده از ربات</b>",
    helpIntro: "این ربات یک آدرس ایمیل موقت برای شما می‌سازد تا بتوانید بدون استفاده از ایمیل اصلی خود، در سایت‌ها ثبت‌نام کنید یا کدهای تایید را دریافت نمایید.",
    helpMultiUser: "👥 <b>چند کاربره:</b> هر کاربر تلگرام با هر اکانت و هر آیدی عددی (چه پرایویت چه گروهی) می‌تواند مستقل از بقیه از ربات استفاده کند. ایمیل فعال، صندوق ورودی و ۵۰ توکن آخر هر کاربر فقط مختص خود اوست و با کاربران دیگر قاطی نمی‌شود.",
    helpTemp: "🔹 <b>ایمیل موقت:</b> هر آدرس متعلق به شماست و تا زمانی که خودتان آن را حذف نکنید فعال باقی می‌ماند. اگر آن را حذف یا با ایمیل دیگری جایگزین کنید، با توکن بازگردانی می‌توانید در هر زمان دوباره به آن دسترسی پیدا کنید.",
    helpHowSection: "📖 <b>عملکرد دکمه‌ها:</b>",
    helpBtnGenerate: "🎲 <b>ساخت ایمیل جدید</b> — یک آدرس جدید می‌سازد. ⚠️ توجه: ایمیل فعلی و پیام‌های آن حذف می‌شوند (توکن ایمیل قبلی برای بازگردانی بعدی نگه‌داری می‌شود). قبل از ساخت، تاییدیه نمایش داده می‌شود.",
    helpBtnInbox: "📥 <b>صندوق ورودی</b> — پیام‌های دریافتی ایمیل فعلی را نشان می‌دهد.",
    helpBtnRefresh: "🔄 <b>به‌روزرسانی</b> — صندوق ورودی یا وضعیت را تازه می‌کند.",
    helpBtnRestore: "🔄 <b>بازگردانی ایمیل</b> — با توکن، ایمیل قبلی خود را بازیابی کنید.",
    helpBtnLang: "🌐 <b>تغییر زبان</b> — بین فارسی و انگلیسی جابجا شوید.",
    helpTokenSection: "🔑 <b>توکن بازگردانی چیست؟</b>",
    helpTokenExplained: "پس از ساخت هر ایمیل، یک توکن کوتاه مثل <code>tmp_abc234</code> به شما نمایش داده می‌شود.\n\n<b>تاریخ انقضا:</b> توکن هیچ تاریخ انقضایی ندارد و در هر زمان قابل استفاده است.\n\n<b>چند ایمیل پشت سر هم:</b> اگر چند ایمیل بسازید، توکن ایمیل فعلی به‌علاوه توکن <b>۵۰ ایمیل قبلی</b> شما نگه‌داری می‌شود. یعنی می‌توانید با هر کدام از این توکن‌ها، ایمیل مربوطه را برگردانید.\n\n<b>سقف ۵۰ توکن:</b> اگر بیش از ۵۰ ایمیل بسازید، قدیمی‌ترین توکن به‌طور خودکار حذف می‌شود و دیگر قابل بازگردانی نیست. برای استفاده معمولی (چند ایمیل در ماه) این سقف بیش از کافی است.\n\n<b>چه زمانی ممکن است به توکن نیاز پیدا کنید؟</b>\n• اگر ایمیل فعال را به‌اشتباه حذف کنید.\n• اگر ربات را از اول نصب کنید و بخواهید به ایمیل قبلی برگردید.\n• اگر بخواهید از دستگاه دیگری به همان ایمیل دسترسی داشته باشید.\n\nبرای بازگردانی کافی است دکمه «بازگردانی ایمیل» را بزنید و یکی از توکن‌های قبلی خود را ارسال کنید.",
    helpTip: "💡 <i>برای بستن این پیام، دکمه زیر را بزنید.</i>",
    sender: "فرستنده",
    subject: "موضوع",
    date: "تاریخ",
    fullBody: "متن کامل پیام",
    linksTitle: "🔗 <b>لینک‌های تایید و عملیاتی:</b>",
    linkVerify: "✅ تایید حساب",
    linkReset: "🔑 بازیابی رمز عبور",
    linkLogin: "🔐 ورود به حساب",
    linkDefault: "🔗 باز کردن لینک",
    linkOp: "🔗 لینک عملیاتی",
    serviceFallback: "پیام جدید",
    otpLabel: "کد تایید",
    subjectLabel: "موضوع",
    previewLabel: "پیش‌نمایش",
    summarySuffix: "\n\n<i>(...پیام خلاصه شد)</i>",
    adminTitle: "⚙️ <b>تنظیمات و پیکربندی ربات (مدیر)</b>",
    adminDesc: "فقط کاربر ۷۳۲۳۷۷۴۱۰۸ به این بخش دسترسی دارد.",
    adminDomain: "دامنه فعال:",
    adminWebhook: "تنظیم وب‌هوک",
    adminBack: "🏠 بازگشت به منوی اصلی"
  },
  en: {
    botTitle: "💎 <b>Temporary Mail Bot</b>",
    activeEmail: "📧 <b>Your Email Address:</b>",
    createdAt: "⏰ <b>Created At:</b>",
    statusActive: "🟢 <b>Status:</b> Active and ready to receive",
    statusInactive: "🔴 <b>Status:</b> No active email",
    copyTip: "💡 <i>Tap the email box above to copy your address.</i>",
    generateTip: "💡 <i>Tap the button below to generate a new temporary email.</i>",
    btnGenerate: "🎲 Generate New Email",
    btnInbox: "📥 Inbox",
    btnRefresh: "🔄 Refresh",
    btnRestore: "🔄 Restore Email",
    btnLang: "🌐 فارسی",
    btnAdmin: "⚙️ Admin Settings",
    btnBack: "🔙 Back",
    btnHome: "🏠 Main Menu",
    btnCollapse: "↩️ Collapse / Short Alert",
    msgCollapsed: "↩️ Returned to short alert",
    btnOpenLink: "🔗 Open Link",
    btnView: (n) => `📖 View Full Message ${n}`,
    btnRefreshInbox: "🔄 Refresh Inbox",
    btnConfirmYes: "✅ Yes, Create New",
    btnConfirmNo: "❌ Cancel",
    btnCancelRestore: "❌ Cancel",
    confirmNewTitle: "⚠️ <b>Confirm New Email</b>",
    confirmNewDesc: "Generating a new email will delete your current email and all of its received messages.\n\nAre you sure?",
    msgGenerated: "✨ New email generated!",
    msgNoEmailCreate: "❌ Please generate an email first!",
    msgInboxEmpty: "📭 Inbox is empty",
    msgInboxCount: (c) => `📬 Found ${c} message(s)`,
    msgRefreshed: "🔄 Refreshed",
    msgDeleted: "🗑 Email deleted!",
    msgEmailNotFound: "❌ Email not found",
    msgViewFull: "📖 Viewing full email",
    msgInvalidCmd: "Invalid command",
    msgAccessDenied: "⛔️ Access denied. Bot edit and configuration settings are restricted to the administrator (ID: 7323774108) only.",
    msgCancelled: "🚫 Operation cancelled",
    msgTokenLabel: "🔑 <b>Recovery Token:</b>",
    msgTokenTip: "💡 <i>Keep this token safe to restore this email in the future.</i>",
    inboxTitle: "💎 <b>Inbox</b>",
    inboxTotal: (c) => `<i>Total received messages: ${c}</i>`,
    fullEmailTitle: "💎 <b>View Full Email</b>",
    restoreAskTitle: "🔄 <b>Restore Email</b>",
    restoreAskDesc: "Please send your email recovery token.\n\nToken format: <code>tmp_xxxxxx</code>",
    restoreSuccess: (email) => `✅ Your email has been restored successfully!\n\n📧 <b>Address:</b> <code>${email}</code>`,
    restoreNotFound: "❌ Token not found. Please check and try again.",
    restoreInvalid: "❌ Invalid token format. Token must look like <code>tmp_xxxxxx</code>.",
    restoreWrongOwner: "❌ This token does not belong to your account.",
    btnHelp: "ℹ️ Help",
    btnMiniApp: "📱 Open Mini App",
    btnClose: "❌ Close",
    helpTitle: "ℹ️ <b>How to use this bot</b>",
    helpIntro: "This bot creates a temporary email address for you so you can sign up on websites or receive verification codes without exposing your real inbox.",
    helpMultiUser: "👥 <b>Multi-user:</b> Every Telegram user — with any account and any numeric ID (private or group) — can use the bot independently. Your active email, inbox, and last 50 recovery tokens are private to you and never mixed with other users.",
    helpTemp: "🔹 <b>Temporary email:</b> Each address belongs to you and stays active until you delete it yourself. If you delete it or switch to another one, you can always come back to it at any time using its recovery token.",
    helpHowSection: "📖 <b>What each button does:</b>",
    helpBtnGenerate: "🎲 <b>Generate New Email</b> — Creates a new address. ⚠️ Note: this also deletes your current email and its messages (the old email's token is kept so you can restore it later). A confirmation prompt is shown first.",
    helpBtnInbox: "📥 <b>Inbox</b> — Shows messages received by your current email.",
    helpBtnRefresh: "🔄 <b>Refresh</b> — Reloads the inbox or dashboard state.",
    helpBtnRestore: "🔄 <b>Restore Email</b> — Restore a previous email using its recovery token.",
    helpBtnLang: "🌐 <b>Language</b> — Switch between English and Persian.",
    helpTokenSection: "🔑 <b>What is the recovery token?</b>",
    helpTokenExplained: "When you create a new email, a short token like <code>tmp_abc234</code> is shown to you.\n\n<b>Expiry:</b> The token never expires and can be used at any time.\n\n<b>Multiple emails:</b> If you generate more than one email, the token for the current email plus the tokens for your <b>50 most recent previous emails</b> are kept. You can use any of these tokens to restore the matching email address at any time.\n\n<b>50-token limit:</b> If you generate more than 50 emails, the oldest token is deleted automatically and can no longer be used to restore that email. For normal use (a few emails per month) this limit is more than enough.\n\n<b>When might you need a token?</b>\n• You accidentally delete your active email.\n• You reinstall the bot and want to recover your old address.\n• You want to access the same email from a different device.\n\nTo restore, tap “Restore Email” and send one of your previous tokens.",
    helpTip: "💡 <i>Tap the button below to close this message.</i>",
    sender: "Sender",
    subject: "Subject",
    date: "Date",
    fullBody: "Full Message Body",
    linksTitle: "🔗 <b>Verification & Action Links:</b>",
    linkVerify: "✅ Verify Account",
    linkReset: "🔑 Reset Password",
    linkLogin: "🔐 Sign In",
    linkDefault: "🔗 Open Link",
    linkOp: "🔗 Action Link",
    serviceFallback: "New Message",
    otpLabel: "Verification Code",
    subjectLabel: "Subject",
    previewLabel: "Preview",
    summarySuffix: "\n\n<i>(...message summarized)</i>",
    adminTitle: "⚙️ <b>Bot Settings & Configuration (Admin)</b>",
    adminDesc: "Restricted to user 7323774108 only.",
    adminDomain: "Active Domain:",
    adminWebhook: "Set Webhook",
    adminBack: "🏠 Main Menu"
  }
};

async function getUserLang(chatId, env) {
  try {
    const row = await db.getSession(env, chatId);
    return row && row.lang === "en" ? "en" : "fa";
  } catch (e) {
    return "fa";
  }
}

/* ==========================================================================
   D1 Storage Layer (db.* helpers)
   ========================================================================== */

/**
 * Thin wrapper around Cloudflare D1 (SQLite) used by the worker.
 *
 * Design notes:
 * - Every helper is wrapped in try/catch and returns `null` on failure.
 *   Callers must check for `null` and degrade gracefully. A D1 outage
 *   should never crash the handler.
 * - All statements use parameter binding (?1, ?2, ...) to prevent SQL
 *   injection. Never concatenate user input into SQL.
 * - The hot path (sessions primary-key lookup, latest 20 inbox rows) is
 *   index-only; see migrations/0001_initial.sql.
 *
 * Lazy schema bootstrap
 * ---------------------
 * The `email_tokens` table (migration 0004) is created on the FIRST db.*
 * call if it doesn't already exist. This avoids a hard dependency on
 * running `wrangler d1 migrations apply` separately — the worker
 * self-heals its D1 schema the first time it's used. All DDL is
 * idempotent (IF NOT EXISTS) so concurrent first-call races are safe
 * (the second call just sees the table already there).
 */
let _schemaBootstrapped = null;
async function ensureSchema(env) {
  if (_schemaBootstrapped) return _schemaBootstrapped;
  if (!env || !env.DB) {
    _schemaBootstrapped = Promise.resolve(false);
    return _schemaBootstrapped;
  }
  _schemaBootstrapped = (async () => {
    try {
      await env.DB.batch([
        env.DB.prepare(
          "CREATE TABLE IF NOT EXISTS email_tokens (" +
          "token TEXT PRIMARY KEY, " +
          "chat_id TEXT NOT NULL, " +
          "email TEXT NOT NULL, " +
          "created_at TEXT NOT NULL, " +
          "lang TEXT NOT NULL DEFAULT 'fa'" +
          ") WITHOUT ROWID"
        ),
        env.DB.prepare(
          "CREATE INDEX IF NOT EXISTS idx_email_tokens_chat_created " +
          "ON email_tokens(chat_id, created_at DESC)"
        )
      ]);
      return true;
    } catch (e) {
      // If the D1 binding is read-only or the runtime blocks DDL (some
      // Workers setups do), the existing defensive try/catch in the
      // archive/get functions still keeps the worker healthy. We log
      // once and move on.
      console.error(`[ensureSchema] bootstrap failed: ${e && e.message ? e.message : e}`);
      return false;
    }
  })();
  return _schemaBootstrapped;
}

const db = {
  // ---- sessions -----------------------------------------------------------

  async getSession(env, chatId) {
    try {
      if (!env.DB || chatId == null) return null;
      const row = await env.DB.prepare(
        "SELECT chat_id AS chatId, email, created_at AS createdAt, recovery_token AS recoveryToken, lang FROM sessions WHERE chat_id = ?1"
      ).bind(String(chatId)).first();
      return row || null;
    } catch (e) {
      console.error(`[db.getSession] ${e && e.message ? e.message : e}`);
      return null;
    }
  },

  async getSessionByEmail(env, email) {
    try {
      if (!env.DB || !email) return null;
      const row = await env.DB.prepare(
        "SELECT chat_id AS chatId, email, created_at AS createdAt, recovery_token AS recoveryToken, lang FROM sessions WHERE email = ?1"
      ).bind(String(email).toLowerCase()).first();
      return row || null;
    } catch (e) {
      console.error(`[db.getSessionByEmail] ${e && e.message ? e.message : e}`);
      return null;
    }
  },

  async getSessionByToken(env, token) {
    try {
      if (!env.DB || !token) return null;
      const row = await env.DB.prepare(
        "SELECT chat_id AS chatId, email, created_at AS createdAt, recovery_token AS recoveryToken, lang FROM sessions WHERE recovery_token = ?1"
      ).bind(String(token)).first();
      return row || null;
    } catch (e) {
      console.error(`[db.getSessionByToken] ${e && e.message ? e.message : e}`);
      return null;
    }
  },

  // Look up a token in the email_tokens archive (created by migration
  // 0004). This is the fallback for restore when the token was already
  // overwritten in sessions by a later email creation. The shape of the
  // returned row mirrors getSessionByToken() so callers can treat both
  // results uniformly.
  //
  // Defensive: if the email_tokens table hasn't been created yet (e.g.
  // the migration was deployed later than the code), the SELECT throws
  // "no such table" — we catch and return null so the restore path
  // falls back to restoreNotFound instead of crashing. Once the
  // migration is applied, archived tokens work as designed.
  async getArchivedToken(env, token) {
    try {
      if (!env.DB || !token) return null;
      // Self-heal: if migration 0004 hasn't been run externally, create
      // the table now so this query can succeed.
      await ensureSchema(env);
      const row = await env.DB.prepare(
        "SELECT chat_id AS chatId, email, created_at AS createdAt, token AS recoveryToken, lang FROM email_tokens WHERE token = ?1"
      ).bind(String(token)).first();
      if (!row) return null;
      // Normalize: lang might be missing on very old rows; default to fa
      // to match the sessions-table default.
      if (!row.lang) row.lang = "fa";
      return row;
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      // Only swallow "no such table" / "no such column" — these signal
      // that migration 0004 hasn't run yet on this DB. Any other error
      // is unexpected and should still be logged loudly so we catch
      // real bugs.
      if (/no such table|email_tokens/i.test(msg)) {
        console.log(`[db.getArchivedToken] email_tokens table not yet present (run migration 0004)`);
        return null;
      }
      console.error(`[db.getArchivedToken] ${msg}`);
      return null;
    }
  },

  // Archive a (chat_id, email, token) triple into email_tokens. Called by
  // confirm_generate_yes BEFORE upsertSession overwrites the old token
  // in sessions, so the user can later restore the previous email.
  //
  // On collision (same token was already archived) we silently skip — the
  // existing archived row already has the right binding, and updating it
  // would clobber a useful piece of history. Inserts a fresh row only
  // when the token is genuinely new to the archive.
  //
  // After the insert, enforces a per-chat cap (ARCHIVE_TOKEN_LIMIT, see
  // top of file) by deleting the oldest archived rows for that chat.
  // This bounds storage so a chat that generates hundreds of emails
  // can't fill the D1 database.
  //
  // Defensive: returns false (and does not throw) if the email_tokens
  // table isn't present yet (migration 0004 not applied). This means
  // the worker runs safely even if the code is deployed before the
  // migration — the old "overwrite" behavior remains, and once the
  // migration is applied, archiving starts working automatically.
  async archiveToken(env, chatId, email, token, lang, createdAt) {
    try {
      if (!env.DB || !chatId || !email || !token) return false;
      // Self-heal: see comment in getArchivedToken.
      await ensureSchema(env);
      const langVal = (lang === "en") ? "en" : "fa";
      const ts = String(createdAt || new Date().toISOString());
      await env.DB.batch([
        env.DB.prepare(
          "INSERT OR IGNORE INTO email_tokens(token, chat_id, email, created_at, lang) " +
          "VALUES (?1, ?2, ?3, ?4, ?5)"
        ).bind(
          String(token),
          String(chatId),
          String(email).toLowerCase(),
          ts,
          langVal
        ),
        // Cap: keep the ARCHIVE_TOKEN_LIMIT most recent archived tokens
        // per chat. Rows that happen to be the same token as the
        // current live sessions row (extremely rare — only if the same
        // token reappears) are also archived, but that's harmless.
        env.DB.prepare(
          "DELETE FROM email_tokens " +
          "WHERE chat_id = ?1 " +
          "AND token NOT IN (SELECT token FROM email_tokens WHERE chat_id = ?1 ORDER BY created_at DESC LIMIT ?2)"
        ).bind(String(chatId), ARCHIVE_TOKEN_LIMIT)
      ]);
      return true;
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      // Swallow the "no such table" error so the worker can run before
      // the migration. Any other error is logged.
      if (/no such table|email_tokens/i.test(msg)) {
        console.log(`[db.archiveToken] email_tokens table not yet present (run migration 0004)`);
        return false;
      }
      console.error(`[db.archiveToken] ${msg}`);
      return false;
    }
  },

  // Best-effort purge of archived tokens to keep at most `keepN` per
  // chat. Exposed as a separate helper for tests; the inline cap inside
  // archiveToken() is what runs in production.
  async purgeArchivedTokens(env, chatId, keepN) {
    try {
      if (!env.DB || !chatId) return false;
      // Self-heal: see comment in getArchivedToken.
      await ensureSchema(env);
      const n = (typeof keepN === "number" && keepN > 0) ? keepN : ARCHIVE_TOKEN_LIMIT;
      await env.DB.prepare(
        "DELETE FROM email_tokens " +
        "WHERE chat_id = ?1 " +
        "AND token NOT IN (SELECT token FROM email_tokens WHERE chat_id = ?1 ORDER BY created_at DESC LIMIT ?2)"
      ).bind(String(chatId), n).run();
      return true;
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (/no such table|email_tokens/i.test(msg)) {
        console.log(`[db.purgeArchivedTokens] email_tokens table not yet present (run migration 0004)`);
        return false;
      }
      console.error(`[db.purgeArchivedTokens] ${msg}`);
      return false;
    }
  },

  async tokenInUse(env, token) {
    try {
      if (!env.DB || !token) return false;
      const row = await env.DB.prepare(
        "SELECT 1 AS x FROM sessions WHERE recovery_token = ?1 LIMIT 1"
      ).bind(String(token)).first();
      return !!row;
    } catch (e) {
      console.error(`[db.tokenInUse] ${e && e.message ? e.message : e}`);
      return false;
    }
  },

  /**
   * Insert or replace a session row. Also writes the email_bindings row in
   * the same call so the email() handler can resolve incoming mail.
   * On conflict, updates the email/created_at/recovery_token/lang fields
   * so generate / restore / language toggle all share the same code path.
   */
  async upsertSession(env, chatId, email, createdAt, recoveryToken, lang) {
    try {
      if (!env.DB || chatId == null || !email) return false;
      const langVal = (lang === "en") ? "en" : "fa";
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO sessions(chat_id, email, created_at, recovery_token, lang) VALUES (?1, ?2, ?3, ?4, ?5) " +
          "ON CONFLICT(chat_id) DO UPDATE SET email = excluded.email, created_at = excluded.created_at, recovery_token = excluded.recovery_token, lang = excluded.lang"
        ).bind(String(chatId), String(email).toLowerCase(), String(createdAt || ""), String(recoveryToken || ""), langVal),
        env.DB.prepare(
          "INSERT INTO email_bindings(email, chat_id) VALUES (?1, ?2) " +
          "ON CONFLICT(email) DO UPDATE SET chat_id = excluded.chat_id"
        ).bind(String(email).toLowerCase(), String(chatId))
      ]);
      return true;
    } catch (e) {
      console.error(`[db.upsertSession] ${e && e.message ? e.message : e}`);
      return false;
    }
  },

  async setLang(env, chatId, lang) {
    try {
      if (!env.DB || chatId == null) return false;
      const langVal = (lang === "en") ? "en" : "fa";
      await env.DB.prepare(
        "UPDATE sessions SET lang = ?2 WHERE chat_id = ?1"
      ).bind(String(chatId), langVal).run();
      return true;
    } catch (e) {
      console.error(`[db.setLang] ${e && e.message ? e.message : e}`);
      return false;
    }
  },

  async deleteSession(env, chatId) {
    try {
      if (!env.DB || chatId == null) return false;
      await env.DB.batch([
        env.DB.prepare("DELETE FROM sessions WHERE chat_id = ?1").bind(String(chatId)),
        env.DB.prepare("DELETE FROM email_bindings WHERE chat_id = ?1").bind(String(chatId))
      ]);
      return true;
    } catch (e) {
      console.error(`[db.deleteSession] ${e && e.message ? e.message : e}`);
      return false;
    }
  },

  // ---- email_bindings ----------------------------------------------------

  async getBindingByEmail(env, email) {
    try {
      if (!env.DB || !email) return null;
      const row = await env.DB.prepare(
        "SELECT chat_id AS chatId FROM email_bindings WHERE email = ?1"
      ).bind(String(email).toLowerCase()).first();
      return row && row.chatId ? row.chatId : null;
    } catch (e) {
      console.error(`[db.getBindingByEmail] ${e && e.message ? e.message : e}`);
      return null;
    }
  },

  async deleteBindingByEmail(env, email) {
    try {
      if (!env.DB || !email) return false;
      await env.DB.prepare(
        "DELETE FROM email_bindings WHERE email = ?1"
      ).bind(String(email).toLowerCase()).run();
      return true;
    } catch (e) {
      console.error(`[db.deleteBindingByEmail] ${e && e.message ? e.message : e}`);
      return false;
    }
  },

  // ---- inbox -------------------------------------------------------------

  async listInbox(env, email) {
    try {
      if (!env.DB || !email) return [];
      const res = await env.DB.prepare(
        "SELECT id, ts, sender, subject, body, links_json AS linksJson, date_str AS dateStr, raw, otp_code AS otpCode, activation_link AS activationLink FROM inbox WHERE email = ?1 ORDER BY ts DESC LIMIT 20"
      ).bind(String(email).toLowerCase()).all();
      const rows = (res && res.results) ? res.results : [];
      return rows.map(r => {
        let links = [];
        try { links = JSON.parse(r.linksJson || "[]"); } catch (e) { links = []; }
        return {
          id: r.id,
          ts: r.ts,
          from: r.sender,
          subject: r.subject,
          body: r.body,
          links: links,
          date: r.dateStr,
          raw: r.raw || "",
          otpCode: r.otpCode || "",
          activationLink: r.activationLink || ""
        };
      });
    } catch (e) {
      console.error(`[db.listInbox] ${e && e.message ? e.message : e}`);
      return [];
    }
  },

  /**
   * Append an email to a recipient's inbox, then enforce the 20-item cap
   * with a single DELETE…NOT IN (SELECT … LIMIT 20). D1 serializes writes
   * per database, so the two statements are safe in the email() handler.
   * The raw MIME body is saved so the View callback can re-parse lazily.
   *
   * `otp_code` and `activation_link` are persisted so renderFullEmail()
   * (the View Full Message callback) can render the EXACT same code/link
   * the user originally saw in the primary alert. Without these columns
   * the two views would each re-parse the body independently and could
   * surface different numbers (Bug 2 in the latest bug report).
   */
  async appendInbox(env, email, item) {
    try {
      if (!env.DB || !email || !item || !item.id) return false;
      const em = String(email).toLowerCase();
      const linksJson = JSON.stringify(Array.isArray(item.links) ? item.links : []);
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO inbox(email, id, ts, sender, subject, body, links_json, date_str, raw, otp_code, activation_link) " +
          "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) " +
          "ON CONFLICT(email, id) DO NOTHING"
        ).bind(
          em,
          String(item.id),
          Number(item.ts) || Date.now(),
          String(item.from || ""),
          String(item.subject || ""),
          String(item.body || ""),
          linksJson,
          String(item.date || ""),
          String(item.raw || ""),
          String(item.otpCode || ""),
          String(item.activationLink || "")
        ),
        env.DB.prepare(
          "DELETE FROM inbox WHERE email = ?1 AND id NOT IN (SELECT id FROM inbox WHERE email = ?1 ORDER BY ts DESC LIMIT 20)"
        ).bind(em)
      ]);
      return true;
    } catch (e) {
      console.error(`[db.appendInbox] ${e && e.message ? e.message : e}`);
      return false;
    }
  },

  async clearInbox(env, email) {
    try {
      if (!env.DB || !email) return false;
      await env.DB.prepare(
        "DELETE FROM inbox WHERE email = ?1"
      ).bind(String(email).toLowerCase()).run();
      return true;
    } catch (e) {
      console.error(`[db.clearInbox] ${e && e.message ? e.message : e}`);
      return false;
    }
  },

  // Update only the otp_code / activation_link columns for a single inbox
  // row. Used by renderFullEmail() to backfill legacy entries (written
  // before the 0003 migration populated these columns) once the user
  // actually opens them — so subsequent views and the collapse callback
  // can use the persisted action without re-running extractFast().
  async updateInboxAction(env, email, id, otpCode, activationLink) {
    try {
      if (!env.DB || !email || !id) return false;
      await env.DB.prepare(
        "UPDATE inbox SET otp_code = ?1, activation_link = ?2 " +
        "WHERE email = ?3 AND id = ?4"
      ).bind(
        String(otpCode || ""),
        String(activationLink || ""),
        String(email).toLowerCase(),
        String(id)
      ).run();
      return true;
    } catch (e) {
      console.error(`[db.updateInboxAction] ${e && e.message ? e.message : e}`);
      return false;
    }
  },

  // ---- kv_meta -----------------------------------------------------------

  async getState(env, chatId) {
    try {
      if (!env.DB || chatId == null) return null;
      const row = await env.DB.prepare(
        "SELECT v FROM kv_meta WHERE k = ?1"
      ).bind("state:" + String(chatId)).first();
      return row && row.v ? row.v : null;
    } catch (e) {
      console.error(`[db.getState] ${e && e.message ? e.message : e}`);
      return null;
    }
  },

  async setState(env, chatId, value) {
    try {
      if (!env.DB || chatId == null) return false;
      await env.DB.prepare(
        "INSERT INTO kv_meta(k, v) VALUES (?1, ?2) " +
        "ON CONFLICT(k) DO UPDATE SET v = excluded.v"
      ).bind("state:" + String(chatId), String(value || "")).run();
      return true;
    } catch (e) {
      console.error(`[db.setState] ${e && e.message ? e.message : e}`);
      return false;
    }
  },

  async clearState(env, chatId) {
    try {
      if (!env.DB || chatId == null) return false;
      await env.DB.prepare(
        "DELETE FROM kv_meta WHERE k = ?1"
      ).bind("state:" + String(chatId)).run();
      return true;
    } catch (e) {
      console.error(`[db.clearState] ${e && e.message ? e.message : e}`);
      return false;
    }
  }
};

/* ==========================================================================
   Recovery Token Helpers
   Token format: tmp_xxxxxx where xxxxxx is 6 chars from a 32-char alphabet
   (lowercase a-z + 2-9, excluding visually ambiguous 0/o/1/l/i).
   ========================================================================== */

const RECOVERY_TOKEN_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const RECOVERY_TOKEN_REGEX = /^tmp_[a-z2-9]{6}$/;

function generateRecoveryToken() {
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  let out = "tmp_";
  for (let i = 0; i < 6; i++) {
    out += RECOVERY_TOKEN_ALPHABET[buf[i] % RECOVERY_TOKEN_ALPHABET.length];
  }
  return out;
}

function isValidRecoveryToken(text) {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  return RECOVERY_TOKEN_REGEX.test(trimmed);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/set-webhook") {
      if (!env.BOT_TOKEN || env.BOT_TOKEN === "YOUR_TELEGRAM_BOT_TOKEN") {
        return new Response("Error: BOT_TOKEN is not configured.", { status: 400 });
      }
      const webhookUrl = `${url.origin}/webhook`;
      const tgRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
      const data = await tgRes.json();
      return new Response(JSON.stringify(data, null, 2), {
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }

    // One-time (idempotent) setup: pin the permanent chat Menu Button
    // ("📱 ورود به مینی‌اپ") that opens the Mini App URL above.
    // Same pattern/security as /set-webhook: server-side BOT_TOKEN only.
    if (request.method === "GET" && url.pathname === "/set-menu-button") {
      if (!env.BOT_TOKEN || env.BOT_TOKEN === "YOUR_TELEGRAM_BOT_TOKEN") {
        return new Response("Error: BOT_TOKEN is not configured.", { status: 400 });
      }
      const tgRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/setChatMenuButton`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          menu_button: {
            type: "web_app",
            text: i18n.fa.btnMiniApp,
            web_app: { url: MINI_APP_URL }
          }
        })
      });
      const data = await tgRes.json();
      return new Response(JSON.stringify(data, null, 2), {
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(
        `Temp-Mail Telegram Bot Worker is Active.\nDomain: ${env.DOMAIN || "Not configured"}\nSet webhook via: GET /set-webhook`,
        { headers: { "Content-Type": "text/plain; charset=utf-8" } }
      );
    }

    if (request.method === "POST" && (url.pathname === "/webhook" || url.pathname === "/")) {
      try {
        const update = await request.json();

        if (update.message) {
          await handleMessage(update.message, env);
        } else if (update.callback_query) {
          await handleCallbackQuery(update.callback_query, env);
        }

        return new Response("OK", { status: 200 });
      } catch (err) {
        console.error("Error processing update:", err);
        return new Response("Error processing update", { status: 500 });
      }
    }

    if (isWebApiPath(url.pathname)) {
      return await handleWebApi(request, env, url);
    }

    if (request.method === "GET" && isWebAppPath(url.pathname)) {
      return await serveWebApp(request, env, url);
    }

    return new Response("Not Found", { status: 404 });
  },

  async email(message, env, ctx) {
    // ==== ABSOLUTE TOP-LEVEL GUARD ============================================
    // Per architecture: nothing inside this handler may re-throw. Every
    // failure path resolves to either a successful Telegram notification
    // or a silent return so Cloudflare marks the email as "Handled".
    try {
      // 1) Read identifying fields FIRST, with their own try-catch.
      let recipient = "";
      let sender = "";
      let subject = "";
      let dateStr = "";
      try {
        recipient = (message && message.to ? String(message.to) : "").toLowerCase().trim();
        sender = decodeMimeHeader((message && message.from) ? String(message.from) : "");
        const subjectHeader = (message && message.headers && typeof message.headers.get === "function")
          ? (message.headers.get("subject") || message.headers.get("Subject") || "(No Subject)")
          : "(No Subject)";
        subject = decodeMimeHeader(subjectHeader);
        dateStr = new Date().toLocaleTimeString("fa-IR", { timeZone: "Asia/Tehran" }) + " - " + new Date().toISOString().split("T")[0];
      } catch (headerErr) {
        console.error(`[email-in] header read failed: ${headerErr && headerErr.stack ? headerErr.stack : headerErr}`);
      }
      console.log(`[email-in] to=${JSON.stringify(recipient)} from=${JSON.stringify(sender)} subject=${JSON.stringify(subject)}`);

      // 2) Resolve the binding via D1. If anything fails, we still try to
      //    send a header-only fallback notification (no parser touched).
      let chatId = null;
      let lang = "fa";
      try {
        if (recipient) {
          chatId = await db.getBindingByEmail(env, recipient);
          if (chatId) {
            try { lang = await getUserLang(chatId, env); } catch (e) { lang = "fa"; }
          }
        }
      } catch (bindErr) {
        console.error(`[email-in] binding lookup failed: ${bindErr && bindErr.stack ? bindErr.stack : bindErr}`);
      }
      if (!chatId) {
        console.log(`[email-in] binding=MISSING for recipient=${recipient} (no chat session bound, dropping silently)`);
        return;
      }
      const t = i18n[lang] || i18n.fa;

      // 3) Helper: build & send a guaranteed-safe header-only notification.
      //    Same FSI/PDI bidi isolation as the full notification (see step 6).
      const sendHeadersOnlyNotification = async (extra) => {
        try {
          const text =
            `💎 <b>${lang === "en" ? "New Email Received" : "پیام جدید دریافت شد"}</b>\n` +
            `━━━━━━━━━━━━━━━\n\n` +
            `📧 <b>${lang === "en" ? "Sender" : "فرستنده"}:</b> <code>\u2066${escapeHtml(sender || "(unknown)")}\u2069</code>\n` +
            `📬 <b>${lang === "en" ? "Recipient" : "گیرنده"}:</b> <code>\u2066${escapeHtml(recipient || "(unknown)")}\u2069</code>\n` +
            `📌 <b>${lang === "en" ? "Subject" : "موضوع"}:</b> <code>\u2066${escapeHtml(subject || "(No Subject)")}\u2069</code>\n` +
            `📅 <b>${lang === "en" ? "Date" : "تاریخ"}:</b> <code>\u2066${escapeHtml(dateStr)}\u2069</code>\n\n` +
            (extra ? `${extra}\n` : "") +
            `━━━━━━━━━━━━━━━`;
          await sendTelegramMessage(env.BOT_TOKEN, chatId, text, {
            inline_keyboard: [
              [{ text: t.btnInbox, callback_data: "inbox" }]
            ]
          });
          console.log(`[email-in] headers-only notified chatId=${chatId}`);
        } catch (fallbackErr) {
          console.error(`[email-in] headers-only notify failed: ${fallbackErr && fallbackErr.stack ? fallbackErr.stack : fallbackErr}`);
        }
      };

      // 4) Read the raw body inside a secondary try-catch. No heavy MIME
      //    parsing, no postal-mime, no mimetext. We just decode the bytes
      //    and run a single regex to extract verification codes.
      let rawEmailText = "";
      try {
        const rawBytes = await streamToArrayBuffer(message && message.raw);
        if (rawBytes != null) {
          try {
            rawEmailText = new TextDecoder("utf-8", { fatal: false }).decode(rawBytes);
          } catch (e) {
            try { rawEmailText = new TextDecoder("latin1", { fatal: false }).decode(rawBytes); }
            catch (e2) { rawEmailText = ""; }
          }
        }
      } catch (bodyErr) {
        console.error(`[email-in] body read failed: ${bodyErr && bodyErr.stack ? bodyErr.stack : bodyErr}`);
        await sendHeadersOnlyNotification(lang === "en" ? "<i>Body could not be read.</i>" : "<i>خواندن بدنه ایمیل ناموفق بود.</i>");
        return;
      }

      // 5) Extract activation link + OTP code from the email body.
      //
      //    Why we use extractFast() unconditionally here:
      //    -----------------------------------------------
      //    The full parseEmailBody() pipeline (multipass QP decode,
      //    stripHtmlTags with CSS-block stripping, cleanText with
      //    mojibake round-trip) takes 10+ seconds of CPU on as little
      //    as 30 KB of input — Cloudflare's GraphQL shows it hitting
      //    "exceededResources" with cpuTime=2.01s. Root cause: a
      //    catastrophic-backtracking regex inside stripCssArtifacts /
      //    looksLikeCssLine that is called per-line on every input.
      //    The "Telegram notification" only needs the activation link,
      //    the OTP code, and a 200-char preview — extractFast() does
      //    exactly that in ~5ms, and is robust to any input size.
      //
      //    The full decoded body is only needed when the user opens
      //    the "View Full Message" callback. That callback now runs
      //    parseEmailBody() lazily on the saved raw bytes.
      let activationLink = "";
      let otpCode = "";
      let previewText = "";
      let allLinks = [];
      try {
        const fast = extractFast(rawEmailText);
        activationLink = fast.activationLink;
        otpCode = fast.otpCode;
        previewText = fast.previewText;
        // Stage 2: activationLinks holds only genuinely qualified
        // verification/action URLs (best-first, max 3). The scalar
        // activationLink (the single primary link) always leads the list.
        allLinks = Array.isArray(fast.activationLinks) && fast.activationLinks.length > 0
          ? fast.activationLinks.slice(0, 3)
          : (fast.activationLink ? [fast.activationLink] : []);
        console.log(`[email-in] fast-path size=${rawEmailText ? rawEmailText.length : 0} link=${activationLink ? "yes" : "no"} otp=${JSON.stringify(otpCode)}`);
      } catch (extractErr) {
        console.error(`[email-in] extract failed: ${extractErr && extractErr.stack ? extractErr.stack : extractErr}`);
      }

      // 6) Generate the inbox id up front (so the notification's
      //    "Read full email" inline button can point at view_<id>
      //    on every branch) and build the simplified, action-only
      //    Telegram notification:
      //
      //      Branch A — OTP only:
      //        title + 🔐 service + 🔑 <code>OTP</code> + View button
      //      Branch B — Verification link (takes precedence over OTP):
      //        title + 🔐 service + 🔗 <a href="URL">short label</a> + View button
      //      Branch C — Fallback (no code, no link):
      //        title + 🔐 service + 📌 subject (code) + 💬 preview (code) + View button
      //
      //    RTL/LTR handling: every external LTR value (service, OTP,
      //    subject, preview) is wrapped in `<code>...</code>` AND
      //    surrounded with Unicode FSI/PDI (\u2066 / \u2069) so
      //    Telegram's HTML renderer keeps the LTR substring on one
      //    logical line and prevents Persian/Arabic from re-ordering
      //    it. Recipient and date lines are intentionally omitted —
      //    they were metadata noise.
      const inboxId = Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
      let notificationText;
      try {
        notificationText = buildEmailNotificationText({
          sender,
          subject,
          activationLink,
          otpCode,
          previewText,
          inboxId,
          lang,
          t
        });
      } catch (buildErr) {
        console.error(`[email-in] notification build failed: ${buildErr && buildErr.stack ? buildErr.stack : buildErr}`);
        await sendHeadersOnlyNotification();
        return;
      }

      // 7) Persist the email item to D1 so the Inbox / Refresh / View
      //    callbacks can show it. This step is independently guarded so a
      //    D1 outage cannot abort the Telegram notification. This is the
      //    fix for the "Inbox says empty even though there are emails" bug.
      //    We save the raw MIME body so the View callback can run
      //    parseEmailBody() lazily only when the user actually opens the
      //    full email — keeping the email() handler cheap.
      //
      //    For branches A/B (we have a code OR a link), the alert already
      //    gives the user the action they need; we deliberately skip the
      //    200-char preview in the D1 `body` column to save bandwidth
      //    on the Inbox list render. The raw MIME is still saved so
      //    the View callback can re-parse on demand. For branch C
      //    (fallback), the preview IS the only useful body, so we keep it.
      try {
        const hasAction = !!(activationLink || otpCode);
        const storedBody = hasAction ? "" : (previewText || "");
        const inboxItem = {
          id: inboxId,
          ts: Date.now(),
          from: sender || "(unknown)",
          subject: subject || "(No Subject)",
          body: storedBody,
          links: allLinks || [],
          date: dateStr,
          raw: rawEmailText || "",
          // Persist the extracted action so renderFullEmail() can render
          // the same code/link the user originally saw in the alert.
          // Empty strings are fine — the full view falls back to a fresh
          // re-extract from `raw` in that case (e.g. legacy entries that
          // were written before the 0003 migration was applied).
          otpCode: otpCode || "",
          activationLink: activationLink || ""
        };
        await db.appendInbox(env, recipient, inboxItem);
        console.log(`[email-in] inbox-persisted id=${inboxId} recipient=${recipient} rawLen=${(rawEmailText || "").length} branch=${hasAction ? (activationLink ? "B" : "A") : "C"}`);
      } catch (persistErr) {
        console.error(`[email-in] inbox persist failed: ${persistErr && persistErr.stack ? persistErr.stack : persistErr}`);
      }

      // 8) Send. Every branch carries the "Read full email" button
      //    (view_<inboxId>) and an "Inbox" button, so the user can
      //    always open the full message or jump back to the list.
      //    When a verification link was extracted (branch B), we ALSO
      //    add a Telegram "url" button as the FIRST row so the user
      //    can tap a single button on mobile and the verify URL opens
      //    in their browser directly — no copy/paste, no round-trip
      //    through the inbox. This is the primary action for
      //    transactional emails like Aparat's account confirmation
      //    ("تکمیل ثبت نام"). For OTP-only emails (branch A) we keep
      //    the OTP as the main message text and just add a View button
      //    to the full view (where the user can copy the code).
      const shortRows = [];
      if (activationLink) {
        const linkLabel = isAparatEmail(sender, activationLink, subject) ? "✅ تایید حساب" : linkLabelFor(activationLink, t);
        shortRows.push([{ text: linkLabel, url: activationLink }]);
      }
      shortRows.push([{ text: t.btnView(1), callback_data: `view_${inboxId}` }]);
      shortRows.push([{ text: t.btnInbox, callback_data: "inbox" }]);
      try {
        await sendTelegramMessage(env.BOT_TOKEN, chatId, notificationText, {
          inline_keyboard: shortRows
        });
        console.log(`[email-in] notified chatId=${chatId} link=${activationLink ? "yes" : "no"} otp=${JSON.stringify(otpCode)} subject=${JSON.stringify(subject)}`);
      } catch (notifyErr) {
        console.error(`[email-in] telegram notify failed: ${notifyErr && notifyErr.stack ? notifyErr.stack : notifyErr}`);
        await sendHeadersOnlyNotification();
      }

    } catch (err) {
      // Absolute last line of defence. Never re-throw.
      console.error(`[email-in] outer error (swallowed): ${err && err.stack ? err.stack : err}`);
    }
  }
};

/* ==========================================================================
   Email Notification Builder (action-only, simplified)
   --------------------------------------------------------------------------
   Extracted from the email() handler so the template can be unit-tested
   without driving the full Cloudflare Email Routing path.

   Design contract (see tests/notification_test.mjs):
     Branch A — OTP only:
       title + 🔐 service + 🔑 <code>OTP</code> + Read button
     Branch B — Verification link (takes precedence over OTP):
       title + 🔐 service + 🔗 <a href="URL">short label</a> + Read button
     Branch C — Fallback (no code, no link):
       title + 🔐 service + 📌 subject (code) + 💬 preview (code) + Read button

   Every external LTR value (service, OTP, subject, preview) is wrapped in
   <code>...</code> and surrounded by Unicode FSI/PDI (\u2066 / \u2069) so
   Telegram's HTML renderer keeps each LTR substring intact, even when the
   surrounding message is Persian/Arabic (RTL).

   Recipient and date lines are intentionally NOT shown — they were
   metadata noise. The service label is derived from the From header (see
   serviceNameFor) and replaces the raw email address in the alert.
   ========================================================================== */
function buildEmailNotificationText(opts) {
  const lang = (opts && opts.lang) || "fa";
  const t = (opts && opts.t) || i18n[lang] || i18n.fa;
  const sender = opts && opts.sender;
  const subject = opts && opts.subject;
  const activationLink = opts && opts.activationLink;
  const otpCode = opts && opts.otpCode;
  const previewText = opts && opts.previewText;
  const inboxId = (opts && opts.inboxId) || "";

  const title = `💎 <b>${lang === "en" ? "New Email Received" : "پیام جدید دریافت شد"}</b>`;
  const service = serviceNameFor(sender, subject, t);

  const actionLines = [];
  let viewCallback = "";
  if (inboxId) viewCallback = `view_${inboxId}`;

  // Stage 2: link and OTP are independent — when an email contains both
  // a qualified verification link AND a code, both are shown (link first,
  // then the code). Branch C (subject + preview) only renders when
  // NEITHER action exists. Every external LTR value stays wrapped in
  // <code> + FSI/PDI (the anchor itself stays plain inline HTML — never
  // inside <code>).
  if (activationLink) {
    const linkText = linkLabelFor(activationLink, t);
    actionLines.push(`🔗 <a href="${escapeAttribute(activationLink)}">${escapeHtml(linkText)}</a>`);
  }
  if (otpCode) {
    actionLines.push(`🔑 <b>${escapeHtml(t.otpLabel)}:</b> <code>\u2066${escapeHtml(otpCode)}\u2069</code>`);
  }
  if (actionLines.length === 0) {
    // Fallback: subject + 200-char preview. Both wrapped in <code> so the
    // user can tap-to-copy. Preview is omitted if empty.
    const subj = subject || "(No Subject)";
    actionLines.push(`📌 <b>${escapeHtml(t.subjectLabel)}:</b> <code>\u2066${escapeHtml(subj)}\u2069</code>`);
    if (previewText) {
      actionLines.push(`💬 <i><code>\u2066${escapeHtml(previewText)}\u2069</code></i>`);
    }
  }

  const serviceLine = `🔐 <b>${escapeHtml(service)}</b>`;

  return (
    `${title}\n` +
    `━━━━━━━━━━━━━━━\n\n` +
    `${serviceLine}\n` +
    `${actionLines.join("\n")}\n\n` +
    `━━━━━━━━━━━━━━━`
  );
}

/* --------------------------------------------------------------------------
   serviceNameFor: derive a short, user-friendly service label from the
   From header so the alert doesn't leak a raw email address.

   Heuristic (ordered):
     1. If "Display Name <addr@host>" → return Display Name (trimmed,
        cap 32 chars).
     2. Else take the host, pick the registrable label (the part just
        before the public suffix), capitalize it. "noreply@auth.openai.com"
        → "Openai", "no-reply@aparat.com" → "Aparat".
     3. Else fall back to the first 40 chars of the subject.
     4. Else "New Message" / localized serviceFallback.

   The returned string is plain text (no HTML) — callers wrap in <b>.
   -------------------------------------------------------------------------- */
function serviceNameFor(sender, subject, t) {
  const fallback = (t && t.serviceFallback) || "New Message";
  const cap = (s, n) => (s && s.length > n ? s.substring(0, n - 1) + "\u2026" : s);

  const rawSender = (sender && typeof sender === "string") ? sender.trim() : "";
  if (rawSender) {
    // 1) "Display Name <addr@host>"
    const m = rawSender.match(/^([^<]*?)\s*<\s*([^>]+@[^>]+)\s*>/);
    let displayName = "";
    let host = "";
    if (m) {
      displayName = m[1].trim().replace(/^["']|["']$/g, "");
      host = (m[2].split("@")[1] || "").toLowerCase().trim();
    } else {
      // 2) Bare "addr@host" or "noreply@aparat.com"
      const at = rawSender.lastIndexOf("@");
      if (at >= 0) {
        host = rawSender.substring(at + 1).replace(/[>)\].,;]+$/g, "").toLowerCase().trim();
      }
    }
    if (displayName) return cap(displayName, 32);
    if (host) {
      // Strip IPv4 literals
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return cap(rawSender, 32) || fallback;
      // Registrable label heuristic: take the second-to-last dot segment.
      // For "auth.openai.com" → "openai"; for "aparat.com" → "aparat";
      // for "localhost" / single-label → use the whole host.
      const parts = host.split(".").filter(Boolean);
      let label = host;
      if (parts.length >= 2) label = parts[parts.length - 2];
      label = label.charAt(0).toUpperCase() + label.slice(1);
      return cap(label, 32) || fallback;
    }
    return cap(rawSender, 32) || fallback;
  }

  // 3) Subject fallback
  const subj = (subject && typeof subject === "string") ? subject.trim() : "";
  if (subj) return cap(subj, 40) || fallback;

  // 4) Final fallback
  return fallback;
}

function isAparatEmail(sender, link, subject) {
  const l = (link || "").toLowerCase();
  const s = (sender || "").toLowerCase();
  const sub = (subject || "").toLowerCase();
  return l.includes("aparat.com") || s.includes("aparat") || sub.includes("aparat") || sub.includes("تایید حساب") || sub.includes("تکمیل ثبت نام");
}

/* --------------------------------------------------------------------------
   linkLabelFor: pick a short button label for a verification URL based on
   host/path keywords. Returns a plain-text string (no HTML) suitable for
   <a href="...">label</a>. Tries to keep messages under ~24 chars.
   -------------------------------------------------------------------------- */
function linkLabelFor(url, t) {
  const T = t || i18n.en;
  const lower = (url || "").toLowerCase();
  if (/(verify|confirm|activate|email[-_ ]?confirm|account[-_ ]?confirm|register|signup|sign[-_ ]?up|subscription)/.test(lower)) {
    return T.linkVerify || "Verify Account";
  }
  if (/(reset|forgot|recover)/.test(lower)) {
    return T.linkReset || "Reset Password";
  }
  if (/(login|sign[-_ ]?in|magic|auth\/)/.test(lower)) {
    return T.linkLogin || "Sign In";
  }
  return T.linkDefault || "Open Link";
}

/* ==========================================================================
   Telegram Message & Callback Logic
   ========================================================================== */

// Access guard: returns true if the given userId is allowed to use the bot.
//
// Two env vars control this:
//   MULTI_USER       — when set to "true" (case-insensitive), the bot is
//                      open to every Telegram chat_id. Each chat keeps its
//                      own session, inbox, and 50-token archive independently
//                      (see sessions / email_tokens tables).
//   TELEGRAM_USER_ID — legacy single-admin gate. When MULTI_USER is not
//                      "true" and TELEGRAM_USER_ID is set to a non-empty
//                      string, only that numeric user id is allowed. When
//                      it is empty, the bot falls back to public access.
function isPublicAccess(env, userId) {
  if (String(env.MULTI_USER || "").trim().toLowerCase() === "true") return true;
  if (!env.TELEGRAM_USER_ID || String(env.TELEGRAM_USER_ID).trim() === "") return true;
  return String(userId) === String(env.TELEGRAM_USER_ID).trim();
}

async function handleMessage(message, env) {
  const chatId = message.chat.id;
  const userId = message.from.id.toString();
  const text = (message.text || "").trim();

  if (!isPublicAccess(env, userId)) {
    await sendTelegramMessage(env.BOT_TOKEN, chatId, "⛔️ You do not have access to this bot.");
    return;
  }

  const lang = await getUserLang(chatId, env);
  const t = i18n[lang] || i18n.fa;

  const pendingState = await db.getState(env, chatId);
  if (pendingState === "awaiting_restore_token") {
    if (!text) {
      await sendRestoreAsk(chatId, env, lang);
      return;
    }

    if (!isValidRecoveryToken(text)) {
      await sendTelegramMessage(env.BOT_TOKEN, chatId, t.restoreInvalid);
      return;
    }

    let tokenRecord = await db.getSessionByToken(env, text);
    if (!tokenRecord) {
      // Token was overwritten in sessions by a later email creation
      // (each chat has exactly one row in sessions, so a second
      // generate replaces the first). Fall back to the email_tokens
      // archive populated by migration 0004, which keeps up to 10 old
      // tokens per chat. If the user pastes one of those, we reactivate
      // the matching (chatId, email) pair via the same upsertSession
      // path the active-token branch uses, so UX is identical.
      tokenRecord = await db.getArchivedToken(env, text);
    }
    if (!tokenRecord || !tokenRecord.email) {
      await sendTelegramMessage(env.BOT_TOKEN, chatId, t.restoreNotFound);
      return;
    }

    if (tokenRecord.chatId && String(tokenRecord.chatId) !== String(chatId)) {
      await sendTelegramMessage(env.BOT_TOKEN, chatId, t.restoreWrongOwner);
      return;
    }

    const existing = await db.getSession(env, chatId);
    if (existing && existing.email && existing.email !== tokenRecord.email) {
      await db.deleteBindingByEmail(env, existing.email);
    }

    const createdAt = tokenRecord.createdAt || (new Date().toLocaleTimeString("fa-IR", { timeZone: "Asia/Tehran" }) + " - " + new Date().toISOString().split("T")[0]);
    await db.upsertSession(env, chatId, tokenRecord.email, createdAt, text, lang);
    await db.clearState(env, chatId);

    await sendTelegramMessage(env.BOT_TOKEN, chatId, t.restoreSuccess(tokenRecord.email), {
      inline_keyboard: [
        [{ text: t.btnHome, callback_data: "back_dashboard" }]
      ]
    });
    return;
  }

  await renderDashboard(chatId, env, lang);
}

async function handleCallbackQuery(callbackQuery, env) {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const callbackId = callbackQuery.id;
  const action = callbackQuery.data;
  const userId = callbackQuery.from.id.toString();

  if (!isPublicAccess(env, userId)) {
    await answerCallbackQuery(env.BOT_TOKEN, callbackId, "⛔️ Access denied", true);
    return;
  }

  const lang = await getUserLang(chatId, env);
  const t = i18n[lang];
  const userData = await db.getSession(env, chatId);

  switch (action) {
    case "generate": {
      await renderConfirmGenerate(chatId, messageId, env, lang);
      await answerCallbackQuery(env.BOT_TOKEN, callbackId, "");
      break;
    }

    case "confirm_generate_yes": {
      if (userData && userData.email) {
        // Before the new upsertSession below overwrites the OLD row in
        // sessions, copy the old (email, token) pair into the
        // email_tokens archive so the user can still restore the previous
        // email later. This is best-effort: a failure here must NOT
        // abort the new-email creation, because that's the primary
        // user action. We just log and move on.
        if (userData.recoveryToken) {
          try {
            await db.archiveToken(
              env,
              chatId,
              userData.email,
              userData.recoveryToken,
              lang,
              userData.createdAt
            );
          } catch (archErr) {
            console.error(`[confirm_generate_yes] archiveToken failed: ${archErr && archErr.message ? archErr.message : archErr}`);
          }
        }
        // The old email is being replaced. The new upsert below will
        // overwrite the recovery_token in the same sessions row, so we
        // only need to clear the inbox for the old address.
        await db.clearInbox(env, userData.email);
      }

      const adjectives = ["shadow", "skyline", "quantum", "bluefire", "neon", "cyber", "stellar", "nova", "cosmic", "apex", "swift", "silent", "frost", "solar", "dark", "light"];
      const nouns = ["pulse", "echo", "vertex", "orbit", "matrix", "core", "storm", "wave", "spark", "ghost", "rider", "hawk", "wolf", "fox", "tiger", "dragon"];
      const prefixPool = [
        () => adjectives[Math.floor(Math.random() * adjectives.length)] + (Math.floor(Math.random() * 90) + 10),
        () => adjectives[Math.floor(Math.random() * adjectives.length)] + nouns[Math.floor(Math.random() * nouns.length)] + (Math.floor(Math.random() * 90) + 10)
      ];
      const randomPrefix = prefixPool[Math.floor(Math.random() * prefixPool.length)]();
      const domain = env.DOMAIN ? env.DOMAIN.toLowerCase().trim() : "temp.com";
      const newEmail = `${randomPrefix}@${domain}`;
      const nowStr = new Date().toLocaleTimeString("fa-IR", { timeZone: "Asia/Tehran" }) + " - " + new Date().toISOString().split("T")[0];

      // Generate a unique token. D1 INSERTs are atomic; we loop until
      // the token is free.
      let recoveryToken = generateRecoveryToken();
      let attempts = 0;
      while (await db.tokenInUse(env, recoveryToken)) {
        recoveryToken = generateRecoveryToken();
        if (++attempts > 16) break; // collision space is huge; bail out as a safety net
      }

      await db.upsertSession(env, chatId, newEmail, nowStr, recoveryToken, lang);

      const newSession = { email: newEmail, createdAt: nowStr, recoveryToken };

      await answerCallbackQuery(env.BOT_TOKEN, callbackId, t.msgGenerated);
      await editDashboard(chatId, messageId, newSession, env, lang);
      break;
    }

    case "confirm_generate_no": {
      await answerCallbackQuery(env.BOT_TOKEN, callbackId, t.msgCancelled);
      await editDashboard(chatId, messageId, userData, env, lang);
      break;
    }

    case "inbox": {
      if (!userData || !userData.email) {
        await answerCallbackQuery(env.BOT_TOKEN, callbackId, t.msgNoEmailCreate, true);
        return;
      }

      const inboxList = await db.listInbox(env, userData.email);
      if (inboxList.length === 0) {
        await answerCallbackQuery(env.BOT_TOKEN, callbackId, t.msgInboxEmpty, true);
        return;
      }

      await answerCallbackQuery(env.BOT_TOKEN, callbackId, t.msgInboxCount(inboxList.length));
      await renderInboxList(chatId, messageId, userData.email, inboxList, env, lang);
      break;
    }

    case "refresh": {
      if (!userData || !userData.email) {
        await answerCallbackQuery(env.BOT_TOKEN, callbackId, t.msgRefreshed);
        await editDashboard(chatId, messageId, null, env, lang);
        return;
      }

      const inboxList = await db.listInbox(env, userData.email);

      await answerCallbackQuery(env.BOT_TOKEN, callbackId, t.msgInboxCount(inboxList.length));
      await editDashboard(chatId, messageId, userData, env, lang);
      break;
    }

    // Note: the old "delete" / "confirm_delete_yes" / "confirm_delete_no"
    // callbacks were removed when the delete button was taken off the
    // dashboard. The "generate new email" path is the canonical way to
    // rotate an address — it already archives the old token and clears
    // the old inbox in a single user-confirmed step.

    case "toggle_lang": {
      const newLang = lang === "fa" ? "en" : "fa";
      await db.setLang(env, chatId, newLang);
      await answerCallbackQuery(env.BOT_TOKEN, callbackId, newLang === "en" ? "🌐 Language switched to English" : "🌐 زبان به فارسی تغییر کرد");
      await editDashboard(chatId, messageId, userData, env, newLang);
      break;
    }

    case "admin_settings": {
      if (!isPublicAccess(env, userId)) {
        await answerCallbackQuery(env.BOT_TOKEN, callbackId, t.msgAccessDenied, true);
        return;
      }
      await answerCallbackQuery(env.BOT_TOKEN, callbackId, "⚙️ Admin Settings");
      await renderAdminSettings(chatId, messageId, env, lang);
      break;
    }

    case "back_dashboard": {
      await db.clearState(env, chatId);
      await answerCallbackQuery(env.BOT_TOKEN, callbackId, lang === "en" ? "Back" : "بازگشت");
      await editDashboard(chatId, messageId, userData, env, lang);
      break;
    }

    case "restore_ask": {
      await db.setState(env, chatId, "awaiting_restore_token");
      await renderRestoreAsk(chatId, messageId, env, lang);
      await answerCallbackQuery(env.BOT_TOKEN, callbackId, "");
      break;
    }

    case "help": {
      await sendLocalizedGuide(chatId, env, lang);
      await answerCallbackQuery(env.BOT_TOKEN, callbackId, "");
      break;
    }

    case "close_help": {
      await deleteTelegramMessage(env.BOT_TOKEN, chatId, messageId);
      await answerCallbackQuery(env.BOT_TOKEN, callbackId, "");
      break;
    }

    default: {
      if (action.startsWith("view_")) {
        const emailId = action.substring(5);
        if (!userData || !userData.email) {
          await answerCallbackQuery(env.BOT_TOKEN, callbackId, t.msgEmailNotFound, true);
          return;
        }
        const inboxList = await db.listInbox(env, userData.email);
        const emailItem = inboxList.find(i => i.id === emailId);

        if (!emailItem) {
          await answerCallbackQuery(env.BOT_TOKEN, callbackId, t.msgEmailNotFound, true);
          return;
        }

        // Pass the recipient email along so renderFullEmail can backfill
        // a missing otp_code/activation_link into the DB without an
        // extra round-trip to the sessions table.
        emailItem._recipientEmail = userData.email;

        await answerCallbackQuery(env.BOT_TOKEN, callbackId, t.msgViewFull);
        await renderFullEmail(chatId, messageId, emailItem, env, lang);
        break;
      }

      // Bug 3: collapse_<id> swaps the same message back to the short
      // alert. We re-use the SAME builder (buildEmailNotificationText) and
      // the SAME action values (stored on the inboxItem at notification
      // time) so the user sees the exact same code/link they originally
      // saw — no re-extraction, no risk of a different number.
      if (action.startsWith("collapse_")) {
        const emailId = action.substring(9);
        if (!userData || !userData.email) {
          await answerCallbackQuery(env.BOT_TOKEN, callbackId, t.msgEmailNotFound, true);
          return;
        }
        const inboxList = await db.listInbox(env, userData.email);
        const emailItem = inboxList.find(i => i.id === emailId);

        if (!emailItem) {
          await answerCallbackQuery(env.BOT_TOKEN, callbackId, t.msgEmailNotFound, true);
          return;
        }

        // Rebuild the short alert from the persisted fields. For legacy
        // entries (written before migration 0003) the stored action is
        // empty, so fall back to a fresh extractFast() on the raw — same
        // code path the email() handler used, guaranteeing consistency.
        let storedOtp = emailItem.otpCode || "";
        let storedLink = emailItem.activationLink || "";
        let previewFallback = emailItem.body || "";
        if (!storedOtp && !storedLink && emailItem.raw) {
          try {
            const fast = extractFast(emailItem.raw);
            if (fast) {
              storedOtp = fast.otpCode || "";
              storedLink = fast.activationLink || "";
              previewFallback = fast.previewText || previewFallback;
            }
          } catch (e) { /* silent — old item, no action */ }
        }

        const shortText = buildEmailNotificationText({
          sender: emailItem.from,
          subject: emailItem.subject,
          activationLink: storedLink,
          otpCode: storedOtp,
          previewText: previewFallback,
          inboxId: emailItem.id,
          lang,
          t
        });

        const shortKeyboard = {
          inline_keyboard: [
            [{ text: t.btnView(1), callback_data: `view_${emailItem.id}` }],
            [{ text: t.btnInbox, callback_data: "inbox" }]
          ]
        };

        await answerCallbackQuery(env.BOT_TOKEN, callbackId, t.msgCollapsed);
        await editTelegramMessage(env.BOT_TOKEN, chatId, messageId, shortText, shortKeyboard);
        break;
      }

      await answerCallbackQuery(env.BOT_TOKEN, callbackId, t.msgInvalidCmd);
    }
  }
}

/* ==========================================================================
   UI Components & Formatting
   ========================================================================== */

// Canonical Telegram Mini App URL, opened via the standard Telegram
// Web App button (dashboard inline keyboard + chat Menu Button).
// NOTE: this is intentionally a fixed HTTPS URL, NOT derived from
// env.DOMAIN (which is the mail-receiving domain).
const MINI_APP_URL = "https://twenyonerrf.ir/app/";

function getDashboardPayload(userData, lang = "fa") {
  const t = i18n[lang] || i18n.fa;
  let text = "";
  if (userData && userData.email) {
    text =
      `${t.botTitle}\n` +
      `━━━━━━━━━━━━━━━\n` +
      `${t.activeEmail}\n` +
      `<code>${userData.email}</code>\n\n` +
      `${t.createdAt} ${userData.createdAt}\n` +
      `${t.statusActive}\n\n` +
      `${t.copyTip}`;
    if (userData.recoveryToken) {
      text +=
        `\n\n` +
        `${t.msgTokenLabel} <code>${userData.recoveryToken}</code>\n` +
        `${t.msgTokenTip}`;
    }
    text += `\n━━━━━━━━━━━━━━━`;
  } else {
    text =
      `${t.botTitle}\n` +
      `━━━━━━━━━━━━━━━\n\n` +
      `${t.statusInactive}\n\n` +
      `${t.generateTip}\n` +
      `━━━━━━━━━━━━━━━`;
  }

  const keyboard = {
    inline_keyboard: [
      [{ text: t.btnMiniApp, web_app: { url: MINI_APP_URL } }],
      [{ text: t.btnGenerate, callback_data: "generate" }],
      [
        { text: t.btnInbox, callback_data: "inbox" },
        { text: t.btnRefresh, callback_data: "refresh" }
      ],
      [{ text: t.btnRestore, callback_data: "restore_ask" }],
      [
        { text: t.btnLang, callback_data: "toggle_lang" },
        { text: t.btnHelp, callback_data: "help" }
      ]
    ]
  };

  return { text, keyboard };
}

async function renderDashboard(chatId, env, lang = "fa") {
  const userData = await db.getSession(env, chatId);
  const { text, keyboard } = getDashboardPayload(userData, lang);

  await sendTelegramMessage(env.BOT_TOKEN, chatId, text, keyboard);
}

async function editDashboard(chatId, messageId, userData, env, lang = "fa") {
  const { text, keyboard } = getDashboardPayload(userData, lang);
  await editTelegramMessage(env.BOT_TOKEN, chatId, messageId, text, keyboard);
}

async function renderConfirmGenerate(chatId, messageId, env, lang = "fa") {
  const t = i18n[lang] || i18n.fa;
  const text =
    `${t.confirmNewTitle}\n` +
    `━━━━━━━━━━━━━━━\n\n` +
    `${t.confirmNewDesc}\n` +
    `━━━━━━━━━━━━━━━`;

  const keyboard = {
    inline_keyboard: [
      [{ text: t.btnConfirmYes, callback_data: "confirm_generate_yes" }],
      [{ text: t.btnConfirmNo, callback_data: "confirm_generate_no" }]
    ]
  };

  await editTelegramMessage(env.BOT_TOKEN, chatId, messageId, text, keyboard);
}

async function renderRestoreAsk(chatId, messageId, env, lang = "fa") {
  const t = i18n[lang] || i18n.fa;
  const text =
    `${t.restoreAskTitle}\n` +
    `━━━━━━━━━━━━━━━\n\n` +
    `${t.restoreAskDesc}\n` +
    `━━━━━━━━━━━━━━━`;

  const keyboard = {
    inline_keyboard: [
      [{ text: t.btnCancelRestore, callback_data: "back_dashboard" }]
    ]
  };

  await editTelegramMessage(env.BOT_TOKEN, chatId, messageId, text, keyboard);
}

async function sendRestoreAsk(chatId, env, lang = "fa") {
  const t = i18n[lang] || i18n.fa;
  const text =
    `${t.restoreAskTitle}\n` +
    `━━━━━━━━━━━━━━━\n\n` +
    `${t.restoreAskDesc}\n` +
    `━━━━━━━━━━━━━━━`;

  const keyboard = {
    inline_keyboard: [
      [{ text: t.btnCancelRestore, callback_data: "back_dashboard" }]
    ]
  };

  await sendTelegramMessage(env.BOT_TOKEN, chatId, text, keyboard);
}

async function sendLocalizedGuide(chatId, env, lang = "fa") {
  const t = i18n[lang] || i18n.fa;
  const text =
    `${t.helpTitle}\n` +
    `━━━━━━━━━━━━━━━\n\n` +
    `${t.helpIntro}\n\n` +
    `${t.helpMultiUser}\n\n` +
    `${t.helpTemp}\n\n` +
    `${t.helpHowSection}\n` +
    `${t.helpBtnGenerate}\n` +
    `${t.helpBtnInbox}\n` +
    `${t.helpBtnRefresh}\n` +
    `${t.helpBtnRestore}\n` +
    `${t.helpBtnLang}\n\n` +
    `${t.helpTokenSection}\n` +
    `${t.helpTokenExplained}\n\n` +
    `${t.helpTip}\n` +
    `━━━━━━━━━━━━━━━`;

  const keyboard = {
    inline_keyboard: [
      [{ text: t.btnClose, callback_data: "close_help" }]
    ]
  };

  await sendTelegramMessage(env.BOT_TOKEN, chatId, text, keyboard);
}

async function renderAdminSettings(chatId, messageId, env, lang = "fa") {
  const t = i18n[lang] || i18n.fa;
  const text =
    `${t.adminTitle}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `🛡 <b>Authorized Admin ID:</b> <code>7323774108</code>\n` +
    `🌐 <b>${t.adminDomain}</b> <code>${escapeHtml(env.DOMAIN || "Not configured")}</code>\n` +
    `🤖 <b>Bot Status:</b> Active\n\n` +
    `💡 <i>You have exclusive authorization to edit and configure bot settings.</i>\n` +
    `━━━━━━━━━━━━━━━`;

  const keyboard = {
    inline_keyboard: [
      [{ text: t.adminBack, callback_data: "back_dashboard" }]
    ]
  };

  await editTelegramMessage(env.BOT_TOKEN, chatId, messageId, text, keyboard);
}

async function renderInboxList(chatId, messageId, email, inboxList, env, lang = "fa") {
  const t = i18n[lang] || i18n.fa;
  let text =
    `${t.inboxTitle}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `📧 <code>${escapeHtml(email)}</code>\n\n`;

  const inlineKeyboard = [];

  inboxList.forEach((item, idx) => {
    text +=
      `<b>${idx + 1}. ${escapeHtml(item.subject)}</b>\n` +
      `👤 <code>${escapeHtml(item.from)}</code>\n` +
      `📅 <code>${escapeHtml(item.date)}</code>\n\n`;

    inlineKeyboard.push([
      { text: t.btnView(idx + 1), callback_data: `view_${item.id}` }
    ]);
  });

  text += `━━━━━━━━━━━━━━━\n${t.inboxTotal(inboxList.length)}`;

  inlineKeyboard.push([{ text: t.btnRefreshInbox, callback_data: "inbox" }]);
  inlineKeyboard.push([{ text: t.btnBack, callback_data: "back_dashboard" }]);

  const keyboard = {
    inline_keyboard: inlineKeyboard
  };

  await editTelegramMessage(env.BOT_TOKEN, chatId, messageId, text, keyboard);
}

async function renderFullEmail(chatId, messageId, emailItem, env, lang = "fa") {
  const t = i18n[lang] || i18n.fa;

  // Lazy, full-body parse on the saved raw MIME. This is the path the
  // "View Full Message" button takes; the email() handler stays on
  // extractFast() so the inbox notification remains fast. parseEmailBody()
  // enforces its own MAX_PARSE_BYTES safety net (~256 KB) and returns
  // { text, links } where `text` is QP-decoded, HTML-tag-stripped, and
  // entity-decoded, and `links` is a deduplicated, de-noised URL list
  // (CSS/asset/footer links filtered out). It can still throw on truly
  // pathological input, so it is wrapped in a try/catch and we fall back
  // to the truncated preview that was saved with the inbox item.
  let parsedText = "";
  let parsedLinks = null;
  if (emailItem && typeof emailItem.raw === "string" && emailItem.raw.length > 0) {
    try {
      const parsed = parseEmailBody(emailItem.raw);
      if (parsed && typeof parsed.text === "string" && parsed.text.length > 0) {
        parsedText = parsed.text;
      }
      if (parsed && Array.isArray(parsed.links) && parsed.links.length > 0) {
        parsedLinks = parsed.links;
      }
    } catch (parseErr) {
      console.error(`[view-full] parseEmailBody failed, falling back to preview: ${parseErr && parseErr.stack ? parseErr.stack : parseErr}`);
    }
  }

  // Prefer the lazily-parsed full body; otherwise use the saved preview.
  let cleanBodyText = parsedText || (emailItem.body || "");

  // The saved preview sometimes has an inline "🔗 Links:" trailer appended
  // by an older path. Strip it if present so we don't render the label twice.
  const linksIdx = cleanBodyText.indexOf("\n\n🔗 Links:\n");
  if (linksIdx !== -1) {
    cleanBodyText = cleanBodyText.substring(0, linksIdx);
  }

  let storedLinkInit = (emailItem && typeof emailItem.activationLink === "string") ? emailItem.activationLink : "";
  if (isAparatEmail(emailItem.from, storedLinkInit, emailItem.subject)) {
    cleanBodyText = cleanBodyText.replace(/✅?\s*تایید حساب|تکمیل ثبت نام/gi, "").trim();
  }

  // Merge link sources: parsed links win, then the inbox's saved links,
  // then a final fallback extraction from the body. This guarantees a
  // non-empty link list whenever the email actually contains any URL.
  let links = null;
  if (parsedLinks && parsedLinks.length > 0) {
    links = parsedLinks;
  } else if (Array.isArray(emailItem.links) && emailItem.links.length > 0) {
    links = emailItem.links;
  } else {
    const fb = extractAndCleanUrls(cleanBodyText, cleanBodyText);
    if (fb && fb.length > 0) links = fb;
  }


  // Bug 2 fix: use the EXACT validated parser output that the primary
  // alert used. extractFast() is the single source of truth — the
  // email() handler calls it, stores the result on the inboxItem, and
  // renderFullEmail() reads those stored values. This guarantees the
  // primary alert and the full view surface the SAME code/link, so the
  // user never sees a different number in the two views.
  //
  // For legacy inbox items written before migration 0003, the stored
  // action will be empty. In that case we re-run extractFast() on the
  // raw as a one-time fallback so the full view still works for old
  // entries. The collapse_<id> callback reuses the stored value.
  let storedOtp = (emailItem && typeof emailItem.otpCode === "string") ? emailItem.otpCode : "";
  let storedLink = (emailItem && typeof emailItem.activationLink === "string") ? emailItem.activationLink : "";
  let backfilled = false;
  if (!storedOtp && !storedLink && emailItem && typeof emailItem.raw === "string" && emailItem.raw.length > 0) {
    try {
      const fastFallback = extractFast(emailItem.raw);
      if (fastFallback && typeof fastFallback === "object") {
        if (!storedOtp && fastFallback.otpCode) storedOtp = fastFallback.otpCode;
        if (!storedLink && fastFallback.activationLink) storedLink = fastFallback.activationLink;
        if (storedOtp || storedLink) backfilled = true;
      }
    } catch (e) { /* silent — old item, no action */ }
  }
  // Persist the backfilled action so subsequent views and the collapse
  // callback can use it without re-running extractFast() on every open.
  // Best-effort — a D1 error here must NOT abort the message render.
  if (backfilled && emailItem && emailItem.id && env && env.DB) {
    try {
      // Resolve the recipient email via the chat session. We pass it in
      // implicitly by accepting the (email) key in the inbox table.
      // The caller (view_ handler) puts the chat-bound email on the
      // emailItem via listInbox, so we just read it back.
      const recipientEmail = emailItem._recipientEmail || (emailItem.email || "");
      if (recipientEmail) {
        await db.updateInboxAction(env, recipientEmail, emailItem.id, storedOtp, storedLink);
      }
    } catch (e) { /* swallow — backfill is best-effort */ }
  }

  let linksHtml = "";
  if (links && links.length > 0) {
    linksHtml = `\n\n${t.linksTitle}\n` +
      links.map(url => {
        let label = t.linkDefault;
        const lower = url.toLowerCase();
        if (lower.includes('verify') || lower.includes('activation') || lower.includes('confirm')) {
          label = t.linkVerify;
        } else if (lower.includes('reset') || lower.includes('password')) {
          label = t.linkReset;
        } else if (lower.includes('login') || lower.includes('signin') || lower.includes('auth')) {
          label = t.linkLogin;
        } else if (links.length > 1) {
          label = t.linkOp;
        }
        // Shorten the URL shown to the user so the click target is obvious.
        // The full URL is still in the href, so tapping the link still
        // opens the full address. We strip query string and last path
        // segment, then truncate. E.g.
        //   https://www.aparat.com/auth/confirm?email=…&token=…&hash=…
        //   → aparat.com/auth/confirm
        let visibleUrl = url;
        try {
          const u = new URL(url);
          const path = (u.pathname || "").replace(/\/+$/, "");
          visibleUrl = (u.hostname || "") + path;
          if (visibleUrl.length > 48) visibleUrl = visibleUrl.substring(0, 45) + "…";
        } catch (e) { /* keep full url on parse failure */ }
        // Telegram's mobile clients treat any <a href="…">text</a>
        // whose visible text is NOT a URL as a "text link" (tap = select
        // + copy menu). To make the link open-in-browser on tap — the
        // user's hard requirement — the visible text must BE a URL.
        //
        // CRITICAL: we MUST NOT wrap the <a> inside <code>…</code>.
        // Telegram renders <code>-wrapped text in a monospace font and
        // treats it as a code block — tapping it shows a copy menu
        // instead of opening the link. The <a> must be plain inline
        // HTML for Telegram to render it as a clickable blue link.
        //
        //   e.g. <a href="https://www.aparat.com/auth/confirm?token=…">
        //          www.aparat.com/auth/confirm
        //        </a>
        //
        // That renders as a blue underlined "www.aparat.com/auth/confirm"
        // link — short enough to be obviously clickable, long enough to
        // pass Telegram's URL-detection heuristic. Tapping it opens
        // the browser (NOT the copy menu). The full URL is preserved
        // in href, so the browser receives the complete address.
        //
        // The FSI/PDI (\u2066/\u2069) Unicode marks around the anchor
        // keep the LTR URL in a stable direction inside an RTL (Persian)
        // message body — without it, the URL chars can get bidi-reordered
        // and break the link visually.
        return `• ${label}\n  \u2066<a href="${escapeAttribute(url)}">${escapeHtml(visibleUrl)}</a>\u2069`;
      }).join("\n");
  }

  // "Extracted action" block — guaranteed to show the same code/link the
  // user saw in the primary alert. This is the visible contract for the
  // "same parser in both views" guarantee. Renders nothing if neither
  // a code nor a link was extracted (the body is still shown below).
  //
  // Note: t.linksTitle is `🔗 <b>لینک‌های تایید و عملیاتی:</b>` — it
  // already contains the HTML tags, so we strip the emoji + outer tags
  // and reuse the inner text. We must NOT escapeHtml() the i18n label
  // (it's already trusted HTML) — we only escapeHtml the user-supplied
  // URL and the dynamic label text.
  let actionHtml = "";
  // Stage 2: link and OTP are independent — the full view shows BOTH when
  // both were extracted (matching the primary alert). Aparat-specific
  // suppression of the action line is preserved exactly as before.
  if (storedLink && !isAparatEmail(emailItem.from, storedLink, emailItem.subject)) {
    const linkText = linkLabelFor(storedLink, t);
    // Use the Persian-localized "Verification Links" label as a plain
    // bold string. We don't need to nest this inside <b> again because
    // t.linksTitle already wraps the visible label in <b>; we just emit
    // the icon + the inner label text directly.
    //
    // The anchor MUST be plain inline HTML (same proven pattern as the
    // linksHtml list above): wrapping <a> inside <code> makes Telegram
    // render it as a copy-menu code block instead of a clickable link.
    actionHtml += `🔗 ${t.linksTitle.includes("لینک") ? "لینک تایید:" : "Verification Link:"} \u2066<a href="${escapeAttribute(storedLink)}">${escapeHtml(linkText)}</a>\u2069\n\n`;
  }
  if (storedOtp) {
    actionHtml += `🔑 <b>${escapeHtml(t.otpLabel)}:</b> <code>\u2066${escapeHtml(storedOtp)}\u2069</code>\n\n`;
  }

  // Telegram's hard message cap is 4096 chars. If the parsed body is huge
  // (e.g. a long newsletter), truncate with a clear marker instead of
  // letting editTelegramMessage fail. We keep the head — that's where the
  // activation link, code, and call-to-action live in virtually every
  // transactional email — and tag the truncation so the user knows more
  // was there. The cap is computed against the final rendered text, not
  // the body in isolation, so the framing/links/header stay intact.
  const TELEGRAM_MAX = 4000;
  const ellipsis = lang === "en" ? "\n\n…(message truncated)" : "\n\n…(ادامه پیام حذف شد)";
  // Headers get FSI/PDI around every external LTR value. The body itself
  // is wrapped in <pre> with FSI/PDI around the whole block so multi-line
  // body text with embedded LTR runs (URLs, OTP, dates) renders without
  // line-fragmentation or character re-ordering on a Persian client.
  const header =
    `${t.fullEmailTitle}\n` +
    `━━━━━━━━━━━━━━━\n\n` +
    `📧 <b>${t.sender}:</b> <code>\u2066${escapeHtml(emailItem.from)}\u2069</code>\n` +
    `📌 <b>${t.subject}:</b> <code>\u2066${escapeHtml(emailItem.subject)}\u2069</code>\n` +
    `📅 <b>${t.date}:</b> <code>\u2066${escapeHtml(emailItem.date)}\u2069</code>\n\n` +
    (actionHtml ? `${actionHtml}` : "") +
    `💬 <b>${t.fullBody}:</b>\n`;
  const footer = `\n${linksHtml}\n━━━━━━━━━━━━━━━`;
  const reserved = header.length + footer.length + ellipsis.length;
  const bodyBudget = Math.max(0, TELEGRAM_MAX - reserved);
  let bodyOut = cleanBodyText;
  if (bodyOut.length > bodyBudget) {
    bodyOut = bodyOut.substring(0, bodyBudget) + ellipsis;
  }

  // Body is rendered as plain escaped HTML inside the message. We do NOT
  // wrap the whole body in <pre> or global FSI/PDI: the body may itself
  // be Persian/Arabic (RTL) and forcing it to LTR would re-order the
  // user's actual text. Instead, only the header fields (sender, subject,
  // date) and each link anchor are individually isolated with FSI/PDI
  // inside <code>, which is sufficient to keep external LTR values from
  // being re-ordered into the RTL flow. Mixed content inside the body
  // (e.g. a URL embedded in a Persian sentence) still renders correctly
  // because Telegram's HTML parser handles inline bidi per codepoint.
  const text =
    header +
    `${escapeHtml(bodyOut)}` +
    footer;

  // Inline keyboard. When the email contains an activation/verification
  // link, the FIRST row is a Telegram "URL" button (not a callback
  // button) so the user can tap it on mobile and the verify URL opens
  // in their browser directly — no copy/paste, no round-trip through
  // the inbox. This is the primary action for transactional emails
  // like Aparat's account confirmation ("تکمیل ثبت نام"). The collapse,
  // back, and home rows are preserved exactly as before.
  const keyboardRows = [];
  if (storedLink) {
    const linkLabel = isAparatEmail(emailItem.from, storedLink, emailItem.subject) ? "✅ تایید حساب" : linkLabelFor(storedLink, t);
    keyboardRows.push([
      { text: linkLabel, url: storedLink }
    ]);
  }
  keyboardRows.push([{ text: t.btnCollapse, callback_data: `collapse_${emailItem.id}` }]);
  keyboardRows.push([{ text: t.btnBack, callback_data: "inbox" }]);
  keyboardRows.push([{ text: t.btnHome, callback_data: "back_dashboard" }]);
  const keyboard = { inline_keyboard: keyboardRows };

  await editTelegramMessage(env.BOT_TOKEN, chatId, messageId, text, keyboard);
}

/* ==========================================================================
   Telegram API Helper Functions
   ========================================================================== */

async function sendTelegramMessage(botToken, chatId, text, replyMarkup = null) {
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  let json = null;
  try { json = await res.json(); } catch (e) { json = null; }
  if (!res.ok || (json && json.ok === false)) {
    const desc = (json && json.description) ? json.description : `HTTP ${res.status}`;
    throw new Error(`Telegram API error: ${desc}`);
  }
  return json;
}

async function editTelegramMessage(botToken, chatId, messageId, text, replyMarkup = null) {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text: text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;

  const res = await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  let json = null;
  try { json = await res.json(); } catch (e) { json = null; }
  // Benign Telegram 400: editing a message with identical content. Treated
  // as success (same no-op behavior as before this fix) so redundant
  // Refresh/Back taps don't surface as errors.
  if (json && !res.ok && typeof json.description === "string" &&
      json.description.includes("message is not modified")) {
    return json;
  }
  if (!res.ok || (json && json.ok === false)) {
    const desc = (json && json.description) ? json.description : `HTTP ${res.status}`;
    throw new Error(`Telegram API error: ${desc}`);
  }
  return json;
}

async function answerCallbackQuery(botToken, callbackQueryId, text, showAlert = false) {
  const payload = {
    callback_query_id: callbackQueryId,
    text: text,
    show_alert: showAlert
  };

  const res = await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return await res.json();
}

async function deleteTelegramMessage(botToken, chatId, messageId) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId })
  });
  return await res.json();
}

/* ==========================================================================
   Self-Contained Lightweight MIME & Quoted-Printable Decoder
   ========================================================================== */

/**
 * Safely read a ReadableStream into a Uint8Array without ever throwing.
 * Returns null on failure (caller should fall back).
 */
async function streamToArrayBuffer(stream) {
  try {
    if (!stream) return null;
    if (stream instanceof Uint8Array) return stream;
    if (stream instanceof ArrayBuffer) return new Uint8Array(stream);
    if (typeof stream === "string") return new TextEncoder().encode(stream);
    if (typeof stream.getReader === "function") {
      const reader = stream.getReader();
      const chunks = [];
      let total = 0;
      // Hard cap to avoid hanging on pathological inputs (~5MB).
      const MAX_BYTES = 5 * 1024 * 1024;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength || value.length || 0;
          if (total > MAX_BYTES) {
            try { await reader.cancel(); } catch (e) {}
            return new Uint8Array(0);
          }
          chunks.push(value instanceof Uint8Array ? value : new Uint8Array(value));
        }
      }
      let out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { out.set(c, off); off += c.byteLength; }
      return out;
    }
    if (stream.arrayBuffer) {
      const ab = await stream.arrayBuffer();
      return new Uint8Array(ab);
    }
    return null;
  } catch (e) {
    console.error(`[streamToArrayBuffer] failed: ${e && e.stack ? e.stack : e}`);
    return null;
  }
}

/**
 * Decode MIME encoded headers like =?UTF-8?B?...?= and =?UTF-8?Q?...?=
 */
function decodeMimeHeader(text) {
  if (!text) return "";
  return text.replace(/=\?([^?]+)\?([QB])\?([^?]+)\?=/gi, (_, charset, encoding, data) => {
    try {
      if (encoding.toUpperCase() === 'Q') {
        const bytes = new Uint8Array(data.replace(/=/g, '%').match(/%..|./g).map(c => c.startsWith('%') ? parseInt(c.slice(1), 16) : c.charCodeAt(0)));
        return new TextDecoder(charset).decode(bytes);
      }
      if (encoding.toUpperCase() === 'B') {
        return new TextDecoder(charset).decode(Uint8Array.from(atob(data), c => c.charCodeAt(0)));
      }
    } catch (e) {}
    return text;
  });
}

/**
 * Clean Quoted-Printable and HTML Entities in text
 */
function cleanBody(text) {
  if (!text) return "";
  let decoded = text.replace(/=\r?\n/g, "").replace(/=20/g, " ");
  decoded = decoded.replace(/(=[0-9A-F]{2})+/gi, (match, _p1, offset, full) => {
    const before = offset > 0 ? full[offset - 1] : "";
    if (before && /[A-Za-z0-9._~%-]/.test(before)) return match;
    try {
      const bytes = new Uint8Array(match.split('=').slice(1).map(hex => parseInt(hex, 16)));
      return new TextDecoder('utf-8').decode(bytes);
    } catch (e) {
      return match;
    }
  });
  return decoded.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec)).trim();
}

/**
 * Decode Quoted-Printable content with full multi-byte UTF-8 support and
 * soft line breaks. The decoder is robust against the common real-world
 * case where a plain-text URL or query string contains an `=` that is
 * *not* a QP escape (e.g. `?key=value`, `id=42`).
 *
 * Per RFC 2045, an `=` followed by two hex digits is a hex escape. In
 * practice, however, the bytes produced by that interpretation must be
 * valid UTF-8 lead bytes (0xC2-0xF4) or printable ASCII (0x20-0x7E) for
 * the result to make sense in a UTF-8 body. QP is overwhelmingly used
 * to encode either ASCII whitespace/punctuation (=20, =3D, =2F) or
 * multi-byte UTF-8 sequences (=E2=80=99, =D8=AD, …). If `=XX` would
 * produce a byte that cannot be a UTF-8 lead or continuation start
 * (i.e. 0x80-0xBF or 0xC0-0xC1) the `=XX` is left as literal text —
 * this is what every popular email client does in practice.
 *
 * Examples:
 *   "=20"            → " "         (space, QP escape, decoded)
 *   "=3D"            → "="         (literal equals, QP escape, decoded)
 *   "=E2=80=99"      → "\u2019"    (right single quotation mark, decoded)
 *   "?key=abc"       → "?key=abc"  (literal =, NOT a QP escape)
 *   "?token=3Dabc"   → "?token=3Dabc" (no QP context, =3D left literal
 *                                     in this version because it could
 *                                     also be a QP escape; the byte 0x3D
 *                                     IS printable ASCII so this could
 *                                     decode to "=". We keep it literal
 *                                     when followed by non-hex to avoid
 *                                     corrupting URLs.)
 *
 * Multi-byte sequences are accumulated into a `bytes[]` buffer and
 * flushed with TextDecoder so a 3-byte UTF-8 character split across
 * three =XX sequences decodes as a single codepoint, not three
 * replacement characters.
 */
function decodeQuotedPrintable(str) {
  if (!str) return "";

  // Soft line breaks: "=\r\n" or "=\n" (per RFC 2045 §6.7).
  let result = str.replace(/=\r?\n/g, "");
  const bytes = [];
  let decodedString = "";
  let i = 0;

  const flushBytes = () => {
    if (bytes.length === 0) return;
    try {
      decodedString += new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
    } catch (e) {}
    bytes.length = 0;
  };

  while (i < result.length) {
    const ch = result[i];
    if (ch === "=" && i + 2 < result.length) {
      const hex = result.substring(i + 1, i + 3);
      if (/^[A-F0-9]{2}$/i.test(hex)) {
        const byte = parseInt(hex, 16);
        // Accept the byte if it is:
        //   - printable ASCII (0x20-0x7E)  — common QP targets
        //   - a valid UTF-8 multi-byte lead (0xC2-0xF4)
        //   - a UTF-8 continuation (0x80-0xBF) — only valid if bytes[]
        //     is non-empty (i.e. we are mid-sequence).
        //
        // Reject (leave literal) if:
        //   - it's 0x00-0x1F (control, almost never a QP target in
        //     UTF-8 text; usually indicates we're looking at e.g. ?id=00
        //     in a URL or some base64-like string)
        //   - it's 0x7F (DEL)
        //   - it's 0xC0-0xC1 (overlong UTF-8 lead, never used in valid
        //     QP-encoded UTF-8)
        //   - it's 0xF5-0xFF (above the Unicode maximum)
        //   - it's a continuation byte 0x80-0xBF AND bytes[] is empty
        //     (a lone continuation byte is never a QP target)
        const isPrintableAscii = byte >= 0x20 && byte <= 0x7E;
        const isUtf8Lead = byte >= 0xC2 && byte <= 0xF4;
        const isContinuation = byte >= 0x80 && byte <= 0xBF;
        const accept = isPrintableAscii
          || isUtf8Lead
          || (isContinuation && bytes.length > 0);
        if (accept) {
          bytes.push(byte);
          i += 3;
          continue;
        }
        // Otherwise: fall through and treat the `=` as a literal char.
        // The next two iterations will see the hex chars as literal too.
      }
    }

    // Either we are not at `=XX`, or the `=XX` is invalid. Flush any
    // accumulated bytes and emit the current character verbatim.
    flushBytes();
    decodedString += ch;
    i++;
  }

  flushBytes();
  return decodedString;
}

/**
 * Decode numeric HTML entities (e.g. &#1582; or &#x62A;) and named entities to proper UTF-8 Persian text
 */
function decodeNumericHtmlEntities(str) {
  if (!str) return "";
  return str
    .replace(/&#(\d+);/g, (match, dec) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10));
      } catch (e) {
        return match;
      }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch (e) {
        return match;
      }
    });
}

/**
 * Clean up Mojibake text artifacts (e.g. ISO-8859-1 / Windows-1256 artifacts)
 */
function cleanTextArtifacts(str) {
  if (!str) return "";
  let result = str;

  try {
    if (/[\u0080-\u00ff]/.test(result)) {
      const latin1Bytes = new Uint8Array(result.length);
      for (let i = 0; i < result.length; i++) {
        latin1Bytes[i] = result.charCodeAt(i) & 0xff;
      }
      const utf8Decoded = new TextDecoder("utf-8", { fatal: true }).decode(latin1Bytes);
      if (utf8Decoded && utf8Decoded.length > 0) {
        result = utf8Decoded;
      }
    }
  } catch (e) {}

  return result;
}

/**
 * Strip all internal HTML/CSS tags, extra spaces, and empty lines
 */
function stripHtmlTags(html) {
  if (!html) return "";
  if (typeof html !== "string") html = String(html);

  let text = html;

  text = text.replace(/<!doctype[\s\S]*?>/gi, "");
  text = text.replace(/<\?xml[\s\S]*?\?>/gi, "");
  text = text.replace(/<!\[CDATA\[[\s\S]*?\]\]>/gi, "");

  text = text.replace(/<!--[\s\S]*?-->/g, "");

  text = text.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, "");

  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "");
  text = text.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, "");
  text = text.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, "");
  text = text.replace(/<object\b[^>]*>[\s\S]*?<\/object\s*>/gi, "");
  text = text.replace(/<embed\b[^>]*>[\s\S]*?<\/embed\s*>/gi, "");
  text = text.replace(/<applet\b[^>]*>[\s\S]*?<\/applet\s*>/gi, "");
  text = text.replace(/<template\b[^>]*>[\s\S]*?<\/template\s*>/gi, "");
  text = text.replace(/<svg\b[^>]*>[\s\S]*?<\/svg\s*>/gi, "");

  text = text.replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, "");
  text = text.replace(/<meta\b[^>]*\/?>/gi, "");
  text = text.replace(/<link\b[^>]*\/?>/gi, "");
  text = text.replace(/<base\b[^>]*\/?>/gi, "");

  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<hr\s*\/?>/gi, "\n");

  text = text.replace(/<(\/?)(p|div|section|article|main|aside|header|footer|nav|table|tr|td|th|ul|ol|li|dl|dt|dd|h[1-6]|blockquote|pre|figure|figcaption|address|form|fieldset|legend)\b[^>]*>/gi, (m, slash, tag) => {
    return slash ? "\n" : " ";
  });

  text = text.replace(/<[^>]+>/g, "");

  text = decodeNumericHtmlEntities(text);

  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&zwnj;/gi, "\u200c")
    .replace(/&zwj;/gi, "\u200d")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&hellip;/gi, "…")
    .replace(/&lsquo;/gi, "\u2018")
    .replace(/&rsquo;/gi, "\u2019")
    .replace(/&ldquo;/gi, "\u201c")
    .replace(/&rdquo;/gi, "\u201d")
    .replace(/&bull;/gi, "•")
    .replace(/&middot;/gi, "·")
    .replace(/&copy;/gi, "©")
    .replace(/&reg;/gi, "®")
    .replace(/&trade;/gi, "™");

  text = stripCssArtifacts(text);

  return text;
}

function stripCssArtifacts(text) {
  if (!text) return "";
  let result = text;

  result = result.replace(/<link\b[^>]*stylesheet[^>]*>/gi, "");
  result = result.replace(/<link\b[^>]*>/gi, "");

  result = result.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "");

  result = result.replace(/\/\*[\s\S]*?\*\//g, "");

  // @media / @keyframes / @font-face and other at-rule blocks are now
  // removed by stripCssBlocks() via balanced-brace matching (see looksLikeCssSelector).

  result = stripCssBlocks(result);

  // Empty CSS rule blocks: `selector { }`. Bounded by requiring the inner
  // selector to not contain a `{` (so the matcher can't chase into nested
  // blocks) and by the overall pattern being a single linear sweep.
  // The previous version `(\\s*[,>+~ ]\\s*[A-Za-z_*#.][\\w-]*)*` was
  // catastrophic on long runs of letters/digits (e.g. a 16KB body of
  // plain text), causing the email handler to hit Cloudflare's
  // "exceededResources" limit and bounce as Delivery failed.
  result = result.replace(/[A-Za-z_][\w-]{0,80}(?:\s*[,>+~]\s*[A-Za-z_*#.][\w-]{0,80}){0,8}\s*\{\s*\}/g, "");

  const knownCssProperties = "(?:font|color|background|padding|margin|border|width|height|min|max|top|left|right|bottom|display|position|float|clear|visibility|opacity|overflow|transform|transition|animation|flex|grid|gap|align|justify|text|letter|line|word|white|vertical|content|cursor|outline|box-shadow|z-index|list-style|text-decoration|text-transform|font-weight|font-style|font-size|font-family|margin-top|margin-bottom|margin-left|margin-right|padding-top|padding-bottom|padding-left|padding-right|border-top|border-bottom|border-left|border-right|border-color|border-style|border-width|border-radius|background-color|background-image|background-position|background-size|background-repeat|max-width|min-width|max-height|min-height)";
  // Bounded value: a real CSS value is < 500 chars and stops at ; { } or newline.
  const cssPropRegex = new RegExp("\\b" + knownCssProperties + "(?:-[a-z]+)?\\s*:\\s[^;{}\\n]{0,500}?(?:\\s*!\\s*(?:important|optional))?\\s*;", "gi");
  result = result.replace(cssPropRegex, "");

  result = result.replace(/<style\b[^>]*\/?>/gi, "");
  result = result.replace(/<\/style\s*>/gi, "");

  result = result.split(/\r?\n/).filter(line => !looksLikeCssLine(line)).join("\n");

  return result;
}

function isCssSelectorStart(ch, nextCh) {
  if (!ch) return false;
  if (ch === "*" || ch === "." || ch === "#" || ch === "&") return true;
  if (ch === ":") {
    if (!nextCh) return false;
    if (nextCh === ":") return true;
    return /[a-zA-Z*]/.test(nextCh);
  }
  if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")) return true;
  return false;
}

function isSelectorTokenChar(ch) {
  if (!ch) return false;
  if (/[a-zA-Z0-9_]/.test(ch)) return true;
  if (ch === "-" || ch === "." || ch === "#" || ch === "*" || ch === "&") return true;
  return false;
}

function lastSelectorTokenEnd(prefix, end) {
  if (end === 0) return 0;
  let i = end - 1;

  while (i >= 0) {
    const ch = prefix[i];
    if (isSelectorTokenChar(ch)) { i--; continue; }
    if (ch === ":") {
      const nextCh = i + 1 < end ? prefix[i + 1] : "";
      if (nextCh && /[a-zA-Z*]/.test(nextCh)) { i--; continue; }
      return i + 1;
    }
    if (ch === ")") {
      let depth = 1;
      let k = i - 1;
      while (k >= 0 && depth > 0) {
        const c2 = prefix[k];
        if (c2 === ")") depth++;
        else if (c2 === "(") depth--;
        k--;
      }
      if (depth !== 0) return i + 1;
      i = k;
      continue;
    }
    if (ch === "]") {
      let depth = 1;
      let k = i - 1;
      while (k >= 0 && depth > 0) {
        const c2 = prefix[k];
        if (c2 === "]") depth++;
        else if (c2 === "[") depth--;
        k--;
      }
      if (depth !== 0) return i + 1;
      i = k;
      continue;
    }
    return i + 1;
  }
  return 0;
}

const KNOWN_CSS_TAGS = new Set([
  "a","abbr","address","article","aside","audio","b","bdi","bdo","blockquote","body",
  "button","canvas","caption","cite","code","data","datalist","dd","del","details","dfn",
  "dialog","div","dl","dt","em","embed","fieldset","figcaption","figure","footer","form",
  "h1","h2","h3","h4","h5","h6","head","header","hgroup","hr","html","i","iframe","img",
  "input","ins","kbd","label","legend","li","link","main","map","mark","menu","meta",
  "meter","nav","noscript","object","ol","optgroup","option","output","p","picture","pre",
  "progress","q","rp","rt","ruby","s","samp","script","section","select","small","source",
  "span","strong","style","sub","summary","sup","table","tbody","td","template","textarea",
  "tfoot","th","thead","time","title","tr","track","u","ul","var","video","wbr"
]);

function looksLikeCssSelector(prefix) {
  const p = (prefix || "").trim();
  if (!p) return false;
  if (/^@[\w-]+/i.test(p)) return true;
  if (/[;{}]/.test(p)) return false;

  if (/[.#*\[(:>~+]/.test(p)) return true;

  if (/^[a-zA-Z][\w-]*$/i.test(p)) {
    return KNOWN_CSS_TAGS.has(p.toLowerCase());
  }

  const tokens = p.split(/(?:\s*[>+~]\s*|\s+)/).filter(Boolean);
  if (tokens.length >= 2 && tokens.length <= 6) {
    const allSelectors = tokens.every(t => {
      const bare = t.replace(/^[*#.&]+/, "").replace(/:.*$/, "");
      return bare === "" || KNOWN_CSS_TAGS.has(bare) || /^[*#.&:]/.test(t);
    });
    if (allSelectors) return true;
  }

  return false;
}

function findMatchingBrace(text, openIdx) {
  let depth = 0;
  let inString = null;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : "";
    if (inLineComment) { if (ch === "\n") inLineComment = false; continue; }
    if (inBlockComment) { if (ch === "*" && next === "/") { inBlockComment = false; i++; } continue; }
    if (inString) { if (ch === "\\") { i++; continue; } if (ch === inString) inString = null; continue; }
    if (ch === "/" && next === "/") { inLineComment = true; i++; continue; }
    if (ch === "/" && next === "*") { inBlockComment = true; i++; continue; }
    if (ch === "'" || ch === '"') { inString = ch; continue; }
    if (ch === "{") { depth++; continue; }
    if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function isPureSelectorLine(line) {
  const t = (line || "").trim();
  if (!t) return false;
  if (/^@[\w-]+/i.test(t)) return true;
  if (/[;{}]/.test(t)) return false;
  const unit = "(?:[*#.&:]?[a-zA-Z][\\w-]*(?::[\\w-]+)*|\\([^()]*\\)|\\[[^\\]]*\\])";
  const re = new RegExp("^" + unit + "(?:\\s*[>+~]?\\s*" + unit + ")*(?:\\s*\\{[^}]*\\})?$");
  return re.test(t);
}

function stripCssBlocks(text) {
  if (!text) return "";
  let result = "";
  let i = 0;
  while (i < text.length) {
    const braceIdx = text.indexOf("{", i);
    if (braceIdx === -1) {
      result += text.substring(i);
      break;
    }
    const prefix = text.substring(i, braceIdx);
    const matchIdx = findMatchingBrace(text, braceIdx);
    if (matchIdx === -1) {
      result += text.substring(i);
      break;
    }
    const selectorLine = prefix.substring(prefix.lastIndexOf("\n") + 1);
    if (looksLikeCssSelector(selectorLine)) {
      const lastNl = prefix.lastIndexOf("\n");
      if (!isPureSelectorLine(selectorLine)) {
        // selector line holds real content (e.g. a verification code) -> keep it, drop only the block
        result += prefix;
      } else if (lastNl !== -1) {
        result += prefix.substring(0, lastNl + 1);
      }
      i = matchIdx + 1;
      while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
      if (i < text.length && text[i] === "\n") {
        result += "\n";
        i++;
      }
      while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
    } else {
      result += text.substring(i, matchIdx + 1);
      i = matchIdx + 1;
    }
  }
  return result;
}

// Maximum line length we will even attempt to run the CSS heuristics on.
// Any line longer than this is not a CSS rule — it's prose, a URL, or
// base64. Combined with the bounded patterns below, this makes
// looksLikeCssLine linear in the line length.
const MAX_CSS_LINE_LENGTH = 512;

function looksLikeCssLine(line) {
  if (!line || typeof line !== "string") return false;
  const trimmed = line.trim();
  if (!trimmed) return false;
  // Hard length cap: prevents pathological backtracking on long lines
  // (e.g. base64 blobs, URLs, or non-CSS prose that happens to contain
  // a stray brace).
  if (trimmed.length > MAX_CSS_LINE_LENGTH) return false;

  // Bounded, non-nested patterns. Each branch handles a specific CSS shape
  // and all the inner quantifiers are bounded by MAX_CSS_LINE_LENGTH, so
  // backtracking is linear in line length.

  // .selector1, .selector2, #id { ... }
  if (/^[\s]*[.#][\w-]+(?:\s*,\s*[.#][\w-]+)*\s*\{[^}]{0,400}\}$/i.test(trimmed)) return true;
  // #id, .class { ... }
  if (/^[\s]*#[\w-]+(?:\s*,\s*[.#][\w-]+)*\s*\{[^}]{0,400}\}$/i.test(trimmed)) return true;

  // @import / @charset / @namespace etc.
  if (/^[\s]*@(import|charset|namespace)\b/i.test(trimmed)) return true;
  // @media / @keyframes / @font-face blocks
  if (/^[\s]*@[a-zA-Z][\w-]*\b/i.test(trimmed) && /[{}]/.test(trimmed) && trimmed.length < 400) return true;

  // selector { ... }  (no commas)
  if (/^[\s]*[a-zA-Z][\w-]*(?:[:#.\w\-\[\]="',\s>()+*~]*)\s*\{[^}]{0,400}\}$/i.test(trimmed)) return true;

  // CSS property declaration: name: value;
  if (/^[\s]*[a-zA-Z][\w-]*\s*:\s*[^;{}\n]{0,300}?\s*(?:!important|!optional)?\s*;\s*$/i.test(trimmed)) {
    const colonText = trimmed.split(":")[0].trim();
    if (/^(font|color|background|padding|margin|border|width|height|min|max|top|left|right|bottom|display|position|float|clear|visibility|opacity|overflow|transform|transition|animation|flex|grid|gap|align|justify|text|letter|line|word|white|vertical|content|cursor|outline|box-shadow|z-index|list-style|text-decoration|text-transform|font-weight|font-style|font-size|font-family|margin-top|margin-bottom|margin-left|margin-right|padding-top|padding-bottom|padding-left|padding-right|border-top|border-bottom|border-left|border-right|border-color|border-style|border-width|border-radius|background-color|background-image|background-position|background-size|background-repeat|max-width|min-width|max-height|min-height)$/i.test(colonText)) {
      return true;
    }
  }

  return false;
}

/**
 * Comprehensive text cleaning for email body
 */
function cleanText(str) {
  if (!str) return "";
  let result = cleanBody(str);

  result = decodeNumericHtmlEntities(result);

  result = result
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&zwnj;/gi, "\u200c");

  result = cleanTextArtifacts(result);

  // Final safety net: even if a header line somehow slipped past
  // parseEmailBody (e.g. via a future code path that skips the part
  // splitter), drop it here so the user never sees raw SMTP headers
  // in the parsed body.
  result = stripInnerHeaderLines(result);

  const lines = result
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(line => line.length > 0);

  return lines.join("\n");
}

/* ==========================================================================
   Email Body Parser
   ========================================================================== */

/* ==========================================================================
   Robust Email Body Parser & MIME / Base64 Decoder
   ========================================================================== */

/**
 * Last-resort text extractor for emails where the main pipeline produced nothing
 * (e.g. some senders put the OTP inside a <style>-laden <div> that gets misclassified
 *  as CSS, or the only text part is a stub and the real content is buried in
 *  deeply-nested HTML). Strips <style>, <script>, all tags, and decodes basic
 *  HTML entities. Conservative: only used when the main pipeline returns "(no content)".
 */
function lastResortExtract(html) {
  if (!html) return "";
  let result = String(html);

  result = result.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ");
  result = result.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ");
  result = result.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, " ");

  result = decodeNumericHtmlEntities(result);

  result = result
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&zwnj;/gi, "\u200c");

  result = result.replace(/<[^>]+>/g, " ");

  // Final safety net: drop any leaked SMTP/MIME header lines so the
  // user never sees them in the rendered body.
  result = stripInnerHeaderLines(result);

  result = result
    .split(/\r?\n/)
    .map(line => line.replace(/[ \t]+/g, " ").trim())
    .filter(line => line.length > 0)
    .join("\n");

  return result;
}

/* ==========================================================================
   Fast-path extractor for large email bodies (CPU safety net)
   ==========================================================================
   Cloudflare Workers free plan caps CPU at 10ms per invocation. The full
   parseEmailBody pipeline below runs ~30 regex passes over a multi-KB
   body, which is fine for small emails (Aparat, OpenAI) but blows the
   budget on large AI assistant digests (200 KB+). For those we run a
   cheap, bounded extractor that finds the activation link and OTP code
   with a single regex pass each, plus a tag-stripped preview. */

const MAX_PARSE_BYTES = 256 * 1024;
const FAST_PATH_PREVIEW_LIMIT = 50 * 1024; // only inspect this much for the preview

// How many archived recovery tokens to keep per chat in the email_tokens
// archive (migration 0004). The most recent N tokens are retained per
// chat; anything older is dropped. 50 covers years of normal use for
// one person (a few emails a week → 50 ≈ a year of history) and keeps
// storage bounded: 50 rows × ~100 bytes/row × 1k users = ~5 MB total.
const ARCHIVE_TOKEN_LIMIT = 50;

const ACTIVATION_KEYWORDS = [
  "confirm", "verify", "verification", "activate", "activation",
  "token", "auth", "login", "signin", "signup", "register",
  "reset", "password", "magic", "callback", "redirect", "aparat"
];

const URL_REGEX_GLOBAL = /https?:\/\/[^\s<>"']+/gi;
const URL_REGEX_GLOBAL_LT = /https?:\/\/[^\s<>"']+/g;
const OTP_REGEX = /\b\d{4,8}\b/g;
const TAG_REGEX = /<[^>]+>/g;
const STYLE_SCRIPT_REGEX = /<(?:style|script|head)\b[^>]*>[\s\S]*?<\/(?:style|script|head)\s*>/gi;

// Strip HTML attribute values (href, src, data-*, style, name, value, id,
// class) so a digit inside an attribute never matches the bare-digit scan.
// Match either quoted forms ("..." / '...') or bare tokens.
const HTML_ATTR_REGEX = /\b(?:href|src|action|data-[a-z0-9_-]+|style|name|value|id|class)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const MAILTO_OR_TEL_REGEX = /\b(?:mailto|tel|data|ftp|file):[^\s<>"']+/gi;

// Lines that look like a code/OTP label (English + Persian). Used by the
// line-aware bare-digit scan in extractFast. A line must contain one of
// these substrings to be considered a candidate for bare-digit matching.
const CODE_LINE_LABELS = [
  "code", "codes", "otp", "pin", "token", "passcode", "one-time",
  "کد", "رمز", "شناسه", "تایید", "تأیید", "اعتبارسنجی"
];
const CODE_LINE_LABEL_RE = new RegExp(CODE_LINE_LABELS.map(s => {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}).join("|"), "i");

// Labelled OTP regex: matches a line that says "verification code", "your
// code", "کد تایید" etc. followed by 4-8 digits. Used to find the OTP
// before any link scan, so a code-bearing email always surfaces the code
// (not an accidentally-extracted tracking link).
const LABELLED_OTP_REGEX = /(?:(?:verification|confirm|security|one[- ]time|login|sign[- ]?in|sign[- ]?up|account|email)\s*(?:code|otp|pin|token|password)|code\s*(?:is|:|＝)|your\s*code|کد\s*تایید|کد\s*[:：]?|رمز\s*یکبار\s*مصرف|کد\s*پستی\s*الکترونیکی|کد\s*امنیتی|شناسه\s*تأیید)\s*[=:]?\s*([0-9]{4,8})/i;

/**
 * Build the scan text used by the line-aware bare-digit OTP scan.
 *
 * Removes every place a digit could appear that is NOT body prose:
 *   1. http/https absolute URLs (so ?id=12345 in a query is gone)
 *   2. mailto / tel / data / ftp / file URIs
 *   3. HTML attribute values (href, src, data-*, style, name, value, id, class)
 *   4. All remaining HTML tags
 *
 * Then collapses whitespace to single spaces. The result is safe to
 * run `\b\d{4,8}\b` against, because any digit that remains is body
 * prose (i.e. something the user can actually see and copy).
 */
function buildOtpScanText(text) {
  if (!text) return "";
  return text
    .replace(URL_REGEX_GLOBAL_LT, " ")
    .replace(MAILTO_OR_TEL_REGEX, " ")
    .replace(HTML_ATTR_REGEX, " ")
    .replace(TAG_REGEX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Strict URL classifier. A URL is treated as a verification link if:
//   - its path contains a verification keyword (verify/confirm/auth/…),
//     AND is not in the tracker reject list, AND its host is not a known
//     shortener; OR
//   - its query string contains a token/code/key/hash/otp/secret param,
//     AND the path is not a tracker prefix, AND the host is not a
//     shortener.
//
// Everything else is rejected. This stops tracking pixels, open-trackers
// (t.co, /r/, /open), and SMTP-wrapper URLs from being mistaken for the
// real activation link.
const VERIFY_PATH_KEYWORDS = [
  "/verify", "/verification", "/verified", "/verifiy",
  "/confirm", "/confirmation", "/confirmed", "/confirme",
  "/activate", "/activation", "/active", "/enable", "/enabled",
  "/auth", "/authenticate", "/authentication",
  "/login", "/log-in", "/signin", "/sign-in", "/sign-into",
  "/signup", "/sign-up", "/sign-up", "/register", "/registration",
  "/reset", "/forgot", "/recover", "/recovery",
  "/account", "/myaccount", "/user", "/users", "/member", "/members",
  "/magic", "/magiclink", "/magic-link", "/magic_link",
  "/c/", "/subscription", "/subscribe",
  "/email-confirm", "/email_confirm", "/emailconfirm",
  "/email-verify", "/email_verify", "/emailverify",
  "/verify-email", "/verify_email", "/verifyemail",
  "/email-verification", "/email_verification", "/emailverification",
  "/account-verify", "/account_verify", "/accountverify",
  "/account-activation", "/account_activation",
  "/user-verify", "/user_verify", "/userverify",
  "/welcome", "/onboard", "/onboarding",
  "/validate", "/challenge", "/check", "/finish",
  "/go/", "/tap/", "/click-confirm", "/click-verify",
  "/confirm-email", "/confirm_email", "/confirmemail",
  "/verification-link", "/verification_link", "/verificationlink",
  "/click-to-confirm", "/click_to_confirm", "/clicktoconfirm",
  "/click-to-verify", "/click_to_verify", "/clicktoverify",
  "/complete-registration", "/complete_registration",
  "/finish-registration", "/finish_registration"
];
const TRACKER_PATH_PREFIXES = [
  "/track", "/click", "/open", "/r/", "/redirect",
  "/pixel", "/beacon", "/t/", "/share", "/unsubscribe",
  "/img/", "/images/", "/static/", "/assets/", "/css/", "/js/"
];
const TRACKER_HOSTS = new Set([
  "t.co", "bit.ly", "goo.gl", "ow.ly", "tinyurl.com",
  "is.gd", "buff.ly", "rebrand.ly", "cutt.ly", "short.io",
  "trib.al", "lnkd.in", "fb.me", "youtu.be", "tr.ee",
  "mcaf.ee", "po.st", "adf.ly", "shorte.st", "sh.st"
]);
// Query-parameter classification (Stage 2). STRONG params are sufficient
// on their own to qualify a URL as a verification/action link; WEAK params
// only corroborate a path/context signal and can never qualify a URL
// alone. Single-letter params (u=, k=, v=, h=, t=, l=, s=) are dropped
// entirely — they were the main source of tracking URLs winning the
// primary-link slot.
const VERIFY_QUERY_STRONG = [
  "token", "code", "otp", "secret", "hash", "key",
  "confirmation_token", "verify_token", "verification_token", "verification-token",
  "confirmation", "confirm", "verify", "validation", "verified",
  "activation", "activate", "activation_token", "activation-token",
  "signup", "sign-up", "register", "registration",
  "auth_token", "session_token", "email_token", "email-token",
  "email_confirm_token", "email-confirm-token",
  "reset_token", "reset-token", "_token",
  "invite", "invitation", "ticket", "challenge", "nonce"
];
const VERIFY_QUERY_WEAK = [
  "id", "uid", "user_id", "userid", "account_id", "accountid",
  "user", "username", "account", "email", "emailaddress",
  "session", "auth", "sig", "signature", "state",
  "redirect_uri", "redirect-url", "next", "return_to", "return-to",
  "continue", "goto", "url", "link", "ref",
  "lang", "locale", "lng", "ttl", "expires", "expiry", "exp",
  "action", "type", "kind", "csrf", "csrf_token"
];
// Legacy flattened list (STRONG + WEAK) — kept for tests/back-compat.
const VERIFY_QUERY_KEYWORDS =
  VERIFY_QUERY_STRONG.concat(VERIFY_QUERY_WEAK).map(n => n + "=");

// Keywords in HTML anchor text or surrounding body lines that signal the
// link IS a verification/activation link even when the URL itself doesn't
// contain a recognizable keyword in path or query. Used as a fallback by
// the local-context path of scoreVerificationUrl() to catch real-world
// services (Aparat, X/Twitter, many e-commerce onboarding flows, etc.)
// whose verify URL has a totally arbitrary path like
// "/users/email-confirm/12345" or "/c/abcd" with no token/code/hash/secret
// in the query string.
const ACTIVATION_CONTEXT_KEYWORDS = [
  "verify", "verification", "verified", "verify-account", "verify email", "verify-email", "verify your",
  "confirm", "confirmation", "confirmed", "confirm your", "confirm email", "confirm-email",
  "activate", "activation", "active", "enable", "enabled",
  "complete registration", "finish registration", "complete signup", "finish signup",
  "click here to confirm", "click here to verify", "click to confirm", "click to verify",
  "tap here", "tap to confirm", "tap to verify",
  "complete your registration", "verify your account", "verify your email",
  "confirm your account", "confirm your email",
  "click the link", "click the button", "click below",
  "validate", "finish your signup", "finish signing up",
  "subscription", "subscribe", "join",
  "تأیید", "تایید", "تاييد",
  "تکمیل ثبت نام", "تکمیل ثبت‌نام", "تکمیل عضویت",
  "فعال سازی", "فعالسازی", "فعال‌سازی",
  "تایید حساب", "تایید ایمیل", "تأیید ایمیل",
  "تأیید حساب", "تأیید حساب کاربری",
  "برای فعال سازی", "برای فعال‌سازی", "برای تایید",
  "کلیک کنید", "روی لینک کلیک", "روی دکمه کلیک",
  "اینجا کلیک", "اینجا بزنید", "اینجا را کلیک",
  "عضویت", "اشتراک", "ثبت نام", "ثبت‌نام",
  "verify account", "confirm account", "verify your", "confirm your",
  "signin", "sign in", "sign-in", "log in", "login",
  "sign up", "signup", "sign-up", "register", "join us",
  "reset password", "forgot password", "recover account"
];

// Marketing/unsubscribe URL markers — these are NEVER the primary
// verification link, no matter what keywords appear elsewhere. (utm_*
// params are NOT hard-rejected: they only demote ranking in
// scoreVerificationUrl and can never qualify a URL on their own.)
const MARKETING_URL_MARKERS = [
  "unsubscribe", "list-manage", "campaign-"
];

function hasMarketingMarker(urlString) {
  const lower = String(urlString || "").toLowerCase();
  return MARKETING_URL_MARKERS.some(m => lower.includes(m));
}

// Anchor text for the <a> tag that contains `urlStart`, or "" when the URL
// is not inside an anchor. Used for verbatim context matching.
function anchorTextFor(stripped, urlStart) {
  const aOpen = stripped.lastIndexOf("<a", urlStart);
  if (aOpen === -1 || urlStart - aOpen > 500) return "";
  const tagClose = stripped.indexOf(">", aOpen);
  const aEnd = stripped.indexOf("</a>", urlStart);
  if (tagClose === -1 || tagClose <= aOpen || aEnd === -1) return "";
  return stripped.substring(tagClose + 1, aEnd).trim();
}

// Local context window: the text immediately surrounding a URL occurrence.
// When the URL sits inside an <a ...>…</a>, ONLY the anchor's inner text is
// used — the anchor text is the most reliable signal of the link's purpose,
// and scoping the context this way stops a body-wide "verification code is…"
// mention from qualifying an unrelated footer/help link. When the anchor
// text carries no activation keyword, a bounded window around the URL is
// used as fallback (plain-text links).
function localContextAround(stripped, urlStart, urlLen) {
  const anchor = anchorTextFor(stripped, urlStart);
  if (anchor) return anchor;
  const WINDOW = 300;
  const from = Math.max(0, urlStart - WINDOW);
  const to = Math.min(stripped.length, urlStart + urlLen + WINDOW);
  return stripped.substring(from, to);
}

function isStrictVerificationUrl(rawUrl, contextText) {
  return scoreVerificationUrl(rawUrl, contextText).qualified;
}

function paramCount(paramNames) {
  return Array.isArray(paramNames) ? paramNames.length : 0;
}

// Deterministic score for ranking multiple qualified candidates. Higher is
// better; a URL qualifies only when it carries at least one GENUINE
// verification signal:
//   - a verification keyword in its path (+40), OR
//   - a strong query param such as token/code/otp (+30), OR
//   - an activation keyword in its LOCAL context window (+35)
// Weak query params (+10) only corroborate — they can never qualify a URL
// alone (this kills "…?id=/u=/v=/t=…"-style tracking URLs).
// Penalties (utm_* params −15, ≥6 query params −10) only DEMOTE ranking:
// a URL with a genuine signal always stays at/above the qualification bar,
// so a real verify link that happens to carry utm tracking params keeps
// working, while a utm_-only URL never qualifies.
const QUALIFY_SCORE = 30;

function scoreVerificationUrl(url, localContext) {
  let parsed;
  try { parsed = new URL(String(url).trim()); } catch (e) {
    return { qualified: false, score: -1 };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { qualified: false, score: -1 };
  }

  const host = (parsed.hostname || "").toLowerCase();
  if (TRACKER_HOSTS.has(host)) return { qualified: false, score: -1 };

  const path = (parsed.pathname || "").toLowerCase();
  if (TRACKER_PATH_PREFIXES.some(p => path.startsWith(p))) {
    return { qualified: false, score: -1 };
  }
  if (hasMarketingMarker(url)) {
    return { qualified: false, score: -1 };
  }

  const pathHasVerify = VERIFY_PATH_KEYWORDS.some(k => path.includes(k));

  const paramNames = [];
  try {
    for (const name of parsed.searchParams.keys()) paramNames.push(name.toLowerCase());
  } catch (e) { /* malformed query — treat as no params */ }
  const strongQuery = paramNames.some(n => VERIFY_QUERY_STRONG.includes(n));
  const weakQuery = paramNames.some(n => VERIFY_QUERY_WEAK.includes(n));
  const utm = paramNames.some(n => n.startsWith("utm_"));

  const ctx = (localContext && typeof localContext === "string") ? localContext.toLowerCase() : "";
  let contextHit = false;
  if (ctx && !pathHasVerify && !strongQuery) {
    // Local-context fallback. The window mixes anchor text with nearby
    // prose, so require a LONG activation keyword (≥6 chars or a Persian
    // phrase) — short generic hits like "active"/"verified" inside a
    // sentence such as "your verification code is…" must not qualify an
    // unrelated help/footer link.
    contextHit = ACTIVATION_CONTEXT_KEYWORDS.some(kw =>
      kw.length >= 6 && ctx.includes(kw)
    );
  }

  const qualified = pathHasVerify || strongQuery || contextHit;
  if (!qualified) return { qualified: false, score: -1 };

  let score = 0;
  if (pathHasVerify) score += 40;
  if (strongQuery) score += 30;
  if (weakQuery) score += 10;
  if (contextHit) score += 35;
  if (paramCount(paramNames) >= 6) score -= 10;
  if (utm) score -= 15;
  // Penalties only demote ranking, never disqualify (see block comment).
  score = Math.max(score, QUALIFY_SCORE);

  return { qualified: true, score };
}
// Recognised MIME header field names. If a line starts with one of these
// followed by ":" it's almost certainly a header (transport, envelope, or
// per-part), not body content. We use this to drop stray "Received:",
// "ARC-Seal", "DKIM-Signature:" etc. that may appear inside the body
// after a multipart boundary.
//
// We also accept ANY "X-*: ..." line unconditionally (see stripInnerHeaderLines)
// to be future-proof against new senders (Cloudflare's X-CF-SpamH-Score,
// Gmail's X-Gm-Message-State, Exchange's X-MS-Exchange-*, etc.) — body
// content virtually never starts with "X-Foo:".
const MIME_HEADER_NAMES = [
  "Received", "From", "To", "Cc", "Bcc", "Reply-To", "Subject", "Date",
  "Sender", "Message-ID", "Resent-From", "Resent-To", "Resent-Date",
  "Resent-Message-ID", "In-Reply-To", "References",
  "MIME-Version", "Content-Type", "Content-Transfer-Encoding",
  "Content-ID", "Content-Description", "Content-Disposition",
  "Content-Language", "Content-Location", "Content-MD5",
  "DKIM-Signature", "ARC-Seal", "ARC-Message-Signature",
  "ARC-Authentication-Results", "Authentication-Results",
  "Authentication-Results-Original",
  "Received-SPF", "X-Received", "X-Original-To", "X-Original-From",
  "X-Original-Message-ID", "X-Original-Sender",
  "X-Mailer", "X-Priority", "X-Spam-Score", "X-Spam-Status",
  "X-Spam-Flag", "X-Source", "X-Source-Args", "X-Source-Dir",
  "X-Source-IP", "X-Source-Sender", "X-Originating-IP",
  "X-Report-Abuse", "X-Report-Spam", "X-Feedback-ID", "Feedback-ID",
  "List-Id", "List-Unsubscribe", "List-Unsubscribe-Post",
  "List-Subscribe", "List-Help", "List-Owner", "List-Archive",
  "Return-Path", "Return-Receipt-To", "Disposition-Notification-To",
  "Thread-Topic", "Thread-Index", "Accept-Language",
  // Cloudflare Email Routing / spam pipeline
  "X-CF-SpamH-Score", "X-CF-SpamH-Result", "X-CF-SpamH-Rule",
  // Cisco / IronPort
  "X-CMAE-Analysis", "X-CM-Header-Analysis", "X-CM-Transcript-ID",
  // Google (Gmail / Workspace)
  "X-Gm-Message-State", "X-Google-DKIM-Signature", "X-Google-Smtp-Source",
  // Microsoft Exchange / Outlook
  "X-MS-Exchange-Organization-SCL", "X-MS-Has-Attach",
  "X-MS-TNEF-Correlator", "X-Exchange-Antispam-Report",
  // Facebook notifications
  "X-Facebook-Notify",
  // Mailgun
  "X-Mailgun-Sid", "X-Mailgun-Variables", "X-Mailgun-Tag",
  "X-Mailgun-Dkim-Check", "X-Mailgun-Sscore",
  // Amazon SES
  "X-SES-Configuration-Set", "X-SES-Outgoing",
  // Proofpoint
  "X-Proofpoint-Spam-Details", "X-Proofpoint-Virus-Version",
  // Barracuda
  "X-Barracuda-Spam-Score", "X-Barracuda-Spam-Status",
  // Mimecast
  "X-Mimecast-Spam-Score", "X-Mimecast-Signature",
  // Proofpoint / Message-Page
  "X-PM-Message-Id", "X-PM-Signature"
];
const MIME_HEADER_RE = new RegExp(
  "^\\s*(?:" + MIME_HEADER_NAMES.join("|") + ")\\s*:",
  "im"
);

/**
 * Strip the leading MIME headers (transport + envelope) from a raw email.
 * Returns the substring starting at the first blank line, or the input
 * unchanged if no header/body separator is found within the first 64 KB.
 */
function stripMimeEnvelope(raw) {
  if (!raw || typeof raw !== "string") return "";
  // Cap the search: headers are always at the top and are short. If we
  // don't find a blank line within 64 KB we treat the whole input as body.
  const HEADER_LIMIT = 64 * 1024;
  const head = raw.length > HEADER_LIMIT ? raw.substring(0, HEADER_LIMIT) : raw;
  let splitIdx = -1;
  const crlfIdx = head.indexOf("\r\n\r\n");
  const lfIdx = head.indexOf("\n\n");
  if (crlfIdx !== -1 && (lfIdx === -1 || crlfIdx <= lfIdx)) splitIdx = crlfIdx + 4;
  else if (lfIdx !== -1) splitIdx = lfIdx + 2;
  if (splitIdx === -1) return raw;
  return raw.substring(splitIdx);
}

/**
 * Remove any remaining header-style lines that appear inside the body.
 * Multipart/alternative emails have nested parts each with their own
 * "Content-Type:", "Content-Transfer-Encoding:" etc. headers, and the
 * pattern can leak those into the visible text after a buggy decode.
 * Some senders (Cloudflare, Gmail, Exchange, Mailgun, SES, Mimecast,
 * Proofpoint, Barracuda) also prepend transport-level X-* headers
 * (X-CF-SpamH-Score, X-Gm-Message-State, X-MS-Exchange-*, …) that the
 * outer envelope strip may not catch when the boundary is malformed.
 *
 * Algorithm (single-pass, fold-safe, no chunking):
 *   1. Match a line that starts with a known MIME/transport header name
 *      (MIME_HEADER_NAMES) OR any X-* token.
 *   2. Continue matching folded continuation lines (RFC 5322 §2.2.3):
 *      a logical header ends at the first newline NOT followed by WSP.
 *   3. Drop the whole logical line(s) in one replacement.
 *
 * The earlier 8 KB-chunked implementation broke on:
 *   - very long DKIM-Signature values (>500 chars got past the cap)
 *   - folded headers (a `Key: foo\r\n  bar` line leaked the `  bar` part
 *     into the body when the newline landed in a new chunk)
 *   - unknown X-* senders (closed allowlist)
 *
 * This rewrite fixes all three. CPU is still O(n) and a single pass.
 */
function stripInnerHeaderLines(text) {
  if (!text) return "";
  if (typeof text !== "string") return "";
  // Build a regex that matches a logical header line and any RFC 5322
  // folded continuations that follow it. The header NAMES pattern is:
  //   - any name in MIME_HEADER_NAMES
  //   - "X-" + a token  (catches X-CF-*, X-MS-*, X-Gm-*, …)
  //   - the standard "Received", "ARC-*" etc. families explicitly
  //
  // Per-line value cap is 2000 chars so a 4 KB base64 DKIM signature
  // can still be dropped in one go.
  const KNOWN = MIME_HEADER_NAMES.join("|");
  // A header is `Name: value`, optionally followed by folded continuation
  // lines (each starts with WSP and does NOT contain a colon — the
  // defining property of a folded continuation per RFC 5322 §2.2.3).
  //
  // We allow the header to start at the beginning of input, after a
  // newline, OR after whitespace (the latter catches the common leak
  // case where a senders prepends "X-Foo: bar" to the body without a
  // preceding newline, e.g. "<p>Hello</p>X-CF-SpamH-Score: 0.1").
  //
  // A line is a continuation iff it starts with WSP and has NO `:` in
  // the first 60 chars after the leading WSP. If it has a `:`, it's
  // a new header (or a body label like "Code: 123456" which we don't
  // want to swallow into the previous header's match).
  //
  // Anti-body-prose guard: real headers live on their own line, with
  // the value followed by an actual newline. End-of-string does NOT
  // count as a line terminator here (a body paragraph that ends with
  // "...to continue." without a trailing newline would otherwise look
  // like a header). This rejects
  //   "Date: 12/15/2024. Open https://example.com/confirm to continue."
  // — the value runs to end of input with no newline, so it's body
  // prose, not a real header — and accepts
  //   "X-CF-SpamH-Score: -0.1\r\n"
  // — value is the only thing on its line, followed by a newline.
  //
  // Continuation lines (folded headers) keep the 2000-char cap because
  // a 4 KB base64 DKIM-Signature can be folded across many lines.
  const HEADER_LINE_RE = new RegExp(
    "(?<=^|\\n|\\s)(?:" +
      KNOWN + "|" +
      "X-[A-Za-z0-9._-]+" +
    ")[ \\t]*:[ \\t]*[^\\n]{0,4000}[ \\t]*(?=\\r?\\n)" +
    "(?:\\r?\\n[ \\t]+(?![ \\t]*[A-Za-z0-9-]+[ \\t]*:)[^\\n]{0,2000}[ \\t]*(?=\\r?\\n))*" +
    "\\r?\\n?",
    "gim"
  );
  return text.replace(HEADER_LINE_RE, " ");
}

function extractFast(rawEmail) {
  const raw = (rawEmail && typeof rawEmail === "string") ? rawEmail : "";

  // Step 0: drop the outer MIME envelope (Received:/From:/Subject:... block
  // followed by a blank line). This is what was causing the preview to
  // start with "Received: from v5106.v5375b7fa..." lines instead of the
  // real body content.
  const withoutEnvelope = stripMimeEnvelope(raw);

  // Only scan the first FAST_PATH_PREVIEW_LIMIT bytes for the link/OTP. The
  // activation link is always in the visible body of a transactional email,
  // not in some deep CSS asset block; cropping cuts the worst-case work
  // from O(n) on 1MB strings to O(50KB).
  const scanLimit = Math.min(withoutEnvelope.length, FAST_PATH_PREVIEW_LIMIT);
  const scan = withoutEnvelope.substring(0, scanLimit);

  // Step 0a: decode Quoted-Printable. Most transactional email is sent
  // as `Content-Transfer-Encoding: quoted-printable` and the raw MIME
  // we just read still contains `=20` (space), `=3D` (`=`), `=E2=80=99`
  // (right single quotation mark), etc. Without this step the preview
  // was leaking those byte sequences into Telegram, e.g.
  //   "Hi there, This=20was=20a=20long=20sentence..."
  // and the substring(0, 200) truncation was cutting mid-escape so the
  // visible text read "...wasn=E2=80=99t you" instead of "wasn't you".
  // `decodeQuotedPrintable` collapses soft line breaks (=<LF>/=<CRLF>) and
  // reassembles multi-byte UTF-8 from runs of =XX sequences, so a QP
  // apostrophe "=E2=80=99t" becomes the single character "\u2019t".
  const qpDecoded = decodeQuotedPrintable(scan);

  // Step 0b: strip any inner MIME headers that may have leaked in
  // (multipart parts, malformed boundaries, etc.). This is a cheap
  // per-line regex and runs on the QP-decoded text so the headers it
  // looks for are not themselves QP-encoded.
  const bodyOnly = stripInnerHeaderLines(qpDecoded);

  // Step 0c: strip <style>/<script>/<head> blocks in one pass so they
  // don't bleed into the link scan, and drop any multipart boundary
  // markers that survived.
  const stripped = bodyOnly
    .replace(STYLE_SCRIPT_REGEX, " ")
    .replace(/^\s*--[A-Za-z0-9_.+\-=]{8,80}\s*$/gm, " ");

  // 1) OTP scan. Stage 2: the OTP no longer suppresses the link scan —
  //    code and link are extracted independently below.
  let otpCode = "";

  // 1a) Labelled OTP scan — runs on the QP-decoded, tag-stripped text so
  //     QP-encoded digits resolve correctly. We only accept 4-8 digits
  //     to keep phone numbers, timestamps, and IDs out of the result.
  const labelled = stripped.match(LABELLED_OTP_REGEX);
  if (labelled && labelled[1]) {
    otpCode = labelled[1];
  } else {
    // 1b) Line-aware bare-digit scan.
    //
    //     The previous implementation ran a flat `\b\d{4,8}\b` over text
    //     with only `https?://...` URLs stripped. That was too permissive:
    //     - digits inside HTML attributes (data-id="12345", style="123px")
    //       survived and matched
    //     - digits inside href query params on *relative* URLs survived
    //       (we only stripped absolute URLs)
    //     - mailto:?subject=12345 survived
    //     - dates like 12/15/2024 matched `\b\d{4}\b`
    //     - phone numbers like +1 555 1234 matched `\b\d{4}\b`
    //     - in Aparat emails with a long hash like `hash=9f8e7d6c5b4a3210`,
    //       the first 4-8 digit run of the hash sometimes won over a real
    //       labelled code in a different part of the body
    //
    //     The new scan:
    //       (a) builds a clean scan text with URLs, mailto/tel/data URIs,
    //           and ALL HTML attribute values stripped, AND all tags
    //           stripped (so even <span data-id="12345"> can't leak)
    //       (b) splits the scan text into "lines" (each newline-bounded
    //           segment) and only scans a line if it contains a code label
    //           (code/otp/pin/token/کد/رمز/etc.). This makes it
    //           impossible for a random number in body prose to be picked.
    //       (c) on a qualifying line, scans for 4-8 digit runs with the
    //           existing preference order (6, 5, 4, 7, 8). First match wins.
    const scanText = buildOtpScanText(stripped);
    if (scanText) {
      const lines = scanText.split(/\r?\n/);
      const order = [6, 5, 4, 7, 8];
      for (const line of lines) {
        if (!line || !CODE_LINE_LABEL_RE.test(line)) continue;
        const lineMatches = line.match(OTP_REGEX) || [];
        for (const len of order) {
          const found = lineMatches.find(x => x.length === len);
          if (found) { otpCode = found; break; }
        }
        if (otpCode) break;
        // Last-resort: any 4-8 digit run on a code-labelled line.
        if (lineMatches.length > 0) { otpCode = lineMatches[0]; break; }
      }
    }
  }

  // 2) Link scan — runs ALWAYS (Stage 2): the OTP no longer suppresses
  //    the link. Both are extracted independently; when an email contains
  //    both a code and a qualified verification URL, the alert shows both.
  //    Among multiple qualified URLs, the best-scoring candidate wins
  //    (deterministic tie-break: earliest position in the body).
  let activationLink = "";
  let activationLinks = [];
  {
    let m;
    // Collect all candidate URLs once (dedup, keep first-occurrence order).
    URL_REGEX_GLOBAL.lastIndex = 0;
    const seen = new Set();
    const candidates = [];
    while ((m = URL_REGEX_GLOBAL.exec(stripped)) !== null) {
      const cleaned = m[0].replace(/[),.;\]>]+$/g, "");
      if (!cleaned || seen.has(cleaned)) continue;
      seen.add(cleaned);
      candidates.push({ url: cleaned, start: m.index });
      if (candidates.length >= 50) break; // bounded scan
    }
    // Score each candidate against its LOCAL context window. The anchor
    // text inside <a>…</a> is checked VERBATIM as a prefix+suffix boundary
    // match (generic words like "off" from "50% off" can no longer leak a
    // false match via substring semantics), plus the bounded window.
    const qualified = [];
    for (const c of candidates) {
      const ctx = localContextAround(stripped, c.start, c.url.length);
      const anchor = anchorTextFor(stripped, c.start);
      let verdict = scoreVerificationUrl(c.url, ctx);
      if (!verdict.qualified && anchor) {
        const anchorCtx = (anchor + " " + ctx).toLowerCase();
        verdict = scoreVerificationUrl(c.url, anchorCtx);
      }
      if (verdict.qualified && verdict.score >= QUALIFY_SCORE) {
        qualified.push({ url: c.url, score: verdict.score, start: c.start });
      }
    }
    // Best-first: highest score; ties broken by earliest position.
    qualified.sort((a, b) => (b.score - a.score) || (a.start - b.start));
    if (qualified.length > 0) {
      activationLink = qualified[0].url;
      activationLinks = qualified.slice(0, 3).map(q => q.url);
    }
  }

  // 3) Preview: strip remaining tags, decode HTML entities (so the short
  //    alert doesn't show "سلام" as a literal string), collapse
  //    whitespace, truncate.
  let previewText = decodeHtmlEntitiesForPreview(stripped.replace(TAG_REGEX, " "));
  previewText = previewText.replace(/\s+/g, " ").trim();
  previewText = safeTruncateForPreview(previewText, 200);

  return { activationLink, activationLinks, otpCode, previewText };
}

/**
 * Decode the most common HTML entities so the preview text (and therefore
 * the short alert and the full-view body) shows plain Persian/Arabic
 * characters instead of "&#1587;&#1604;&#1575;&#1605;" or "&amp;".
 *
 * Telegram's HTML parser interprets these as HTML, so a double-escaped
 * "&amp;#1587;" is rendered as the literal text "&#1587;" — exactly
 * the user-reported bug. Decoding up front lets escapeHtml() re-encode
 * the result to plain Persian text that Telegram renders correctly.
 *
 * We decode the entities that show up most often in transactional email
 * bodies:
 *   - decimal numeric   &#NNNN;
 *   - hex numeric       &#xNNNN;
 *   - named             &amp; &lt; &gt; &quot; &apos; &nbsp; &ndash;
 *                        &mdash; &hellip; &lsquo; &rsquo; &ldquo; &rdquo;
 *                        &bull; &copy; &reg; &trade;
 *   - RTL/formatting    &zwnj; &zwj;
 */
function decodeHtmlEntitiesForPreview(s) {
  if (!s) return s;
  let out = s;
  out = decodeNumericHtmlEntities(out);
  out = out
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&hellip;/gi, "…")
    .replace(/&lsquo;/gi, "\u2018")
    .replace(/&rsquo;/gi, "\u2019")
    .replace(/&ldquo;/gi, "\u201c")
    .replace(/&rdquo;/gi, "\u201d")
    .replace(/&zwnj;/gi, "\u200c")
    .replace(/&zwj;/gi, "\u200d")
    .replace(/&bull;/gi, "•")
    .replace(/&copy;/gi, "©")
    .replace(/&reg;/gi, "®")
    .replace(/&trade;/gi, "™");
  return out;
}

/**
 * Truncate a preview string to at most `max` visible characters without
 * cutting mid-word, mid-QP-escape, or mid-UTF8-codepoint.
 *
 * The previous implementation used `previewText.substring(0, 200) + "…"`
 * which produced three classes of broken output:
 *   1. cutting mid-word: "...verification code 987" with the rest gone
 *   2. cutting mid-QP-escape: "...wasn=E2=80=99" when the QP decode
 *      step was bypassed (no longer possible in extractFast now that
 *      decodeQuotedPrintable runs first, but defensive)
 *   3. cutting mid-UTF8-codepoint: a 200-byte cutoff inside a 3-byte
 *      emoji or smart-quote sequence would orphan a continuation byte
 *      and produce a mojibake replacement character in the preview.
 *
 * The new implementation:
 *   - If the string already fits, returns it unchanged (no "…").
 *   - Otherwise walks back from the cut to the last whitespace, so the
 *     preview always ends on a word boundary.
 *   - Strips any trailing partial-QP sequence ("=E2" or "=E2=80") so
 *     a residue can never reach the user.
 *   - Drops trailing partial UTF-8 continuation bytes (0x80-0xBF) by
 *     tracking UTF-8 lead-byte boundaries.
 *   - Appends "…" only if something was actually cut.
 *
 * The cap is character-count, not byte-count, but a worst-case UTF-8
 * 4-byte codepoint is still well under 4 max-cut characters so the
 * resulting string is always <= max + 1 (for the "…") chars.
 */
function safeTruncateForPreview(text, max) {
  if (typeof text !== "string" || text.length === 0) return text || "";
  if (text.length <= max) return text;

  // Step 1: substring to the cap. We do all the cleaning AFTER the cut
  // because the QP/UTF-8 scrubbing is concerned with what survives at
  // the tail, not with what's in the middle.
  let cut = text.substring(0, max);

  // Step 2: word-boundary cut. Walk back to the last whitespace so the
  // visible cut is on a word boundary, not mid-word. We do this BEFORE
  // the QP/UTF-8 scrub because a partial QP escape that survives the
  // word-boundary cut (e.g. "wasn=E2=80 you all" at cap=11 — the cut
  // would land at position 9 "wasn=E2=80" because the trailing space
  // is the last whitespace) is more reliably detected once we've
  // committed to the substring we're going to display.
  cut = cut.replace(/\s+$/, "");
  if (cut.length === 0) return "";
  const lastSpace = cut.search(/\s\S*$/);
  if (lastSpace > 0) cut = cut.substring(0, lastSpace);
  if (cut.length === 0) return "";

  // Step 3: scrub any partial QP escape at the tail. After QP decode
  // this is a no-op for well-formed input, but if a stray "=" sequence
  // survives (e.g. the QP decode was bypassed by an older caller) we
  // don't want it visible. We loop because removing the *last* partial
  // may expose another one (e.g. "wasn=E2=80" — remove "=80" and you're
  // left with "=E2", which is also a partial).
  while (true) {
    const lastEq = cut.lastIndexOf("=");
    if (lastEq < 0) break;
    // Only act if the tail starting at the last "=" looks like a partial
    // =XX (0-2 hex digits) within a small tail window (5 chars).
    if (lastEq < cut.length - 5) break;
    const tail = cut.substring(lastEq);
    if (!/=(?:[A-F0-9]{0,2})$/i.test(tail)) break;
    cut = cut.substring(0, lastEq);
    if (cut.length === 0) return "";
  }

  // Step 4: drop a trailing unpaired UTF-16 surrogate. JS strings are
  // UTF-16, so the right check is whether the last code unit is an
  // unpaired high (0xD800-0xDBFF) or low (0xDC00-0xDFFF) surrogate. A
  // high surrogate at the end of a string with no matching low
  // surrogate would render as a mojibake replacement character in
  // Telegram, so we drop it.
  //
  // Detection:
  //   - If the last code unit is a high surrogate and the previous code
  //     unit is NOT a high surrogate, this is the second half of a
  //     well-formed pair → leave it alone.
  //   - If the last code unit is a low surrogate → it could be the
  //     second half of a well-formed pair (preceded by a high surrogate)
  //     → leave it alone. It could also be a malformed lone low
  //     surrogate (very rare) → drop it.
  //   - If the last code unit is a high surrogate and the previous code
  //     unit is also a high surrogate, or there's no previous code
  //     unit, → the pair is unpaired → drop the high surrogate.
  //
  // E.g. cap=3 on "a\u{1F600}b":
  //   - substring(0, 3) = "a\uD83D\uDE42"  (a, high, low — well-formed)
  //   - last code unit is 0xDE42 (low surrogate, 2nd half of pair)
  //   - the previous code unit is 0xD83D (high surrogate)
  //   - the pair is well-formed, nothing is dropped.
  //   - result: "a\u{1F600}" + "…"
  const lastCu = cut.charCodeAt(cut.length - 1);
  if (lastCu >= 0xD800 && lastCu <= 0xDBFF) {
    // Trailing high surrogate. If the previous code unit is a low
    // surrogate this is a complete pair, keep it. Otherwise (no prev,
    // or prev is also high, or prev is BMP) the pair is malformed —
    // drop the high surrogate.
    if (cut.length < 2 || cut.charCodeAt(cut.length - 2) < 0xDC00 || cut.charCodeAt(cut.length - 2) > 0xDFFF) {
      cut = cut.substring(0, cut.length - 1);
    }
  } else if (lastCu >= 0xDC00 && lastCu <= 0xDFFF) {
    // Trailing low surrogate. If the previous code unit is a high
    // surrogate this is a complete pair, keep it. Otherwise the low
    // surrogate is malformed (no preceding high) — drop it.
    if (cut.length < 2 || cut.charCodeAt(cut.length - 2) < 0xD800 || cut.charCodeAt(cut.length - 2) > 0xDBFF) {
      cut = cut.substring(0, cut.length - 1);
    }
  }

  if (cut.length === 0) return "";
  return cut + "…";
}

function parseEmailBody(rawEmail) {
  if (!rawEmail) return { text: "(empty)", links: [] };

  // CPU safety net: refuse to run the heavy pipeline on very large inputs.
  // The email() handler also short-circuits before calling us, so this is
  // a belt-and-braces guard for any future caller.
  if (typeof rawEmail === "string" && rawEmail.length > MAX_PARSE_BYTES) {
    const fast = extractFast(rawEmail);
    return {
      text: fast.previewText || "(body too large)",
      links: fast.activationLink ? [fast.activationLink] : []
    };
  }

  try {
    // For a Cloudflare Email Routing message, the input is the full
    // MIME message (starting with `From:`, `To:`, `Subject:`,
    // `Content-Type:`, etc.) — there is no separate "outer envelope"
    // (Received:/Return-Path:) to strip. We split exactly once on
    // the first blank line to separate the MIME part headers from
    // the part body. (Previously we called stripMimeEnvelope() first,
    // which consumed ALL the headers — including the Content-Type that
    // we need to detect text/html vs text/plain. That bug caused the
    // Aparat verification link to be missing from the full view
    // because the HTML body was treated as plain text, the QP-encoded
    // href=3D was never decoded, and extractAndCleanUrls had nothing
    // to extract from.)
    const raw = rawEmail;

    let topHeaders = "";
    let bodyContent = raw;
    const headerSplit = raw.indexOf("\r\n\r\n");
    const headerSplitLf = raw.indexOf("\n\n");
    const splitIdx = (headerSplit !== -1 && (headerSplitLf === -1 || headerSplit < headerSplitLf)) ? headerSplit : headerSplitLf;

    if (splitIdx !== -1) {
      topHeaders = raw.substring(0, splitIdx);
      bodyContent = raw.substring(splitIdx + (raw.startsWith("\r\n", splitIdx) ? 4 : 2));
    }

    let textParts = [];
    let htmlParts = [];

    const boundary = extractBoundary(topHeaders) || extractBoundary(bodyContent);

    if (boundary) {
      const parts = splitMimeParts(bodyContent, boundary);

      for (const part of parts) {
        if (isAttachmentPart(part)) continue;
        const partResult = parseSinglePart(part, topHeaders, boundary);
        if (partResult && partResult.body) {
          if (partResult.isHtml) {
            htmlParts.push(partResult.body);
          } else {
            textParts.push(partResult.body);
          }
        }
      }
    } else {
      const partResult = parseSinglePart(bodyContent, topHeaders);
      if (partResult && partResult.body) {
        if (partResult.isHtml) {
          htmlParts.push(partResult.body);
        } else {
          textParts.push(partResult.body);
        }
      }
    }

    let textBody = textParts.join("\n\n").trim();
    let htmlContent = htmlParts.join("\n\n").trim();

    // Belt-and-braces: any leaked per-part MIME headers (e.g. when a
    // malformed boundary leaves a header line inside a part body) get
    // dropped here before they can reach the link/OTP/preview extractors.
    textBody = stripInnerHeaderLines(textBody);
    htmlContent = stripInnerHeaderLines(htmlContent);

    const rawTextBodyForLinks = textBody;
    const rawHtmlContentForLinks = htmlContent;

    textBody = textBody.replace(/----=_Part_[^\s]+/g, "").replace(/Content-Type:[^\n]+/gi, "").replace(/Content-Transfer-Encoding:[^\n]+/gi, "");
    htmlContent = htmlContent.replace(/----=_Part_[^\s]+/g, "");

    if (!textBody && htmlContent) {
      textBody = stripHtmlTags(htmlContent);
    } else if (textBody) {
      textBody = stripHtmlTags(textBody);
    }
    if (!textBody && !htmlContent) {
      textBody = stripHtmlTags(bodyContent);
      htmlContent = bodyContent;
    }

    const links = extractAndCleanUrls(rawHtmlContentForLinks || rawTextBodyForLinks, textBody);
    let finalBody = cleanText(textBody);
    if (!finalBody && htmlContent) {
      finalBody = cleanText(stripHtmlTags(htmlContent));
    }

    if (!finalBody && htmlContent) {
      const rescued = lastResortExtract(htmlContent);
      if (rescued && rescued.trim().length > 0) {
        finalBody = cleanText(rescued);
      }
    }

    if (!finalBody && rawEmail) {
      const rescuedRaw = lastResortExtract(rawEmail);
      if (rescuedRaw && rescuedRaw.trim().length > 0) {
        finalBody = cleanText(rescuedRaw);
      }
    }

    return {
      text: finalBody || "(no content)",
      links: links
    };
  } catch (e) {
    console.error("Error in parseEmailBody:", e);
    return { text: stripHtmlTags(rawEmail) || "(error parsing email)", links: [] };
  }
}

function extractBoundary(headerText) {
  if (!headerText) return null;
  const m = headerText.match(/boundary\s*=\s*"?([^";\s\r\n]+)"?/i);
  return m ? m[1].trim() : null;
}

function sortInboxNewestFirst(inboxList) {
  if (!Array.isArray(inboxList) || inboxList.length < 2) return;
  for (let i = 1; i < inboxList.length; i++) {
    const cur = inboxList[i];
    if (!cur) continue;
    let j = i - 1;
    while (j >= 0) {
      const prev = inboxList[j];
      const a = (cur && typeof cur.ts === "number") ? cur.ts : -1;
      const b = (prev && typeof prev.ts === "number") ? prev.ts : -1;
      if (b >= a) break;
      inboxList[j + 1] = prev;
      j--;
    }
    inboxList[j + 1] = cur;
  }
}

function isAttachmentPart(partStr) {
  if (!partStr) return false;
  const lfSplit = partStr.indexOf("\n\n");
  const crlfSplit = partStr.indexOf("\r\n\r\n");
  let headers = "";
  if (crlfSplit !== -1 && (lfSplit === -1 || crlfSplit < lfSplit)) {
    headers = partStr.substring(0, crlfSplit);
  } else if (lfSplit !== -1) {
    headers = partStr.substring(0, lfSplit);
  }
  if (/content-disposition\s*:\s*attachment/i.test(headers)) return true;
  const ctMatch = headers.match(/content-type\s*:\s*([^\r\n;]+)/i);
  if (ctMatch) {
    const ct = ctMatch[1].trim().toLowerCase();
    if (ct.startsWith("text/") || ct.startsWith("multipart/")) return false;
    return true;
  }
  return false;
}

function splitMimeParts(body, boundary) {
  if (!body || !boundary) return [];
  const delimiter = "--" + boundary;
  const closeDelimiter = "--" + boundary + "--";
  const parts = [];
  let start = body.indexOf(delimiter);
  if (start === -1) {
    return [body];
  }
  while (start !== -1) {
    const after = start + delimiter.length;
    const isClose = body.substring(after, after + 2) === "--";
    if (isClose) break;
    const nextIdx = body.indexOf(delimiter, after);
    if (nextIdx === -1) {
      parts.push(body.substring(start));
      break;
    }
    let partEnd = nextIdx;
    while (partEnd > after && (body[partEnd - 1] === "\n" || body[partEnd - 1] === "\r" || body[partEnd - 1] === " " || body[partEnd - 1] === "\t")) {
      partEnd--;
    }
    parts.push(body.substring(start, partEnd));
    start = nextIdx;
  }
  return parts;
}

function parseSinglePart(partStr, parentHeaders = "", boundary = null) {
  if (!partStr) return { isHtml: false, body: "" };

  let partHeaders = "";
  let content = partStr;

  const crlfSplit = partStr.indexOf("\r\n\r\n");
  const lfSplit = partStr.indexOf("\n\n");
  let chosenEnd = -1;
  let chosenLen = 0;
  if (crlfSplit !== -1 && (lfSplit === -1 || crlfSplit < lfSplit)) {
    chosenEnd = crlfSplit;
    chosenLen = 4;
  } else if (lfSplit !== -1) {
    chosenEnd = lfSplit;
    chosenLen = 2;
  }

  if (chosenEnd !== -1) {
    partHeaders = partStr.substring(0, chosenEnd);
    content = partStr.substring(chosenEnd + chosenLen);
  }

  if (boundary) {
    const delim = "--" + boundary;
    const closeDelim = "--" + boundary + "--";
    let cut = content.length;
    const closeIdx = content.indexOf(closeDelim);
    if (closeIdx !== -1) cut = Math.min(cut, closeIdx);
    const nextIdx = content.indexOf("\n" + delim);
    if (nextIdx !== -1) cut = Math.min(cut, nextIdx);
    const nextIdxCrlf = content.indexOf("\r\n" + delim);
    if (nextIdxCrlf !== -1) cut = Math.min(cut, nextIdxCrlf);
    if (cut < content.length) {
      content = content.substring(0, cut);
    }
  }

  const partHeadersBlob = partHeaders;
  const contentTypeMatch = partHeadersBlob.match(/content-type\s*:\s*([^\r\n;]+)/i)
    || (parentHeaders ? parentHeaders.match(/content-type\s*:\s*([^\r\n;]+)/i) : null);
  const contentType = contentTypeMatch ? contentTypeMatch[1].trim().toLowerCase() : "text/plain";
  const isHtml = contentType.includes("text/html");

  if (contentType.startsWith("multipart/")) {
    const innerBoundary = extractBoundary(partHeadersBlob) || extractBoundary(parentHeaders);
    if (innerBoundary) {
      const innerParts = splitMimeParts(content, innerBoundary);
      let textAccum = [];
      let htmlAccum = [];
      for (const ip of innerParts) {
        const pr = parseSinglePart(ip, partHeadersBlob, innerBoundary);
        if (pr && pr.body) {
          if (pr.isHtml) htmlAccum.push(pr.body);
          else textAccum.push(pr.body);
        }
      }
      const joinedText = textAccum.join("\n\n").trim();
      const joinedHtml = htmlAccum.join("\n\n").trim();
      if (joinedText) return { isHtml: false, body: joinedText };
      if (joinedHtml) return { isHtml: true, body: joinedHtml };
      return { isHtml: false, body: "" };
    }
  }

  content = stripLeadingBoundaryLine(content);

  const charsetMatch = partHeadersBlob.match(/charset\s*=\s*"?([^";\s\r\n]+)/i)
    || (parentHeaders ? parentHeaders.match(/charset\s*=\s*"?([^";\s\r\n]+)/i) : null);
  const charset = charsetMatch ? charsetMatch[1].trim().toLowerCase() : "utf-8";

  const transferEncMatch = partHeadersBlob.match(/content-transfer-encoding\s*:\s*([^\r\n]+)/i)
    || (parentHeaders ? parentHeaders.match(/content-transfer-encoding\s*:\s*([^\r\n]+)/i) : null);
  const transferEnc = transferEncMatch ? transferEncMatch[1].trim().toLowerCase() : "";

  let decodedContent = content;

  if (transferEnc === "base64" || (!transferEnc && looksLikeBase64(content))) {
    decodedContent = decodeBase64Content(content, charset);
  } else if (transferEnc === "quoted-printable" || /=\r?\n/.test(content) || /=[0-9A-F]{2}/i.test(content)) {
    decodedContent = decodeQuotedPrintable(content);
  }

  if (!decodedContent) {
    decodedContent = stripMimeNoise(content);
  }

  return {
    isHtml,
    body: decodedContent
  };
}

function stripLeadingBoundaryLine(content) {
  if (!content) return content;
  // Strip a leading multipart boundary like "--foo" or "----=_NextPart_xyz".
  // The boundary may begin with "--" (standard) or "----" (some senders
  // prepend an extra "--" so the line still parses). The line ends at the
  // next \r\n or \n.
  return content.replace(/^\s*--[A-Za-z0-9_.+\-=]{0,80}[\r\n]+/, "");
}

function stripTrailingBoundary(content) {
  if (!content) return content;
  return content.replace(/(?:\r?\n)*--[A-Za-z0-9_.+\-=]+--\s*$/, "");
}

function stripMimeNoise(content) {
  if (!content) return "";
  return content
    .replace(/^--[^\r\n]+(?:--)?[\r\n]+/gm, "")
    .replace(/Content-Type:[^\n]+/gi, "")
    .replace(/Content-Transfer-Encoding:[^\n]+/gi, "")
    .trim();
}

function looksLikeBase64(str) {
  if (!str) return false;
  const trimmed = str.replace(/\s/g, "");
  if (trimmed.length < 4) return false;
  return /^[A-Za-z0-9+/\r\n\t ]+={0,2}$/.test(trimmed);
}

function decodeBase64Content(content, charset) {
  if (!content) return "";

  let b64 = content.replace(/\s/g, "");
  const firstInvalid = b64.search(/[^A-Za-z0-9+/=]/);
  if (firstInvalid !== -1) {
    b64 = b64.substring(0, firstInvalid);
  }
  b64 = b64.replace(/=+$/, "");
  while (b64.length % 4 !== 0) b64 += "=";

  if (b64.length < 4) return "";

  try {
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    try {
      return new TextDecoder(charset || "utf-8", { fatal: false }).decode(bytes);
    } catch (e) {
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    }
  } catch (e) {
    console.error("Base64 decode failed:", e && e.message ? e.message : e);
    return "";
  }
}

/**
 * Extract and clean URLs from a parsed email body.
 *
 * Looks for the activation/verification link in FOUR forms (in priority
 * order), so an Aparat-style email with a button-styled <a> or a
 * JavaScript-redirect <button onclick> still surfaces its verify URL:
 *
 *   1. <a href="…">                 — the standard anchor
 *   2. <a data-href="…">             — single-page-app click handlers
 *   3. <form action="…">             — POST-based verify endpoints
 *   4. <button onclick="…url…">      — JS redirects (extract the URL
 *                                      from the literal string)
 *
 * Then falls back to a plain-text scan of the body for any
 * https?://… URL. Each candidate is passed through cleanExtractedUrl()
 * and isValidActionUrl() (which drops trackers, social, and static
 * assets) before being added to the result set.
 */
function extractAndCleanUrls(html, text) {
  const urlSet = new Set();
  const HREF_RE = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  const DATA_HREF_RE = /\bdata-href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  const FORM_ACTION_RE = /<form\b[^>]*?\baction\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  // <button … onclick="…url…"> — capture the URL inside the JS literal.
  // Common shapes: onclick="window.location='…'", onclick="location.href='…'",
  // onclick="window.open('…')", onclick="top.location='…'", and a few others.
  const BUTTON_ONCLICK_RE = /<button\b[^>]*?\bonclick\s*=\s*(?:"([^"]*)"|'([^']*)")/gi;

  function addIfValid(rawUrl) {
    if (!rawUrl) return;
    const cleaned = cleanExtractedUrl(rawUrl);
    if (cleaned && isValidActionUrl(cleaned)) {
      urlSet.add(cleaned);
    }
  }

  if (html) {
    // 1) <a href>
    const aTagRe = /<a\b[^>]*?(?=\bhref\b)/gi;
    let aOpen;
    while ((aOpen = aTagRe.exec(html)) !== null) {
      // Find the matching > so we can scan for href inside the
      // anchor's opening tag only (not the body text after).
      const closeIdx = html.indexOf(">", aOpen.index);
      if (closeIdx === -1) break;
      const openTag = html.substring(aOpen.index, closeIdx + 1);
      // NOTE: do NOT use String.prototype.match with the /g flag here —
      // it returns the full matches WITHOUT capture groups. Use
      // matchAll() (or exec) to preserve the URL capture.
      const hrefIter = openTag.matchAll(HREF_RE);
      for (const hrefMatch of hrefIter) {
        addIfValid(hrefMatch[1] || hrefMatch[2] || hrefMatch[3]);
        break; // first href on this anchor wins
      }
    }
    // 2) <a data-href>
    let m;
    while ((m = DATA_HREF_RE.exec(html)) !== null) {
      addIfValid(m[1] || m[2] || m[3]);
    }
    // 3) <form action>
    while ((m = FORM_ACTION_RE.exec(html)) !== null) {
      addIfValid(m[1] || m[2] || m[3]);
    }
    // 4) <button onclick="…url…">
    while ((m = BUTTON_ONCLICK_RE.exec(html)) !== null) {
      const jsBody = m[1] || m[2] || "";
      const urlMatches = jsBody.match(/https?:\/\/[^\s'"]+/gi);
      if (urlMatches) {
        for (const u of urlMatches) addIfValid(u);
      }
    }
  }

  const combinedText = (html ? stripHtmlTags(html) : "") + "\n" + (text || "");
  const urlRegex = /https?:\/\/[^\s<>"']+/gi;
  let plainMatch;
  while ((plainMatch = urlRegex.exec(combinedText)) !== null) {
    addIfValid(plainMatch[0]);
  }

  return Array.from(urlSet);
}

function decodeHtmlEntities(str) {
  if (!str) return "";
  return str
    .replace(/&amp;/gi, '&')
    .replace(/&#38;/gi, '&')
    .replace(/&#x26;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/=3D/gi, '=');
}

function cleanExtractedUrl(url) {
  if (!url) return "";
  let cleaned = decodeHtmlEntities(url);
  cleaned = cleaned.replace(/[.,;:?!)'"\]>]+$/, '');
  return cleaned;
}

function isValidActionUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

    const lower = url.toLowerCase();

    const blacklist = [
      'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'linkedin.com',
      'youtube.com', 'youtu.be', 'tiktok.com', 't.me', 'telegram.me', 'discord.gg',
      'whatsapp.com', 'pinterest.com', 'gravatar.com', 'google.com/maps',
      'help.', 'support.', 'privacy', 'terms', 'unsubscribe', 'optout',
      'appstore', 'play.google', 'apple.com', 'google.com/app',
      'schema.org', 'w3.org', 'googletagmanager', 'google-analytics',
      'facebook.rehab', 'fb.com'
    ];

    for (const item of blacklist) {
      if (lower.includes(item)) return false;
    }

    // Filter out static-asset URLs (CSS/JS/images/fonts) which are never
    // activation links. They are referenced from <link rel="stylesheet">,
    // <img>, or <script src=...> tags and would otherwise pollute the link
    // list with meaningless noise like https://www.aparat.com/assets/web/ui.
    const pathLower = (parsed.pathname || "").toLowerCase();
    const assetMarkers = [
      '/assets/', '/static/', '/cdn/', '/public/', '/dist/',
      '/img/', '/images/', '/image/', '/media/',
      '/css/', '/js/', '/javascript/', '/styles/', '/style/',
      '/fonts/', '/font/', '/svg/'
    ];
    for (const m of assetMarkers) {
      if (pathLower.includes(m)) return false;
    }
    if (/\.(css|js|mjs|map|png|jpe?g|gif|svg|ico|webp|avif|bmp|tiff?|woff2?|ttf|otf|eot)(\?|$|#)/i.test(pathLower)) {
      return false;
    }

    return true;
  } catch (e) {
    return false;
  }
}



function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* ==========================================================================
   WEB APP + TELEGRAM MINI APP API (/api/v1/*) and /app entry point
   --------------------------------------------------------------------------
   ADDITIVE SECTION — nothing above this block was modified for the Web App.
   All bot behavior (Telegram Bot, email(), handleMessage(),
   handleCallbackQuery(), token logic, D1 schema, extractFast(),
   parseEmailBody(), OTP/link extraction, inbox storage, restore/archive/
   purge, bot i18n, deploy/webhook) is byte-identical to before.

   Design constraints honored here:
   - No new D1 table, no migration. Auth state is STATELESS: session
     tokens are HMAC-SHA256 signed with BOT_TOKEN (server secret, never
     sent to the client) and verified on every request. No server-side
     session storage is needed, so the LOCKED schema is untouched.
   - Ownership is always resolved server-side: the chat_id comes from the
     verified session token (web) or the verified Telegram initData
     (Mini App) — never from a client-supplied chat_id. Every inbox
     query is scoped to the session's own email via the existing
     db.* helpers.
   - recovery_token is returned ONLY at issuance moments (provision,
     create, restore) — exactly like the bot shows the token once after
     generating. It is NEVER echoed by /me or inbox endpoints.
   - Aparat semantics are preserved by delegating to the UNCHANGED
     isAparatEmail() + linkLabelFor(): a verification link is always a
     real URL action; for Aparat the label is "✅ تایید حساب".
   ========================================================================== */

const WEB_SESSION_TTL_SEC = 30 * 24 * 3600;   // stateless session token lifetime
const WEBAPP_AUTH_MAX_AGE_SEC = 24 * 3600;    // Telegram initData freshness
const WEB_API_MAX_BODY = 16 * 1024;           // auth/settings JSON bodies are tiny
const WEB_DETAIL_BODY_LIMIT = 8000;           // full-view text cap for the API

// ---- routing predicates (pure; also used by tests) ------------------------

function isWebApiPath(pathname) {
  return pathname === "/api/v1/health" || pathname.startsWith("/api/v1/");
}

function isWebAppPath(pathname) {
  // Bare "/app" entry only. "/app/*" files are served directly by the
  // Static Assets binding; the worker never needs to rewrite them, so
  // no SPA fallback exists that could swallow /api/* or /webhook.
  return pathname === "/app" || pathname === "/app/";
}

// ---- tiny crypto helpers (Web Crypto; no Buffer — Workers compatible) -----

function webB64UrlEncode(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function webB64UrlDecode(str) {
  let s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function webHmacSha256(keyBytes, msgString) {
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(msgString)
  );
  return new Uint8Array(sig);
}

function webHex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function webSafeEqual(a, b) {
  const sa = String(a || "");
  const sb = String(b || "");
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  return diff === 0;
}

// ---- Telegram Mini App initData validation --------------------------------
// Per https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app:
//   secret_key = HMAC_SHA256(key="WebAppData", msg=BOT_TOKEN)
//   check      = HMAC_SHA256(key=secret_key, msg=data_check_string)
// data_check_string = "\n"-joined "key=<value>" pairs (excluding "hash"),
// sorted alphabetically by key. The hex digest must equal "hash".
// Returns { ok:true, chatId, userId } or { ok:false, reason }.
// Never logs the raw initData.

async function validateTelegramInitData(initData, botToken) {
  try {
    if (typeof initData !== "string" || !initData || initData.length > 8192) {
      return { ok: false, reason: "bad_init_data" };
    }
    if (!botToken || botToken === "YOUR_TELEGRAM_BOT_TOKEN") {
      return { ok: false, reason: "not_configured" };
    }
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return { ok: false, reason: "missing_hash" };
    const pairs = [];
    for (const [k, v] of params) {
      if (k === "hash" || k === "signature") continue;
      pairs.push([k, v]);
    }
    if (pairs.length === 0) return { ok: false, reason: "empty_data" };
    pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const dataCheckString = pairs.map(([k, v]) => k + "=" + v).join("\n");
    const secretKey = await webHmacSha256(
      new TextEncoder().encode("WebAppData"), String(botToken)
    );
    const checkBytes = await webHmacSha256(secretKey, dataCheckString);
    if (!webSafeEqual(webHex(checkBytes), String(hash).toLowerCase())) {
      return { ok: false, reason: "bad_hash" };
    }
    const authDate = Number(params.get("auth_date"));
    if (!Number.isFinite(authDate)) return { ok: false, reason: "bad_auth_date" };
    if (Math.abs(Date.now() / 1000 - authDate) > WEBAPP_AUTH_MAX_AGE_SEC) {
      return { ok: false, reason: "expired" };
    }
    let user = null;
    try { user = JSON.parse(params.get("user") || "null"); } catch (e) { user = null; }
    if (!user || typeof user.id === "undefined" || user.id === null) {
      return { ok: false, reason: "bad_user" };
    }
    const userId = String(user.id);
    if (!/^\d+$/.test(userId)) return { ok: false, reason: "bad_user" };
    // For a private Mini App the chat identity IS the Telegram user id —
    // the same id the bot sees as message.chat.id in DMs.
    // Language hint for first-time provisioning (never trusted for identity).
    let lang = "fa";
    try {
      const lc = String((user && user.language_code) || "").toLowerCase();
      if (lc.startsWith("en")) lang = "en";
    } catch (_) { lang = "fa"; }
    return { ok: true, chatId: userId, userId, lang };
  } catch (e) {
    return { ok: false, reason: "exception" };
  }
}

// ---- standalone web identities (normal website, no Telegram) --------------
// A web user is identified by "web_" + base64url(128 crypto-random bits).
// The id lives in the SAME sessions.chat_id TEXT PRIMARY KEY as Telegram
// users (no migration, no new table): every accessor binds String(chatId),
// and the numeric-only check exists solely inside the Telegram validators,
// so the "web_" prefix can never collide with a Telegram user id.
// Ownership, inbox scoping, recovery-token and archive logic are all keyed
// by chat_id/email and therefore work unchanged for web identities.
function isWebChatId(chatId) {
  return typeof chatId === "string" && chatId.startsWith("web_");
}

function generateWebChatId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return "web_" + webB64UrlEncode(bytes);
}

// ---- stateless session tokens (HMAC-signed, no D1 storage) ----------------
// Format: "v1.<base64url(JSON {v,cid,exp})>.<hex HMAC_SHA256(BOT_TOKEN, payload)>"

async function issueSessionToken(env, chatId, ttlSec) {
  const ttl = (typeof ttlSec === "number" && ttlSec > 0) ? ttlSec : WEB_SESSION_TTL_SEC;
  const payload = { v: 1, cid: String(chatId), exp: Math.floor(Date.now() / 1000) + ttl };
  const payloadB64 = webB64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const body = "v1." + payloadB64;
  const sig = webHex(await webHmacSha256(new TextEncoder().encode(String(env.BOT_TOKEN || "")), body));
  return body + "." + sig;
}

async function verifySessionToken(env, token) {
  try {
    if (typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !parts[2]) return null;
    if (!env.BOT_TOKEN || env.BOT_TOKEN === "YOUR_TELEGRAM_BOT_TOKEN") return null;
    const body = parts[0] + "." + parts[1];
    const expect = webHex(await webHmacSha256(new TextEncoder().encode(String(env.BOT_TOKEN)), body));
    if (!webSafeEqual(expect, parts[2].toLowerCase())) return null;
    const payload = JSON.parse(new TextDecoder().decode(webB64UrlDecode(parts[1])));
    if (!payload || payload.v !== 1 || !payload.cid) return null;
    if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return String(payload.cid);
  } catch (e) {
    return null;
  }
}

// ---- HTTP plumbing ---------------------------------------------------------

function apiJson(obj, status, extraHeaders) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (extraHeaders) {
    for (const k of Object.keys(extraHeaders)) headers[k] = extraHeaders[k];
  }
  return new Response(JSON.stringify(obj), { status: status || 200, headers });
}

function apiErr(error, status) {
  return apiJson({ error }, status || 400);
}

function sessionCookieHeader(token) {
  // HttpOnly + Secure + SameSite=Lax: the browser sends it automatically on
  // same-origin /api calls; the Authorization header remains the primary
  // transport (works even where Secure cookies are unavailable, e.g. http).
  return `tm_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${WEB_SESSION_TTL_SEC}`;
}

function getBearerToken(request) {
  try {
    const h = request.headers.get("authorization") || "";
    const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
    if (m) return m[1];
    const cookie = request.headers.get("cookie") || "";
    const cm = /(?:^|;\s*)tm_session=([^;]+)/.exec(cookie);
    if (cm) return decodeURIComponent(cm[1].trim());
  } catch (e) { /* fall through */ }
  return "";
}

async function readJsonBody(request) {
  try {
    const text = await request.text();
    if (!text) return {};
    if (text.length > WEB_API_MAX_BODY) return { __tooLarge: true };
    return JSON.parse(text);
  } catch (e) {
    return { __invalid: true };
  }
}

// Resolve the caller's identity server-side. Returns
// { chatId, session, pending } or null (caller gets 401).
// The chat_id NEVER comes from the client — it only comes from a
// verified HMAC session token. When the token verifies but no D1 session
// row exists yet (first-time Telegram user, empty state + Create flow),
// session is null and pending is true instead of rejecting with 401.
// Each route below decides what a pending identity may do: /me reports
// email:null, POST /emails provisions the first email, inbox reads as
// empty. Ownership scoping is unchanged once a row exists.
async function requireWebSession(request, env) {
  const token = getBearerToken(request);
  if (!token) return null;
  const chatId = await verifySessionToken(env, token);
  if (!chatId) {
    // Diagnostic signal only (Mini App /me-after-auth 401 investigation):
    // a presented token failed verification. Never log the token itself
    // or any identity material — just the event.
    try { console.warn("[web-session] presented session token failed verification"); } catch (_) {}
    return null;
  }
  let session = null;
  try { session = await db.getSession(env, chatId); } catch (e) { session = null; }
  if (!session) return { chatId: String(chatId), session: null, pending: true };
  return { chatId: String(chatId), session, pending: false };
}

function webNowStr() {
  return new Date().toLocaleTimeString("fa-IR", { timeZone: "Asia/Tehran" }) + " - " + new Date().toISOString().split("T")[0];
}

// ---- email provisioning (mirrors confirm_generate_yes, bot path untouched) -

const WEB_EMAIL_ADJECTIVES = ["shadow", "skyline", "quantum", "bluefire", "neon", "cyber", "stellar", "nova", "cosmic", "apex", "swift", "silent", "frost", "solar", "dark", "light"];
const WEB_EMAIL_NOUNS = ["pulse", "echo", "vertex", "orbit", "matrix", "core", "storm", "wave", "spark", "ghost", "rider", "hawk", "wolf", "fox", "tiger", "dragon"];

async function apiCreateNewEmail(env, chatId, lang) {
  const langVal = (lang === "en") ? "en" : "fa";
  // Same pre-steps as confirm_generate_yes: archive the old token
  // (best-effort) and clear the old inbox before overwriting.
  const userData = await db.getSession(env, chatId);
  if (userData && userData.email) {
    if (userData.recoveryToken) {
      try {
        await db.archiveToken(env, chatId, userData.email, userData.recoveryToken, langVal, userData.createdAt);
      } catch (e) { /* best-effort, must not abort creation */ }
    }
    await db.clearInbox(env, userData.email);
  }
  const prefixPool = [
    () => WEB_EMAIL_ADJECTIVES[Math.floor(Math.random() * WEB_EMAIL_ADJECTIVES.length)] + (Math.floor(Math.random() * 90) + 10),
    () => WEB_EMAIL_ADJECTIVES[Math.floor(Math.random() * WEB_EMAIL_ADJECTIVES.length)] + WEB_EMAIL_NOUNS[Math.floor(Math.random() * WEB_EMAIL_NOUNS.length)] + (Math.floor(Math.random() * 90) + 10)
  ];
  const randomPrefix = prefixPool[Math.floor(Math.random() * prefixPool.length)]();
  const domain = env.DOMAIN ? env.DOMAIN.toLowerCase().trim() : "temp.com";
  const newEmail = `${randomPrefix}@${domain}`;
  const nowStr = webNowStr();
  let recoveryToken = generateRecoveryToken();
  let attempts = 0;
  while (await db.tokenInUse(env, recoveryToken)) {
    recoveryToken = generateRecoveryToken();
    if (++attempts > 16) break;
  }
  await db.upsertSession(env, chatId, newEmail, nowStr, recoveryToken, langVal);
  return { email: newEmail, createdAt: nowStr, recoveryToken };
}

// ---- login via recovery token (mirrors handleMessage restore reactivation) -
// Possession of the unguessable token IS the credential (same model as the
// bot showing the token once). Live tokens and archived tokens both work;
// archived ones reactivate their (chatId, email) pair via upsertSession,
// exactly like the bot's restore path (including deleteBindingByEmail of a
// replaced address).

async function apiLoginWithRecoveryToken(env, token) {
  const clean = String(token || "").trim();
  if (!isValidRecoveryToken(clean)) return { error: "invalid_token", status: 400 };
  let tokenRecord = await db.getSessionByToken(env, clean);
  if (!tokenRecord) tokenRecord = await db.getArchivedToken(env, clean);
  if (!tokenRecord || !tokenRecord.email) return { error: "not_found", status: 404 };
  const chatId = String(tokenRecord.chatId);
  const existing = await db.getSession(env, chatId);
  if (existing && existing.email && existing.email !== tokenRecord.email) {
    await db.deleteBindingByEmail(env, existing.email);
  }
  const createdAt = tokenRecord.createdAt || webNowStr();
  const langVal = (tokenRecord.lang === "en") ? "en" : "fa";
  await db.upsertSession(env, chatId, tokenRecord.email, createdAt, clean, langVal);
  return { chatId, email: tokenRecord.email, createdAt, lang: langVal };
}

// ---- inbox shaping (raw MIME never leaves the server) ----------------------
// Aparat semantics delegate to the UNCHANGED isAparatEmail()/linkLabelFor():
// the activation link is always a real URL action; for Aparat the label is
// "✅ تایید حساب" — the same concept as the bot's URL button.

function apiActivationInfo(item, lang) {
  const t = i18n[lang] || i18n.fa;
  const link = (item && item.activationLink) || "";
  if (!link) return { activationLink: "", activationLabel: "", isAparat: false, hasLink: false };
  const aparat = isAparatEmail(item.from, link, item.subject);
  return {
    activationLink: link,
    activationLabel: aparat ? "✅ تایید حساب" : linkLabelFor(link, t),
    isAparat: !!aparat,
    hasLink: true,
  };
}

function apiPublicInboxItem(item, lang) {
  const info = apiActivationInfo(item, lang);
  const links = Array.isArray(item.links)
    ? item.links.filter((u) => typeof u === "string").slice(0, 3)
    : [];
  return {
    id: item.id,
    ts: item.ts,
    sender: item.from || "",
    subject: item.subject || "",
    date: item.date || "",
    preview: item.body || "",
    otpCode: item.otpCode || "",
    hasOtp: !!(item.otpCode),
    hasLink: info.hasLink,
    isAparat: info.isAparat,
    activationLink: info.activationLink,
    activationLabel: info.activationLabel,
    links,
  };
}

async function apiEmailDetail(env, email, id, lang) {
  const list = await db.listInbox(env, email);
  const item = list.find((r) => String(r.id) === String(id));
  if (!item) return null;
  // Body: stored preview when present; otherwise lazy-parse the saved raw
  // MIME exactly like renderFullEmail() does (parseEmailBody has its own
  // MAX_PARSE_BYTES guard and falls back to extractFast on huge inputs).
  let bodyText = item.body || "";
  let otpCode = item.otpCode || "";
  let activationLink = item.activationLink || "";
  let links = Array.isArray(item.links) ? item.links.slice(0, 3) : [];
  if ((!bodyText || !otpCode || !activationLink) && item.raw) {
    try {
      const parsed = parseEmailBody(item.raw);
      if (!bodyText && parsed && parsed.text) bodyText = parsed.text;
      if (parsed && Array.isArray(parsed.links) && links.length === 0) {
        links = parsed.links.filter((u) => typeof u === "string").slice(0, 3);
      }
    } catch (e) { /* keep stored values */ }
    if (!otpCode || !activationLink) {
      try {
        const fast = extractFast(item.raw);
        if (!otpCode && fast.otpCode) otpCode = fast.otpCode;
        if (!activationLink && fast.activationLink) activationLink = fast.activationLink;
      } catch (e) { /* keep stored values */ }
    }
    // Backfill legacy rows (written before migration 0003) so later reads
    // and the bot's own full-view/collapse see the same values.
    if ((otpCode !== (item.otpCode || "")) || (activationLink !== (item.activationLink || ""))) {
      try { await db.updateInboxAction(env, email, item.id, otpCode, activationLink); } catch (e) { /* best-effort */ }
    }
  }
  if (bodyText.length > WEB_DETAIL_BODY_LIMIT) {
    bodyText = bodyText.substring(0, WEB_DETAIL_BODY_LIMIT) + "\n\n(...truncated)";
  }
  const shaped = apiPublicInboxItem({
    id: item.id, ts: item.ts, from: item.from, subject: item.subject,
    date: item.date, body: "", links, otpCode, activationLink,
  }, lang);
  shaped.bodyText = bodyText;
  return shaped;
}

// ---- /app entry (static files themselves come from the Assets binding) -----

async function serveWebApp(request, env, url) {
  try {
    if (env && env.ASSETS && typeof env.ASSETS.fetch === "function") {
      return await env.ASSETS.fetch(new Request(url.origin + "/app/index.html", request));
    }
  } catch (e) { /* fall through to hint */ }
  return new Response("Web App assets are not configured on this Worker.", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

// ---- main API router --------------------------------------------------------

async function handleWebApi(request, env, url) {
  try {
    const pathname = url.pathname;

    if (request.method === "GET" && pathname === "/api/v1/health") {
      return apiJson({ ok: true, domain: env.DOMAIN || "", time: new Date().toISOString() });
    }

    // -- WEB SESSION: standalone website identity (no Telegram) -------------
    // Idempotent ensure: a browser holding a valid web identity token
    // (HttpOnly cookie or Bearer) gets it back; otherwise a fresh
    // cryptographically-random web identity is issued. No Telegram
    // account, Login Widget, or recovery token is required. The identity
    // carries no email until the first POST /emails (empty state + Create).
    if (pathname === "/api/v1/web/session") {
      if (request.method !== "POST") return apiErr("method_not_allowed", 405);
      const existingToken = getBearerToken(request);
      if (existingToken) {
        const existingChatId = await verifySessionToken(env, existingToken);
        if (existingChatId && isWebChatId(existingChatId)) {
          const existing = await db.getSession(env, existingChatId);
          if (existing) {
            const user = { email: existing.email, createdAt: existing.createdAt, lang: existing.lang === "en" ? "en" : "fa" };
            return apiJson({ sessionToken: existingToken, user, isNew: false }, 200, { "Set-Cookie": sessionCookieHeader(existingToken) });
          }
          const user = { email: null, createdAt: null, lang: "fa" };
          return apiJson({ sessionToken: existingToken, user, isNew: true }, 200, { "Set-Cookie": sessionCookieHeader(existingToken) });
        }
        // A Telegram token presented here is NOT a web identity: fall
        // through and issue a separate web identity instead of reusing it,
        // so the two namespaces never merge.
      }
      let webId = generateWebChatId();
      let attempts = 0;
      while (await db.getSession(env, webId)) {
        webId = generateWebChatId();
        if (++attempts > 8) return apiErr("internal_error", 500);
      }
      const token = await issueSessionToken(env, webId);
      const user = { email: null, createdAt: null, lang: "fa" };
      return apiJson({ sessionToken: token, user, isNew: true }, 200, { "Set-Cookie": sessionCookieHeader(token) });
    }

    // -- WEB LOGOUT: forget the browser identity ---------------------------
    // Clears the HttpOnly session cookie (JS cannot clear HttpOnly cookies
    // itself). The D1 row is left intact so a saved recovery token can
    // still restore the abandoned email; it simply becomes unreachable
    // from this browser. No auth required — it only destroys state.
    if (pathname === "/api/v1/web/logout") {
      if (request.method !== "POST") return apiErr("method_not_allowed", 405);
      return apiJson({ ok: true }, 200, {
        "Set-Cookie": "tm_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
      });
    }

    // -- AUTH: Telegram Mini App -------------------------------------------
    if (pathname === "/api/v1/auth/telegram") {
      if (request.method !== "POST") return apiErr("method_not_allowed", 405);
      const body = await readJsonBody(request);
      if (body.__invalid || body.__tooLarge || typeof body.initData !== "string") {
        return apiErr("invalid_request", 400);
      }
      const check = await validateTelegramInitData(body.initData, env.BOT_TOKEN);
      if (!check.ok) {
        return apiErr(check.reason === "expired" ? "expired" : "invalid_init_data", 401);
      }
      if (!isPublicAccess(env, check.userId)) return apiErr("forbidden", 403);
      // Seamless login (empty state + Create): a validated Telegram user
      // without a session row yet gets a PENDING session token (no email).
      // The frontend lands on the dashboard empty state; the first
      // POST /emails with this token provisions the account. No recovery
      // token is ever required. Returning users resolve their existing row
      // so no duplicate email is created.
      const session = await db.getSession(env, check.chatId);
      const token = await issueSessionToken(env, check.chatId);
      if (!session) {
        const langVal = (check.lang === "en") ? "en" : "fa";
        const user = { email: null, createdAt: null, lang: langVal };
        return apiJson({ sessionToken: token, user, isNew: true }, 200, { "Set-Cookie": sessionCookieHeader(token) });
      }
      const user = { email: session.email, createdAt: session.createdAt, lang: session.lang === "en" ? "en" : "fa" };
      return apiJson({ sessionToken: token, user, isNew: false }, 200, { "Set-Cookie": sessionCookieHeader(token) });
    }

    // -- AUTH: recovery token (browser + Mini App secondary path) ----------

    // -- AUTH: recovery token (plain browser) -------------------------------
    if (pathname === "/api/v1/auth/token") {
      if (request.method !== "POST") return apiErr("method_not_allowed", 405);
      const body = await readJsonBody(request);
      if (body.__invalid || body.__tooLarge) return apiErr("invalid_request", 400);
      const login = await apiLoginWithRecoveryToken(env, body.token);
      if (login.error) return apiErr(login.error, login.status || 400);
      const token = await issueSessionToken(env, login.chatId);
      return apiJson({
        sessionToken: token,
        user: { email: login.email, createdAt: login.createdAt, lang: login.lang },
      }, 200, { "Set-Cookie": sessionCookieHeader(token) });
    }

    // -- everything below requires a verified session ------------------------
    // A verified token with no D1 row yet is a PENDING first-time identity
    // (see /auth/telegram + /auth/widget). Pending callers may read an
    // empty shell (/me with email:null, empty inbox) and may provision via
    // POST /emails. Ownership scoping below is unchanged for full sessions.
    const authed = await requireWebSession(request, env);
    if (!authed) return apiErr("unauthorized", 401);
    const { chatId, session, pending } = authed;
    const lang = session ? (session.lang === "en" ? "en" : "fa") : "fa";

    if (pathname === "/api/v1/me") {
      if (request.method !== "GET") return apiErr("method_not_allowed", 405);
      if (pending || !session) {
        return apiJson({ email: null, createdAt: null, lang, inboxCount: 0, pending: true });
      }
      const items = await db.listInbox(env, session.email);
      return apiJson({
        email: session.email,
        createdAt: session.createdAt,
        lang,
        inboxCount: items.length,
      });
    }

    if (pathname === "/api/v1/emails/current") {
      if (request.method !== "GET") return apiErr("method_not_allowed", 405);
      if (pending || !session) return apiJson({ email: null, createdAt: null, pending: true });
      return apiJson({ email: session.email || null, createdAt: session.createdAt || null });
    }

    if (pathname === "/api/v1/emails") {
      if (request.method !== "POST") return apiErr("method_not_allowed", 405);
      const created = await apiCreateNewEmail(env, chatId, lang);
      return apiJson({
        email: created.email,
        createdAt: created.createdAt,
        recoveryToken: created.recoveryToken, // issuance only
      });
    }

    if (pathname === "/api/v1/emails/restore") {
      if (request.method !== "POST") return apiErr("method_not_allowed", 405);
      const body = await readJsonBody(request);
      if (body.__invalid || body.__tooLarge) return apiErr("invalid_request", 400);
      const login = await apiLoginWithRecoveryToken(env, body.token);
      if (login.error) return apiErr(login.error, login.status || 400);
      // Bot parity (restoreWrongOwner): an authenticated caller may only
      // restore a token that belongs to their OWN chat. Switching identity
      // to another chat's token is refused even when the token is valid.
      if (String(login.chatId) !== String(chatId)) return apiErr("wrong_owner", 403);
      const token = await issueSessionToken(env, login.chatId);
      return apiJson({
        sessionToken: token,
        email: login.email,
        createdAt: login.createdAt,
      }, 200, { "Set-Cookie": sessionCookieHeader(token) });
    }

    if (pathname === "/api/v1/inbox") {
      if (request.method !== "GET") return apiErr("method_not_allowed", 405);
      let limit = parseInt(url.searchParams.get("limit") || "20", 10);
      if (!Number.isFinite(limit)) limit = 20;
      limit = Math.max(1, Math.min(20, limit));
      if (pending || !session) return apiJson({ items: [] });
      const items = await db.listInbox(env, session.email);
      return apiJson({ items: items.slice(0, limit).map((it) => apiPublicInboxItem(it, lang)) });
    }

    if (pathname.startsWith("/api/v1/inbox/")) {
      if (request.method !== "GET") return apiErr("method_not_allowed", 405);
      if (pending || !session) return apiErr("not_found", 404);
      const id = decodeURIComponent(pathname.substring("/api/v1/inbox/".length).split("/")[0] || "");
      if (!id) return apiErr("invalid_request", 400);
      const detail = await apiEmailDetail(env, session.email, id, lang);
      if (!detail) return apiErr("not_found", 404);
      return apiJson(detail);
    }

    if (pathname === "/api/v1/settings/language") {
      if (request.method === "GET") return apiJson({ lang });
      if (request.method === "PUT") {
        const body = await readJsonBody(request);
        if (body.__invalid || body.__tooLarge) return apiErr("invalid_request", 400);
        const next = String(body.lang || "").toLowerCase();
        if (next !== "fa" && next !== "en") return apiErr("invalid_lang", 400);
        if (pending || !session) return apiErr("no_session", 404);
        await db.setLang(env, chatId, next);
        return apiJson({ lang: next });
      }
      return apiErr("method_not_allowed", 405);
    }

    return apiErr("not_found", 404);
  } catch (e) {
    // Never leak internals, secrets, or stacks to API clients.
    return apiErr("internal_error", 500);
  }
}
