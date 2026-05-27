mod commands;
mod db;
mod error;
mod providers;
mod types;

use sqlx::SqlitePool;
use std::sync::OnceLock;
use tauri::Manager;

/// Shared application state. The DB pool is wrapped in `OnceLock` because we
/// initialize it asynchronously after the Tauri event loop has started — doing
/// it synchronously in `setup()` blocks the macOS main thread and the window
/// never gets a chance to register.
pub struct AppState {
    db_cell: OnceLock<SqlitePool>,
}

impl AppState {
    fn new() -> Self {
        Self {
            db_cell: OnceLock::new(),
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
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
            if let Some(db) = self.db_cell.get() {
                return Ok(db);
            }
        }
        Err(error::AppError::Other(
            "database not initialized after 5s — startup likely panicked".into(),
        ))
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
                    window.app_handle().exit(0);
                }
            }
        })
        .setup(|app| {
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
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::sessions::list_sessions,
            commands::sessions::create_session,
            commands::sessions::update_session,
            commands::sessions::delete_session,
            commands::messages::list_messages,
            commands::secrets::has_api_key,
            commands::secrets::set_api_key,
            commands::secrets::delete_api_key,
            commands::stream::start_stream,
            commands::stream::detect_claude_code,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
