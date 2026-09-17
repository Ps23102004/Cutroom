//! Deterministic, local FFmpeg/ffprobe adapters for the initial Cutroom render path.
//!
//! This crate accepts only typed source ranges and compiles fixed FFmpeg arguments.
//! It never accepts a caller-provided executable, URL, or filtergraph.

mod engine;
mod error;
mod model;

pub use cutroom_core::{RationalTime, RationalTimeBase};
pub use engine::{CancellationToken, MediaEngine};
pub use error::{MediaError, Result};
pub use model::{
    AudioProbe, ColorGrade, ColorMetadata, InputColorSpace, LutInfo, LutSpec, MediaProbe,
    OutputColor, OutputSpec, ProRenderRequest, RenderArtifact, SourceRange, TwoClipRenderRequest,
    VideoCodec, VideoProbe,
};
