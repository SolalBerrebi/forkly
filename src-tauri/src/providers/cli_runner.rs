//! Shared subprocess plumbing for CLI-backed providers (Claude Code, Codex).
//!
//! Both CLIs follow the same pattern: spawn a binary that streams NDJSON
//! events on stdout while diagnostic noise lands on stderr; wait for exit;
//! map exit + stderr to a clean error. Only the per-event parsing differs.
//!
//! This module owns the OS-level plumbing — process spawn, line-buffered
//! stdout reads, stderr drain, exit-status mapping — so each provider's
//! module stays focused on its NDJSON event schema.
//!
//! Why a hand-rolled helper instead of a Provider trait: we have exactly two
//! CLI providers, both async, both with subtly different argument-building
//! needs. A trait would force one of them to wear a coat that doesn't fit.
//! A thin helper that handles the boring parts is the smaller commitment.

use crate::error::{AppError, AppResult};
use tokio::io::{AsyncBufReadExt, BufReader, Lines};
use tokio::process::{Child, ChildStderr, ChildStdout, Command};

/// Handles around a running CLI subprocess. The caller drives `lines` to
/// consume NDJSON events; once that loop ends (EOF or early break), call
/// [`finish`] to wait on the process and surface any error.
pub struct CliProcess {
    pub child: Child,
    pub lines: Lines<BufReader<ChildStdout>>,
    pub stderr: ChildStderr,
}

impl CliProcess {
    /// Spawn `command` with stdout/stderr piped. The caller is responsible
    /// for setting stdin (`Stdio::null()` if the prompt goes via argv, or
    /// `Stdio::piped()` if it needs to be written after spawn). We
    /// deliberately do NOT default stdin here because overriding a piped
    /// stdin to null silently breaks `codex exec - ` (it reads the prompt
    /// from stdin) — debugged the hard way on 2026-05-28.
    pub fn spawn(mut command: Command, label: &str) -> AppResult<Self> {
        command
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let mut child = command
            .spawn()
            .map_err(|e| AppError::Upstream(format!("spawn {label}: {e}")))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::Other(format!("{label} stdout missing")))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AppError::Other(format!("{label} stderr missing")))?;

        Ok(Self {
            child,
            lines: BufReader::new(stdout).lines(),
            stderr,
        })
    }

    /// Wait for the process, drain stderr, and turn a non-zero exit into a
    /// nicely-formatted `AppError::Upstream`. `terminal_error` is the
    /// caller's "parsed an error event mid-stream" message — it takes
    /// precedence over an exit-code error because it's usually more specific.
    pub async fn finish(
        mut self,
        label: &str,
        terminal_error: Option<String>,
    ) -> AppResult<()> {
        // Best-effort stderr drain. Most CLIs emit nothing here on success.
        let stderr_text = drain_to_string(self.stderr).await.unwrap_or_default();

        let status = self
            .child
            .wait()
            .await
            .map_err(|e| AppError::Upstream(format!("wait {label}: {e}")))?;

        if let Some(msg) = terminal_error {
            return Err(AppError::Upstream(msg));
        }
        if !status.success() {
            let detail = if stderr_text.trim().is_empty() {
                format!("exit {status}")
            } else {
                format!("{status}: {}", stderr_text.trim())
            };
            return Err(AppError::Upstream(format!("{label}: {detail}")));
        }
        Ok(())
    }

    /// Kill the subprocess. Use when the consumer of the output channel has
    /// dropped — there's no one to deliver further deltas to.
    pub async fn kill(mut self) {
        let _ = self.child.kill().await;
    }
}

async fn drain_to_string<R: tokio::io::AsyncRead + Unpin>(reader: R) -> std::io::Result<String> {
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
