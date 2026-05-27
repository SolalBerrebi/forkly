-- Add workspaces ("pages / sheets") so users can organize sessions across
-- multiple independent canvases. Each workspace shows its own subset of the
-- session graph in the same Forkly window; switching is instant since data
-- stays hydrated in the frontend store.
--
-- We can't add FK constraints to existing columns in SQLite via ALTER TABLE,
-- so workspace_id is a plain TEXT column. App-layer code in
-- commands/workspaces::delete_workspace handles cascade-delete of sessions.

CREATE TABLE IF NOT EXISTS workspaces (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

ALTER TABLE sessions ADD COLUMN workspace_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_workspace
    ON sessions(workspace_id);

-- Seed a single default workspace and migrate every existing session into it
-- so users with pre-workspace data don't lose anything.
INSERT OR IGNORE INTO workspaces (id, name, sort_order, created_at, updated_at)
VALUES (
    'default',
    'main',
    0,
    CAST(strftime('%s', 'now') AS INTEGER) * 1000,
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
);

UPDATE sessions SET workspace_id = 'default' WHERE workspace_id IS NULL;
