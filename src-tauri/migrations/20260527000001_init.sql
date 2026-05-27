-- Forkly initial schema.
-- Sessions are nodes on the canvas. Messages are immutable records that
-- belong to a session by id; cross-session references for forking are
-- established via sessions.parent_session_id + sessions.fork_point_message_id.

CREATE TABLE IF NOT EXISTS sessions (
    id                    TEXT PRIMARY KEY,
    title                 TEXT NOT NULL DEFAULT 'untitled session',
    provider_id           TEXT NOT NULL,
    model_id              TEXT NOT NULL,
    system_prompt         TEXT,
    position_x            REAL NOT NULL DEFAULT 0,
    position_y            REAL NOT NULL DEFAULT 0,
    parent_session_id     TEXT REFERENCES sessions(id) ON DELETE SET NULL,
    fork_point_message_id TEXT,
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_parent
    ON sessions(parent_session_id);

CREATE TABLE IF NOT EXISTS messages (
    id            TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role          TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content       TEXT NOT NULL,
    provider_id   TEXT,
    model_id      TEXT,
    input_tokens  INTEGER,
    output_tokens INTEGER,
    position      INTEGER NOT NULL,
    created_at    INTEGER NOT NULL,
    UNIQUE (session_id, position)
);

CREATE INDEX IF NOT EXISTS idx_messages_session_pos
    ON messages(session_id, position);
