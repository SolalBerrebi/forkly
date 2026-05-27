mod commands;
mod db;
mod error;
mod types;

use sqlx::SqlitePool;
use tauri::Manager;

pub struct AppState {
    pub db: SqlitePool,
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
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let data_dir = handle
                    .path()
                    .app_data_dir()
                    .expect("app_data_dir resolves on supported platforms");
                let db_path = data_dir.join("workspace.db");
                tracing::info!(path = %db_path.display(), "opening workspace database");
                let pool = db::init(db_path)
                    .await
                    .expect("workspace database init must succeed");
                handle.manage(AppState { db: pool });
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::sessions::list_sessions,
            commands::sessions::create_session,
            commands::sessions::update_session,
            commands::sessions::delete_session,
            commands::messages::list_messages,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
