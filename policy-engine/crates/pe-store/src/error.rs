//! Store error type.

use thiserror::Error;

/// Errors from the local persistence layer.
#[derive(Debug, Error)]
pub enum StoreError {
    /// An underlying SQLite error.
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    /// The on-disk schema version is newer than this binary supports.
    #[error("schema version {found} is newer than supported {supported}")]
    SchemaTooNew {
        /// Version found on disk.
        found: u32,
        /// Highest version this binary applies.
        supported: u32,
    },

    /// A value read from the database was not in the expected form.
    #[error("data integrity error: {0}")]
    Integrity(String),
}

/// Convenience result alias.
pub type Result<T> = std::result::Result<T, StoreError>;
