//! OpenAI HTTP streaming transport.
//!
//! POSTs to `/v1/chat/completions` with `stream: true` and consumes the
//! resulting Server-Sent Events. We deliberately use the same `ApiStreamRequest`
//! shape as Anthropic and the same `eventsource_stream` parser — the wire
//! protocols differ only at the JSON-body level, so collapsing the boilerplate
//! isn't worth it. Each event payload is a `chat.completion.chunk` JSON object
//! whose `choices[0].delta.content` is a text fragment.
//!
//! Usage tokens arrive on the final chunk via the `usage` field (OpenAI's
//! `stream_options.include_usage: true` opt-in). The stream is terminated
//! by a literal `[DONE]` event payload — outside JSON-land, so we handle it
//! as a string check before attempting deserialization.

use crate::error::{AppError, AppResult};
use crate::providers::{ApiStreamRequest, StreamEvent};
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

const API_URL: &str = "https://api.openai.com/v1/chat/completions";
const DONE_SENTINEL: &str = "[DONE]";

#[derive(Serialize)]
struct RequestBody<'a> {
    model: &'a str,
    stream: bool,
    stream_options: StreamOptions,
    messages: Vec<OutMessage<'a>>,
    /// Newer OpenAI models (GPT-5 / o-series) reject the legacy `max_tokens`
    /// field and require `max_completion_tokens` instead. We send the new
    /// name and rely on OpenAI to map it for older models too — the field
    /// has been accepted across the board since 2025.
    #[serde(skip_serializing_if = "Option::is_none")]
    max_completion_tokens: Option<u32>,
}

#[derive(Serialize)]
struct StreamOptions {
    include_usage: bool,
}

#[derive(Serialize)]
struct OutMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize, Debug)]
struct Chunk {
    #[serde(default)]
    choices: Vec<Choice>,
    /// Present only on the very last chunk when stream_options.include_usage
    /// is true. All deltas in between have `usage: null`.
    #[serde(default)]
    usage: Option<Usage>,
}

#[derive(Deserialize, Debug)]
struct Choice {
    #[serde(default)]
    delta: Delta,
}

#[derive(Deserialize, Debug, Default)]
struct Delta {
    /// Missing on the role-introduction chunk and again on the terminating
    /// `finish_reason` chunk; populated for the actual text deltas.
    #[serde(default)]
    content: Option<String>,
}

#[derive(Deserialize, Debug)]
struct Usage {
    prompt_tokens: Option<i64>,
    completion_tokens: Option<i64>,
}

#[derive(Deserialize, Debug)]
struct ErrorEnvelope {
    error: OpenAiError,
}

#[derive(Deserialize, Debug)]
struct OpenAiError {
    message: String,
    #[serde(default, rename = "type")]
    kind: Option<String>,
}

pub async fn stream_chat(req: ApiStreamRequest, tx: mpsc::Sender<StreamEvent>) -> AppResult<()> {
    let mut messages: Vec<OutMessage> = Vec::with_capacity(req.messages.len() + 1);
    if let Some(sys) = req.system_prompt.as_deref() {
        if !sys.is_empty() {
            messages.push(OutMessage {
                role: "system",
                content: sys,
            });
        }
    }
    for m in &req.messages {
        messages.push(OutMessage {
            role: m.role.as_str(),
            content: m.content.as_str(),
        });
    }

    let body = RequestBody {
        model: &req.model,
        stream: true,
        stream_options: StreamOptions {
            include_usage: true,
        },
        messages,
        max_completion_tokens: Some(req.max_tokens),
    };

    let client = crate::providers::http_client();
    let res = client
        .post(API_URL)
        .bearer_auth(&req.api_key)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Upstream(format!("openai request: {e}")))?;

    let status = res.status();
    if !status.is_success() {
        let text = res.text().await.unwrap_or_else(|_| status.to_string());
        // Try to extract the structured error message; fall back to raw body.
        let msg = serde_json::from_str::<ErrorEnvelope>(&text)
            .ok()
            .map(|e| {
                format!(
                    "openai {status} ({}): {}",
                    e.error.kind.unwrap_or_default(),
                    e.error.message
                )
            })
            .unwrap_or_else(|| {
                format!(
                    "openai {status}: {}",
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
            Err(e) => return Err(AppError::Upstream(format!("openai sse: {e}"))),
        };

        if event.data.is_empty() {
            continue;
        }
        // OpenAI terminates the stream with a literal `[DONE]` payload that
        // isn't JSON — handle it before serde tries.
        if event.data.trim() == DONE_SENTINEL {
            break;
        }

        let chunk: Chunk = match serde_json::from_str(&event.data) {
            Ok(c) => c,
            Err(_) => continue, // unknown / malformed event, skip silently
        };

        if let Some(choice) = chunk.choices.into_iter().next() {
            if let Some(text) = choice.delta.content {
                if !text.is_empty() && tx.send(StreamEvent::Delta(text)).await.is_err() {
                    return Ok(()); // receiver dropped
                }
            }
        }

        if let Some(usage) = chunk.usage {
            input_tokens = usage.prompt_tokens;
            output_tokens = usage.completion_tokens;
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
