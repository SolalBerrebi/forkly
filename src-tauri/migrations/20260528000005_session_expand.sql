-- Per-session expand toggle. When pre_expand_{width,height} are both set, the
-- session is in "expanded" state — the canvas renders it at a generous preset
-- size while these columns remember what to restore on collapse. Clearing
-- both columns (set NULL) means the session is back to its user-chosen size.

ALTER TABLE sessions ADD COLUMN pre_expand_width REAL;
ALTER TABLE sessions ADD COLUMN pre_expand_height REAL;
