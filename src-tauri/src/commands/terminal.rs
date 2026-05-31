//! Cross-platform "run this script in the user's terminal" command.
//!
//! Lets the onboarding flow turn a copy-paste install instruction into a
//! one-click action. The script gets typed into a fresh terminal window
//! and *not* auto-executed — the user reviews it, hits enter, and watches
//! it run. We deliberately don't try to run things as root from inside
//! Forkly; the few commands we currently launch (npm global install,
//! `claude login`, `codex login`) handle their own elevation prompts.

use crate::error::{AppError, AppResult};
use tokio::process::Command;

/// Spawn the user's default terminal with the given shell script pre-typed.
///
/// On macOS we drive Terminal.app via AppleScript — it's pre-installed on
/// every Mac, no dependencies required. Linux and Windows fall back to the
/// most common terminal emulators.
#[tauri::command]
pub async fn run_in_terminal(script: String) -> AppResult<()> {
    if script.trim().is_empty() {
        return Err(AppError::BadRequest("empty script".into()));
    }

    #[cfg(target_os = "macos")]
    {
        // AppleScript string escaping: \ → \\ and " → \". Newlines inside
        // the script become literal `; ` because `do script` interprets
        // newlines as multiple commands sent line-by-line — we want one
        // editable line in the terminal so the user can review it.
        let single_line = script.replace('\n', " ; ");
        let escaped = single_line.replace('\\', "\\\\").replace('"', "\\\"");
        let osa = format!(
            "tell application \"Terminal\" to do script \"{}\"\n\
             tell application \"Terminal\" to activate",
            escaped
        );
        Command::new("osascript")
            .arg("-e")
            .arg(&osa)
            .status()
            .await
            .map_err(|e| AppError::Other(format!("osascript: {e}")))?;
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        // Try common terminals in order of how-likely-to-be-installed.
        // `bash -c "<script>; exec bash"` keeps the window open after the
        // command finishes so the user can inspect output.
        let script_with_shell = format!("{} ; exec bash", script);
        let candidates: &[(&str, &[&str])] = &[
            ("gnome-terminal", &["--", "bash", "-c"]),
            ("konsole", &["-e", "bash", "-c"]),
            ("xfce4-terminal", &["-e", "bash", "-c"]),
            ("xterm", &["-e", "bash", "-c"]),
        ];
        for (term, args) in candidates {
            let mut cmd = Command::new(term);
            for a in *args {
                cmd.arg(a);
            }
            cmd.arg(&script_with_shell);
            if cmd.spawn().is_ok() {
                return Ok(());
            }
        }
        Err(AppError::Other(
            "no supported terminal emulator found (gnome-terminal, konsole, xfce4-terminal, xterm)"
                .into(),
        ))
    }

    #[cfg(target_os = "windows")]
    {
        // `start cmd /k` opens a new cmd window that stays open after the
        // command finishes. The user sees the script and runs it manually.
        Command::new("cmd")
            .arg("/c")
            .arg("start")
            .arg("cmd")
            .arg("/k")
            .arg(&script)
            .status()
            .await
            .map_err(|e| AppError::Other(format!("start cmd: {e}")))?;
        Ok(())
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = script;
        Err(AppError::Other(
            "unsupported OS for terminal launcher".into(),
        ))
    }
}
