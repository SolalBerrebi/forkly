-- Per-session metadata chips: running token totals, last activity, working
-- directory (for the git-branch chip).
--
-- All four columns are nullable for older sessions; the frontend falls back
-- gracefully when a chip's underlying value is missing.

ALTER TABLE sessions ADD COLUMN input_tokens_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN output_tokens_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN last_activity_at INTEGER;
ALTER TABLE sessions ADD COLUMN working_dir TEXT;
