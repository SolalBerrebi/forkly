# Changelog

All notable changes to Forkly. The format roughly follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Hardened — pre-launch audit pass

Reliability, security, and polish work to take Forkly from a great demo to a
shippable product.

- **Stop a running generation** — every streaming cell now has a Stop button;
  in-flight streams are tracked in a registry and cancelled cleanly (partial
  output is kept). Deleting a node or quitting the app aborts its stream and
  reaps any CLI subprocess instead of orphaning it.
- **Fixed the Claude Code "wedge"** — a session whose first turn failed (auth /
  network) is no longer stuck forever trying to `--resume` a session Claude
  Code never created; it correctly retries with `--session-id`.
- **Stream timeouts** — HTTP providers get a connect + idle timeout, so a
  stalled connection surfaces an error instead of spinning forever (Ollama is
  exempt so local cold-loads aren't cut off).
- **CLI PATH fix** — `claude` / `codex` are resolved against an augmented PATH
  so the app finds them even when launched from Finder/Dock (which don't
  inherit your shell PATH); a missing CLI now gives an actionable message.
- **No more subprocess deadlock** — CLI stderr is drained concurrently, so a
  chatty CLI can't fill the pipe and hang the read loop.
- **Security**: a strict Content-Security-Policy is now set; the network log
  scrubs anything key-shaped (incl. the Gemini key in request URLs);
  `~/.claude/projects` import paths are validated against traversal; keychain
  access runs off the async runtime; CC import is transactional.
- **Crash safety**: a React error boundary (app-wide + per cell) replaces
  white-screens with a recoverable fallback; a failed initial load shows a real
  error + retry instead of a misleading empty canvas; deltas that arrive before
  their stream starts are buffered (no lost leading tokens); the messages store
  is purged on delete / workspace switch (no unbounded growth).
- **UX**: `Reorganize` now uses the correct cell footprint (no overlapping
  nodes); Enter no longer sends mid-IME-composition (CJK/accents); canvas
  shortcuts (Delete/`M`/`2`–`9`) no longer fire while a menu/dialog is open;
  the version pill reads the real app version; auto-titling falls back to the
  first message when Claude Code isn't available.
- **Tooling**: clippy + rustfmt + ESLint now gate CI (clippy was previously
  non-blocking); CI covers Windows; the version pill, `SECURITY.md`, a PR
  template, and `docs/architecture.md` + `docs/providers.md` round out the
  open-source setup.

### Added — M8: Multi-provider integration

- **OpenAI provider** — both transports:
  - `codex exec --json` CLI for ChatGPT Plus / Pro / Business subscription auth (no API key needed)
  - `/v1/chat/completions` HTTP for the API tier
- **Google Gemini provider** via `streamGenerateContent` (API key). Gemini CLI deliberately skipped — it's being deprecated for free / personal tiers on 2026-06-18.
- **Ollama local provider** via `localhost:11434/api/chat`. Models are dynamically populated from `ollama list` on the user's machine; no hardcoded catalog.
- **Cross-LLM fork picker** — clicking the fork button on any message opens a small popover listing every provider you have configured. Pick one and the fork inherits the parent's history but runs on a different model. The composer has a matching always-visible "fork ⇢" button that forks from the latest message.
- **First-launch onboarding** detects Claude Code, Codex CLI, and Ollama; offers a Gemini AI Studio walkthrough as the universal fallback so new users land in a working state within 60 seconds without an API key. No keys are ever shipped in the binary.
- **Per-cell provider switching** — the model picker on each cell now lists every provider's catalog (Claude amber, GPT green, Gemini blue, Ollama pink), and switching providers auto-picks the cheapest available transport (subscription CLI when logged in, API otherwise).

### Added — M7: Per-cell polish

- **Per-cell info chips** in each session header: token totals, turn count, last activity, current git branch when the working dir is a repo.
- **Resizable cells** via xyflow's `NodeResizer`, with min/max bounds and debounced persistence.
- **Dagre auto-layout** (`⌘⇧L`) — reorganizes unlocked cells into a clean left-to-right tree. Cells you've manually dragged stay where they are.
- **Network log drawer** (`⌘⇧N`) — every outbound call (CLI subprocess invocations or HTTP requests) lands here with method, status, duration, token totals, and a raw-detail expansion for debugging upstream schema changes. Local-only, capped at 500 entries.
- **Live-linked Claude Code session import** — Forkly's session id is the underlying CC session UUID, so `claude --resume` continues the same `.jsonl` file on disk. Adding turns in Forkly grows the original file.
- **Per-cell appearance toggle** — flip a single cell between Claude-Code-terminal feel (mono, `›` prefix, blinking caret) and chat feel (sans-serif bubbles) without affecting other cells on the canvas.
- **Cell expand / collapse** preset, persisted across launches.

### Added — UI polish pass

- **Liquid-glass surfaces** — every chrome element (top bar, cells, composer, dialogs, drawer, popovers) is translucent with 20–24px backdrop blur over an aurora-lit canvas, so colored ambient light bleeds through. Light + dark have parity tokens; the OS color scheme is the default and the theme toggle is for explicit overrides.
- **Click-to-focus** any off-center cell smoothly slides the viewport to centre it at the current zoom.
- **Smart wheel handler** — pinch zooms the canvas, scroll past the top/bottom of a message list pans the canvas, scroll mid-list scrolls the list.

### Added — initial release (pre-M8)

- **Subscription-backed chat via Claude Code** — Forkly's primary auth path. Detects `claude` on PATH, surfaces install/login instructions if missing.
- **Direct Anthropic API key transport** as an advanced fallback. API keys live in the OS keychain via the `keyring` crate.
- **Visual canvas with infinite pan/zoom** powered by xyflow.
- **Forking** — hover any message, click "fork" or press `2`–`9` for fan-out. Forks inherit parent context (replayed as a prelude on the first turn for Claude Code, sent natively as `messages[]` for the API transports).
- **Merge nodes** — select 2+ sibling forks, press `M`. A new node fans in with edges from every source and auto-streams a synthesis prompt built from each source's final response.
- **Auto-titling** — after the first reply, a cheap Haiku call titles the session (≤4 words, lowercased).
- **Zoom-dependent node rendering** — full chat at normal zoom, label-only when zoomed out far.
- **Workspaces** (pages / sheets).
- **Delete sessions** with confirmation, cascading messages but orphaning descendants so forks survive.
- **Settings dialog** with status detection for every transport.

### Known limitations

- No automatic crash recovery for mid-stream interruptions yet (the partial response is saved but the stream doesn't auto-resume).
- API-only users (no Claude Code installed) don't get auto-titling, since the titling call uses the `claude` CLI for cheap inference.
- The first launch on a fresh install doesn't ship a demo workspace yet.
- macOS builds are not signed yet; running from a downloaded `.dmg` will require right-click → Open until v0.1.0.

### Internals

- SQLite-backed workspace persists across launches; migrations live in `src-tauri/migrations/`.
- Streaming is event-based via Tauri's `emit` system (`stream:start` / `stream:delta` / `stream:done` / `stream:error` / `session:stats` / `net-log:entry`) so concurrent streams across multiple nodes work natively.
- Shared `providers/cli_runner.rs` wraps subprocess plumbing for Claude Code and Codex. Each provider owns its NDJSON parser; the I/O is uniform.
- Frontend state: Zustand + Immer; messages and workspaces are separate stores wired via a thin stream-event bridge.

[Unreleased]: https://github.com/SolalBerrebi/forkly/compare/v0.0.0...HEAD
