use thiserror::Error;

pub type Result<T> = std::result::Result<T, JobsError>;

#[derive(Debug, Error)]
pub enum JobsError {
    #[error("core persistence error: {0}")]
    Core(#[from] cutroom_core::CoreError),
    #[error("media render error: {0}")]
    Media(#[from] cutroom_media::MediaError),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("job engine mutex was poisoned")]
    MutexPoisoned,
    #[error("job engine is shut down")]
    Shutdown,
    #[error("job {0} did not produce a verified artifact")]
    MissingArtifact(String),
    #[error("unsafe durable scratch path: {0}")]
    UnsafeScratchPath(String),
    #[error("job engine thread failed")]
    ThreadFailed,
}
