//! Local-first relational persistence and timeline-domain primitives for Cutroom.
//!
//! This crate deliberately owns no media probing, job execution, or IPC transport.
//! Callers provide already-probed asset metadata and translate public domain errors
//! into their transport-specific response envelopes.

mod error;
mod model;
mod storage;

pub use error::{CoreError, Result};
pub use model::*;
pub use storage::{
    AssetRepository, CompositionRepository, Database, JobRepository, LATEST_MIGRATION_VERSION,
    NativeReceipt, NativeReceiptLookup, NativeReceiptRepository, ProjectRepository,
    RevisionRepository, now_utc_iso,
};
