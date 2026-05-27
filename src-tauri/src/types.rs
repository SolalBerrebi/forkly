use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub title: String,
    pub provider_id: String,
    pub model_id: String,
    pub transport_id: String,
    pub system_prompt: Option<String>,
    pub position_x: f64,
    pub position_y: f64,
    pub parent_session_id: Option<String>,
    pub fork_point_message_id: Option<String>,
    /// JSON-encoded array of session ids whose outputs this session
    /// synthesizes. NULL for regular (non-merge) sessions.
    pub merge_source_session_ids: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub position: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionInput {
    pub title: Option<String>,
    pub provider_id: String,
    pub model_id: String,
    pub transport_id: Option<String>,
    pub system_prompt: Option<String>,
    pub position_x: Option<f64>,
    pub position_y: Option<f64>,
    pub parent_session_id: Option<String>,
    pub fork_point_message_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSessionInput {
    pub title: Option<String>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub transport_id: Option<String>,
    pub system_prompt: Option<String>,
    pub position_x: Option<f64>,
    pub position_y: Option<f64>,
}
