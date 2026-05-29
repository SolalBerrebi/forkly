//! Ollama local HTTP streaming transport.
//!
//! Posts to `http://localhost:11434/api/chat` and consumes the NDJSON
//! response stream. No auth, no internet — entirely local. Detection is a
//! quick `/api/tags` probe that doubles as the model list fetcher.
//!
//! The endpoint URL is configurable via the `OLLAMA_HOST` env var, matching
//! Ollama's own convention, so users running Ollama on a different port
//! (e.g. for container setups) Just Work without code changes.

use crate::error::{AppError, AppResult};
use crate::providers::{OllamaRequest, StreamEvent};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::sync::mpsc;

fn base_url() -> String {
    std::env::var("OLLAMA_HOST").unwrap_or_else(|_| "http://localhost:11434".to_string())
}

#[derive(Serialize)]
struct RequestBody<'a> {
    model: &'a str,
    messages: Vec<OutMessage<'a>>,
    stream: bool,
}

#[derive(Serialize)]
struct OutMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize, Debug)]
struct Chunk {
    #[serde(default)]
    message: Option<MessageChunk>,
    #[serde(default)]
    done: bool,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    prompt_eval_count: Option<i64>,
    #[serde(default)]
    eval_count: Option<i64>,
}

#[derive(Deserialize, Debug)]
struct MessageChunk {
    #[serde(default)]
    content: Option<String>,
}

pub async fn stream_chat(
    req: OllamaRequest,
    tx: mpsc::Sender<StreamEvent>,
) -> AppResult<()> {
    let mut messages: Vec<OutMessage> = Vec::with_capacity(req.messages.len() + 1);
    if let Some(sys) = req.system_prompt.as_deref().filter(|s| !s.is_empty()) {
        messages.push(OutMessage {
            role: "system",
            content: sys,
        });
    }
    for m in &req.messages {
        messages.push(OutMessage {
            role: m.role.as_str(),
            content: m.content.as_str(),
        });
    }

    let body = RequestBody {
        model: &req.model,
        messages,
        stream: true,
    };

    let url = format!("{}/api/chat", base_url());
    let client = reqwest::Client::new();
    let res = client
        .post(&url)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            // Best-effort error mapping: a connect refused almost always
            // means Ollama isn't running. Tell the user, not a stack trace.
            let msg = e.to_string();
            if msg.contains("Connection refused") || msg.contains("connection refused") {
                AppError::Upstream(
                    "ollama isn't running on localhost:11434. start it with `ollama serve`."
                        .into(),
                )
            } else {
                AppError::Upstream(format!("ollama request: {e}"))
            }
        })?;

    let status = res.status();
    if !status.is_success() {
        let text = res.text().await.unwrap_or_else(|_| status.to_string());
        return Err(AppError::Upstream(format!(
            "ollama {status}: {}",
            text.chars().take(500).collect::<String>()
        )));
    }

    let mut input_tokens: Option<i64> = None;
    let mut output_tokens: Option<i64> = None;

    // Ollama emits NDJSON: one JSON object per line. We can't reuse the
    // eventsource_stream parser here (no SSE framing). Instead, accumulate
    // bytes and split on newlines.
    let mut buffer: Vec<u8> = Vec::new();
    let mut stream = res.bytes_stream();
    while let Some(chunk_result) = stream.next().await {
        let bytes = chunk_result
            .map_err(|e| AppError::Upstream(format!("ollama stream: {e}")))?;
        buffer.extend_from_slice(&bytes);

        // Drain complete lines, leaving any partial trailing line in the buffer.
        while let Some(newline_pos) = buffer.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = buffer.drain(..=newline_pos).collect();
            // strip trailing \n and \r
            let trimmed = std::str::from_utf8(&line)
                .map(|s| s.trim().to_string())
                .unwrap_or_default();
            if trimmed.is_empty() {
                continue;
            }
            let parsed: Chunk = match serde_json::from_str(&trimmed) {
                Ok(c) => c,
                Err(_) => continue,
            };
            if let Some(err) = parsed.error {
                return Err(AppError::Upstream(format!("ollama: {err}")));
            }
            if let Some(MessageChunk { content: Some(text) }) = parsed.message {
                if !text.is_empty() && tx.send(StreamEvent::Delta(text)).await.is_err() {
                    return Ok(()); // receiver dropped
                }
            }
            if parsed.done {
                input_tokens = parsed.prompt_eval_count;
                output_tokens = parsed.eval_count;
            }
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

/* -------------------------------------------------------------------- */
/* Detection + model listing                                            */
/* -------------------------------------------------------------------- */

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    pub running: bool,
    pub models: Vec<OllamaModel>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaModel {
    pub id: String,
    pub size_bytes: Option<i64>,
    pub modified_at: Option<String>,
}

#[derive(Deserialize)]
struct TagsResponse {
    #[serde(default)]
    models: Vec<TagsModel>,
}

#[derive(Deserialize)]
struct TagsModel {
    name: String,
    #[serde(default)]
    size: Option<i64>,
    #[serde(default)]
    modified_at: Option<String>,
}

pub async fn detect() -> OllamaStatus {
    let url = format!("{}/api/tags", base_url());
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_millis(800))
        .build()
    {
        Ok(c) => c,
        Err(_) => return OllamaStatus { running: false, models: Vec::new() },
    };
    let res = match client.get(&url).send().await {
        Ok(r) => r,
        Err(_) => return OllamaStatus { running: false, models: Vec::new() },
    };
    if !res.status().is_success() {
        return OllamaStatus { running: false, models: Vec::new() };
    }
    let tags = match res.json::<TagsResponse>().await {
        Ok(t) => t,
        Err(_) => return OllamaStatus { running: true, models: Vec::new() },
    };
    let models = tags
        .models
        .into_iter()
        .map(|m| OllamaModel {
            id: m.name,
            size_bytes: m.size,
            modified_at: m.modified_at,
        })
        .collect();
    OllamaStatus { running: true, models }
}
