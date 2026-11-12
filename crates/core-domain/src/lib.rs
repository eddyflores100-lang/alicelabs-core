use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProjectId(pub Uuid);

impl ProjectId {
    pub fn new() -> Self { Self(Uuid::new_v4()) }
}
impl Default for ProjectId { fn default() -> Self { Self::new() } }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoutingMode { Manual, Recommended, Automatic }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskState {
    Queued, Planning, Running, WaitingApproval, Validating,
    Completed, Failed, Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: ProjectId,
    pub name: String,
    pub root_path: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn project_ids_are_unique() {
        assert_ne!(ProjectId::new(), ProjectId::new());
    }
}
