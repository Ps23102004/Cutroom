use std::{cmp::Ordering, path::PathBuf};

use serde::{Deserialize, Serialize};

use crate::{CoreError, Result};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RationalTimeBase {
    pub num: i64,
    pub den: i64,
}

impl RationalTimeBase {
    pub fn new(num: i64, den: i64) -> Result<Self> {
        let value = Self { num, den };
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<()> {
        if self.num <= 0 || self.den <= 0 {
            return Err(CoreError::InvalidTime(
                "time-base numerator and denominator must be positive".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RationalTime {
    pub ticks: String,
    pub time_base: RationalTimeBase,
}

impl RationalTime {
    pub fn new(ticks: impl Into<String>, time_base: RationalTimeBase) -> Result<Self> {
        let value = Self {
            ticks: ticks.into(),
            time_base,
        };
        value.validate()?;
        Ok(value)
    }

    pub fn from_ticks(ticks: i128, time_base: RationalTimeBase) -> Result<Self> {
        Self::new(ticks.to_string(), time_base)
    }

    pub fn validate(&self) -> Result<()> {
        self.time_base.validate()?;
        parse_ticks(&self.ticks).map(|_| ())
    }

    pub fn ticks_i128(&self) -> Result<i128> {
        self.validate()?;
        parse_ticks(&self.ticks)
    }

    /// Compares two rational times exclusively with checked integer arithmetic.
    /// Common factors are cancelled before multiplication so equal, very-large
    /// values do not overflow merely because of their representation.
    pub fn compare_checked(&self, other: &Self) -> Result<Ordering> {
        self.validate()?;
        other.validate()?;
        let self_ticks = self.ticks_i128()?;
        let other_ticks = other.ticks_i128()?;
        if equivalent_time_bases(&self.time_base, &other.time_base) {
            return Ok(self_ticks.cmp(&other_ticks));
        }

        let mut left = [
            self_ticks,
            self.time_base.num as i128,
            other.time_base.den as i128,
        ];
        let mut right = [
            other_ticks,
            other.time_base.num as i128,
            self.time_base.den as i128,
        ];
        cancel_cross_factors(&mut left, &mut right);
        Ok(checked_product(&left)?.cmp(&checked_product(&right)?))
    }

    /// Converts only when the target tick count is exactly representable.
    /// This prohibits hidden rounding and any float-based accumulated timing.
    pub fn exact_ticks_in(&self, target: &RationalTimeBase) -> Result<String> {
        self.validate()?;
        target.validate()?;
        let ticks = self.ticks_i128()?;
        if equivalent_time_bases(&self.time_base, target) {
            return Ok(ticks.to_string());
        }

        let mut numerator_factors = [ticks, self.time_base.num as i128, target.den as i128];
        let mut denominator = (self.time_base.den as i128)
            .checked_mul(target.num as i128)
            .ok_or(CoreError::ArithmeticOverflow)?;
        for factor in &mut numerator_factors {
            let divisor = greatest_common_divisor(*factor, denominator);
            if divisor > 1 {
                *factor /= divisor;
                denominator /= divisor;
            }
        }
        if denominator != 1 {
            return Err(CoreError::InvalidTime(
                "time is not exactly representable in the target time base".into(),
            ));
        }
        Ok(checked_product(&numerator_factors)?.to_string())
    }
}

fn equivalent_time_bases(left: &RationalTimeBase, right: &RationalTimeBase) -> bool {
    let left_divisor = greatest_common_divisor(left.num as i128, left.den as i128);
    let right_divisor = greatest_common_divisor(right.num as i128, right.den as i128);
    (
        left.num as i128 / left_divisor,
        left.den as i128 / left_divisor,
    ) == (
        right.num as i128 / right_divisor,
        right.den as i128 / right_divisor,
    )
}

fn cancel_cross_factors(left: &mut [i128], right: &mut [i128]) {
    for left_factor in left {
        for right_factor in &mut *right {
            let divisor = greatest_common_divisor(*left_factor, *right_factor);
            if divisor > 1 {
                *left_factor /= divisor;
                *right_factor /= divisor;
            }
        }
    }
}

fn checked_product(factors: &[i128]) -> Result<i128> {
    factors.iter().try_fold(1_i128, |product, factor| {
        product
            .checked_mul(*factor)
            .ok_or(CoreError::ArithmeticOverflow)
    })
}

fn greatest_common_divisor(mut left: i128, mut right: i128) -> i128 {
    while right != 0 {
        let remainder = left % right;
        left = right;
        right = remainder;
    }
    left.abs()
}

pub(crate) fn parse_ticks(value: &str) -> Result<i128> {
    if value.is_empty() {
        return Err(CoreError::InvalidTime("ticks cannot be empty".into()));
    }
    let ticks = value
        .parse::<i128>()
        .map_err(|_| CoreError::InvalidTime(format!("ticks are not an i128 decimal: {value}")))?;
    if ticks.to_string() != value {
        return Err(CoreError::InvalidTime(format!(
            "ticks are not canonical decimal text: {value}"
        )));
    }
    if ticks < 0 {
        return Err(CoreError::InvalidTime(
            "negative ticks are not permitted".into(),
        ));
    }
    Ok(ticks)
}

pub(crate) fn checked_tick_sum(left: &str, right: &str) -> Result<String> {
    let value = parse_ticks(left)?
        .checked_add(parse_ticks(right)?)
        .ok_or(CoreError::ArithmeticOverflow)?;
    Ok(value.to_string())
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectInput {
    pub name: String,
    pub path: String,
    pub aspect_ratio: String,
    pub fps: RationalTimeBase,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub aspect_ratio: String,
    pub fps: RationalTimeBase,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AssetInput {
    pub project_id: String,
    pub name: String,
    pub path: String,
    pub size_bytes: i64,
    pub duration: RationalTime,
    pub width: i64,
    pub height: i64,
    pub format: String,
    pub codec: String,
    pub audio_channels: i64,
    pub import_type: String,
    pub sha256: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Asset {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub path: String,
    pub size_bytes: i64,
    pub duration: RationalTime,
    pub width: i64,
    pub height: i64,
    pub format: String,
    pub codec: String,
    pub audio_channels: i64,
    pub import_type: String,
    pub proxy_status: String,
    pub sha256: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrackInput {
    /// Supplying an ID is useful for deterministic restore/import flows.
    pub id: Option<String>,
    pub kind: String,
    pub label: String,
    pub sort_order: i64,
    pub is_muted: bool,
    pub is_locked: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Track {
    pub id: String,
    pub composition_id: String,
    pub kind: String,
    pub label: String,
    pub sort_order: i64,
    pub is_muted: bool,
    pub is_locked: bool,
}

/// Per-clip color grade applied in the pro render pipeline, after input
/// normalization (de-log / HDR tone map) and before the output encode.
/// All values are validated by the media engine; out-of-range values are
/// rejected rather than clamped.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorGrade {
    /// Exposure compensation in stops. Range: -3.0..=3.0.
    #[serde(default)]
    pub exposure_ev: f32,
    /// Contrast multiplier. Range: 0.1..=4.0.
    #[serde(default = "default_contrast")]
    pub contrast: f32,
    /// Saturation multiplier. Range: 0.0..=3.0.
    #[serde(default = "default_saturation")]
    pub saturation: f32,
    /// White-balance temperature shift. >0 warms, <0 cools. Range: -1.0..=1.0.
    #[serde(default)]
    pub wb_temp: f32,
    /// White-balance tint shift. >0 magenta, <0 green. Range: -1.0..=1.0.
    #[serde(default)]
    pub wb_tint: f32,
    /// Optional creative `.cube` LUT applied last in the grade chain.
    #[serde(default)]
    pub lut: Option<LutSpec>,
}

fn default_contrast() -> f32 {
    1.0
}

fn default_saturation() -> f32 {
    1.0
}

impl Default for ColorGrade {
    /// Neutral grade: every adjustment at its identity value.
    fn default() -> Self {
        Self {
            exposure_ev: 0.0,
            contrast: 1.0,
            saturation: 1.0,
            wb_temp: 0.0,
            wb_tint: 0.0,
            lut: None,
        }
    }
}

impl ColorGrade {
    /// True when every adjustment is at its neutral default.
    pub fn is_neutral(&self) -> bool {
        self.exposure_ev == 0.0
            && self.contrast == 1.0
            && self.saturation == 1.0
            && self.wb_temp == 0.0
            && self.wb_tint == 0.0
            && self.lut.is_none()
    }

    /// Rejects out-of-range grades at edit time so bad values never reach
    /// the render queue. The media engine re-validates before rendering.
    pub fn validate(&self) -> Result<()> {
        let range = |name: &str, v: f32, lo: f32, hi: f32| {
            if v.is_finite() && v >= lo && v <= hi {
                Ok(())
            } else {
                Err(CoreError::InvalidInput(format!(
                    "color grade {name} must be within {lo}..={hi}"
                )))
            }
        };
        range("exposure_ev", self.exposure_ev, -3.0, 3.0)?;
        range("contrast", self.contrast, 0.1, 4.0)?;
        range("saturation", self.saturation, 0.0, 3.0)?;
        range("wb_temp", self.wb_temp, -1.0, 1.0)?;
        range("wb_tint", self.wb_tint, -1.0, 1.0)?;
        if let Some(lut) = &self.lut {
            if lut.path.as_os_str().is_empty() {
                return Err(CoreError::InvalidInput(
                    "color grade LUT path must not be empty".into(),
                ));
            }
            if lut.expected_sha256.trim().is_empty() {
                return Err(CoreError::InvalidInput(
                    "color grade LUT must carry its expected SHA-256".into(),
                ));
            }
        }
        Ok(())
    }
}

/// A user-supplied `.cube` 3D LUT. The path is canonicalized and its SHA-256
/// verified before and after every render that uses it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LutSpec {
    pub path: PathBuf,
    pub expected_sha256: String,
}

/// Declared input color space for a clip. `Auto` probes the file's tagged
/// transfer/primaries; explicit log profiles select the de-log path.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InputColorSpace {
    #[default]
    Auto,
    Rec709,
    Bt2020Sdr,
    SLog3,
    VLog,
    CLog3,
    PqHdr,
    HlgHdr,
}

/// Per-clip color state stored on the timeline clip.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipColor {
    #[serde(default)]
    pub input_color_space: InputColorSpace,
    #[serde(default)]
    pub grade: ColorGrade,
}

impl ClipColor {
    pub fn validate(&self) -> Result<()> {
        self.grade.validate()
    }
}

/// Output video codec for a pro render preset.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VideoCodec {
    H264,
    H265,
}

/// Output color pipeline: SDR Rec.709 or HDR10 (PQ/BT.2020 with static
/// metadata). HDR10 requires the H.265 codec and HDR (PQ) sources.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputColor {
    #[default]
    SdrRec709,
    Hdr10,
}

/// A validated render output preset: resolution, frame rate, codec, color.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct OutputSpec {
    pub width: u32,
    pub height: u32,
    pub frame_rate: RationalTimeBase,
    pub codec: VideoCodec,
    pub color: OutputColor,
}

impl OutputSpec {
    /// Legacy preset: 1080p24 H.264 SDR (the original B0 pipeline output).
    pub fn sd_1080p24_h264() -> Self {
        Self {
            width: 1920,
            height: 1080,
            frame_rate: RationalTimeBase { num: 24, den: 1 },
            codec: VideoCodec::H264,
            color: OutputColor::SdrRec709,
        }
    }

    pub fn preset(name: &str) -> Option<Self> {
        let frame_rate = |num: i64| RationalTimeBase { num, den: 1 };
        match name {
            "1080p_sdr" => Some(Self::sd_1080p24_h264()),
            "720p_h264" => Some(Self {
                width: 1280,
                height: 720,
                frame_rate: frame_rate(30),
                codec: VideoCodec::H264,
                color: OutputColor::SdrRec709,
            }),
            "1080p_h264" => Some(Self {
                width: 1920,
                height: 1080,
                frame_rate: frame_rate(30),
                codec: VideoCodec::H264,
                color: OutputColor::SdrRec709,
            }),
            "2160p_h265" => Some(Self {
                width: 3840,
                height: 2160,
                frame_rate: frame_rate(30),
                codec: VideoCodec::H265,
                color: OutputColor::SdrRec709,
            }),
            "2160p60_h265" => Some(Self {
                width: 3840,
                height: 2160,
                frame_rate: frame_rate(60),
                codec: VideoCodec::H265,
                color: OutputColor::SdrRec709,
            }),
            "2160p_hdr10" => Some(Self {
                width: 3840,
                height: 2160,
                frame_rate: frame_rate(30),
                codec: VideoCodec::H265,
                color: OutputColor::Hdr10,
            }),
            _ => None,
        }
    }

    /// All presets the Deliver panel may offer, in display order.
    pub fn preset_names() -> &'static [&'static str] {
        &[
            "1080p_sdr",
            "720p_h264",
            "1080p_h264",
            "2160p_h265",
            "2160p60_h265",
            "2160p_hdr10",
        ]
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ClipInput {
    pub id: Option<String>,
    pub track_id: String,
    pub asset_id: String,
    pub name: String,
    pub in_time: RationalTime,
    pub out_time: RationalTime,
    pub timeline_start: RationalTime,
    pub timeline_duration: RationalTime,
    pub sort_order: i64,
    /// Per-clip color state. Defaults to neutral when omitted.
    #[serde(default)]
    pub color: ClipColor,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Clip {
    pub id: String,
    pub track_id: String,
    pub asset_id: String,
    pub name: String,
    pub in_ticks: String,
    pub out_ticks: String,
    pub timeline_start_ticks: String,
    pub timeline_duration_ticks: String,
    pub sort_order: i64,
    /// Per-clip color state. Defaults to neutral; old payloads still parse.
    #[serde(default)]
    pub color: ClipColor,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Composition {
    pub id: String,
    pub project_id: String,
    pub version: i64,
    pub duration_ticks: String,
    pub time_base: RationalTimeBase,
    pub updated_at: String,
    pub tracks: Vec<Track>,
    pub clips: Vec<Clip>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum TimelineOperation {
    AddTrack { track: TrackInput },
    AddClip { clip: ClipInput },
    UpdateClip { clip: ClipInput },
    RemoveClip { clip_id: String },
    SetClipColor { clip_id: String, color: ClipColor },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CompositionMutation {
    pub operations: Vec<TimelineOperation>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MutationResult {
    pub composition: Composition,
    /// `true` means this came from an existing durable operation receipt.
    pub replayed: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CompositionSnapshot {
    pub composition_id: String,
    pub time_base: RationalTimeBase,
    pub tracks: Vec<Track>,
    pub clips: Vec<Clip>,
}

impl From<&Composition> for CompositionSnapshot {
    fn from(composition: &Composition) -> Self {
        Self {
            composition_id: composition.id.clone(),
            time_base: composition.time_base.clone(),
            tracks: composition.tracks.clone(),
            clips: composition.clips.clone(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Revision {
    pub id: String,
    pub project_id: String,
    pub revision_number: i64,
    pub commit_note: String,
    pub author: String,
    pub content_hash: String,
    pub parent_revision_id: Option<String>,
    pub composition_snapshot: CompositionSnapshot,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Queued,
    Running,
    Waiting,
    Retrying,
    Succeeded,
    Failed,
    Canceled,
}

impl JobStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Waiting => "waiting",
            Self::Retrying => "retrying",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Canceled => "canceled",
        }
    }

    pub(crate) fn parse(value: &str) -> Result<Self> {
        match value {
            "queued" => Ok(Self::Queued),
            "running" => Ok(Self::Running),
            "waiting" => Ok(Self::Waiting),
            "retrying" => Ok(Self::Retrying),
            "succeeded" => Ok(Self::Succeeded),
            "failed" => Ok(Self::Failed),
            "canceled" => Ok(Self::Canceled),
            _ => Err(CoreError::InvalidInput(format!(
                "invalid stored job status: {value}"
            ))),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct JobEnqueue {
    pub operation_id: String,
    pub project_id: String,
    pub revision_id: String,
    pub dependency_job_id: Option<String>,
    /// Requested output preset. `None` means the legacy 1080p_sdr pipeline.
    #[serde(default)]
    pub output: Option<OutputSpec>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RenderJobSource {
    pub source: String,
    pub expected_sha256: String,
    pub start: RationalTime,
    pub end: RationalTime,
    /// Per-clip color state copied from the revision snapshot.
    #[serde(default)]
    pub color: ClipColor,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RenderJobSpec {
    pub project_id: String,
    pub revision_id: String,
    /// The immutable revision's deterministic clip order. B0 media accepts two clips.
    pub clips: [RenderJobSource; 2],
    /// Output preset. Defaults to the legacy 1080p_sdr pipeline for old rows.
    #[serde(default = "default_render_output")]
    pub output: OutputSpec,
}

fn default_render_output() -> OutputSpec {
    OutputSpec::sd_1080p24_h264()
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct JobRecord {
    pub id: String,
    pub project_id: String,
    pub revision_id: Option<String>,
    pub operation_id: Option<String>,
    pub title: String,
    pub kind: String,
    pub status: JobStatus,
    pub input_json: String,
    pub input_digest: String,
    pub config_digest: Option<String>,
    pub attempt: i64,
    pub lease_token: Option<String>,
    pub lease_expires_at: Option<String>,
    pub heartbeat_at: Option<String>,
    pub stage: String,
    pub progress: i64,
    pub error: Option<String>,
    pub artifact_path: Option<String>,
    pub artifact_sha256: Option<String>,
    pub cancel_requested: bool,
    pub dependency_job_id: Option<String>,
    pub scratch_dir: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct JobClaim {
    pub job: JobRecord,
    pub lease_token: String,
}
