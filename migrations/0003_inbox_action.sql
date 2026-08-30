-- Add otp_code and activation_link to inbox so the email() handler can
-- persist the action that extractFast() extracted, and renderFullEmail()
-- can re-render the SAME code/link the user originally saw in the alert.
--
-- This guarantees 100% consistency between the primary Telegram alert
-- and the "View Full Email" view (Bug 2 from the latest bug report).
--
-- Both columns are TEXT NOT NULL DEFAULT '' so existing rows simply
-- upgrade in place and the application code can read them with `|| ''`
-- (no migration script changes needed in the JS worker).
--
-- Apply with:
--   wrangler d1 migrations apply DB --remote
ALTER TABLE inbox ADD COLUMN otp_code        TEXT NOT NULL DEFAULT '';
ALTER TABLE inbox ADD COLUMN activation_link TEXT NOT NULL DEFAULT '';
