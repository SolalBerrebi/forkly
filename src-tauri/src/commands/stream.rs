use crate::commands::messages::{build_history, insert_message, update_message_content};
use crate::commands::secrets::read_api_key;
use crate::error::{AppError, AppResult};
use crate::providers::{
    anthropic::stream_chat as stream_chat_api,
    claude_code::stream_chat as stream_chat_cc,
    ApiStreamRequest, ChatMessage, ClaudeCodeRequest, StreamEvent,
};
use crate::types::{Message, Session};
use crate::AppState;
use serde::Serialize;
use sqlx::SqlitePool;
use std::fmt::Write as _;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StreamStartPayload {
    pub session_id: String,
    pub user_message: Message,
    pub assistant_message: Message,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StreamDeltaPayload {
    pub session_id: String,
    pub assistant_message_id: String,
    pub delta: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StreamDonePayload {
    pub session_id: String,
    pub assistant_message_id: String,
    pub content: String,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StreamErrorPayload {
    pub session_id: String,
    pub assistant_message_id: Option<String>,
    pub error: String,
}

/// What transport is in play for this turn — decided up front, after we know
/// the session row but before we touch the DB or the network.
enum Dispatch {
    Api(ApiStreamRequest),
    ClaudeCode(ClaudeCodeRequest),
}

#[tauri::command]
pub async fn start_stream(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    user_message: String,
) -> AppResult<()> {
    let pool = state.db().await?.clone();

    // 1. Look up session
    let session = sqlx::query_as::<_, Session>(
        "SELECT id, title, provider_id, model_id, transport_id, system_prompt,
                position_x, position_y, parent_session_id, fork_point_message_id,
                merge_source_session_ids, workspace_id, created_at, updated_at
         FROM sessions WHERE id = ?",
    )
    .bind(&session_id)
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("session {session_id}")))?;

    // 2. Determine if this is a continuation of an existing CC session, BEFORE
    //    we persist the new user message (which would otherwise contaminate
    //    the count). Only meaningful for transport=claude-code.
    let prior_message_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM messages WHERE session_id = ?",
    )
    .bind(&session.id)
    .fetch_one(&pool)
    .await?;

    // 3. Pre-flight: read transport-specific auth BEFORE any destructive writes.
    //    If auth fails, the user message never gets persisted — clean failure.
    let api_key = if session.transport_id == "api" {
        Some(read_api_key(&session.provider_id)?)
    } else if session.transport_id != "claude-code" {
        return Err(AppError::BadRequest(format!(
            "unsupported transport: {}",
            session.transport_id
        )));
    } else {
        None
    };

    // 4. If this is the first turn of a merge node, REPLACE the incoming
    //    user_message with a synthesis prompt built from the source nodes'
    //    final assistant responses. Frontend can call start_stream(merge_id, "")
    //    right after merge_sessions; the synthesis content lives entirely
    //    on the backend so prompt-engineering doesn't leak into the UI.
    let is_merge_first_turn = session.merge_source_session_ids.is_some()
        && prior_message_count == 0;
    let user_message = if is_merge_first_turn {
        build_synthesis_prompt(&pool, &session).await?
    } else {
        user_message
    };

    // 5. Persist user message.
    let user_msg =
        insert_message(&pool, &session.id, "user", &user_message, None, None).await?;

    // 5. Build the full conversation history (now includes the user message
    //    we just persisted). Used by both transports:
    //      - API: the canonical `messages` array sent to /v1/messages
    //      - CC fork's first turn: the inherited portion gets prepended as
    //        a prelude inside the new user message, because Claude Code's
    //        --input-format stream-json does NOT accept assistant turns as
    //        actual prior turns (probed 2026-05-27).
    let history = build_history(&pool, &session.id).await?;

    // 6. Build the dispatch.
    let dispatch = match session.transport_id.as_str() {
        "api" => Dispatch::Api(ApiStreamRequest {
            model: session.model_id.clone(),
            system_prompt: session.system_prompt.clone(),
            messages: history
                .iter()
                .filter(|m| m.role != "system")
                .map(|m| ChatMessage {
                    role: m.role.clone(),
                    content: m.content.clone(),
                })
                .collect(),
            max_tokens: 4096,
            api_key: api_key.expect("api_key resolved above"),
        }),
        "claude-code" => {
            let is_fork_first_turn =
                session.parent_session_id.is_some() && prior_message_count == 0;

            let cc_user_message = if is_fork_first_turn {
                // Inherited history = everything in `history` except the
                // just-persisted user message (which is the last element).
                let inherited = &history[..history.len().saturating_sub(1)];
                format_fork_prelude(inherited, &user_message)
            } else {
                user_message.clone()
            };

            Dispatch::ClaudeCode(ClaudeCodeRequest {
                model: session.model_id.clone(),
                system_prompt: session.system_prompt.clone(),
                user_message: cc_user_message,
                session_id: session.id.clone(),
                is_resume: prior_message_count > 0,
            })
        }
        _ => unreachable!("validated above"),
    };

    // 6. Persist an empty assistant message; we'll fill content as we stream.
    let assistant_msg = insert_message(
        &pool,
        &session.id,
        "assistant",
        "",
        Some(&session.provider_id),
        Some(&session.model_id),
    )
    .await?;

    // 7. Notify frontend so it can render both bubbles immediately.
    app.emit(
        "stream:start",
        StreamStartPayload {
            session_id: session.id.clone(),
            user_message: user_msg,
            assistant_message: assistant_msg.clone(),
        },
    )
    .ok();

    // 8. Spawn the streaming task; returns immediately.
    let app_for_task = app.clone();
    let session_id_for_task = session.id.clone();
    let assistant_id = assistant_msg.id.clone();

    tauri::async_runtime::spawn(async move {
        let (tx, mut rx) = mpsc::channel::<StreamEvent>(64);

        // Drive the provider in a sub-task so we can consume events concurrently.
        let provider_handle = match dispatch {
            Dispatch::Api(req) => tauri::async_runtime::spawn(stream_chat_api(req, tx)),
            Dispatch::ClaudeCode(req) => tauri::async_runtime::spawn(stream_chat_cc(req, tx)),
        };

        let mut accumulated = String::new();
        let mut input_tokens: Option<i64> = None;
        let mut output_tokens: Option<i64> = None;

        while let Some(ev) = rx.recv().await {
            match ev {
                StreamEvent::Delta(text) => {
                    accumulated.push_str(&text);
                    app_for_task
                        .emit(
                            "stream:delta",
                            StreamDeltaPayload {
                                session_id: session_id_for_task.clone(),
                                assistant_message_id: assistant_id.clone(),
                                delta: text,
                            },
                        )
                        .ok();
                }
                StreamEvent::Usage {
                    input_tokens: it,
                    output_tokens: ot,
                } => {
                    input_tokens = it;
                    output_tokens = ot;
                }
                StreamEvent::Done => break,
            }
        }

        let provider_result = match provider_handle.await {
            Ok(r) => r,
            Err(je) => Err(AppError::Other(format!("task panic: {je}"))),
        };

        // Persist whatever we accumulated, even on error.
        let _ = update_message_content(
            &pool,
            &assistant_id,
            &accumulated,
            input_tokens,
            output_tokens,
        )
        .await;

        match provider_result {
            Ok(()) => {
                app_for_task
                    .emit(
                        "stream:done",
                        StreamDonePayload {
                            session_id: session_id_for_task,
                            assistant_message_id: assistant_id,
                            content: accumulated,
                            input_tokens,
                            output_tokens,
                        },
                    )
                    .ok();
            }
            Err(e) => {
                emit_error(
                    &app_for_task,
                    &session_id_for_task,
                    Some(&assistant_id),
                    e.to_string(),
                );
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn detect_claude_code() -> crate::providers::claude_code::DetectionStatus {
    crate::providers::claude_code::detect().await
}

/// Build the synthesis prompt for a merge node's first turn — collects
/// each source session's final assistant response and asks the model to
/// distill them into a single best-of answer.
async fn build_synthesis_prompt(
    pool: &SqlitePool,
    session: &Session,
) -> AppResult<String> {
    let sources_json = session
        .merge_source_session_ids
        .as_ref()
        .ok_or_else(|| AppError::Other("merge session missing source ids".into()))?;
    let source_ids: Vec<String> = serde_json::from_str(sources_json)
        .map_err(|e| AppError::Other(format!("decode merge sources: {e}")))?;

    let mut variants = String::new();
    let mut found = 0usize;
    for (i, src_id) in source_ids.iter().enumerate() {
        let last = sqlx::query_as::<_, Message>(
            "SELECT id, session_id, role, content, provider_id, model_id,
                    input_tokens, output_tokens, position, created_at
             FROM messages
             WHERE session_id = ? AND role = 'assistant'
             ORDER BY position DESC LIMIT 1",
        )
        .bind(src_id)
        .fetch_optional(pool)
        .await?;

        if let Some(msg) = last {
            if !msg.content.trim().is_empty() {
                let _ = writeln!(variants, "VARIANT {}:\n{}\n", i + 1, msg.content);
                found += 1;
            }
        }
    }

    if found < 2 {
        return Err(AppError::BadRequest(format!(
            "merge needs at least 2 source responses, found {found}"
        )));
    }

    Ok(format!(
        "You have {} parallel responses below from different branches that diverged \
         from the same point in a conversation. Synthesize them into a single \
         best-of response: capture the strongest insights from each, note \
         meaningful differences explicitly, and present a clear conclusion. Don't \
         restate the variants verbatim — distill them.\n\n{}",
        found, variants
    ))
}

/// Render the inherited history as a prelude that gets prepended to the
/// first user message of a forked Claude Code session.
///
/// We can't pass real prior turns to `claude --input-format stream-json` —
/// it only honors user messages from stdin, not assistant messages (probed
/// 2026-05-27 on CC 2.1.152). So inherited context has to live inside the
/// new user-message string for the very first turn after a fork. Once that
/// turn lands in CC's session storage, subsequent turns can `--resume` and
/// everything chains naturally.
fn format_fork_prelude(inherited: &[Message], new_user_message: &str) -> String {
    let mut out = String::with_capacity(2048);
    out.push_str(
        "<prior_conversation>\n\
         The following exchanges happened in a parent conversation that \
         this one was forked from. Treat them as your real prior context — \
         the user already saw your earlier responses and is now asking the \
         new question below. Do not comment on the fork or repeat \
         yourself; just respond to the new message with full awareness of \
         what's been said.\n\
         ---\n",
    );
    for m in inherited {
        let role = match m.role.as_str() {
            "user" => "USER",
            "assistant" => "ASSISTANT",
            _ => continue,
        };
        let _ = writeln!(out, "{role}: {}", m.content);
        out.push('\n');
    }
    out.push_str("---\n</prior_conversation>\n\n");
    out.push_str(new_user_message);
    out
}

fn emit_error(app: &AppHandle, session_id: &str, assistant_id: Option<&str>, error: String) {
    tracing::warn!(%session_id, %error, "stream error");
    app.emit(
        "stream:error",
        StreamErrorPayload {
            session_id: session_id.to_string(),
            assistant_message_id: assistant_id.map(String::from),
            error,
        },
    )
    .ok();
}
