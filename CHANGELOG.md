# Changelog

All notable changes to Forkly. The format roughly follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Subscription-backed chat via Claude Code** — Forkly's primary auth path. Detects `claude` on PATH, surfaces install/login instructions if missing. Streams via `claude --print --verbose --output-format stream-json --include-partial-messages`; multi-turn conversations use `--session-id` on the first turn and `--resume` thereafter.
- **Direct Anthropic API key transport** as an advanced fallback for power users / orgs that don't use Claude Code. API keys live in the OS keychain via the `keyring` crate.
- **Visual canvas with infinite pan/zoom** powered by xyflow, custom cross-dot grid background, and a cursor-tracking violet highlight.
- **Forking** — hover any message, click "fork" or press `2`–`9` for fan-out. Forks inherit parent context (replayed as a prelude on the first turn for Claude Code, sent natively as `messages[]` for the API transport).
- **Merge nodes** — select 2+ sibling forks, press `M`. A new node fans in with edges from every source and auto-streams a synthesis prompt built from each source's final response.
- **Auto-titling** — after the first reply, a cheap Haiku call titles the session (≤4 words, lowercased).
- **Zoom-dependent node rendering** — full chat (zoom ≥ 0.7), compact card with last user/assistant preview (0.35–0.7), or label-only at far zoom.
- **Workspaces** (pages / sheets) — create named canvases; each one is an independent set of sessions. Persistent across launches.
- **Delete sessions** via `Delete` / `Backspace` key on selection, or the "..." menu on each node header. Confirms first; cascades messages but orphans descendants so forks survive.
- **Settings dialog** with Claude Code status detection and per-provider API key management.
- **Light & dark themes**, persisted to localStorage.

### Known limitations

- No automatic crash recovery for mid-stream interruptions yet (the partial response is saved but the stream doesn't auto-resume).
- API-only users (no Claude Code installed) don't get auto-titling, since the titling call uses the `claude` CLI for cheap inference.
- The first launch on a fresh install doesn't ship a demo workspace yet.

### Internals

- SQLite-backed workspace persists across launches; migrations live in `src-tauri/migrations/`.
- Streaming is event-based via Tauri's `emit` system (`stream:start` / `stream:delta` / `stream:done` / `stream:error`) so concurrent streams across multiple nodes work natively.
- Frontend state: Zustand + Immer; messages and workspaces are separate stores wired via a thin stream-event bridge.

[Unreleased]: https://github.com/forkly/forkly/compare/v0.0.0...HEAD
