-- Per-session flag indicating whether the user has manually positioned this
-- node by dragging. AutoLayout (M7-D) leaves locked nodes alone and only
-- repositions the unlocked ones, so a node the user has placed deliberately
-- never moves out from under them when a new fork lands.

ALTER TABLE sessions ADD COLUMN position_locked INTEGER NOT NULL DEFAULT 0;
