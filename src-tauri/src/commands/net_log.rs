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
    /// Free-form detail line shown when the row is expanded. Headers etc
    /// are pre-masked here so secrets never reach the renderer.
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
pub fn record(app: &AppHandle, entry: LogEntry) {
    let state = app.state::<AppState>();
    state.net_log.push_locked(entry.clone());
    app.emit("net-log:entry", entry).ok();
}

/// Convenience: build a fresh entry id + timestamp.
pub fn new_entry_id() -> String {
    Uuid::new_v4().to_string()
}

#[tauri::command]
pub async fn list_net_log(state: State<'_, AppState>, limit: Option<usize>) -> AppResult<Vec<LogEntry>> {
    let cap = limit.unwrap_or(RING_CAP).min(RING_CAP);
    Ok(state.net_log.snapshot(cap))
}

#[tauri::command]
pub async fn clear_net_log(state: State<'_, AppState>) -> AppResult<()> {
    state.net_log.clear();
    Ok(())
}
