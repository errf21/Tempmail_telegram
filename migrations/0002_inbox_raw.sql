-- Add `raw` column to inbox so the email() handler can save the full MIME
-- body for the "View Full Message" callback to parse lazily. This avoids
-- the catastrophic CPU cost of running the heavy parser on the hot path.
ALTER TABLE inbox ADD COLUMN raw TEXT NOT NULL DEFAULT '';
