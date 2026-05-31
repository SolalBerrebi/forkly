//! In-process ring buffer for outbound LLM calls. Used by the network-log
//! drawer (M7-A): every start_stream invocation pushes an entry summarizing
//! the call (transport, model, status, duration, token usage) so the user
//! can SEE that "your conversations never leave your machine except to the
//! provider you choose" is literally true.
//!
//! Buffer is bounded at 500 entries — older ones drop silently.

use crate::error::AppResult;
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

pub const RING_CAP: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: String,
    pub timestamp_ms: i64,
    /// "api" | "claude-code" | (future providers)
    pub transport: String,
    /// e.g. "POST /v1/messages" or "claude --print --model …"
    pub method: String,
    /// "streaming" while in flight, "ok" / "error: …" once finished.
    pub status: String,
    pub duration_ms: Option<i64>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub session_id: Option<String>,
    /// Free-form detail line shown when the row is expanded. Run through
    /// [`mask_secrets`] in [`record`] so an API key can never reach the
    /// renderer even if a future change starts logging request URLs/headers —
    /// the Gemini key rides in the request URL, so this is not hypothetical.
    pub detail: Option<String>,
}

pub struct NetLog {
    inner: Mutex<VecDeque<LogEntry>>,
}

impl NetLog {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(VecDeque::with_capacity(RING_CAP)),
        }
    }

    fn push_locked(&self, entry: LogEntry) {
        if let Ok(mut buf) = self.inner.lock() {
            if buf.len() >= RING_CAP {
                buf.pop_front();
            }
            buf.push_back(entry);
        }
    }

    pub fn snapshot(&self, limit: usize) -> Vec<LogEntry> {
        let buf = match self.inner.lock() {
            Ok(b) => b,
            Err(_) => return Vec::new(),
        };
        let start = buf.len().saturating_sub(limit);
        buf.iter().skip(start).cloned().collect()
    }

    pub fn clear(&self) {
        if let Ok(mut buf) = self.inner.lock() {
            buf.clear();
        }
    }
}

/// Push a new entry into the ring AND emit a Tauri event so the frontend
/// drawer can append in real time without polling.
///
/// `status` and `detail` are scrubbed through [`mask_secrets`] here so a key
/// can never reach the log buffer or the renderer, regardless of which
/// provider produced the strings.
pub fn record(app: &AppHandle, mut entry: LogEntry) {
    entry.status = mask_secrets(&entry.status);
    entry.detail = entry.detail.map(|d| mask_secrets(&d));
    let state = app.state::<AppState>();
    state.net_log.push_locked(entry.clone());
    app.emit("net-log:entry", entry).ok();
}

/// Convenience: build a fresh entry id + timestamp.
pub fn new_entry_id() -> String {
    Uuid::new_v4().to_string()
}

/// Redact anything that looks like an API key/token from a string before it's
/// shown in the network log or surfaced as an error message.
///
/// Today no secret reaches these strings, but the Gemini API key travels in
/// the request URL (`?key=AIza…`), and a `reqwest` error's `Display` echoes
/// the URL — so an upstream connection error would otherwise leak the key into
/// the log and the user-facing error. This enforces the invariant rather than
/// trusting every future caller to remember it.
pub fn mask_secrets(input: &str) -> String {
    let mut out = redact_after(input, "key=");
    out = redact_after(&out, "Bearer ");
    for prefix in ["sk-ant-", "sk-", "AIza"] {
        out = redact_prefixed(&out, prefix);
    }
    out
}

/// Replace the value following `marker` (up to a delimiter) with `…`.
fn redact_after(s: &str, marker: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(idx) = rest.find(marker) {
        result.push_str(&rest[..idx]);
        result.push_str(marker);
        result.push('…');
        let after = &rest[idx + marker.len()..];
        let val_len = after
            .char_indices()
            .take_while(|(_, c)| {
                !c.is_whitespace() && !matches!(c, '&' | '"' | '\'' | ')' | '}' | ']')
            })
            .map(|(i, c)| i + c.len_utf8())
            .last()
            .unwrap_or(0);
        rest = &after[val_len..];
    }
    result.push_str(rest);
    result
}

/// Replace `prefix` + its trailing key-ish run (alphanumeric / `-` / `_`) with
/// `prefix…`, anywhere it occurs.
fn redact_prefixed(s: &str, prefix: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(idx) = rest.find(prefix) {
        result.push_str(&rest[..idx]);
        result.push_str(prefix);
        result.push('…');
        let after = &rest[idx + prefix.len()..];
        let key_len = after
            .char_indices()
            .take_while(|(_, c)| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
            .map(|(i, c)| i + c.len_utf8())
            .last()
            .unwrap_or(0);
        rest = &after[key_len..];
    }
    result.push_str(rest);
    result
}

#[tauri::command]
pub async fn list_net_log(
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> AppResult<Vec<LogEntry>> {
    let cap = limit.unwrap_or(RING_CAP).min(RING_CAP);
    Ok(state.net_log.snapshot(cap))
}

#[tauri::command]
pub async fn clear_net_log(state: State<'_, AppState>) -> AppResult<()> {
    state.net_log.clear();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_gemini_key_in_request_url() {
        // A reqwest error's Display echoes the request URL, and Gemini's key
        // rides in that URL — the sharpest leak this guards.
        let s = "gemini request: error sending request for url \
                 (https://generativelanguage.googleapis.com/v1beta/models/\
                 gemini-2.0-flash:streamGenerateContent?alt=sse&key=AIzaSyA1b2C3d4E5f6G7h8)";
        let masked = mask_secrets(s);
        assert!(
            !masked.contains("AIzaSyA1b2C3d4E5f6G7h8"),
            "key leaked: {masked}"
        );
        assert!(masked.contains("key=…"));
        // Non-secret context is preserved so the log stays useful.
        assert!(masked.contains("streamGenerateContent"));
    }

    #[test]
    fn masks_bearer_and_key_prefixes() {
        assert!(!mask_secrets("authorization: Bearer sk-proj-abc123def").contains("abc123def"));
        assert!(!mask_secrets("x-api-key: sk-ant-api03-zzz999").contains("api03-zzz999"));
        assert!(!mask_secrets("stray AIzaSyDEADBEEF token").contains("AIzaSyDEADBEEF"));
    }

    #[test]
    fn leaves_ordinary_text_untouched() {
        let s = "anthropic 429 Too Many Requests: rate limited, retry shortly";
        assert_eq!(mask_secrets(s), s);
    }
}
