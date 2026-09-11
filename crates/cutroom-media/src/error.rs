use std::path::PathBuf;

use thiserror::Error;

pub type Result<T> = std::result::Result<T, MediaError>;

#[derive(Debug, Error)]
pub enum MediaError {
    #[error("invalid media input: {0}")]
    InvalidInput(String),
    #[error("invalid half-open source range for {source_path}: {reason}")]
    InvalidRange {
        source_path: PathBuf,
        reason: String,
    },
    #[error("unsupported media: {0}")]
    UnsupportedMedia(String),
    #[error("source identity mismatch for {source_path}: expected {expected}, actual {actual}")]
    SourceIdentityMismatch {
        source_path: PathBuf,
        expected: String,
        actual: String,
    },
    #[error("source changed during render: {0}")]
    SourceChanged(PathBuf),
    #[error("render destination already exists: {0}")]
    DestinationExists(PathBuf),
    #[error("render destination aliases a source: {0}")]
    DestinationAliasesSource(PathBuf),
    #[error("external process {program} failed with {status}: {stderr}")]
    ProcessFailed {
        program: &'static str,
        status: String,
        stderr: String,
    },
    #[error("media operation was cancelled")]
    Cancelled,
    #[error("output verification failed: {0}")]
    VerificationFailed(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("time error: {0}")]
    Time(#[from] cutroom_core::CoreError),
}
