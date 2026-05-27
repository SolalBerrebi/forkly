pub mod anthropic;
pub mod claude_code;

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
