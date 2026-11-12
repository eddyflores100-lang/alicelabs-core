// Storage boundary. SQLite implementation and migrations are introduced in the
// persistence milestone; domain modules must depend on this interface, not SQL.
#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("storage is not initialized")]
    NotInitialized,
    #[error("storage operation failed: {0}")]
    Operation(String),
}

pub trait StorageHealth {
    fn is_ready(&self) -> bool;
}
