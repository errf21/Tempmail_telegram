-- Initial schema for the temp-mail bot, migrating from Cloudflare KV to D1 (SQLite).
--
-- All four tables are WITHOUT ROWID because the primary key is the only
-- access path; this gives smaller storage and faster lookups.

-- 1) sessions: one row per Telegram chatId. Stores the active email, its
--    recovery token, the human-readable creation date, and the chat language.
CREATE TABLE IF NOT EXISTS sessions (
  chat_id        TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  created_at     TEXT NOT NULL,
  recovery_token TEXT NOT NULL UNIQUE,
  lang           TEXT NOT NULL DEFAULT 'fa'
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_sessions_email ON sessions(email);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(recovery_token);

-- 2) email_bindings: recipient -> chatId. Looked up on every incoming email
--    to know which chat to notify. Separate from sessions so a chat that
--    restores an old email does not clobber a currently active session.
CREATE TABLE IF NOT EXISTS email_bindings (
  email   TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_email_bindings_chat ON email_bindings(chat_id);

-- 3) inbox: one row per received email. Composite PK so the per-recipient
--    list is index-only; the (email, ts DESC) index makes "latest 20" cheap.
CREATE TABLE IF NOT EXISTS inbox (
  email       TEXT NOT NULL,
  id          TEXT NOT NULL,
  ts          INTEGER NOT NULL,
  sender      TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  links_json  TEXT NOT NULL DEFAULT '[]',
  date_str    TEXT NOT NULL,
  PRIMARY KEY (email, id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_inbox_email_ts ON inbox(email, ts DESC);

-- 4) kv_meta: tiny key/value table for transient per-chat state (e.g.
--    "awaiting_restore_token"). Kept separate so the hot sessions table
--    stays small and uniform.
CREATE TABLE IF NOT EXISTS kv_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
) WITHOUT ROWID;
