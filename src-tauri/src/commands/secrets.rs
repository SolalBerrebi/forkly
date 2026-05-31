use crate::error::{AppError, AppResult};
use keyring::Entry;

const SERVICE: &str = "forkly";

fn entry_for(provider: &str) -> AppResult<Entry> {
    Entry::new(SERVICE, &format!("{provider}-api-key"))
        .map_err(|e| AppError::Other(format!("keychain entry create: {e}")))
}

/// Run a blocking keychain operation on the blocking thread pool.
///
/// `keyring` calls are synchronous and, on macOS, can round-trip through the
/// Security framework (and even surface a user prompt on first access). Doing
/// that inline in an `async` command body blocks a tokio worker thread and can
/// stall other commands — so every keychain touch goes through `spawn_blocking`.
async fn blocking<T, F>(f: F) -> AppResult<T>
where
    F: FnOnce() -> AppResult<T> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Other(format!("keychain task join: {e}")))?
}

#[tauri::command]
pub async fn has_api_key(provider: String) -> AppResult<bool> {
    blocking(move || {
        let entry = entry_for(&provider)?;
        match entry.get_password() {
            Ok(_) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(e) => Err(AppError::Other(format!("keychain read: {e}"))),
        }
    })
    .await
}

#[tauri::command]
pub async fn set_api_key(provider: String, key: String) -> AppResult<()> {
    if key.trim().is_empty() {
        return Err(AppError::BadRequest("api key cannot be empty".into()));
    }
    blocking(move || {
        let entry = entry_for(&provider)?;
        entry
            .set_password(&key)
            .map_err(|e| AppError::Other(format!("keychain write: {e}")))
    })
    .await
}

#[tauri::command]
pub async fn delete_api_key(provider: String) -> AppResult<()> {
    blocking(move || {
        let entry = entry_for(&provider)?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::Other(format!("keychain delete: {e}"))),
        }
    })
    .await
}

/// Internal: read the raw key (blocking). Never exposed as a Tauri command —
/// only the streaming task reads raw keys. Call [`read_api_key_async`] from
/// async contexts so the keychain round-trip doesn't block a worker thread.
pub fn read_api_key(provider: &str) -> AppResult<String> {
    let entry = entry_for(provider)?;
    entry.get_password().map_err(|e| match e {
        keyring::Error::NoEntry => AppError::NotFound(format!("api key for {provider}")),
        other => AppError::Other(format!("keychain read: {other}")),
    })
}

/// Async wrapper around [`read_api_key`] for use inside async command bodies.
pub async fn read_api_key_async(provider: &str) -> AppResult<String> {
    let provider = provider.to_string();
    blocking(move || read_api_key(&provider)).await
}
