use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use thiserror::Error;

const SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("SQLite operation failed: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredProject {
    pub id: String,
    pub name: String,
    pub root_path: String,
}

pub struct SqliteStore {
    connection: Connection,
}

impl SqliteStore {
    pub fn open(path: impl AsRef<std::path::Path>) -> Result<Self, StorageError> {
        let connection = Connection::open(path)?;
        Self::from_connection(connection)
    }

    pub fn open_in_memory() -> Result<Self, StorageError> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(mut connection: Connection) -> Result<Self, StorageError> {
        connection.execute_batch("PRAGMA foreign_keys = ON;")?;
        {
            let tx = connection.transaction()?;
            tx.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                ",
            )?;

            let current: Option<i64> =
                tx.query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                    row.get(0)
                })?;

            if current.unwrap_or_default() < SCHEMA_VERSION {
                tx.execute_batch(
                    "
                    CREATE TABLE IF NOT EXISTS projects (
                        id TEXT PRIMARY KEY NOT NULL,
                        name TEXT NOT NULL,
                        root_path TEXT NOT NULL,
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    );

                    CREATE TABLE IF NOT EXISTS provider_accounts (
                        id TEXT PRIMARY KEY NOT NULL,
                        provider_id TEXT NOT NULL,
                        display_name TEXT NOT NULL,
                        credential_ref TEXT,
                        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    );

                    CREATE TABLE IF NOT EXISTS agent_profiles (
                        id TEXT PRIMARY KEY NOT NULL,
                        name TEXT NOT NULL,
                        model_policy_json TEXT NOT NULL,
                        permissions_json TEXT NOT NULL,
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    );

                    CREATE TABLE IF NOT EXISTS tasks (
                        id TEXT PRIMARY KEY NOT NULL,
                        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                        objective TEXT NOT NULL,
                        status TEXT NOT NULL,
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    );

                    CREATE TABLE IF NOT EXISTS events (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
                        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
                        event_type TEXT NOT NULL,
                        payload_json TEXT NOT NULL,
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    );

                    CREATE INDEX IF NOT EXISTS idx_tasks_project_status
                        ON tasks(project_id, status);
                    CREATE INDEX IF NOT EXISTS idx_events_project_created
                        ON events(project_id, created_at);
                    ",
                )?;
                tx.execute(
                    "INSERT INTO schema_migrations(version) VALUES (?1)",
                    params![SCHEMA_VERSION],
                )?;
            }
            tx.commit()?;
        }

        Ok(Self { connection })
    }

    pub fn schema_version(&self) -> Result<i64, StorageError> {
        Ok(self.connection.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )?)
    }

    pub fn create_project(&self, project: &StoredProject) -> Result<(), StorageError> {
        self.connection.execute(
            "INSERT INTO projects(id, name, root_path) VALUES (?1, ?2, ?3)",
            params![project.id, project.name, project.root_path],
        )?;
        Ok(())
    }

    pub fn list_projects(&self) -> Result<Vec<StoredProject>, StorageError> {
        let mut statement = self
            .connection
            .prepare("SELECT id, name, root_path FROM projects ORDER BY created_at, id")?;
        let rows = statement.query_map([], |row| {
            Ok(StoredProject {
                id: row.get(0)?,
                name: row.get(1)?,
                root_path: row.get(2)?,
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(StorageError::from)
    }

    /// Stores only an opaque operating-system vault reference, never a provider secret.
    pub fn save_provider_account(
        &self,
        id: &str,
        provider_id: &str,
        display_name: &str,
        credential_ref: Option<&str>,
    ) -> Result<(), StorageError> {
        self.connection.execute(
            "INSERT INTO provider_accounts(id, provider_id, display_name, credential_ref)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET
                provider_id = excluded.provider_id,
                display_name = excluded.display_name,
                credential_ref = excluded.credential_ref",
            params![id, provider_id, display_name, credential_ref],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initializes_schema_and_persists_projects() {
        let store = SqliteStore::open_in_memory().unwrap();
        assert_eq!(store.schema_version().unwrap(), SCHEMA_VERSION);

        let project = StoredProject {
            id: "project-1".into(),
            name: "AliceLabs Core".into(),
            root_path: "C:/work/core".into(),
        };
        store.create_project(&project).unwrap();

        assert_eq!(store.list_projects().unwrap(), vec![project]);
    }

    #[test]
    fn migration_version_is_recorded() {
        let store = SqliteStore::open_in_memory().unwrap();
        assert_eq!(store.schema_version().unwrap(), SCHEMA_VERSION);
    }
}
