//! Auto-title a session by asking a cheap Haiku call to summarize the first
//! exchange in 4 words. Called from the frontend right after the first
//! assistant message of a session completes streaming.
//!
//! We use a dedicated short-lived `claude --print` subprocess with
//! --no-session-persistence so it doesn't pollute CC's own session storage.
//! The titling call runs in parallel with whatever the user does next.

use crate::commands::messages::build_history;
use crate::db::now_ms;
use crate::error::{AppError, AppResult};
use crate::providers::cli_runner;
use crate::types::Message;
use crate::AppState;
use std::process::Stdio;
use tauri::State;

const TITLING_MODEL: &str = "haiku";

const TITLING_PROMPT: &str = "Summarize the following exchange as a session title. \
    Rules: at most 4 words, lowercase, no punctuation, no quotes, no emoji. \
    Respond with ONLY the title text on a single line, nothing else.";

#[tauri::command]
pub async fn auto_title(state: State<'_, AppState>, session_id: String) -> AppResult<String> {
    let pool = state.db().await?;

    let history = build_history(pool, &session_id).await?;
    if history.is_empty() {
        return Err(AppError::BadRequest("no messages to title from".into()));
    }

    // Build a compact transcript. Cap each turn so a long response doesn't
    // blow the model's context for what's just a titling call.
    let mut transcript = String::new();
    for m in history.iter().take(4) {
        let role = match m.role.as_str() {
            "user" => "USER",
            "assistant" => "ASSISTANT",
            _ => continue,
        };
        let content = if m.content.chars().count() > 400 {
            let truncated: String = m.content.chars().take(400).collect();
            format!("{truncated}…")
        } else {
            m.content.clone()
        };
        transcript.push_str(&format!("{role}: {content}\n\n"));
    }

    let full_prompt = format!("{TITLING_PROMPT}\n\nEXCHANGE:\n{transcript}");

    // Prefer a model-generated title via the Claude CLI. If Claude isn't
    // available (not installed / not logged in — common for users on Codex,
    // API keys, or Ollama only) or returns nothing usable, fall back to a
    // title derived from the first user message so EVERY session still gets a
    // real label instead of being stuck on a default placeholder.
    let cleaned = match run_claude_titling(&full_prompt).await {
        Ok(raw) => {
            let c = sanitize_title(&raw);
            if c.is_empty() {
                fallback_title(&history)
            } else {
                c
            }
        }
        Err(e) => {
            tracing::info!(error = %e, "auto-title via claude unavailable; using first-message fallback");
            fallback_title(&history)
        }
    };

    if cleaned.is_empty() {
        return Err(AppError::Other("could not derive a title".into()));
    }

    let now = now_ms();
    sqlx::query("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?")
        .bind(&cleaned)
        .bind(now)
        .bind(&session_id)
        .execute(pool)
        .await?;

    Ok(cleaned)
}

/// Run the cheap Haiku titling call via the Claude CLI. Returns the raw
/// (unsanitized) stdout, or an error if the CLI is missing / not logged in /
/// exits non-zero.
async fn run_claude_titling(full_prompt: &str) -> AppResult<String> {
    let output = cli_runner::command("claude")
        .arg("--print")
        .arg("--no-session-persistence")
        .arg("--allowedTools")
        .arg("")
        .arg("--model")
        .arg(TITLING_MODEL)
        .arg(full_prompt)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| AppError::Upstream(format!("spawn claude for titling: {e}")))?;

    if !output.status.success() {
        let err_text = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Upstream(format!(
            "titling claude failed ({}): {}",
            output.status,
            err_text.chars().take(200).collect::<String>()
        )));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Deterministic fallback: the first user message squeezed through the same
/// sanitizer (≤4 lowercase words) the model output goes through.
fn fallback_title(history: &[Message]) -> String {
    let first_user = history
        .iter()
        .find(|m| m.role == "user")
        .map(|m| m.content.as_str())
        .unwrap_or("");
    sanitize_title(first_user)
}

/// Coerce Haiku's response into a clean 4-word lowercase title even if it
/// adds quotes, punctuation, or an explanatory preamble.
fn sanitize_title(raw: &str) -> String {
    // Take only the first line — if the model wrote a preamble, we want
    // just the title that follows.
    let first_line = raw.lines().next().unwrap_or("").trim();

    // Strip surrounding quotes / brackets / leading "Title:" labels.
    let stripped = first_line
        .trim_start_matches(|c: char| !c.is_alphanumeric())
        .trim_end_matches(|c: char| !c.is_alphanumeric())
        .trim_start_matches("Title:")
        .trim_start_matches("title:")
        .trim();

    // Keep at most 4 words, drop trailing punctuation per word, lowercase.
    let words: Vec<String> = stripped
        .split_whitespace()
        .take(4)
        .map(|w| {
            w.trim_matches(|c: char| !c.is_alphanumeric())
                .to_lowercase()
        })
        .filter(|w| !w.is_empty())
        .collect();

    words.join(" ")
}
