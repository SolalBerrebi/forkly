pub mod anthropic;
pub mod claude_code;
pub mod cli_runner;
pub mod codex;
pub mod google;
pub mod ollama;
pub mod openai;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone)]
pub enum StreamEvent {
    Delta(String),
    Usage {
        input_tokens: Option<i64>,
        output_tokens: Option<i64>,
    },
    /// Raw upstream line, accumulated for the network-log detail. Used by
    /// CLI providers (Codex, Claude Code) so when a turn returns empty
    /// content we can see exactly what the subprocess actually emitted —
    /// the user can read it in the in-app network log without enabling
    /// debug logging or hunting through `tauri dev` terminal output.
    Trace(String),
    Done,
}

/// Request shape for the direct Anthropic API transport (pay-per-token API key).
#[derive(Debug, Clone)]
pub struct ApiStreamRequest {
    pub model: String,
    pub system_prompt: Option<String>,
    pub messages: Vec<ChatMessage>,
    pub max_tokens: u32,
    pub api_key: String,
}

/// Request shape for the Claude Code CLI subprocess transport (subscription-backed).
///
/// `session_id` is Forkly's session UUID, reused as the Claude Code session id so
/// CC can maintain conversation state across invocations. `is_resume` is false on
/// the first turn (we create the CC session via --session-id) and true thereafter
/// (we --resume the same id).
#[derive(Debug, Clone)]
pub struct ClaudeCodeRequest {
    pub model: String,
    pub system_prompt: Option<String>,
    pub user_message: String,
    pub session_id: String,
    pub is_resume: bool,
}

/// Request shape for the OpenAI Codex CLI subprocess transport
/// (ChatGPT Plus / Pro subscription-backed).
///
/// Unlike Claude Code, Codex does NOT let the caller pre-assign a session
/// id — the thread_id comes back in the first event (`thread.started`). For
/// v0.1 we side-step that by re-sending the full conversation as the prompt
/// on every turn, so each `codex exec` is single-shot and stateless from
/// Codex's perspective. Forkly's DB remains the source of truth for history.
#[derive(Debug, Clone)]
pub struct CodexRequest {
    pub model: String,
    pub system_prompt: Option<String>,
    /// Full conversation, already flattened into a single prompt string by
    /// the caller. Includes the new user message at the end.
    pub prompt: String,
}

/// Request shape for the Ollama local HTTP transport. No API key — talks to
/// `localhost:11434`. The `model` field is whatever the user has pulled via
/// `ollama pull` (e.g. "llama3.2", "qwen2.5-coder:14b").
#[derive(Debug, Clone)]
pub struct OllamaRequest {
    pub model: String,
    pub system_prompt: Option<String>,
    pub messages: Vec<ChatMessage>,
}
