pub mod anthropic;

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

#[derive(Debug, Clone)]
pub struct StreamRequest {
    pub model: String,
    pub system_prompt: Option<String>,
    pub messages: Vec<ChatMessage>,
    pub max_tokens: u32,
    pub api_key: String,
}
