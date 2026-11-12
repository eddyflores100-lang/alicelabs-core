//! Provider-neutral model gateway adapters.
//! API credentials are supplied at runtime and are never serialized by this crate.

use async_trait::async_trait;
use reqwest::{header, Client, StatusCode};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MessageRole {
    System,
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChatMessage {
    pub role: MessageRole,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub max_tokens: u32,
    pub temperature: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChatResponse {
    pub provider: String,
    pub model: String,
    pub content: String,
    pub usage: Option<TokenUsage>,
}

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("provider request failed")]
    Transport(#[from] reqwest::Error),
    #[error("provider returned HTTP {0}")]
    HttpStatus(StatusCode),
    #[error("provider returned an empty completion")]
    EmptyCompletion,
    #[error("provider response could not be decoded")]
    Decode,
}

#[async_trait]
pub trait ProviderAdapter: Send + Sync {
    fn provider_id(&self) -> &'static str;
    async fn complete(&self, request: &ChatRequest) -> Result<ChatResponse, ProviderError>;
}

/// Adapter for OpenAI Chat Completions-compatible endpoints.
/// Supports OpenAI and gateways such as OpenRouter via configurable base URL.
pub struct OpenAiCompatibleAdapter {
    client: Client,
    base_url: String,
    api_key: String,
    provider: &'static str,
}

impl OpenAiCompatibleAdapter {
    pub fn new(
        base_url: impl Into<String>,
        api_key: impl Into<String>,
        provider: &'static str,
    ) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.into().trim_end_matches('/').to_string(),
            api_key: api_key.into(),
            provider,
        }
    }
}

#[derive(Serialize)]
struct OpenAiPayload<'a> {
    model: &'a str,
    messages: Vec<OpenAiMessage<'a>>,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
}

#[derive(Serialize)]
struct OpenAiMessage<'a> {
    role: &'static str,
    content: &'a str,
}

#[derive(Deserialize)]
struct OpenAiResult {
    model: Option<String>,
    choices: Vec<OpenAiChoice>,
    usage: Option<OpenAiUsage>,
}

#[derive(Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessageResult,
}

#[derive(Deserialize)]
struct OpenAiMessageResult {
    content: Option<String>,
}

#[derive(Deserialize)]
struct OpenAiUsage {
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
}

#[async_trait]
impl ProviderAdapter for OpenAiCompatibleAdapter {
    fn provider_id(&self) -> &'static str {
        self.provider
    }

    async fn complete(&self, request: &ChatRequest) -> Result<ChatResponse, ProviderError> {
        let messages = request
            .messages
            .iter()
            .map(|message| OpenAiMessage {
                role: match message.role {
                    MessageRole::System => "system",
                    MessageRole::User => "user",
                    MessageRole::Assistant => "assistant",
                },
                content: &message.content,
            })
            .collect();

        let payload = OpenAiPayload {
            model: &request.model,
            messages,
            max_tokens: request.max_tokens,
            temperature: request.temperature,
        };

        let response = self
            .client
            .post(format!("{}/chat/completions", self.base_url))
            .bearer_auth(&self.api_key)
            .json(&payload)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(ProviderError::HttpStatus(response.status()));
        }

        let result: OpenAiResult = response.json().await.map_err(|_| ProviderError::Decode)?;
        let content = result
            .choices
            .into_iter()
            .next()
            .and_then(|choice| choice.message.content)
            .filter(|content| !content.trim().is_empty())
            .ok_or(ProviderError::EmptyCompletion)?;

        Ok(ChatResponse {
            provider: self.provider.to_string(),
            model: result.model.unwrap_or_else(|| request.model.clone()),
            content,
            usage: result.usage.map(|usage| TokenUsage {
                input_tokens: usage.prompt_tokens.unwrap_or_default(),
                output_tokens: usage.completion_tokens.unwrap_or_default(),
            }),
        })
    }
}

/// Adapter for the Anthropic Messages API.
pub struct AnthropicAdapter {
    client: Client,
    api_key: String,
    base_url: String,
}

impl AnthropicAdapter {
    pub fn new(api_key: impl Into<String>) -> Self {
        Self::with_base_url("https://api.anthropic.com", api_key)
    }

    pub fn with_base_url(base_url: impl Into<String>, api_key: impl Into<String>) -> Self {
        Self {
            client: Client::new(),
            api_key: api_key.into(),
            base_url: base_url.into().trim_end_matches('/').to_string(),
        }
    }
}

#[derive(Serialize)]
struct AnthropicPayload<'a> {
    model: &'a str,
    max_tokens: u32,
    messages: Vec<AnthropicMessage<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
}

#[derive(Serialize)]
struct AnthropicMessage<'a> {
    role: &'static str,
    content: &'a str,
}

#[derive(Deserialize)]
struct AnthropicResult {
    model: Option<String>,
    content: Vec<AnthropicContent>,
    usage: Option<AnthropicUsage>,
}

#[derive(Deserialize)]
struct AnthropicContent {
    text: Option<String>,
}

#[derive(Deserialize)]
struct AnthropicUsage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
}

#[async_trait]
impl ProviderAdapter for AnthropicAdapter {
    fn provider_id(&self) -> &'static str {
        "anthropic"
    }

    async fn complete(&self, request: &ChatRequest) -> Result<ChatResponse, ProviderError> {
        let system = request
            .messages
            .iter()
            .filter(|message| message.role == MessageRole::System)
            .map(|message| message.content.as_str())
            .collect::<Vec<_>>()
            .join("\n");

        let messages = request
            .messages
            .iter()
            .filter(|message| message.role != MessageRole::System)
            .map(|message| AnthropicMessage {
                role: match message.role {
                    MessageRole::Assistant => "assistant",
                    MessageRole::User => "user",
                    MessageRole::System => unreachable!(),
                },
                content: &message.content,
            })
            .collect();

        let payload = AnthropicPayload {
            model: &request.model,
            max_tokens: request.max_tokens,
            messages,
            system: if system.is_empty() {
                None
            } else {
                Some(system)
            },
            temperature: request.temperature,
        };

        let response = self
            .client
            .post(format!("{}/v1/messages", self.base_url))
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .header(header::CONTENT_TYPE, "application/json")
            .json(&payload)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(ProviderError::HttpStatus(response.status()));
        }

        let result: AnthropicResult = response.json().await.map_err(|_| ProviderError::Decode)?;
        let content = result
            .content
            .into_iter()
            .filter_map(|block| block.text)
            .collect::<Vec<_>>()
            .join("")
            .trim()
            .to_string();

        if content.is_empty() {
            return Err(ProviderError::EmptyCompletion);
        }

        Ok(ChatResponse {
            provider: self.provider_id().to_string(),
            model: result.model.unwrap_or_else(|| request.model.clone()),
            content,
            usage: result.usage.map(|usage| TokenUsage {
                input_tokens: usage.input_tokens.unwrap_or_default(),
                output_tokens: usage.output_tokens.unwrap_or_default(),
            }),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_request_serializes_without_provider_specific_fields() {
        let request = ChatRequest {
            model: "model-x".into(),
            messages: vec![ChatMessage {
                role: MessageRole::User,
                content: "hello".into(),
            }],
            max_tokens: 128,
            temperature: None,
        };
        let json = serde_json::to_value(request).unwrap();
        assert_eq!(json["model"], "model-x");
        assert_eq!(json["messages"][0]["role"], "user");
        assert!(json.get("api_key").is_none());
    }

    #[test]
    fn openai_adapter_identifies_provider() {
        let adapter =
            OpenAiCompatibleAdapter::new("https://api.openai.com/v1", "runtime-secret", "openai");
        assert_eq!(adapter.provider_id(), "openai");
    }

    #[test]
    fn anthropic_adapter_identifies_provider() {
        let adapter = AnthropicAdapter::new("runtime-secret");
        assert_eq!(adapter.provider_id(), "anthropic");
    }
}
