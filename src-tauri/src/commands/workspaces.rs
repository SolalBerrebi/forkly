use crate::db::now_ms;
use crate::error::{AppError, AppResult};
use crate::types::Workspace;
use crate::AppState;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

const SELECT_WORKSPACE_COLUMNS: &str = "id, name, sort_order, created_at, updated_at";

#[tauri::command]
pub async fn list_workspaces(state: State<'_, AppState>) -> AppResult<Vec<Workspace>> {
    let pool = state.db().await?;
    let sql = format!(
        "SELECT {SELECT_WORKSPACE_COLUMNS} FROM workspaces
         ORDER BY sort_order ASC, created_at ASC"
    );
    let rows = sqlx::query_as::<_, Workspace>(&sql).fetch_all(pool).await?;
    Ok(rows)
}

#[tauri::command]
pub async fn create_workspace(
    state: State<'_, AppState>,
    name: String,
) -> AppResult<Workspace> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest("workspace name cannot be empty".into()));
    }

    let pool = state.db().await?;
    let id = Uuid::new_v4().to_string();
    let now = now_ms();

    // New workspaces go to the end of the list.
    let next_order: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM workspaces",
    )
    .fetch_one(pool)
    .await?;

    sqlx::query(
        "INSERT INTO workspaces (id, name, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(trimmed)
    .bind(next_order)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await?;

    fetch_workspace(pool, &id).await
}

#[tauri::command]
pub async fn rename_workspace(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> AppResult<Workspace> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest("workspace name cannot be empty".into()));
    }
    let pool = state.db().await?;
    let now = now_ms();
    let result = sqlx::query(
        "UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?",
    )
    .bind(trimmed)
    .bind(now)
    .bind(&id)
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("workspace {id}")));
    }
    fetch_workspace(pool, &id).await
}

/// Delete a workspace and every session it contains. Refuses to delete the
/// last workspace — there must always be at least one canvas to land on.
/// Returns the remaining workspace ids (sorted) so the frontend can pick a
/// new "current" workspace.
#[tauri::command]
pub async fn delete_workspace(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<Vec<String>> {
    let pool = state.db().await?;

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workspaces")
        .fetch_one(pool)
        .await?;
    if count <= 1 {
        return Err(AppError::BadRequest(
            "can't delete the last workspace — Forkly needs at least one canvas".into(),
        ));
    }

    // App-layer cascade: delete every session that lived in this workspace.
    // The messages FK on sessions cascades transitively, so messages go too.
    sqlx::query("DELETE FROM sessions WHERE workspace_id = ?")
        .bind(&id)
        .execute(pool)
        .await?;

    let result = sqlx::query("DELETE FROM workspaces WHERE id = ?")
        .bind(&id)
        .execute(pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("workspace {id}")));
    }

    let remaining: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM workspaces ORDER BY sort_order ASC, created_at ASC",
    )
    .fetch_all(pool)
    .await?;
    Ok(remaining)
}

async fn fetch_workspace(pool: &SqlitePool, id: &str) -> AppResult<Workspace> {
    let sql = format!("SELECT {SELECT_WORKSPACE_COLUMNS} FROM workspaces WHERE id = ?");
    sqlx::query_as::<_, Workspace>(&sql)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("workspace {id}")))
}
