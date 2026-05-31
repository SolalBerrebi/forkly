mod commands;
mod db;
mod error;
mod providers;
mod types;

use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::{Emitter, Manager};
use tokio_util::sync::CancellationToken;

/// Shared application state. The DB pool is wrapped in `OnceLock` because we
/// initialize it asynchronously after the Tauri event loop has started — doing
/// it synchronously in `setup()` blocks the macOS main thread and the window
/// never gets a chance to register.
pub struct AppState {
    db_cell: OnceLock<SqlitePool>,
    /// Set instead of `db_cell` if initialization fails, so commands can
    /// surface the *real* cause (disk/permission error, migration failure)
    /// rather than a generic timeout.
    db_error: OnceLock<String>,
    pub net_log: commands::net_log::NetLog,
    /// Cancellation tokens for in-flight streams, keyed by session id. Lets the
    /// Stop button, node deletion, and app close abort a running generation
    /// (and, via `kill_on_drop`, reap any CLI subprocess). Also doubles as a
    /// one-stream-per-session guard so concurrent turns can't corrupt Claude
    /// Code's `--resume` chain.
    active_streams: Mutex<HashMap<String, CancellationToken>>,
}

impl AppState {
    fn new() -> Self {
        Self {
            db_cell: OnceLock::new(),
            db_error: OnceLock::new(),
            net_log: commands::net_log::NetLog::new(),
            active_streams: Mutex::new(HashMap::new()),
        }
    }

    /// Returns the DB pool, waiting briefly if init hasn't completed yet.
    /// Init is fast (single SQLite open + a few migrations), so a short poll
    /// is acceptable and far simpler than a Notify-based wait. Commands that
    /// fire in the first few hundred ms after launch will hit this path.
    pub async fn db(&self) -> Result<&SqlitePool, error::AppError> {
        // Fast path: already initialized.
        if let Some(db) = self.db_cell.get() {
            return Ok(db);
        }
        // Slow path: wait up to 5s with 25ms polling. Plenty for SQLite open.
        for _ in 0..200 {
            if let Some(err) = self.db_error.get() {
                return Err(error::AppError::Other(format!(
                    "database failed to initialize: {err}"
                )));
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
            if let Some(db) = self.db_cell.get() {
                return Ok(db);
            }
        }
        if let Some(err) = self.db_error.get() {
            return Err(error::AppError::Other(format!(
                "database failed to initialize: {err}"
            )));
        }
        Err(error::AppError::Other(
            "database not initialized after 5s — check Forkly has permission to write its app-data directory".into(),
        ))
    }

    /// Register a new in-flight stream for `session_id`, returning its
    /// cancellation token. Returns `None` if one is already running (the caller
    /// should reject — a second concurrent turn corrupts CC's `--resume`).
    pub fn register_stream(&self, session_id: &str) -> Option<CancellationToken> {
        let mut map = self.active_streams.lock().ok()?;
        if map.contains_key(session_id) {
            return None;
        }
        let token = CancellationToken::new();
        map.insert(session_id.to_string(), token.clone());
        Some(token)
    }

    /// Deregister a stream once its task has finished (success or failure).
    pub fn finish_stream(&self, session_id: &str) {
        if let Ok(mut map) = self.active_streams.lock() {
            map.remove(session_id);
        }
    }

    /// Cancel a single session's in-flight stream. Returns whether one was
    /// running. Called by the Stop button and by `delete_session`.
    pub fn cancel_stream(&self, session_id: &str) -> bool {
        if let Ok(mut map) = self.active_streams.lock() {
            if let Some(token) = map.remove(session_id) {
                token.cancel();
                return true;
            }
        }
        false
    }

    /// Cancel every in-flight stream (used on app close so CLI subprocesses
    /// get reaped instead of orphaned).
    pub fn cancel_all_streams(&self) {
        if let Ok(mut map) = self.active_streams.lock() {
            for (_, token) in map.drain() {
                token.cancel();
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_target(false)
        .compact()
        .try_init()
        .ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
        .on_window_event(|window, event| {
            // Quit the whole app when the main window closes. macOS apps
            // normally stay alive in the dock, but Forkly is a single-window
            // tool and leaving a headless process around is confusing in dev.
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if window.label() == "main" {
                    // Abort in-flight streams first so any CLI subprocess gets
                    // reaped (kill_on_drop) rather than orphaned, then quit.
                    window.app_handle().state::<AppState>().cancel_all_streams();
                    window.app_handle().exit(0);
                }
            }
        })
        .setup(|app| {
            // Explicitly center, show, and focus the main window. On macOS the
            // default placement can land off-screen on multi-display setups,
            // and Tauri's auto-focus doesn't always grab user attention in
            // dev mode — making this explicit avoids "where is the window?"
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.center();
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
                // NB: deliberately no `request_user_attention(Critical)` — that
                // bounces the dock icon until the app is focused, which is
                // obnoxious for a tool the user just launched on purpose.
                #[cfg(debug_assertions)]
                window.open_devtools();
                tracing::info!("main window shown + focused");
            } else {
                tracing::error!("main window not found at setup");
            }

            let handle = app.handle().clone();
            // Spawn (not block_on!) so the main thread continues to the event
            // loop and creates the configured window.
            tauri::async_runtime::spawn(async move {
                let data_dir = match handle.path().app_data_dir() {
                    Ok(d) => d,
                    Err(e) => {
                        tracing::error!(error = %e, "app_data_dir failed");
                        return;
                    }
                };
                let db_path = data_dir.join("workspace.db");
                tracing::info!(path = %db_path.display(), "opening workspace database");
                match db::init(db_path).await {
                    Ok(pool) => {
                        let state = handle.state::<AppState>();
                        if state.db_cell.set(pool).is_err() {
                            tracing::error!("db already initialized — unexpected");
                        } else {
                            tracing::info!("workspace database ready");
                        }
                    }
                    Err(e) => {
                        tracing::error!(error = %e, "workspace database init failed");
                        // Record the cause so commands surface it (instead of a
                        // generic timeout) and tell the frontend so it can show
                        // a real error state rather than an empty canvas.
                        let state = handle.state::<AppState>();
                        let _ = state.db_error.set(e.to_string());
                        let _ = handle.emit("app:db-error", e.to_string());
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::sessions::list_sessions,
            commands::sessions::create_session,
            commands::sessions::update_session,
            commands::sessions::merge_sessions,
            commands::sessions::expand_session,
            commands::sessions::collapse_session,
            commands::sessions::delete_session,
            commands::messages::list_messages,
            commands::secrets::has_api_key,
            commands::secrets::set_api_key,
            commands::secrets::delete_api_key,
            commands::stream::start_stream,
            commands::stream::stop_stream,
            commands::stream::detect_claude_code,
            commands::stream::detect_codex,
            commands::stream::detect_ollama,
            commands::terminal::run_in_terminal,
            commands::titling::auto_title,
            commands::workspaces::list_workspaces,
            commands::workspaces::create_workspace,
            commands::workspaces::rename_workspace,
            commands::workspaces::delete_workspace,
            commands::git::git_branch_for,
            commands::net_log::list_net_log,
            commands::net_log::clear_net_log,
            commands::cc_sessions::list_cc_projects,
            commands::cc_sessions::list_cc_sessions,
            commands::cc_sessions::import_cc_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
