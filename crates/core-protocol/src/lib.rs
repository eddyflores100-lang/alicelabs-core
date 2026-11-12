use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: &str = "1.0";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum CoreEvent {
    DaemonReady { version: String },
    AgentStateChanged { agent_id: String, state: String },
    TaskProgress { task_id: String, progress: Option<u8>, message: String },
    ApprovalRequired { approval_id: String, action: String, summary: String },
    ProviderStatusChanged { provider_id: String, connected: bool },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: String,
    pub protocol_version: String,
}
