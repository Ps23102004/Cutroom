use std::path::PathBuf;

use thiserror::Error;

pub type Result<T> = std::result::Result<T, CoreError>;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("project database is locked: {}", .0.display())]
    ProjectLocked(PathBuf),
    #[error("project not found: {0}")]
    ProjectNotFound(String),
    #[error("asset not found: {0}")]
    AssetNotFound(String),
    #[error("composition not found: {0}")]
    CompositionNotFound(String),
    #[error("revision not found: {0}")]
    RevisionNotFound(String),
    #[error("job not found: {0}")]
    JobNotFound(String),
    #[error("stale write conflict: expected version {expected}, current version {current}")]
    StaleWriteConflict { expected: i64, current: i64 },
    #[error("operation id was reused with a different payload or context: {operation_id}")]
    IdempotencyConflict { operation_id: String },
    #[error("invalid source range for asset {asset_id}: {reason}")]
    InvalidSourceRange { asset_id: String, reason: String },
    #[error("invalid rational time: {0}")]
    InvalidTime(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("integer arithmetic overflow")]
    ArithmeticOverflow,
    #[error("unsupported database schema version {found}; this core supports up to {supported}")]
    UnsupportedSchemaVersion { found: i64, supported: i64 },
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

impl CoreError {
    /// Stable error identifiers for the future native IPC adapter.
    pub fn code(&self) -> &'static str {
        match self {
            Self::ProjectLocked(_) => "PROJECT_LOCKED",
            Self::ProjectNotFound(_) => "PROJECT_NOT_FOUND",
            Self::AssetNotFound(_)
            | Self::CompositionNotFound(_)
            | Self::RevisionNotFound(_)
            | Self::JobNotFound(_) => "INTERNAL_ERROR",
            Self::StaleWriteConflict { .. } => "STALE_WRITE_CONFLICT",
            Self::IdempotencyConflict { .. } => "IDEMPOTENCY_CONFLICT",
            Self::InvalidSourceRange { .. } => "INVALID_SOURCE_RANGE",
            Self::InvalidTime(_)
            | Self::InvalidInput(_)
            | Self::ArithmeticOverflow
            | Self::UnsupportedSchemaVersion { .. } => "INTERNAL_ERROR",
            Self::Sqlite(_) | Self::Io(_) | Self::Json(_) => "INTERNAL_ERROR",
        }
    }
}
