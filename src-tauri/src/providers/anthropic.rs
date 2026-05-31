use crate::error::{AppError, AppResult};
use crate::providers::{ApiStreamRequest, StreamEvent};
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const API_VERSION: &str = "2023-06-01";

#[derive(Serialize)]
struct RequestBody<'a> {
    model: &'a str,
    max_tokens: u32,
    stream: bool,
    messages: &'a [SimpleMessage<'a>],
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<&'a str>,
}

#[derive(Serialize)]
struct SimpleMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
enum Event {
    #[serde(rename = "message_start")]
    MessageStart { message: MessageStart },
    #[serde(rename = "content_block_delta")]
    ContentBlockDelta { delta: ContentDelta },
    #[serde(rename = "message_delta")]
    MessageDelta { usage: UsageDelta },
    #[serde(rename = "message_stop")]
    MessageStop,
    #[serde(rename = "error")]
    Error { error: AnthropicError },
    #[serde(other)]
    Other,
}

#[derive(Deserialize, Debug)]
struct MessageStart {
    usage: InputUsage,
}

#[derive(Deserialize, Debug)]
struct InputUsage {
    input_tokens: i64,
}

#[derive(Deserialize, Debug)]
struct UsageDelta {
    output_tokens: i64,
}

#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
enum ContentDelta {
    #[serde(rename = "text_delta")]
    Text { text: String },
    #[serde(other)]
    Other,
}

#[derive(Deserialize, Debug)]
struct AnthropicError {
    #[serde(rename = "type")]
    kind: String,
    message: String,
}

pub async fn stream_chat(req: ApiStreamRequest, tx: mpsc::Sender<StreamEvent>) -> AppResult<()> {
    let simple: Vec<SimpleMessage> = req
        .messages
        .iter()
        .map(|m| SimpleMessage {
            role: m.role.as_str(),
            content: m.content.as_str(),
        })
        .collect();

    let body = RequestBody {
        model: &req.model,
        max_tokens: req.max_tokens,
        stream: true,
        messages: &simple,
        // Empty means "no custom system prompt" (matches the other providers),
        // so a cleared prompt doesn't send an empty system string.
        system: req.system_prompt.as_deref().filter(|s| !s.is_empty()),
    };

    let client = crate::providers::http_client();
    let res = client
        .post(API_URL)
        .header("x-api-key", &req.api_key)
        .header("anthropic-version", API_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Upstream(format!("anthropic request: {e}")))?;

    let status = res.status();
    if !status.is_success() {
        let text = res.text().await.unwrap_or_else(|_| status.to_string());
        return Err(AppError::Upstream(format!(
            "anthropic {status}: {}",
            text.chars().take(500).collect::<String>()
        )));
    }

    let mut input_tokens: Option<i64> = None;
    let mut output_tokens: Option<i64> = None;

    let mut sse = res.bytes_stream().eventsource();
    while let Some(event_result) = sse.next().await {
        let event = match event_result {
            Ok(ev) => ev,
            Err(e) => return Err(AppError::Upstream(format!("sse stream: {e}"))),
        };

        if event.data.is_empty() {
            continue;
        }

        let parsed: Event = match serde_json::from_str(&event.data) {
            Ok(p) => p,
            Err(_) => continue, // ignore unknown events
        };

        match parsed {
            Event::MessageStart { message } => {
                input_tokens = Some(message.usage.input_tokens);
            }
            Event::ContentBlockDelta { delta } => {
                if let ContentDelta::Text { text } = delta {
                    if tx.send(StreamEvent::Delta(text)).await.is_err() {
                        // receiver dropped, abandon
                        return Ok(());
                    }
                }
            }
            Event::MessageDelta { usage } => {
                output_tokens = Some(usage.output_tokens);
            }
            Event::MessageStop => {
                let _ = tx
                    .send(StreamEvent::Usage {
                        input_tokens,
                        output_tokens,
                    })
                    .await;
                let _ = tx.send(StreamEvent::Done).await;
                return Ok(());
            }
            Event::Error { error } => {
                return Err(AppError::Upstream(format!(
                    "anthropic {}: {}",
                    error.kind, error.message
                )));
            }
            Event::Other => {}
        }
    }

    // Stream ended without message_stop — flush what we have
    let _ = tx
        .send(StreamEvent::Usage {
            input_tokens,
            output_tokens,
        })
        .await;
    let _ = tx.send(StreamEvent::Done).await;
    Ok(())
}
