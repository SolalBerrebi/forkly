//! Google Gemini API streaming transport.
//!
//! POSTs to `:streamGenerateContent?alt=sse` and consumes the SSE stream.
//! Each event payload is a JSON `GenerateContentResponse` with deltas in
//! `candidates[0].content.parts[*].text` and usage metadata on the final
//! event.
//!
//! Notable quirks vs OpenAI/Anthropic:
//!   - role mapping: Gemini uses "model" where everyone else uses "assistant"
//!   - system prompt goes in its own top-level `systemInstruction` field, not
//!     a message turn
//!   - API key travels as a URL query param (unusual but documented), so we
//!     embed it in the URL rather than a header

use crate::error::{AppError, AppResult};
use crate::providers::{ApiStreamRequest, StreamEvent};
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

const API_BASE: &str = "https://generativelanguage.googleapis.com/v1beta/models";

#[derive(Serialize)]
struct RequestBody<'a> {
    contents: Vec<Content<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system_instruction: Option<SystemInstruction<'a>>,
    #[serde(rename = "generationConfig")]
    generation_config: GenerationConfig,
}

#[derive(Serialize)]
struct Content<'a> {
    role: &'a str,
    parts: Vec<Part<'a>>,
}

#[derive(Serialize)]
struct SystemInstruction<'a> {
    parts: Vec<Part<'a>>,
}

#[derive(Serialize)]
struct Part<'a> {
    text: &'a str,
}

#[derive(Serialize)]
struct GenerationConfig {
    #[serde(rename = "maxOutputTokens")]
    max_output_tokens: u32,
}

#[derive(Deserialize, Debug)]
struct Response {
    #[serde(default)]
    candidates: Vec<Candidate>,
    #[serde(default, rename = "usageMetadata")]
    usage_metadata: Option<UsageMetadata>,
    #[serde(default)]
    error: Option<GeminiErrorBody>,
}

#[derive(Deserialize, Debug)]
struct Candidate {
    #[serde(default)]
    content: Option<RespContent>,
}

#[derive(Deserialize, Debug)]
struct RespContent {
    #[serde(default)]
    parts: Vec<RespPart>,
}

#[derive(Deserialize, Debug)]
struct RespPart {
    #[serde(default)]
    text: Option<String>,
}

#[derive(Deserialize, Debug)]
struct UsageMetadata {
    #[serde(default, rename = "promptTokenCount")]
    prompt_tokens: Option<i64>,
    #[serde(default, rename = "candidatesTokenCount")]
    candidates_tokens: Option<i64>,
}

#[derive(Deserialize, Debug)]
struct GeminiErrorBody {
    #[serde(default)]
    message: Option<String>,
}

pub async fn stream_chat(req: ApiStreamRequest, tx: mpsc::Sender<StreamEvent>) -> AppResult<()> {
    // Map Forkly's "assistant" role to Gemini's "model". System turns are
    // filtered out by the caller (stream.rs); we still skip them here in
    // case any leaked through.
    let contents: Vec<Content> = req
        .messages
        .iter()
        .filter_map(|m| {
            let role = match m.role.as_str() {
                "user" => "user",
                "assistant" | "model" => "model",
                _ => return None,
            };
            Some(Content {
                role,
                parts: vec![Part {
                    text: m.content.as_str(),
                }],
            })
        })
        .collect();

    if contents.is_empty() {
        return Err(AppError::BadRequest(
            "gemini: at least one user message required".into(),
        ));
    }

    let system_instruction = req
        .system_prompt
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(|sys| SystemInstruction {
            parts: vec![Part { text: sys }],
        });

    let body = RequestBody {
        contents,
        system_instruction,
        generation_config: GenerationConfig {
            max_output_tokens: req.max_tokens,
        },
    };

    let url = format!(
        "{API_BASE}/{model}:streamGenerateContent?alt=sse&key={key}",
        model = req.model,
        key = urlencoding::encode(&req.api_key)
    );

    let client = crate::providers::http_client();
    let res = client
        .post(&url)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Upstream(format!("gemini request: {e}")))?;

    let status = res.status();
    if !status.is_success() {
        let text = res.text().await.unwrap_or_else(|_| status.to_string());
        // Gemini sometimes returns the error as `{"error": {...}}` even on the
        // streaming endpoint. Try to extract it for a cleaner message.
        let msg = serde_json::from_str::<Response>(&text)
            .ok()
            .and_then(|r| r.error)
            .and_then(|e| e.message)
            .map(|m| format!("gemini {status}: {m}"))
            .unwrap_or_else(|| {
                format!(
                    "gemini {status}: {}",
                    text.chars().take(500).collect::<String>()
                )
            });
        return Err(AppError::Upstream(msg));
    }

    let mut input_tokens: Option<i64> = None;
    let mut output_tokens: Option<i64> = None;

    let mut sse = res.bytes_stream().eventsource();
    while let Some(event_result) = sse.next().await {
        let event = match event_result {
            Ok(ev) => ev,
            Err(e) => return Err(AppError::Upstream(format!("gemini sse: {e}"))),
        };
        if event.data.is_empty() {
            continue;
        }

        let chunk: Response = match serde_json::from_str(&event.data) {
            Ok(c) => c,
            Err(_) => continue,
        };

        if let Some(err) = chunk.error {
            let msg = err.message.unwrap_or_else(|| "unknown error".into());
            return Err(AppError::Upstream(format!("gemini: {msg}")));
        }

        // Emit any text parts on the first candidate (Gemini supports multiple
        // candidates but we always request one).
        if let Some(candidate) = chunk.candidates.into_iter().next() {
            if let Some(content) = candidate.content {
                for part in content.parts {
                    if let Some(text) = part.text {
                        if !text.is_empty() && tx.send(StreamEvent::Delta(text)).await.is_err() {
                            return Ok(()); // receiver dropped
                        }
                    }
                }
            }
        }

        if let Some(um) = chunk.usage_metadata {
            input_tokens = um.prompt_tokens.or(input_tokens);
            output_tokens = um.candidates_tokens.or(output_tokens);
        }
    }

    let _ = tx
        .send(StreamEvent::Usage {
            input_tokens,
            output_tokens,
        })
        .await;
    let _ = tx.send(StreamEvent::Done).await;
    Ok(())
}
