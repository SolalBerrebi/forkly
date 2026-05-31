//! Claude Code CLI subprocess transport.
//!
//! Spawns `claude --print ...` and parses its NDJSON stream. The user's
//! claude.ai subscription quota covers the inference (no API key needed).
//!
//! Multi-turn conversation state is maintained by Claude Code itself via
//! `--session-id <forkly-session-uuid>` on the first turn and
//! `--resume <forkly-session-uuid>` on subsequent turns. Forkly's session id
//! doubles as the CC session id so we don't need a separate column.
//!
//! See `memory/reference_claude_code_cli.md` for the NDJSON event shapes
//! this parser handles and the flags we deliberately do (and do not) pass.

use crate::error::{AppError, AppResult};
use crate::providers::cli_runner::{self, CliProcess};
use crate::providers::{ClaudeCodeRequest, StreamEvent};
use serde::Deserialize;
use std::process::Stdio;
use tokio::sync::mpsc;

/// Top-level shape of each NDJSON line emitted by `claude --print --verbose
/// --output-format stream-json`. We deserialize only the fields we route on
/// and ignore everything else, so future Claude Code additions don't break us.
#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
enum CcLine {
    #[serde(rename = "stream_event")]
    StreamEvent { event: StreamInner },
    #[serde(rename = "result")]
    Result(ResultLine),
    #[serde(rename = "assistant")]
    Assistant(AssistantLine),
    #[serde(other)]
    Other,
}

#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
enum StreamInner {
    #[serde(rename = "message_start")]
    MessageStart { message: MessageStartPayload },
    #[serde(rename = "content_block_delta")]
    ContentBlockDelta { delta: ContentDelta },
    #[serde(rename = "message_delta")]
    MessageDelta { usage: OutputUsage },
    #[serde(rename = "message_stop")]
    MessageStop,
    #[serde(other)]
    Other,
}

#[derive(Deserialize, Debug)]
struct MessageStartPayload {
    usage: InputUsage,
}

#[derive(Deserialize, Debug)]
struct InputUsage {
    input_tokens: i64,
}

#[derive(Deserialize, Debug)]
struct OutputUsage {
    output_tokens: i64,
}

#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
enum ContentDelta {
    #[serde(rename = "text_delta")]
    Text { text: String },
    #[serde(other)]
    Other, // thinking_delta, signature_delta — ignored for chat display
}

#[derive(Deserialize, Debug)]
struct ResultLine {
    is_error: bool,
    result: Option<String>,
}

#[derive(Deserialize, Debug)]
struct AssistantLine {
    #[serde(default)]
    error: Option<String>,
}

pub async fn stream_chat(req: ClaudeCodeRequest, tx: mpsc::Sender<StreamEvent>) -> AppResult<()> {
    let mut cmd = cli_runner::command("claude");
    cmd.arg("--print")
        .arg("--verbose")
        .arg("--output-format")
        .arg("stream-json")
        .arg("--include-partial-messages")
        .arg("--allowedTools")
        .arg("")
        .arg("--model")
        .arg(&req.model);

    // Empty means "no custom system prompt" — fall back to Claude Code's
    // default rather than overriding it with an empty string.
    if let Some(sys) = req.system_prompt.as_deref().filter(|s| !s.is_empty()) {
        cmd.arg("--system-prompt").arg(sys);
    }

    // First turn creates the CC session; subsequent turns resume it.
    if req.is_resume {
        cmd.arg("--resume").arg(&req.session_id);
    } else {
        cmd.arg("--session-id").arg(&req.session_id);
    }

    cmd.arg(&req.user_message);
    // Claude Code reads the prompt from argv, not stdin — close stdin so it
    // doesn't hang waiting for input that's never coming.
    cmd.stdin(Stdio::null());

    let mut process = CliProcess::spawn(cmd, "claude")?;

    let mut input_tokens: Option<i64> = None;
    let mut output_tokens: Option<i64> = None;
    let mut terminal_error: Option<String> = None;

    while let Some(line) = process
        .lines
        .next_line()
        .await
        .map_err(|e| AppError::Upstream(format!("read claude stdout: {e}")))?
    {
        if line.is_empty() {
            continue;
        }

        let parsed: CcLine = match serde_json::from_str(&line) {
            Ok(p) => p,
            Err(_) => continue, // unknown event shape — skip silently
        };

        match parsed {
            CcLine::StreamEvent { event } => match event {
                StreamInner::MessageStart { message } => {
                    input_tokens = Some(message.usage.input_tokens);
                }
                StreamInner::ContentBlockDelta { delta } => {
                    if let ContentDelta::Text { text } = delta {
                        if tx.send(StreamEvent::Delta(text)).await.is_err() {
                            // Consumer dropped; kill child and abandon.
                            process.kill().await;
                            return Ok(());
                        }
                    }
                }
                StreamInner::MessageDelta { usage } => {
                    output_tokens = Some(usage.output_tokens);
                }
                StreamInner::MessageStop => {
                    // Done — wait for the result line to confirm, then exit cleanly.
                }
                StreamInner::Other => {}
            },
            CcLine::Assistant(a) => {
                if let Some(err) = a.error {
                    terminal_error = Some(if err == "authentication_failed" {
                        "claude code is not logged in. run `claude login` in your terminal."
                            .to_string()
                    } else {
                        format!("claude code: {err}")
                    });
                }
            }
            CcLine::Result(r) => {
                if r.is_error {
                    let msg = r
                        .result
                        .unwrap_or_else(|| "claude code returned an error".into());
                    terminal_error.get_or_insert(msg);
                }
            }
            CcLine::Other => {}
        }
    }

    process.finish("claude code", terminal_error).await?;

    let _ = tx
        .send(StreamEvent::Usage {
            input_tokens,
            output_tokens,
        })
        .await;
    let _ = tx.send(StreamEvent::Done).await;
    Ok(())
}

/// Lightweight install/auth check used by the frontend Settings dialog.
///
/// Returns whether `claude` is on PATH, its version string if so, and whether
/// the user appears to be logged in. The login check is just `claude config get
/// auth.user` — fast and side-effect-free. Anything more expensive (a real
/// inference call) is too costly for a status check.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub logged_in: bool,
}

pub async fn detect() -> DetectionStatus {
    // Is `claude` on PATH and runnable?
    let version_out = cli_runner::command("claude")
        .arg("--version")
        .output()
        .await;

    let (installed, version) = match version_out {
        Ok(out) if out.status.success() => {
            let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
            (true, Some(v))
        }
        _ => {
            return DetectionStatus {
                installed: false,
                version: None,
                logged_in: false,
            }
        }
    };

    // We intentionally do NOT pre-emptively check login state. Claude Code
    // stores its OAuth tokens in the macOS keychain / equivalent secure store,
    // and there's no fast public command to query auth status without making
    // an inference call (which would cost a token + 1-2s per status check).
    //
    // Instead: if the user isn't logged in, the first `start_stream` call
    // will fail and our error-mapping in stream_chat() surfaces a clear
    // "run `claude login` in your terminal" message in the chat bubble.
    // Optimistic-status here keeps the Settings dialog responsive and
    // avoids false negatives like the one Solal hit on 2026-05-27 where
    // `claude config get -g theme` returned non-zero despite being logged in.
    DetectionStatus {
        installed,
        version,
        logged_in: installed,
    }
}
