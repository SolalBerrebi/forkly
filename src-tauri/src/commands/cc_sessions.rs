//! Live-linked import of existing Claude Code sessions from
//! `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`.
//!
//! "Live-linked" = the Forkly session uses the same UUID as the CC session,
//! so subsequent turns in Forkly `claude --resume <uuid>` and append to the
//! same JSONL file on disk. Imports never duplicate or rewrite CC's data.
//!
//! Each .jsonl line is a JSON event. We care about the ones with type
//! "user" or "assistant" and ignore everything else (queue-operation,
//! system, summary, etc.). message.content can be a plain string OR an
//! array of typed content blocks — we flatten to plain text.

use crate::commands::messages::insert_message;
use crate::db::now_ms;
use crate::error::{AppError, AppResult};
use crate::types::Session;
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::State;
use tokio::io::AsyncBufReadExt;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcProject {
    /// Folder name as it appears on disk (`-Users-solalberrebi-Desktop-Projects-Forkly`).
    pub encoded_dir: String,
    /// Real cwd from the first line of any session JSONL we can peek.
    pub cwd: Option<String>,
    /// Last path segment of cwd, suitable for the modal's left-pane list.
    pub display_name: String,
    pub session_count: usize,
    /// Last modified time across the project's session files (ms epoch).
    pub last_activity_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSessionSummary {
    /// Filename UUID — the CC session id.
    pub session_id: String,
    pub last_activity_ms: i64,
    pub message_count: usize,
    /// First user message, truncated for the preview list.
    pub first_user_message: Option<String>,
    /// Last seen model id (from any assistant message).
    pub model_id: Option<String>,
}

/// Cwd from .jsonl preview is best-effort; bail silently on unreadable
/// files rather than erroring the whole listing.
#[derive(Deserialize)]
struct JsonlPeek {
    cwd: Option<String>,
}

fn projects_root() -> AppResult<PathBuf> {
    // Resolve home from $HOME (Unix) / %USERPROFILE% (Windows). Avoids a
    // dirs-crate dependency just for this one path.
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| AppError::Other("could not resolve home directory".into()))?;
    Ok(PathBuf::from(home).join(".claude").join("projects"))
}

#[tauri::command]
pub async fn list_cc_projects() -> AppResult<Vec<CcProject>> {
    let root = projects_root()?;
    if !root.is_dir() {
        return Ok(Vec::new()); // no CC installed / no sessions yet
    }

    let mut out = Vec::new();
    let entries = fs::read_dir(&root)
        .map_err(|e| AppError::Other(format!("read ~/.claude/projects: {e}")))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let encoded_dir = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        if encoded_dir.is_empty() {
            continue;
        }

        // List .jsonl files inside, capture last_modified + cwd peek.
        let mut session_count = 0;
        let mut last_activity_ms: i64 = 0;
        let mut cwd_hint: Option<String> = None;
        if let Ok(files) = fs::read_dir(&path) {
            for f in files.flatten() {
                let fp = f.path();
                if fp.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                    continue;
                }
                session_count += 1;
                if let Ok(meta) = f.metadata() {
                    if let Ok(modified) = meta.modified() {
                        if let Ok(d) = modified.duration_since(std::time::UNIX_EPOCH) {
                            let ms = d.as_millis() as i64;
                            if ms > last_activity_ms {
                                last_activity_ms = ms;
                            }
                        }
                    }
                }
                if cwd_hint.is_none() {
                    cwd_hint = peek_cwd(&fp);
                }
            }
        }

        if session_count == 0 {
            continue;
        }

        let display_name = cwd_hint
            .as_deref()
            .and_then(|c| c.rsplit('/').next())
            .unwrap_or(&encoded_dir)
            .to_string();

        out.push(CcProject {
            encoded_dir,
            cwd: cwd_hint,
            display_name,
            session_count,
            last_activity_ms,
        });
    }

    // Most-recently-touched first.
    out.sort_by(|a, b| b.last_activity_ms.cmp(&a.last_activity_ms));
    Ok(out)
}

fn peek_cwd(path: &std::path::Path) -> Option<String> {
    use std::io::{BufRead, BufReader};
    let f = fs::File::open(path).ok()?;
    let mut reader = BufReader::new(f);
    // The cwd is usually on the second or third line (the first is often a
    // queue-operation). Peek up to 5 lines.
    let mut line = String::new();
    for _ in 0..5 {
        line.clear();
        let n = reader.read_line(&mut line).ok()?;
        if n == 0 {
            return None;
        }
        if let Ok(parsed) = serde_json::from_str::<JsonlPeek>(&line) {
            if let Some(cwd) = parsed.cwd {
                if !cwd.is_empty() {
                    return Some(cwd);
                }
            }
        }
    }
    None
}

#[tauri::command]
pub async fn list_cc_sessions(project_dir: String) -> AppResult<Vec<CcSessionSummary>> {
    let root = projects_root()?;
    let dir = root.join(&project_dir);
    if !dir.is_dir() {
        return Err(AppError::NotFound(format!("cc project {project_dir}")));
    }

    let mut out = Vec::new();
    let entries = fs::read_dir(&dir)
        .map_err(|e| AppError::Other(format!("read project dir: {e}")))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let session_id = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };

        let last_activity_ms = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let (message_count, first_user_message, model_id) = summarize_jsonl(&path);

        out.push(CcSessionSummary {
            session_id,
            last_activity_ms,
            message_count,
            first_user_message,
            model_id,
        });
    }

    out.sort_by(|a, b| b.last_activity_ms.cmp(&a.last_activity_ms));
    Ok(out)
}

fn summarize_jsonl(path: &std::path::Path) -> (usize, Option<String>, Option<String>) {
    use std::io::{BufRead, BufReader};
    let f = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return (0, None, None),
    };
    let reader = BufReader::new(f);
    let mut count = 0usize;
    let mut first_user: Option<String> = None;
    let mut model: Option<String> = None;
    for line in reader.lines().map_while(Result::ok) {
        let parsed: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let t = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if t != "user" && t != "assistant" {
            continue;
        }
        count += 1;
        if first_user.is_none() && t == "user" {
            if let Some(text) = extract_message_text(&parsed) {
                first_user = Some(text.chars().take(120).collect());
            }
        }
        if model.is_none() && t == "assistant" {
            model = parsed
                .pointer("/message/model")
                .and_then(|v| v.as_str())
                .map(String::from);
        }
    }
    (count, first_user, model)
}

/// Pulls plain text out of a JSONL line whose `.message.content` is either
/// a string or an array of typed content blocks (text / thinking / etc.).
fn extract_message_text(line: &serde_json::Value) -> Option<String> {
    let content = line.pointer("/message/content")?;
    if let Some(s) = content.as_str() {
        return Some(s.to_string());
    }
    if let Some(arr) = content.as_array() {
        let mut out = String::new();
        for block in arr {
            if block.get("type").and_then(|v| v.as_str()) == Some("text") {
                if let Some(t) = block.get("text").and_then(|v| v.as_str()) {
                    if !out.is_empty() {
                        out.push_str("\n\n");
                    }
                    out.push_str(t);
                }
            }
        }
        if !out.is_empty() {
            return Some(out);
        }
    }
    None
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCcSessionInput {
    pub project_dir: String,
    pub session_id: String,
    pub workspace_id: String,
    pub position_x: f64,
    pub position_y: f64,
}

#[tauri::command]
pub async fn import_cc_session(
    state: State<'_, AppState>,
    input: ImportCcSessionInput,
) -> AppResult<Session> {
    let root = projects_root()?;
    let path = root.join(&input.project_dir).join(format!("{}.jsonl", input.session_id));
    if !path.is_file() {
        return Err(AppError::NotFound(format!(
            "cc session {} in {}",
            input.session_id, input.project_dir
        )));
    }

    let pool = state.db().await?;

    // Refuse if a Forkly session with this id already exists — the Forkly
    // id IS the CC id, so a duplicate import would conflict.
    let exists: Option<String> =
        sqlx::query_scalar("SELECT id FROM sessions WHERE id = ?")
            .bind(&input.session_id)
            .fetch_optional(pool)
            .await?;
    if exists.is_some() {
        return Err(AppError::BadRequest(format!(
            "session {} is already imported",
            input.session_id
        )));
    }

    // Pull the cwd + model from the JSONL preview.
    let cwd = peek_cwd(&path);
    let (_, first_user, model) = summarize_jsonl(&path);
    let model_id = model.unwrap_or_else(|| "claude-sonnet-4-6".to_string());
    let title = first_user
        .as_deref()
        .map(|s| {
            // 4-word teaser to mirror auto-title's style.
            s.split_whitespace()
                .take(4)
                .collect::<Vec<_>>()
                .join(" ")
                .to_lowercase()
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "imported session".to_string());

    let now = now_ms();
    sqlx::query(
        "INSERT INTO sessions
          (id, title, provider_id, model_id, transport_id, system_prompt,
           position_x, position_y, parent_session_id, fork_point_message_id,
           merge_source_session_ids, workspace_id,
           input_tokens_total, output_tokens_total, last_activity_at, working_dir,
           width, height, position_locked,
           created_at, updated_at)
         VALUES (?, ?, 'anthropic', ?, 'claude-code', NULL,
                 ?, ?, NULL, NULL, NULL, ?,
                 0, 0, ?, ?,
                 NULL, NULL, 0,
                 ?, ?)",
    )
    .bind(&input.session_id)
    .bind(&title)
    .bind(&model_id)
    .bind(input.position_x)
    .bind(input.position_y)
    .bind(&input.workspace_id)
    .bind(now)
    .bind(&cwd)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await?;

    // Stream the JSONL and insert user/assistant messages in order.
    let file = tokio::fs::File::open(&path)
        .await
        .map_err(|e| AppError::Other(format!("open jsonl: {e}")))?;
    let mut reader = tokio::io::BufReader::new(file).lines();
    while let Some(line) = reader
        .next_line()
        .await
        .map_err(|e| AppError::Other(format!("read jsonl: {e}")))?
    {
        if line.is_empty() {
            continue;
        }
        let parsed: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let t = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if t != "user" && t != "assistant" {
            continue;
        }
        let text = match extract_message_text(&parsed) {
            Some(t) => t,
            None => continue,
        };
        let role = if t == "user" { "user" } else { "assistant" };
        let _ = insert_message(
            pool,
            &input.session_id,
            role,
            &text,
            Some("anthropic"),
            if role == "assistant" { Some(&model_id) } else { None },
        )
        .await?;
    }

    // Return the row we just inserted.
    let sql = format!(
        "SELECT {} FROM sessions WHERE id = ?",
        SESSION_SELECT
    );
    sqlx::query_as::<_, Session>(&sql)
        .bind(&input.session_id)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
}

const SESSION_SELECT: &str = "
    id, title, provider_id, model_id, transport_id, system_prompt,
    position_x, position_y, parent_session_id, fork_point_message_id,
    merge_source_session_ids, workspace_id,
    input_tokens_total, output_tokens_total, last_activity_at, working_dir,
    width, height, position_locked,
    created_at, updated_at
";
