use crate::commands::messages::{build_history, insert_message, update_message_content};
use crate::commands::secrets::read_api_key;
use crate::error::{AppError, AppResult};
use crate::providers::anthropic::stream_chat;
use crate::providers::{ChatMessage, StreamEvent, StreamRequest};
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

#[tauri::command]
pub async fn start_stream(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    user_message: String,
) -> AppResult<()> {
    let pool = state.db.clone();

    // 1. Look up session
    let session = sqlx::query_as::<_, Session>(
        "SELECT id, title, provider_id, model_id, system_prompt,
                position_x, position_y, parent_session_id, fork_point_message_id,
                created_at, updated_at
         FROM sessions WHERE id = ?",
    )
    .bind(&session_id)
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("session {session_id}")))?;

    // 2. Read API key from keychain BEFORE doing anything destructive
    let api_key = read_api_key(&session.provider_id)?;

    // 3. Persist the user message
    let user_msg =
        insert_message(&pool, &session.id, "user", &user_message, None, None).await?;

    // 4. Build full history (now includes the user message we just added).
    //    For M2 there's no forking so this is just the session's own messages.
    let history = build_history(&pool, &session.id).await?;

    // 5. Persist an empty assistant message; we'll update its content as we stream.
    let assistant_msg = insert_message(
        &pool,
        &session.id,
        "assistant",
        "",
        Some(&session.provider_id),
        Some(&session.model_id),
    )
    .await?;

    // 6. Emit stream:start so the frontend can render both bubbles immediately.
    app.emit(
        "stream:start",
        StreamStartPayload {
            session_id: session.id.clone(),
            user_message: user_msg,
            assistant_message: assistant_msg.clone(),
        },
    )
    .ok();

    // 7. Build provider request from history.
    let messages: Vec<ChatMessage> = history
        .iter()
        .filter(|m| m.role != "system")
        .map(|m| ChatMessage {
            role: m.role.clone(),
            content: m.content.clone(),
        })
        .collect();

    let req = StreamRequest {
        model: session.model_id.clone(),
        system_prompt: session.system_prompt.clone(),
        messages,
        max_tokens: 4096,
        api_key,
    };

    // 8. Spawn the streaming task. Returns immediately; events flow via app.emit.
    let app_for_task = app.clone();
    let provider_id = session.provider_id.clone();
    let session_id_for_task = session.id.clone();
    let assistant_id = assistant_msg.id.clone();

    tauri::async_runtime::spawn(async move {
        let (tx, mut rx) = mpsc::channel::<StreamEvent>(64);

        // Run provider in a sub-task so we can receive events concurrently.
        let provider_handle = match provider_id.as_str() {
            "anthropic" => tauri::async_runtime::spawn(stream_chat(req, tx)),
            other => {
                emit_error(
                    &app_for_task,
                    &session_id_for_task,
                    Some(&assistant_id),
                    format!("unknown provider: {other}"),
                );
                return;
            }
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

        // Provider task may still be running (e.g., if we broke on Done); await it
        // to surface the real result.
        let provider_result = match provider_handle.await {
            Ok(r) => r,
            Err(join_err) => Err(AppError::Other(format!("task panic: {join_err}"))),
        };

        // Always persist whatever we accumulated, even on error.
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
