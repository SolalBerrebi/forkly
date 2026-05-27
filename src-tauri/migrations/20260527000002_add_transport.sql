-- Add per-session transport selector.
-- "claude-code" routes through the locally-installed `claude` CLI, billed
-- against the user's claude.ai subscription (the default — Forkly's primary path).
-- "api" routes directly to api.anthropic.com via an API key stored in the
-- keychain (pay-per-token; the power-user / org option).

ALTER TABLE sessions ADD COLUMN transport_id TEXT NOT NULL DEFAULT 'claude-code';
