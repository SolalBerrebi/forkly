use crate::error::{AppError, AppResult};
use keyring::Entry;

const SERVICE: &str = "forkly";

fn entry_for(provider: &str) -> AppResult<Entry> {
    Entry::new(SERVICE, &format!("{provider}-api-key"))
        .map_err(|e| AppError::Other(format!("keychain entry create: {e}")))
}

#[tauri::command]
pub async fn has_api_key(provider: String) -> AppResult<bool> {
    let entry = entry_for(&provider)?;
    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(AppError::Other(format!("keychain read: {e}"))),
    }
}

#[tauri::command]
pub async fn set_api_key(provider: String, key: String) -> AppResult<()> {
    if key.trim().is_empty() {
        return Err(AppError::BadRequest("api key cannot be empty".into()));
    }
    let entry = entry_for(&provider)?;
    entry
        .set_password(&key)
        .map_err(|e| AppError::Other(format!("keychain write: {e}")))
}

#[tauri::command]
pub async fn delete_api_key(provider: String) -> AppResult<()> {
    let entry = entry_for(&provider)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Other(format!("keychain delete: {e}"))),
    }
}

/// Internal: read the raw key. Never expose this to the frontend.
pub fn read_api_key(provider: &str) -> AppResult<String> {
    let entry = entry_for(provider)?;
    entry
        .get_password()
        .map_err(|e| match e {
            keyring::Error::NoEntry => AppError::NotFound(format!("api key for {provider}")),
            other => AppError::Other(format!("keychain read: {other}")),
        })
}
