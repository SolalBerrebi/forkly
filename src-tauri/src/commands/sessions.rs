use crate::db::now_ms;
use crate::error::{AppError, AppResult};
use crate::types::{CreateSessionInput, Session, UpdateSessionInput};
use crate::AppState;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

const SELECT_SESSION_COLUMNS: &str = "
    id, title, provider_id, model_id, transport_id, system_prompt,
    position_x, position_y, parent_session_id, fork_point_message_id,
    merge_source_session_ids, workspace_id,
    input_tokens_total, output_tokens_total, last_activity_at, working_dir,
    width, height, position_locked,
    pre_expand_width, pre_expand_height,
    created_at, updated_at
";

#[tauri::command]
pub async fn list_sessions(
    state: State<'_, AppState>,
    workspace_id: Option<String>,
) -> AppResult<Vec<Session>> {
    let pool = state.db().await?;
    let rows = match workspace_id {
        Some(wid) => {
            let sql = format!(
                "SELECT {SELECT_SESSION_COLUMNS} FROM sessions
                 WHERE workspace_id = ? ORDER BY created_at ASC"
            );
            sqlx::query_as::<_, Session>(&sql)
                .bind(&wid)
                .fetch_all(pool)
                .await?
        }
        None => {
            let sql = format!(
                "SELECT {SELECT_SESSION_COLUMNS} FROM sessions ORDER BY created_at ASC"
            );
            sqlx::query_as::<_, Session>(&sql).fetch_all(pool).await?
        }
    };
    Ok(rows)
}

#[tauri::command]
pub async fn create_session(
    state: State<'_, AppState>,
    input: CreateSessionInput,
) -> AppResult<Session> {
    let pool = state.db().await?;
    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    let title = input.title.unwrap_or_else(|| "untitled session".to_string());
    let transport = input
        .transport_id
        .unwrap_or_else(|| "claude-code".to_string());
    let workspace = input
        .workspace_id
        .unwrap_or_else(|| "default".to_string());
    let px = input.position_x.unwrap_or(0.0);
    let py = input.position_y.unwrap_or(0.0);

    sqlx::query(
        "INSERT INTO sessions
          (id, title, provider_id, model_id, transport_id, system_prompt,
           position_x, position_y, parent_session_id, fork_point_message_id,
           workspace_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&title)
    .bind(&input.provider_id)
    .bind(&input.model_id)
    .bind(&transport)
    .bind(&input.system_prompt)
    .bind(px)
    .bind(py)
    .bind(&input.parent_session_id)
    .bind(&input.fork_point_message_id)
    .bind(&workspace)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await?;

    fetch_session(pool, &id).await
}

#[tauri::command]
pub async fn update_session(
    state: State<'_, AppState>,
    id: String,
    patch: UpdateSessionInput,
) -> AppResult<Session> {
    let pool = state.db().await?;
    let now = now_ms();

    if let Some(title) = &patch.title {
        sqlx::query("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?")
            .bind(title)
            .bind(now)
            .bind(&id)
            .execute(pool)
            .await?;
    }
    if let Some(pid) = &patch.provider_id {
        sqlx::query("UPDATE sessions SET provider_id = ?, updated_at = ? WHERE id = ?")
            .bind(pid)
            .bind(now)
            .bind(&id)
            .execute(pool)
            .await?;
    }
    if let Some(mid) = &patch.model_id {
        sqlx::query("UPDATE sessions SET model_id = ?, updated_at = ? WHERE id = ?")
            .bind(mid)
            .bind(now)
            .bind(&id)
            .execute(pool)
            .await?;
    }
    if let Some(tid) = &patch.transport_id {
        sqlx::query("UPDATE sessions SET transport_id = ?, updated_at = ? WHERE id = ?")
            .bind(tid)
            .bind(now)
            .bind(&id)
            .execute(pool)
            .await?;
    }
    if let Some(sp) = &patch.system_prompt {
        sqlx::query("UPDATE sessions SET system_prompt = ?, updated_at = ? WHERE id = ?")
            .bind(sp)
            .bind(now)
            .bind(&id)
            .execute(pool)
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
        .execute(pool)
        .await?;
    }
    if let (Some(w), Some(h)) = (patch.width, patch.height) {
        sqlx::query(
            "UPDATE sessions SET width = ?, height = ?, updated_at = ? WHERE id = ?",
        )
        .bind(w)
        .bind(h)
        .bind(now)
        .bind(&id)
        .execute(pool)
        .await?;
    }
    if let Some(locked) = patch.position_locked {
        sqlx::query(
            "UPDATE sessions SET position_locked = ?, updated_at = ? WHERE id = ?",
        )
        .bind(locked)
        .bind(now)
        .bind(&id)
        .execute(pool)
        .await?;
    }

    fetch_session(pool, &id).await
}

#[tauri::command]
pub async fn merge_sessions(
    state: State<'_, AppState>,
    source_session_ids: Vec<String>,
    position_x: f64,
    position_y: f64,
) -> AppResult<Session> {
    if source_session_ids.len() < 2 {
        return Err(AppError::BadRequest(
            "merge needs at least 2 source sessions".into(),
        ));
    }

    let pool = state.db().await?;

    // Inherit provider / model / transport from the first source so the
    // merge node looks consistent with where it came from. (Future polish:
    // pick the "strongest" model when sources mix.)
    let first = fetch_session(pool, &source_session_ids[0]).await?;

    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    let sources_json = serde_json::to_string(&source_session_ids)
        .map_err(|e| AppError::Other(format!("encode merge sources: {e}")))?;
    let title = "synthesis";

    // Inherit workspace from the first source so merges stay in the same canvas.
    let workspace = first
        .workspace_id
        .clone()
        .unwrap_or_else(|| "default".to_string());

    sqlx::query(
        "INSERT INTO sessions
          (id, title, provider_id, model_id, transport_id, system_prompt,
           position_x, position_y, parent_session_id, fork_point_message_id,
           merge_source_session_ids, workspace_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(title)
    .bind(&first.provider_id)
    .bind(&first.model_id)
    .bind(&first.transport_id)
    .bind(&first.system_prompt)
    .bind(position_x)
    .bind(position_y)
    .bind(&sources_json)
    .bind(&workspace)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await?;

    fetch_session(pool, &id).await
}

/// Generous preset size used when a session is expanded. Chosen to look right
/// on the default 1280x820 Tauri window without overflowing it.
const EXPAND_WIDTH: f64 = 1100.0;
const EXPAND_HEIGHT: f64 = 760.0;

#[tauri::command]
pub async fn expand_session(state: State<'_, AppState>, id: String) -> AppResult<Session> {
    let pool = state.db().await?;
    let current = fetch_session(pool, &id).await?;

    // If already expanded, no-op (frontend can avoid double-trigger but be defensive).
    if current.pre_expand_width.is_some() && current.pre_expand_height.is_some() {
        return Ok(current);
    }

    let pre_w = current.width.unwrap_or(360.0);
    let pre_h = current.height.unwrap_or(460.0);
    let now = now_ms();

    sqlx::query(
        "UPDATE sessions
         SET pre_expand_width = ?,
             pre_expand_height = ?,
             width = ?,
             height = ?,
             updated_at = ?
         WHERE id = ?",
    )
    .bind(pre_w)
    .bind(pre_h)
    .bind(EXPAND_WIDTH)
    .bind(EXPAND_HEIGHT)
    .bind(now)
    .bind(&id)
    .execute(pool)
    .await?;

    fetch_session(pool, &id).await
}

#[tauri::command]
pub async fn collapse_session(state: State<'_, AppState>, id: String) -> AppResult<Session> {
    let pool = state.db().await?;
    let current = fetch_session(pool, &id).await?;

    let (restore_w, restore_h) = match (current.pre_expand_width, current.pre_expand_height) {
        (Some(w), Some(h)) => (w, h),
        _ => return Ok(current), // wasn't expanded — no-op
    };

    let now = now_ms();
    sqlx::query(
        "UPDATE sessions
         SET width = ?,
             height = ?,
             pre_expand_width = NULL,
             pre_expand_height = NULL,
             updated_at = ?
         WHERE id = ?",
    )
    .bind(restore_w)
    .bind(restore_h)
    .bind(now)
    .bind(&id)
    .execute(pool)
    .await?;

    fetch_session(pool, &id).await
}

#[tauri::command]
pub async fn delete_session(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let pool = state.db().await?;
    let result = sqlx::query("DELETE FROM sessions WHERE id = ?")
        .bind(&id)
        .execute(pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("session {id}")));
    }
    Ok(())
}

async fn fetch_session(pool: &SqlitePool, id: &str) -> AppResult<Session> {
    let sql = format!("SELECT {SELECT_SESSION_COLUMNS} FROM sessions WHERE id = ?");
    sqlx::query_as::<_, Session>(&sql)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("session {id}")))
}
