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
                created_at, updated_at
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

    // 3. Resolve transport-specific auth BEFORE any destructive writes.
    //    If auth fails, the user message never gets persisted — clean failure.
    let dispatch = match session.transport_id.as_str() {
        "claude-code" => Dispatch::ClaudeCode(ClaudeCodeRequest {
            model: session.model_id.clone(),
            system_prompt: session.system_prompt.clone(),
            user_message: user_message.clone(),
            session_id: session.id.clone(),
            is_resume: prior_message_count > 0,
        }),
        "api" => {
            let api_key = read_api_key(&session.provider_id)?;
            // History is built AFTER persisting the user message below.
            // Build a placeholder request now; we'll fill `messages` in step 5.
            Dispatch::Api(ApiStreamRequest {
                model: session.model_id.clone(),
                system_prompt: session.system_prompt.clone(),
                messages: vec![], // populated below
                max_tokens: 4096,
                api_key,
            })
        }
        other => {
            return Err(AppError::BadRequest(format!(
                "unsupported transport: {other}"
            )))
        }
    };

    // 4. Persist user message.
    let user_msg =
        insert_message(&pool, &session.id, "user", &user_message, None, None).await?;

    // 5. For the API transport, build the full conversation history (now
    //    includes the user message we just persisted). The CC transport
    //    doesn't need this — CC owns its own session state.
    let dispatch = match dispatch {
        Dispatch::Api(mut req) => {
            let history = build_history(&pool, &session.id).await?;
            req.messages = history
                .iter()
                .filter(|m| m.role != "system")
                .map(|m| ChatMessage {
                    role: m.role.clone(),
                    content: m.content.clone(),
                })
                .collect();
            Dispatch::Api(req)
        }
        cc => cc,
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
