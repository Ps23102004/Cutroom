use std::path::PathBuf;

use serde::{Deserialize, Serialize};

pub use cutroom_core::{ColorGrade, InputColorSpace, LutSpec, OutputColor, OutputSpec, VideoCodec};
use cutroom_core::{RationalTime, RationalTimeBase};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SourceRange {
    pub source: PathBuf,
    pub expected_sha256: String,
    pub start: RationalTime,
    pub end: RationalTime,
    /// Per-clip color grade. Defaults to neutral; old payloads still parse.
    #[serde(default)]
    pub color: ColorGrade,
    /// Declared input color space. Defaults to `Auto`.
    #[serde(default)]
    pub input_color_space: InputColorSpace,
}

impl SourceRange {
    /// A range with the neutral color grade and automatic input color-space
    /// detection.
    pub fn new(
        source: PathBuf,
        expected_sha256: String,
        start: RationalTime,
        end: RationalTime,
    ) -> Self {
        Self {
            source,
            expected_sha256,
            start,
            end,
            color: ColorGrade::default(),
            input_color_space: InputColorSpace::Auto,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TwoClipRenderRequest {
    /// The render order is exactly this fixed two-item array order.
    pub clips: [SourceRange; 2],
    pub destination: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ProRenderRequest {
    /// The render order is exactly this fixed two-item array order.
    pub clips: [SourceRange; 2],
    pub output: OutputSpec,
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

/// Validated description of a user-supplied `.cube` LUT.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LutInfo {
    /// The `LUT_3D_SIZE` dimension (N for an NxNxN lattice).
    pub size: u32,
    /// The optional `TITLE` line, if present.
    pub title: Option<String>,
    /// Lowercase hex SHA-256 of the exact validated bytes.
    pub sha256: String,
}
