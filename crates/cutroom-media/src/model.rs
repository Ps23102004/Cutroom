use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::{RationalTime, RationalTimeBase};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceRange {
    pub source: PathBuf,
    pub expected_sha256: String,
    pub start: RationalTime,
    pub end: RationalTime,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TwoClipRenderRequest {
    /// The render order is exactly this fixed two-item array order.
    pub clips: [SourceRange; 2],
    pub destination: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ColorMetadata {
    pub color_space: Option<String>,
    pub color_transfer: Option<String>,
    pub color_primaries: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VideoProbe {
    pub codec: String,
    pub width: u32,
    pub height: u32,
    pub duration: RationalTime,
    pub time_base: RationalTimeBase,
    pub frame_rate: RationalTimeBase,
    pub pixel_format: String,
    pub rotation_degrees: i32,
    pub color: ColorMetadata,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AudioProbe {
    pub codec: String,
    pub channels: u32,
    pub sample_rate: u32,
    pub duration: RationalTime,
    pub time_base: RationalTimeBase,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MediaProbe {
    pub source: PathBuf,
    pub sha256: String,
    pub video: VideoProbe,
    pub audio: Option<AudioProbe>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RenderArtifact {
    pub path: PathBuf,
    pub sha256: String,
    pub config_digest: String,
    pub probe: MediaProbe,
}
