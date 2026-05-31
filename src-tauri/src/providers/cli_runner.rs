//! Shared subprocess plumbing for CLI-backed providers (Claude Code, Codex).
//!
//! Both CLIs follow the same pattern: spawn a binary that streams NDJSON
//! events on stdout while diagnostic noise lands on stderr; wait for exit;
//! map exit + stderr to a clean error. Only the per-event parsing differs.
//!
//! This module owns the OS-level plumbing — process spawn, line-buffered
//! stdout reads, concurrent stderr drain, exit-status mapping, and the
//! GUI-launch PATH fix — so each provider's module stays focused on its
//! NDJSON event schema.
//!
//! Why a hand-rolled helper instead of a Provider trait: we have exactly two
//! CLI providers, both async, both with subtly different argument-building
//! needs. A trait would force one of them to wear a coat that doesn't fit.
//! A thin helper that handles the boring parts is the smaller commitment.

use crate::error::{AppError, AppResult};
use std::ffi::OsString;
use std::path::PathBuf;
use tokio::io::{AsyncBufReadExt, BufReader, Lines};
use tokio::process::{Child, ChildStdout, Command};

/// Cap on captured stderr so a CLI that vomits megabytes of diagnostics
/// can't balloon memory. Plenty for any real error message.
const STDERR_CAP: usize = 64 * 1024;

/// Handles around a running CLI subprocess. The caller drives `lines` to
/// consume NDJSON events; once that loop ends (EOF or early break), call
/// [`finish`] to wait on the process and surface any error.
pub struct CliProcess {
    pub child: Child,
    pub lines: Lines<BufReader<ChildStdout>>,
    /// stderr is drained concurrently into this task from spawn time (see
    /// `spawn`); `finish` awaits it for the captured text.
    stderr_task: tokio::task::JoinHandle<String>,
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
            .stderr(std::process::Stdio::piped())
            // Backstop for cancellation: when the owning stream task is
            // aborted (Stop button / node delete / app close), dropping this
            // `Child` kills the subprocess instead of leaking it.
            .kill_on_drop(true);

        let mut child = command.spawn().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::Upstream(format!(
                    "`{label}` was not found on your PATH. Install it and make sure it's on \
                     PATH. Note: apps launched from Finder/Dock don't inherit your shell's \
                     PATH, so a CLI installed via Homebrew or npm may be invisible — \
                     reinstalling it or relaunching Forkly from a terminal usually fixes this."
                ))
            } else {
                AppError::Upstream(format!("spawn {label}: {e}"))
            }
        })?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::Other(format!("{label} stdout missing")))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AppError::Other(format!("{label} stderr missing")))?;

        // Drain stderr CONCURRENTLY from spawn time. If stderr is only read
        // after the stdout loop finishes, a CLI that writes more than one pipe
        // buffer (~64KB) to stderr blocks on the full pipe, stops writing
        // stdout, and our stdout read loop deadlocks forever waiting for bytes
        // that never come.
        let stderr_task = tokio::spawn(drain_to_string(stderr, STDERR_CAP));

        Ok(Self {
            child,
            lines: BufReader::new(stdout).lines(),
            stderr_task,
        })
    }

    /// Wait for the process, collect the concurrently-drained stderr, and turn
    /// a non-zero exit into a nicely-formatted `AppError::Upstream`.
    /// `terminal_error` is the caller's "parsed an error event mid-stream"
    /// message — it takes precedence over an exit-code error because it's
    /// usually more specific.
    pub async fn finish(mut self, label: &str, terminal_error: Option<String>) -> AppResult<()> {
        let status_res = self.child.wait().await;
        // The drain task finishes when stderr hits EOF (i.e. at process exit).
        let stderr_text = self.stderr_task.await.unwrap_or_default();

        let status = status_res.map_err(|e| AppError::Upstream(format!("wait {label}: {e}")))?;

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
        self.stderr_task.abort();
    }
}

async fn drain_to_string<R: tokio::io::AsyncRead + Unpin>(reader: R, cap: usize) -> String {
    let mut s = String::new();
    let mut r = BufReader::new(reader);
    let mut line = String::new();
    loop {
        line.clear();
        match r.read_line(&mut line).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                if s.len() < cap {
                    s.push_str(&line);
                }
                // Past the cap we keep reading (to drain the pipe and let the
                // child exit) but stop accumulating.
            }
        }
    }
    s
}

/// Build a `Command` for a CLI tool, hardened for GUI-launch contexts.
///
/// macOS apps started from Finder/Dock inherit only a minimal PATH
/// (`/usr/bin:/bin:/usr/sbin:/sbin`), so `claude`/`codex` installed via
/// Homebrew (`/opt/homebrew/bin`) or npm-global (`~/.local/bin`, …) are
/// invisible to a bare `Command::new("claude")`. We (1) resolve the program
/// to an absolute path against an augmented PATH and (2) export that augmented
/// PATH to the child so the tool's own `node`/subprocess dependencies resolve
/// too.
pub fn command(program: &str) -> Command {
    let path = augmented_path();
    let mut cmd = match resolve_program(program, &path) {
        Some(abs) => Command::new(abs),
        None => Command::new(program),
    };
    cmd.env("PATH", &path);
    cmd
}

/// The inherited PATH with common developer-tool bin directories prepended.
fn augmented_path() -> OsString {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        for sub in [
            ".local/bin",
            ".bun/bin",
            ".deno/bin",
            ".volta/bin",
            ".cargo/bin",
            ".npm-global/bin",
            "bin",
        ] {
            dirs.push(home.join(sub));
        }
    }
    for p in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ] {
        dirs.push(PathBuf::from(p));
    }
    // Append the inherited PATH last so anything we didn't add explicitly is
    // still reachable.
    if let Some(existing) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&existing));
    }
    std::env::join_paths(dirs).unwrap_or_else(|_| std::env::var_os("PATH").unwrap_or_default())
}

/// Resolve a bare program name to an absolute path against `path`. Returns
/// `None` for names that already contain a separator (trust them as-is) or
/// that aren't found (let spawn fail with our friendly NotFound message).
fn resolve_program(program: &str, path: &OsString) -> Option<PathBuf> {
    if program.contains('/') || program.contains('\\') {
        return None;
    }
    for dir in std::env::split_paths(path) {
        let candidate = dir.join(program);
        if candidate.is_file() {
            return Some(candidate);
        }
        #[cfg(windows)]
        for ext in ["exe", "cmd", "bat"] {
            let c = dir.join(format!("{program}.{ext}"));
            if c.is_file() {
                return Some(c);
            }
        }
    }
    None
}
