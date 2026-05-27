-- Per-cell width / height so users can resize individual session nodes.
-- NULL means "use SessionNode default" (the 360x460 we ship with).

ALTER TABLE sessions ADD COLUMN width REAL;
ALTER TABLE sessions ADD COLUMN height REAL;
