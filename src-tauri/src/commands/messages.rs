use crate::db::now_ms;
use crate::error::AppResult;
use crate::types::Message;
use crate::AppState;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

const SELECT_MESSAGE_COLUMNS: &str = "
    id, session_id, role, content, provider_id, model_id,
    input_tokens, output_tokens, position, created_at
";

#[tauri::command]
pub async fn list_messages(
    state: State<'_, AppState>,
    session_id: String,
) -> AppResult<Vec<Message>> {
    let sql = format!(
        "SELECT {SELECT_MESSAGE_COLUMNS} FROM messages
         WHERE session_id = ? ORDER BY position ASC"
    );
    let rows = sqlx::query_as::<_, Message>(&sql)
        .bind(&session_id)
        .fetch_all(state.db().await?)
        .await?;
    Ok(rows)
}

/// Build full history for a session, walking up parent chain.
/// Each parent contributes messages up to and including its fork-point.
pub async fn build_history(pool: &SqlitePool, session_id: &str) -> AppResult<Vec<Message>> {
    let session = sqlx::query_as::<_, crate::types::Session>(
        "SELECT id, title, provider_id, model_id, transport_id, system_prompt,
                position_x, position_y, parent_session_id, fork_point_message_id,
                created_at, updated_at
         FROM sessions WHERE id = ?",
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| crate::error::AppError::NotFound(format!("session {session_id}")))?;

    let own_sql = format!(
        "SELECT {SELECT_MESSAGE_COLUMNS} FROM messages
         WHERE session_id = ? ORDER BY position ASC"
    );
    let own: Vec<Message> = sqlx::query_as::<_, Message>(&own_sql)
        .bind(&session.id)
        .fetch_all(pool)
        .await?;

    match (session.parent_session_id, session.fork_point_message_id) {
        (Some(parent_id), Some(fork_msg_id)) => {
            let parent_history = Box::pin(build_history(pool, &parent_id)).await?;
            let cutoff = parent_history
                .iter()
                .position(|m| m.id == fork_msg_id)
                .map(|i| i + 1)
                .unwrap_or(parent_history.len());
            let mut combined = parent_history[..cutoff].to_vec();
            combined.extend(own);
            Ok(combined)
        }
        _ => Ok(own),
    }
}

/// Insert a new message at the next available position for the session.
pub async fn insert_message(
    pool: &SqlitePool,
    session_id: &str,
    role: &str,
    content: &str,
    provider_id: Option<&str>,
    model_id: Option<&str>,
) -> AppResult<Message> {
    let id = Uuid::new_v4().to_string();
    let now = now_ms();

    let next_pos: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM messages WHERE session_id = ?",
    )
    .bind(session_id)
    .fetch_one(pool)
    .await?;

    sqlx::query(
        "INSERT INTO messages
          (id, session_id, role, content, provider_id, model_id, position, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(session_id)
    .bind(role)
    .bind(content)
    .bind(provider_id)
    .bind(model_id)
    .bind(next_pos)
    .bind(now)
    .execute(pool)
    .await?;

    Ok(Message {
        id,
        session_id: session_id.to_string(),
        role: role.to_string(),
        content: content.to_string(),
        provider_id: provider_id.map(String::from),
        model_id: model_id.map(String::from),
        input_tokens: None,
        output_tokens: None,
        position: next_pos,
        created_at: now,
    })
}

pub async fn update_message_content(
    pool: &SqlitePool,
    id: &str,
    content: &str,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE messages SET content = ?, input_tokens = ?, output_tokens = ? WHERE id = ?",
    )
    .bind(content)
    .bind(input_tokens)
    .bind(output_tokens)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}
