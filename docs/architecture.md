# Forkly architecture

A tour of how Forkly is put together, for contributors. Pair this with the code
— it's a map, not a spec.

## Stack

- **Frontend**: React 19 + TypeScript (strict) + Vite, [`@xyflow/react`](https://github.com/xyflow/xyflow)
  for the canvas, Zustand + Immer for state, Tailwind v4 (`@theme` tokens),
  Radix primitives, Framer Motion. Geist is bundled locally (no font CDN).
- **Backend**: Rust + Tauri 2. SQLite via `sqlx` (WAL, foreign keys on),
  `reqwest` (rustls) for HTTP providers, `keyring` for API keys, `tokio` for
  async + subprocess management.

## Data model (git-like)

Messages are **immutable**; sessions are **pointers**.

- `messages` belong to a session by `session_id` (no join table). Each has a
  monotonic `position` (`UNIQUE(session_id, position)`).
- A **fork** is a new session row with `parent_session_id` +
  `fork_point_message_id`. History is reconstructed by walking the parent chain
  (`commands/messages.rs::build_history`): each parent contributes its messages
  up to and including the fork point, then the child's own messages.
- A **merge node** has `parent_session_id = NULL` and a JSON array in
  `merge_source_session_ids`. Its synthesis prompt is built backend-side
  (`commands/stream.rs::build_synthesis_prompt`) and lives inside the merge
  node's first user turn — so the data model stays "one session = one linear
  conversation" even though merges look like a DAG on the canvas.

Schema changes are additive migrations in `src-tauri/migrations/` (timestamped,
run on startup).

## Transports

Each session carries a `provider_id` (anthropic / openai / google / ollama) and
a `transport_id`:

- **Subscription CLIs** — `claude-code` and `codex` shell out to the user's
  installed CLI (billed against their existing plan). See
  `providers/cli_runner.rs` for the shared subprocess plumbing (PATH hardening,
  concurrent stderr drain, kill-on-drop).
- **API key** (`api`) — direct HTTPS to Anthropic / OpenAI / Google, key read
  from the keychain only inside the streaming task.
- **Ollama** — local HTTP, no auth.

To add one, see [providers.md](providers.md).

## Streaming

`start_stream` (a Tauri command) does all fallible setup synchronously (auth,
history, message inserts), registers the stream for cancellation, then spawns a
detached task that drives the provider and **emits Tauri events** rather than
returning a value:

`stream:start` → `stream:delta`* → `stream:done` | `stream:error`

Because deltas flow over events, concurrent streams across many nodes Just Work.
The frontend routes these into `messagesStore` (`lib/streamBridge.ts`). Streams
are cancellable: `AppState` holds a `CancellationToken` per session; the Stop
button, node deletion, and app close all signal it (and `kill_on_drop` reaps any
CLI child).

## Zoom-dependent rendering

A session node renders the full scrollable chat above a zoom threshold and
collapses to a large label below it (`canvas/nodes/SessionNode.tsx`). Edges
subscribe only to stream start/stop transitions (`streamingSessions`), never to
per-delta state — observing per-token state previously caused render storms.

## State

- `workspaceStore` — workspaces + session rows (canvas nodes), hydrated from the
  DB; the source of truth for node positions/sizes/metadata.
- `messagesStore` — messages by id + per-session ordering + streaming flags.
  Purged per-session on delete and wholesale on workspace switch so it can't
  grow without bound.

## Security posture

Local-first: no telemetry, no cloud. Keys in the OS keychain (never on disk in
plaintext, never logged — see `commands/net_log.rs::mask_secrets`). A restrictive
CSP is set in `tauri.conf.json`, and the Tauri capability set is minimal. Every
outbound call appears in the in-app network log (`⌘⇧N`).
