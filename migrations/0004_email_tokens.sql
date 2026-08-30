-- ============================================================================
-- 0004_email_tokens.sql
-- --------------------------------------------------------------------------
-- Archive old recovery tokens so users can restore any previously-generated
-- email, not just the most recent one. Before this migration, calling
-- `upsertSession(chatId, newEmail, …, newToken)` overwrote the old
-- `sessions.recovery_token` row (because the PK is chat_id) — once a user
-- generated a second email, the token for the first was gone forever.
--
-- This table holds a HISTORY of tokens, one row per token. Each row keeps
-- the chatId, email, created_at, and lang that were active when the token
-- was issued. A user can therefore paste any old token, and we can
-- reactivate the matching (chatId, email) pair.
--
-- Row lifecycle:
--   1. confirm_generate_yes: before upsertSession, copy the OLD
--      (chat_id, recovery_token) pair from sessions into this table
--      using db.archiveToken().  The current token in sessions is then
--      overwritten by the new one.
--   2. db.purgeArchivedTokens() runs immediately after the archive and
--      keeps only the most recent 10 archived tokens per chat. This bounds
--      storage so a chat that generates hundreds of emails can't fill D1.
--   3. handleMessage restore path: when getSessionByToken returns null,
--      try getArchivedToken() as a fallback. If found, reactivate the
--      archived (chatId, email) via the same upsertSession+clearState
--      path that's used for the regular restore — so UX is identical.
--
-- Schema notes:
--   * PRIMARY KEY (token) — a token is unique by construction (UNIQUE in
--     sessions), and the lookups are always by token.
--   * WITHOUT ROWID — same as sessions, since PK is the only access path.
--   * idx_email_tokens_chat_created supports purgeArchivedTokens and
--     any future "list this chat's tokens" admin/UI query.
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_tokens (
  token       TEXT PRIMARY KEY,
  chat_id     TEXT NOT NULL,
  email       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  lang        TEXT NOT NULL DEFAULT 'fa'
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_email_tokens_chat_created
  ON email_tokens(chat_id, created_at DESC);
