//! First-launch demo workspace.
//!
//! Seeds a small, canned fork tree into the default workspace so a brand-new
//! user lands on something that *shows* what Forkly is (fork → branch across
//! models → merge) instead of an empty canvas. It's frontend-triggered (not
//! run at startup) so a seeding bug can never break first launch, and it only
//! ever runs when the database has zero sessions.
//!
//! The content is static — no LLM calls. The cells carry real provider/model
//! ids so the node colors and model chips look right; continuing a demo cell
//! just uses that provider like any other (needs it configured).

use crate::db::now_ms;
use crate::error::AppResult;
use crate::AppState;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

const ROOT_REPLY: &str = "A few directions, depending on the vibe you want:\n\n\
- **Playful:** Jotly, Scribbl, Notey\n\
- **Minimal:** Margin, Slate, Plain\n\
- **Techy:** Cortex, Synapse, Index\n\n\
Want me to lean into one of these?";

const PLAYFUL_REPLY: &str = "Playful it is:\n\n\
1. **Jotly** — friendly and verb-y; the \"-ly\" already reads like a product.\n\
2. **Scribbl** — tactile, hints at quick capture.\n\
3. **Doodle** — warm, but it collides with Google Doodle.\n\n\
**Jotly** is the standout — easy to say, easy to brand.";

const MINIMAL_REPLY: &str = "Minimal and grown-up:\n\n\
1. **Margin** — notes in the margin; calm and a little literary.\n\
2. **Slate** — a blank slate; clean and confident.\n\
3. **Plain** — radically simple, maybe too plain.\n\n\
**Margin** is the most evocative without being literal.";

const TECHY_REPLY: &str = "For a technical audience:\n\n\
1. **Cortex** — memory/recall association; strong.\n\
2. **Synapse** — connections between notes; great for a linked-notes app.\n\
3. **Index** — precise, but generic and SEO-hostile.\n\n\
**Synapse** if linking is the core idea; **Cortex** if it's capture + recall.";

const SYNTHESIS_REPLY: &str = "**Best-of across the three branches:**\n\n\
- **Margin** (minimal) is the strongest overall — short, evocative, brandable, \
and it tells a small story about the product.\n\
- **Jotly** (playful) wins if you want warmth and approachability.\n\
- **Synapse** (techy) wins only if linking notes is the headline feature.\n\n\
**Recommendation:** ship as **Margin**, keep **Jotly** as the friendly fallback.";

/// Tauri command: seed the demo workspace if the database is empty.
/// Returns whether anything was seeded.
#[tauri::command]
pub async fn seed_demo_workspace(state: State<'_, AppState>) -> AppResult<bool> {
    let pool = state.db().await?;
    seed_demo(pool).await
}

/// Core seeding logic, separated from the command so it's unit-testable.
/// No-op (returns `false`) when any session already exists, so it never
/// overwrites real data or double-seeds.
pub async fn seed_demo(pool: &SqlitePool) -> AppResult<bool> {
    let existing: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
        .fetch_one(pool)
        .await?;
    if existing > 0 {
        return Ok(false);
    }

    let now = now_ms();
    let mut tx = pool.begin().await?;

    // Root: the original question.
    let root = Uuid::new_v4().to_string();
    ins_session(
        &mut *tx,
        &root,
        "name my notes app",
        "anthropic",
        "claude-sonnet-4-6",
        "claude-code",
        360.0,
        0.0,
        None,
        None,
        None,
        now,
    )
    .await?;
    ins_msg(
        &mut *tx,
        &root,
        "user",
        "Name my note-taking app — something short, memorable, not generic.",
        "anthropic",
        "claude-sonnet-4-6",
        0,
        now,
    )
    .await?;
    let root_reply = ins_msg(
        &mut *tx,
        &root,
        "assistant",
        ROOT_REPLY,
        "anthropic",
        "claude-sonnet-4-6",
        1,
        now,
    )
    .await?;

    // Three forks off the root's reply — each a different model/persona.
    let playful = fork(
        &mut tx,
        &root,
        &root_reply,
        "playful",
        "anthropic",
        "claude-haiku-4-5-20251001",
        "claude-code",
        -360.0,
        540.0,
        "Lean playful.",
        PLAYFUL_REPLY,
        now,
    )
    .await?;
    let minimal = fork(
        &mut tx,
        &root,
        &root_reply,
        "minimal",
        "openai",
        "gpt-5.4",
        "codex",
        360.0,
        540.0,
        "Lean minimal.",
        MINIMAL_REPLY,
        now,
    )
    .await?;
    let techy = fork(
        &mut tx,
        &root,
        &root_reply,
        "techy",
        "google",
        "gemini-2.5-flash",
        "api",
        1080.0,
        540.0,
        "Lean techy.",
        TECHY_REPLY,
        now,
    )
    .await?;

    // Merge node fanning the three back into one synthesis.
    let merge = Uuid::new_v4().to_string();
    let sources = serde_json::to_string(&[playful, minimal, techy])
        .map_err(|e| crate::error::AppError::Other(format!("encode demo sources: {e}")))?;
    ins_session(
        &mut *tx,
        &merge,
        "synthesis",
        "anthropic",
        "claude-sonnet-4-6",
        "claude-code",
        360.0,
        1100.0,
        None,
        None,
        Some(&sources),
        now,
    )
    .await?;
    ins_msg(
        &mut *tx,
        &merge,
        "assistant",
        SYNTHESIS_REPLY,
        "anthropic",
        "claude-sonnet-4-6",
        0,
        now,
    )
    .await?;

    tx.commit().await?;
    Ok(true)
}

/// Insert a forked session (parent + fork point) plus its own user/assistant
/// turn. Returns the new session id.
#[allow(clippy::too_many_arguments)]
async fn fork(
    tx: &mut sqlx::SqliteConnection,
    parent: &str,
    fork_point: &str,
    title: &str,
    provider: &str,
    model: &str,
    transport: &str,
    x: f64,
    y: f64,
    user_msg: &str,
    assistant_msg: &str,
    now: i64,
) -> AppResult<String> {
    let id = Uuid::new_v4().to_string();
    ins_session(
        &mut *tx,
        &id,
        title,
        provider,
        model,
        transport,
        x,
        y,
        Some(parent),
        Some(fork_point),
        None,
        now,
    )
    .await?;
    ins_msg(&mut *tx, &id, "user", user_msg, provider, model, 0, now).await?;
    ins_msg(
        &mut *tx,
        &id,
        "assistant",
        assistant_msg,
        provider,
        model,
        1,
        now,
    )
    .await?;
    Ok(id)
}

#[allow(clippy::too_many_arguments)]
async fn ins_session<'e, E>(
    ex: E,
    id: &str,
    title: &str,
    provider: &str,
    model: &str,
    transport: &str,
    x: f64,
    y: f64,
    parent: Option<&str>,
    fork_point: Option<&str>,
    merge_sources: Option<&str>,
    now: i64,
) -> AppResult<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Sqlite>,
{
    sqlx::query(
        "INSERT INTO sessions
          (id, title, provider_id, model_id, transport_id,
           position_x, position_y, parent_session_id, fork_point_message_id,
           merge_source_session_ids, workspace_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'default', ?, ?)",
    )
    .bind(id)
    .bind(title)
    .bind(provider)
    .bind(model)
    .bind(transport)
    .bind(x)
    .bind(y)
    .bind(parent)
    .bind(fork_point)
    .bind(merge_sources)
    .bind(now)
    .bind(now)
    .execute(ex)
    .await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn ins_msg<'e, E>(
    ex: E,
    session_id: &str,
    role: &str,
    content: &str,
    provider: &str,
    model: &str,
    position: i64,
    now: i64,
) -> AppResult<String>
where
    E: sqlx::Executor<'e, Database = sqlx::Sqlite>,
{
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO messages
          (id, session_id, role, content, provider_id, model_id, position, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(session_id)
    .bind(role)
    .bind(content)
    .bind(provider)
    .bind(model)
    .bind(position)
    .bind(now)
    .execute(ex)
    .await?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn fresh_pool() -> SqlitePool {
        // Single shared in-memory connection so migrations + seed see one DB.
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn seeds_a_fork_tree_once() {
        let pool = fresh_pool().await;

        assert!(seed_demo(&pool).await.unwrap(), "should seed a fresh DB");

        let sessions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(sessions, 5, "root + 3 forks + merge");

        // Three forks point at the root's reply; the merge has source ids.
        let forks: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE parent_session_id IS NOT NULL")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(forks, 3);

        let merges: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sessions WHERE merge_source_session_ids IS NOT NULL",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(merges, 1);
    }

    #[tokio::test]
    async fn never_seeds_twice_or_over_existing_data() {
        let pool = fresh_pool().await;
        assert!(seed_demo(&pool).await.unwrap());
        // Second run is a no-op now that sessions exist.
        assert!(!seed_demo(&pool).await.unwrap());
        let sessions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(sessions, 5);
    }
}
