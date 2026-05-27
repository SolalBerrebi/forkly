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
use crate::providers::{ClaudeCodeRequest, StreamEvent};
use serde::Deserialize;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
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

pub async fn stream_chat(
    req: ClaudeCodeRequest,
    tx: mpsc::Sender<StreamEvent>,
) -> AppResult<()> {
    let mut cmd = Command::new("claude");
    cmd.arg("--print")
        .arg("--verbose")
        .arg("--output-format")
        .arg("stream-json")
        .arg("--include-partial-messages")
        .arg("--allowedTools")
        .arg("")
        .arg("--model")
        .arg(&req.model);

    if let Some(sys) = &req.system_prompt {
        cmd.arg("--system-prompt").arg(sys);
    }

    // First turn creates the CC session; subsequent turns resume it.
    if req.is_resume {
        cmd.arg("--resume").arg(&req.session_id);
    } else {
        cmd.arg("--session-id").arg(&req.session_id);
    }

    cmd.arg(&req.user_message);

    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Upstream(format!("spawn claude: {e}")))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Other("claude stdout missing".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Other("claude stderr missing".into()))?;

    let mut input_tokens: Option<i64> = None;
    let mut output_tokens: Option<i64> = None;
    let mut terminal_error: Option<String> = None;

    let mut reader = BufReader::new(stdout).lines();
    while let Some(line) = reader
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
                            let _ = child.kill().await;
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

    // Drain stderr (best effort, may carry installer / update prompts).
    let stderr_text = read_to_string(stderr).await.unwrap_or_default();

    let status = child
        .wait()
        .await
        .map_err(|e| AppError::Upstream(format!("wait claude: {e}")))?;

    if let Some(msg) = terminal_error {
        return Err(AppError::Upstream(msg));
    }
    if !status.success() {
        let detail = if stderr_text.is_empty() {
            format!("exit {status}")
        } else {
            format!("{status}: {}", stderr_text.trim())
        };
        return Err(AppError::Upstream(format!("claude code: {detail}")));
    }

    let _ = tx
        .send(StreamEvent::Usage {
            input_tokens,
            output_tokens,
        })
        .await;
    let _ = tx.send(StreamEvent::Done).await;
    Ok(())
}

async fn read_to_string<R: tokio::io::AsyncRead + Unpin>(reader: R) -> std::io::Result<String> {
    let mut s = String::new();
    let mut r = BufReader::new(reader);
    let mut line = String::new();
    loop {
        line.clear();
        let n = r.read_line(&mut line).await?;
        if n == 0 {
            break;
        }
        s.push_str(&line);
    }
    Ok(s)
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
    // Step 1: is `claude` on PATH and runnable?
    let version_out = Command::new("claude").arg("--version").output().await;

    let (installed, version) = match version_out {
        Ok(out) if out.status.success() => {
            let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
            (true, Some(v))
        }
        _ => return DetectionStatus { installed: false, version: None, logged_in: false },
    };

    // Step 2: is the user logged in? `claude auth` lists configured auth and exits 0.
    // We avoid making an actual inference call (would cost a token and 1-2s).
    // The simplest non-stale check: run a near-zero-cost subprocess that fails
    // distinctly if not logged in. `claude config get -g theme` works for that.
    let logged_in = Command::new("claude")
        .args(["config", "get", "-g", "theme"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false);

    DetectionStatus {
        installed,
        version,
        logged_in,
    }
}

