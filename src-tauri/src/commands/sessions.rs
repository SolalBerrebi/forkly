use crate::db::now_ms;
use crate::error::{AppError, AppResult};
use crate::types::{CreateSessionInput, Session, UpdateSessionInput};
use crate::AppState;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

const SELECT_SESSION_COLUMNS: &str = "
    id, title, provider_id, model_id, system_prompt,
    position_x, position_y, parent_session_id, fork_point_message_id,
    created_at, updated_at
";

#[tauri::command]
pub async fn list_sessions(state: State<'_, AppState>) -> AppResult<Vec<Session>> {
    let sql = format!(
        "SELECT {SELECT_SESSION_COLUMNS} FROM sessions ORDER BY created_at ASC"
    );
    let rows = sqlx::query_as::<_, Session>(&sql).fetch_all(&state.db).await?;
    Ok(rows)
}

#[tauri::command]
pub async fn create_session(
    state: State<'_, AppState>,
    input: CreateSessionInput,
) -> AppResult<Session> {
    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    let title = input.title.unwrap_or_else(|| "untitled session".to_string());
    let px = input.position_x.unwrap_or(0.0);
    let py = input.position_y.unwrap_or(0.0);

    sqlx::query(
        "INSERT INTO sessions
          (id, title, provider_id, model_id, system_prompt,
           position_x, position_y, parent_session_id, fork_point_message_id,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&title)
    .bind(&input.provider_id)
    .bind(&input.model_id)
    .bind(&input.system_prompt)
    .bind(px)
    .bind(py)
    .bind(&input.parent_session_id)
    .bind(&input.fork_point_message_id)
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await?;

    fetch_session(&state.db, &id).await
}

#[tauri::command]
pub async fn update_session(
    state: State<'_, AppState>,
    id: String,
    patch: UpdateSessionInput,
) -> AppResult<Session> {
    let now = now_ms();

    if let Some(title) = &patch.title {
        sqlx::query("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?")
            .bind(title)
            .bind(now)
            .bind(&id)
            .execute(&state.db)
            .await?;
    }
    if let Some(pid) = &patch.provider_id {
        sqlx::query("UPDATE sessions SET provider_id = ?, updated_at = ? WHERE id = ?")
            .bind(pid)
            .bind(now)
            .bind(&id)
            .execute(&state.db)
            .await?;
    }
    if let Some(mid) = &patch.model_id {
        sqlx::query("UPDATE sessions SET model_id = ?, updated_at = ? WHERE id = ?")
            .bind(mid)
            .bind(now)
            .bind(&id)
            .execute(&state.db)
            .await?;
    }
    if let Some(sp) = &patch.system_prompt {
        sqlx::query("UPDATE sessions SET system_prompt = ?, updated_at = ? WHERE id = ?")
            .bind(sp)
            .bind(now)
            .bind(&id)
            .execute(&state.db)
            .await?;
    }
    if let (Some(px), Some(py)) = (patch.position_x, patch.position_y) {
        sqlx::query(
            "UPDATE sessions SET position_x = ?, position_y = ?, updated_at = ? WHERE id = ?",
        )
        .bind(px)
        .bind(py)
        .bind(now)
        .bind(&id)
        .execute(&state.db)
        .await?;
    }

    fetch_session(&state.db, &id).await
}

#[tauri::command]
pub async fn delete_session(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let result = sqlx::query("DELETE FROM sessions WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("session {id}")));
    }
    Ok(())
}

async fn fetch_session(pool: &SqlitePool, id: &str) -> AppResult<Session> {
    let sql = format!(
        "SELECT {SELECT_SESSION_COLUMNS} FROM sessions WHERE id = ?"
    );
    sqlx::query_as::<_, Session>(&sql)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("session {id}")))
}
