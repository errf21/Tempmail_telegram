-- Reference copy of the D1 schema. The authoritative version is
-- migrations/0001_initial.sql which is applied via:
--   wrangler d1 migrations apply DB --remote
--
-- See migrations/0001_initial.sql for the schema with full comments.
-- This file is kept in sync for humans who want to inspect or apply
-- the schema with `wrangler d1 execute DB --file=db/schema.sql`.

CREATE TABLE IF NOT EXISTS sessions (
  chat_id        TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  created_at     TEXT NOT NULL,
  recovery_token TEXT NOT NULL UNIQUE,
  lang           TEXT NOT NULL DEFAULT 'fa'
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_sessions_email ON sessions(email);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(recovery_token);

CREATE TABLE IF NOT EXISTS email_bindings (
  email   TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_email_bindings_chat ON email_bindings(chat_id);

CREATE TABLE IF NOT EXISTS inbox (
  email           TEXT NOT NULL,
  id              TEXT NOT NULL,
  ts              INTEGER NOT NULL,
  sender          TEXT NOT NULL,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  links_json      TEXT NOT NULL DEFAULT '[]',
  date_str        TEXT NOT NULL,
  raw             TEXT NOT NULL DEFAULT '',
  otp_code        TEXT NOT NULL DEFAULT '',
  activation_link TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (email, id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_inbox_email_ts ON inbox(email, ts DESC);

CREATE TABLE IF NOT EXISTS kv_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
) WITHOUT ROWID;
