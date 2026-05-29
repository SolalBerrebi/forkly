//! OpenAI Codex CLI subprocess transport.
//!
//! Spawns `codex exec --json --model <id>` and parses its NDJSON stream.
//! The user's ChatGPT Plus / Pro / Business / Enterprise subscription quota
//! covers the inference — no API key needed; OAuth tokens live wherever
//! `codex login` puts them (typically `~/.codex/`).
//!
//! ## Conversation state
//!
//! Codex doesn't let the caller pre-assign a thread/session id (Claude Code
//! does, via `--session-id`). The thread_id is generated server-side and
//! announced via the first `thread.started` event. To avoid a DB schema
//! migration for v0.1, we don't `resume` — every turn ships the full
//! conversation as the prompt and Codex sees it as a single-turn exec.
//!
//! ## NDJSON event schema
//!
//! Each line is `{"type": "...", ...}`. Events we handle:
//!   - `thread.started`  — capture `thread_id` (currently unused; logged only)
//!   - `turn.started`    — informational
//!   - `item.started`    — `item.item_type == "agent_message"` marks the
//!                         assistant's response beginning
//!   - `item.delta`      — `delta` is a text fragment; emit as `StreamEvent::Delta`
//!   - `item.completed`  — assistant message bounded
//!   - `turn.completed`  — may carry `usage` with prompt/completion tokens
//!   - `error`           — terminal error; surface to user with a hint to
//!                         run `codex login` if it looks like an auth failure
//!
//! Unknown event types are ignored via `#[serde(other)]` so future Codex
//! releases don't break us.

use crate::error::{AppError, AppResult};
use crate::providers::cli_runner::CliProcess;
use crate::providers::{CodexRequest, StreamEvent};
use serde::Deserialize;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::mpsc;

#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
enum CodexLine {
    #[serde(rename = "thread.started")]
    ThreadStarted {
        #[serde(default)]
        thread_id: Option<String>,
    },
    #[serde(rename = "turn.started")]
    TurnStarted,
    #[serde(rename = "item.started")]
    ItemStarted,
    #[serde(rename = "item.delta")]
    ItemDelta {
        #[serde(default)]
        delta: Option<String>,
        #[serde(default)]
        text: Option<String>,
    },
    /// Codex CLI ≥ 0.5 emits incremental text via `item.updated` rather than
    /// `item.delta`. We accept both so the parser doesn't silently drop
    /// every delta on newer CLI installs (the bug that made GPT cells
    /// stream 68 tokens but render as blank bubbles).
    #[serde(rename = "item.updated")]
    ItemUpdated {
        #[serde(default)]
        delta: Option<String>,
        #[serde(default)]
        text: Option<String>,
    },
    #[serde(rename = "item.completed")]
    ItemCompleted {
        #[serde(default)]
        item: Option<ItemPayload>,
    },
    #[serde(rename = "turn.completed")]
    TurnCompleted {
        #[serde(default)]
        usage: Option<UsagePayload>,
    },
    #[serde(rename = "turn.failed")]
    TurnFailed {
        #[serde(default)]
        error: Option<ErrorPayload>,
    },
    #[serde(rename = "error")]
    Error {
        #[serde(default)]
        message: Option<String>,
        #[serde(default)]
        error: Option<ErrorPayload>,
    },
    #[serde(other)]
    Other,
}

#[derive(Deserialize, Debug)]
struct ItemPayload {
    /// Codex CLI labels the item kind as `"type"` (not `"item_type"`) on the
    /// nested item object. We rename here so serde reads the right field —
    /// missing this rename made every cross-LLM fork render as an empty
    /// bubble even though the model generated text successfully.
    #[serde(default, rename = "type")]
    item_type: Option<String>,
    /// Codex emits the full message text on `item.completed` for non-
    /// streaming model configurations (which, as of 2026-05, is most of
    /// them when called via `codex exec --json`). This is the only path
    /// to actually display the assistant's reply for those configs.
    #[serde(default)]
    text: Option<String>,
}

#[derive(Deserialize, Debug)]
struct UsagePayload {
    #[serde(default)]
    input_tokens: Option<i64>,
    #[serde(default)]
    output_tokens: Option<i64>,
    /// OpenAI sometimes labels these prompt/completion instead of input/output
    /// (shared with the Chat Completions API). Fall back to those names.
    #[serde(default)]
    prompt_tokens: Option<i64>,
    #[serde(default)]
    completion_tokens: Option<i64>,
}

impl UsagePayload {
    fn input(&self) -> Option<i64> {
        self.input_tokens.or(self.prompt_tokens)
    }
    fn output(&self) -> Option<i64> {
        self.output_tokens.or(self.completion_tokens)
    }
}

#[derive(Deserialize, Debug)]
struct ErrorPayload {
    #[serde(default)]
    message: Option<String>,
}

pub async fn stream_chat(
    req: CodexRequest,
    tx: mpsc::Sender<StreamEvent>,
) -> AppResult<()> {
    let mut cmd = Command::new("codex");
    cmd.arg("exec")
        .arg("--json")
        .arg("--model")
        .arg(&req.model)
        // `-` reads the prompt from stdin. Reading from stdin (not argv)
        // avoids shell-quoting hazards for prompts containing quotes.
        .arg("-");

    // codex exec doesn't have a system-prompt flag in the same way Claude
    // Code does; we synthesise one by prepending a `SYSTEM:` block to the
    // prompt itself. Most prompts in Forkly don't set this anyway.
    let prompt = if let Some(sys) = req.system_prompt.as_deref().filter(|s| !s.is_empty()) {
        format!("SYSTEM: {sys}\n\n{}", req.prompt)
    } else {
        req.prompt
    };

    // Pipe stdin so we can write the prompt below.
    cmd.stdin(std::process::Stdio::piped());

    let mut process = CliProcess::spawn(cmd, "codex")?;
    // Write the prompt to stdin and close it so codex starts processing.
    if let Some(mut stdin) = process.child.stdin.take() {
        if stdin.write_all(prompt.as_bytes()).await.is_err() {
            // Codex exited before reading stdin — let the loop below pick
            // up the failure via empty output + non-zero exit code.
        }
        let _ = stdin.shutdown().await;
    }

    let mut input_tokens: Option<i64> = None;
    let mut output_tokens: Option<i64> = None;
    let mut terminal_error: Option<String> = None;
    let mut seen_any_delta = false;

    while let Some(line) = process
        .lines
        .next_line()
        .await
        .map_err(|e| AppError::Upstream(format!("read codex stdout: {e}")))?
    {
        if line.trim().is_empty() {
            continue;
        }

        // Print every raw NDJSON line to the dev terminal AND ship it back
        // up the stream channel so the network-log entry can include it as
        // diagnostic detail. Forkly is brand-new vs Codex CLI schema churn,
        // so when content silently fails to arrive the first question is
        // always "what events did codex actually emit?".
        tracing::info!(target: "codex.line", "{}", line);
        // Best-effort: if the receiver dropped we don't care, traces are
        // strictly debug aid.
        let _ = tx.send(StreamEvent::Trace(line.clone())).await;

        let parsed: CodexLine = match serde_json::from_str(&line) {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!(target: "codex.line", error = %e, "failed to parse codex line");
                continue;
            }
        };

        match parsed {
            CodexLine::ThreadStarted { thread_id } => {
                if let Some(id) = thread_id {
                    tracing::debug!(thread_id = %id, "codex thread started");
                }
            }
            CodexLine::TurnStarted => {}
            CodexLine::ItemStarted => {
                // We don't strictly need to gate on item_type — deltas only
                // arrive for the agent_message anyway. Skipping the gate
                // keeps us forward-compatible if Codex adds new item types.
            }
            CodexLine::ItemDelta { delta, text } => {
                let chunk = delta.or(text).unwrap_or_default();
                if !chunk.is_empty() {
                    seen_any_delta = true;
                    if tx.send(StreamEvent::Delta(chunk)).await.is_err() {
                        process.kill().await;
                        return Ok(());
                    }
                }
            }
            CodexLine::ItemUpdated { delta, text } => {
                // Codex CLI versions ≥ 0.5 renamed `item.delta` → `item.updated`
                // for partial agent_message updates. Handle both for safety.
                let chunk = delta.or(text).unwrap_or_default();
                if !chunk.is_empty() {
                    seen_any_delta = true;
                    if tx.send(StreamEvent::Delta(chunk)).await.is_err() {
                        process.kill().await;
                        return Ok(());
                    }
                }
            }
            CodexLine::ItemCompleted { item } => {
                // Fallback: if Codex didn't stream incremental deltas (some
                // configs only emit the full message on completion), surface
                // the bundled text here so we don't render an empty bubble.
                if !seen_any_delta {
                    if let Some(ItemPayload {
                        item_type: Some(kind),
                        text: Some(t),
                    }) = item
                    {
                        if kind == "agent_message" && !t.is_empty() {
                            if tx.send(StreamEvent::Delta(t)).await.is_err() {
                                process.kill().await;
                                return Ok(());
                            }
                        }
                    }
                }
            }
            CodexLine::TurnCompleted { usage } => {
                if let Some(u) = usage {
                    input_tokens = u.input();
                    output_tokens = u.output();
                }
            }
            CodexLine::TurnFailed { error } => {
                let raw = error
                    .and_then(|e| e.message)
                    .unwrap_or_else(|| "codex turn failed".into());
                terminal_error = Some(map_codex_error(&raw));
            }
            CodexLine::Error { message, error } => {
                let raw = message
                    .or_else(|| error.and_then(|e| e.message))
                    .unwrap_or_else(|| "codex returned an error".into());
                terminal_error = Some(map_codex_error(&raw));
            }
            CodexLine::Other => {}
        }
    }

    process.finish("codex", terminal_error).await?;

    let _ = tx
        .send(StreamEvent::Usage {
            input_tokens,
            output_tokens,
        })
        .await;
    let _ = tx.send(StreamEvent::Done).await;
    Ok(())
}

fn map_codex_error(raw: &str) -> String {
    let lower = raw.to_ascii_lowercase();
    if lower.contains("unauthorized")
        || lower.contains("not logged in")
        || lower.contains("authentication")
        || lower.contains("auth")
    {
        "codex is not logged in. run `codex login` in your terminal.".to_string()
    } else {
        format!("codex: {raw}")
    }
}

/// Lightweight detection: is `codex` on PATH? Same optimistic-login pattern
/// as Claude Code — we don't probe auth ahead of time because there's no
/// fast public command to do so without burning a token.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub logged_in: bool,
}

pub async fn detect() -> DetectionStatus {
    let version_out = Command::new("codex").arg("--version").output().await;
    let (installed, version) = match version_out {
        Ok(out) if out.status.success() => {
            let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
            (true, Some(v))
        }
        _ => return DetectionStatus { installed: false, version: None, logged_in: false },
    };
    DetectionStatus {
        installed,
        version,
        logged_in: installed,
    }
}
