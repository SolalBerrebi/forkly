# Adding an LLM provider

Forkly's provider layer is a small set of shared types plus one `stream_chat`
function per backend — not a heavyweight trait. Adding a new HTTP provider
(Mistral, Groq, OpenRouter, …) is a focused change. `providers/anthropic.rs` is
the cleanest worked example to copy.

## 1. Write the provider module

Create `src-tauri/src/providers/<name>.rs` exposing:

```rust
pub async fn stream_chat(
    req: ApiStreamRequest,            // model, system_prompt, messages, max_tokens, api_key
    tx: tokio::sync::mpsc::Sender<StreamEvent>,
) -> AppResult<()>;
```

Contract:

- Build the client with `crate::providers::http_client()` (gives you a connect
  timeout + an idle/read timeout for free).
- On a non-2xx response, return `AppError::Upstream` with the upstream body
  (truncated). Prefer a friendly message for 401/429.
- For each text chunk, `tx.send(StreamEvent::Delta(text)).await` — and if it
  returns `Err`, the receiver is gone, so stop (the user cancelled).
- When you see usage, send `StreamEvent::Usage { input_tokens, output_tokens }`.
- Finish with `StreamEvent::Done`.
- **Never log the request URL or headers** containing the key — if you must
  surface something, the net-log layer masks it, but don't rely on that.

Register the module in `providers/mod.rs` (`pub mod <name>;`).

## 2. Route it in the orchestrator

In `commands/stream.rs`:

- Add a variant to the `Dispatch` enum if the wire shape differs from the
  existing `ApiStreamRequest`. For an OpenAI-compatible HTTP API you can reuse
  `ApiStreamRequest` and just add a `provider_id` match arm.
- Map your `provider_id` (and `transport_id` if it's a new CLI) to the dispatch,
  and spawn your `stream_chat` in the dispatch `match`.

## 3. Expose models to the UI

Add an entry to `MODEL_CATALOG` in `src/providers/models.ts` — that static
catalog is the single source of truth for the model picker dropdown. Add brand
colors/label in `src/providers/theme.ts`.

## 4. Auth

- **API key**: nothing to do beyond reading it — keys are stored per
  `provider_id` in the keychain via `commands/secrets.rs`, and `start_stream`
  reads yours automatically for `transport_id == "api"`.
- **A new subscription CLI**: model it on `providers/codex.rs` and use
  `cli_runner::command("<bin>")` so it inherits the GUI-launch PATH fix and
  kill-on-drop.

## 5. Verify

```bash
cargo fmt --all && cargo clippy --all-targets -- -D warnings
pnpm build && pnpm lint
```

Then run `pnpm tauri dev`, create a session on your provider, and confirm the
stream renders and the call shows up in the network log (`⌘⇧N`).
