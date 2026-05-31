//! Read-only git probes for the session info chips. Used by the
//! per-session "branch: main" chip.

use crate::error::AppResult;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::process::Command;

/// Cache entries time out after 30s — long enough to amortize the spawn
/// cost across rapid re-renders, short enough that a user switching git
/// branches notices the change without restarting Forkly.
const CACHE_TTL: Duration = Duration::from_secs(30);
const CACHE_CAP: usize = 64;

struct CacheEntry {
    branch: Option<String>,
    inserted_at: Instant,
}

static CACHE: Mutex<Option<HashMap<String, CacheEntry>>> = Mutex::new(None);

fn cache_get(cwd: &str) -> Option<Option<String>> {
    let guard = CACHE.lock().ok()?;
    let map = guard.as_ref()?;
    let entry = map.get(cwd)?;
    if entry.inserted_at.elapsed() < CACHE_TTL {
        Some(entry.branch.clone())
    } else {
        None
    }
}

fn cache_put(cwd: String, branch: Option<String>) {
    let mut guard = match CACHE.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    let map = guard.get_or_insert_with(HashMap::new);
    if map.len() >= CACHE_CAP {
        // Cheap eviction: drop the oldest entry. Iteration order isn't
        // deterministic but we just need to keep size bounded.
        if let Some(oldest_key) = map
            .iter()
            .min_by_key(|(_, v)| v.inserted_at)
            .map(|(k, _)| k.clone())
        {
            map.remove(&oldest_key);
        }
    }
    map.insert(
        cwd,
        CacheEntry {
            branch,
            inserted_at: Instant::now(),
        },
    );
}

#[tauri::command]
pub async fn git_branch_for(cwd: String) -> AppResult<Option<String>> {
    if cwd.trim().is_empty() {
        return Ok(None);
    }

    if let Some(cached) = cache_get(&cwd) {
        return Ok(cached);
    }

    let output = Command::new("git")
        .args(["-C", &cwd, "rev-parse", "--abbrev-ref", "HEAD"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await;

    let branch = match output {
        Ok(out) if out.status.success() => {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            // `git rev-parse --abbrev-ref HEAD` returns "HEAD" on a detached
            // checkout — surface that as None so the UI shows nothing
            // instead of a misleading literal "HEAD".
            if s.is_empty() || s == "HEAD" {
                None
            } else {
                Some(s)
            }
        }
        _ => None,
    };

    cache_put(cwd, branch.clone());
    Ok(branch)
}
