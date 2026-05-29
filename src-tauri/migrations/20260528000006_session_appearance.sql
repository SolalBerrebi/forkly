-- Per-session appearance override. NULL means "follow the global setting in
-- Settings → Appearance"; "terminal" or "chat" lock this single cell to that
-- look so the user can mix the two on one canvas (e.g. terminal feel for
-- coding sessions, chat feel for writing sessions, side by side).
ALTER TABLE sessions ADD COLUMN appearance_override TEXT;
