use std::{
    fs::{self, File},
    io::{BufReader, Read},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    AudioProbe, ColorGrade, ColorMetadata, InputColorSpace, LutInfo, LutSpec, MediaError,
    MediaProbe, OutputColor, OutputSpec, ProRenderRequest, RationalTime, RationalTimeBase,
    RenderArtifact, Result, SourceRange, TwoClipRenderRequest, VideoCodec, VideoProbe,
};

const HOMEBREW_FFMPEG: &str = "/opt/homebrew/bin/ffmpeg";
const HOMEBREW_FFPROBE: &str = "/opt/homebrew/bin/ffprobe";
const OUTPUT_WIDTH: u32 = 1920;
const OUTPUT_HEIGHT: u32 = 1080;
const OUTPUT_FRAME_RATE_NUMERATOR: i64 = 24;
const OUTPUT_FRAME_RATE_DENOMINATOR: i64 = 1;
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(20);
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Cooperative cancellation for the currently-owned child process.
#[derive(Clone, Debug, Default)]
pub struct CancellationToken(Arc<AtomicBool>);

impl CancellationToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

/// Precedence: explicit env override -> PATH -> Homebrew fallback.
fn resolve_media_executable(binary: &str, env_override: &str, fallback: &str) -> Result<PathBuf> {
    if let Some(dir) = std::env::var_os(env_override).filter(|v| !v.is_empty()) {
        let candidate = PathBuf::from(dir);
        if is_regular_file(&candidate) {
            return Ok(candidate);
        }
        return Err(MediaError::InvalidInput(format!(
            "media executable override {env_override} does not point at a regular file: {}",
            candidate.display()
        )));
    }
    if let Some(path) = find_on_path(binary) {
        return Ok(path);
    }
    let fallback = PathBuf::from(fallback);
    if is_regular_file(&fallback) {
        return Ok(fallback);
    }
    Err(MediaError::InvalidInput(format!(
        "required media executable `{binary}` was not found: set {env_override}, put `{binary}` on PATH, or install it at {}",
        fallback.display()
    )))
}

fn find_on_path(binary: &str) -> Option<PathBuf> {
    let file_name = if cfg!(windows) {
        format!("{binary}.exe")
    } else {
        binary.to_string()
    };
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|dir| dir.join(&file_name))
            .find(|candidate| is_regular_file(candidate))
    })
}

fn is_regular_file(path: &Path) -> bool {
    fs::metadata(path).map(|m| m.is_file()).unwrap_or(false)
}

/// Local media adapter. The ffmpeg/ffprobe pair resolves once at construction:
/// an explicit `CUTROOM_FFMPEG` / `CUTROOM_FFPROBE` override wins, then `PATH`,
/// then the Homebrew default. Resolution is fail-closed: a missing or
/// non-regular executable is an error, never a silent fallback.
#[derive(Clone, Debug)]
pub struct MediaEngine {
    ffmpeg: PathBuf,
    ffprobe: PathBuf,
}

impl MediaEngine {
    /// Resolves the local ffmpeg/ffprobe pair (see struct docs for precedence).
    pub fn discover() -> Result<Self> {
        let ffmpeg = resolve_media_executable("ffmpeg", "CUTROOM_FFMPEG", HOMEBREW_FFMPEG)?;
        let ffprobe = resolve_media_executable("ffprobe", "CUTROOM_FFPROBE", HOMEBREW_FFPROBE)?;
        Ok(Self { ffmpeg, ffprobe })
    }

    /// Absolute path of the resolved ffmpeg executable.
    pub fn ffmpeg_path(&self) -> &Path {
        &self.ffmpeg
    }

    /// Absolute path of the resolved ffprobe executable.
    pub fn ffprobe_path(&self) -> &Path {
        &self.ffprobe
    }

    /// Probes a regular local media file and returns exact stream timing plus its SHA-256.
    pub fn probe(&self, source: &Path, cancellation: &CancellationToken) -> Result<MediaProbe> {
        let source = canonical_media_file(source)?;
        let sha256 = hash_file(&source)?;
        let probe = self.probe_canonical(&source, sha256.clone(), cancellation)?;
        if hash_file(&source)? != sha256 {
            return Err(MediaError::SourceChanged(source));
        }
        Ok(probe)
    }

    /// Renders exactly two typed source ranges, in array order, to a new 1080p SDR H.264 artifact.
    pub fn render_1080p_sdr(
        &self,
        request: &TwoClipRenderRequest,
        cancellation: &CancellationToken,
    ) -> Result<RenderArtifact> {
        ensure_not_cancelled(cancellation)?;
        let destination = canonical_destination(&request.destination)?;
        let artifact_path = request.destination.clone();
        let mut prepared = Vec::with_capacity(2);
        for range in &request.clips {
            validate_expected_hash(&range.expected_sha256)?;
            let source = canonical_media_file(&range.source)?;
            ensure_destination_is_not_source(&destination, &source)?;
            let actual_hash = hash_file(&source)?;
            if actual_hash != range.expected_sha256 {
                return Err(MediaError::SourceIdentityMismatch {
                    source_path: source,
                    expected: range.expected_sha256.clone(),
                    actual: actual_hash,
                });
            }
            let probe =
                self.probe_canonical(&source, range.expected_sha256.clone(), cancellation)?;
            validate_renderable_source(&probe)?;
            prepared.push(PreparedClip {
                source,
                expected_sha256: range.expected_sha256.clone(),
                probe: probe.clone(),
                range: compile_range(range, &probe)?,
            });
        }
        let prepared: [PreparedClip; 2] = prepared
            .try_into()
            .map_err(|_| MediaError::InvalidInput("two source ranges are required".into()))?;
        if destination.exists() {
            return Err(MediaError::DestinationExists(destination));
        }
        validate_audio_compatibility(&prepared)?;

        let config_digest = render_config_digest(&prepared)?;
        let temp = OwnedTempDirectory::create(
            destination.parent().expect("validated destination parent"),
        )?;
        let temporary_artifact = temp.path().join("artifact.mp4");
        let filter_graph = render_filter_graph(&prepared)?;
        self.run_render(&prepared, &filter_graph, &temporary_artifact, cancellation)?;

        for clip in &prepared {
            let actual_hash = hash_file(&clip.source)?;
            if actual_hash != clip.expected_sha256 {
                return Err(MediaError::SourceChanged(clip.source.clone()));
            }
        }

        let output_hash = hash_file(&temporary_artifact)?;
        let mut output_probe =
            self.probe_canonical(&temporary_artifact, output_hash.clone(), cancellation)?;
        verify_render_output(&prepared, &output_probe)?;
        self.strict_decode(&temporary_artifact, cancellation)?;
        ensure_not_cancelled(cancellation)?;
        promote_without_clobber(&temporary_artifact, &destination)?;
        output_probe.source = destination.clone();

        Ok(RenderArtifact {
            path: artifact_path,
            sha256: output_hash,
            config_digest,
            probe: output_probe,
        })
    }

    fn probe_canonical(
        &self,
        source: &Path,
        sha256: String,
        cancellation: &CancellationToken,
    ) -> Result<MediaProbe> {
        let demuxer = source_demuxer(source)?;
        let output = run_command(
            Command::new(&self.ffprobe)
                .arg("-v")
                .arg("error")
                .arg("-protocol_whitelist")
                .arg("file,pipe")
                .arg("-show_format")
                .arg("-show_streams")
                .arg("-print_format")
                .arg("json")
                .arg("-f")
                .arg(demuxer)
                .arg("-i")
                .arg(source),
            "ffprobe",
            cancellation,
        )?;
        let report: FfprobeReport = serde_json::from_slice(&output.stdout)?;
        media_probe_from_report(source.to_path_buf(), sha256, report)
    }

    fn run_render(
        &self,
        clips: &[PreparedClip; 2],
        filter_graph: &str,
        temporary_artifact: &Path,
        cancellation: &CancellationToken,
    ) -> Result<()> {
        let has_audio = clips[0].probe.audio.is_some();
        let first_demuxer = source_demuxer(&clips[0].source)?;
        let second_demuxer = source_demuxer(&clips[1].source)?;
        let mut command = Command::new(&self.ffmpeg);
        command
            .arg("-hide_banner")
            .arg("-nostdin")
            .arg("-v")
            .arg("error")
            .arg("-xerror")
            .arg("-protocol_whitelist")
            .arg("file,pipe")
            .arg("-f")
            .arg(first_demuxer)
            .arg("-i")
            .arg(&clips[0].source)
            .arg("-f")
            .arg(second_demuxer)
            .arg("-i")
            .arg(&clips[1].source)
            .arg("-filter_complex")
            .arg(filter_graph)
            .arg("-map")
            .arg("[v]")
            .arg("-c:v")
            .arg("libx264")
            .arg("-pix_fmt")
            .arg("yuv420p")
            .arg("-r")
            .arg("24")
            .arg("-movflags")
            .arg("+faststart");
        if has_audio {
            command
                .arg("-map")
                .arg("[a]")
                .arg("-c:a")
                .arg("aac")
                .arg("-ar")
                .arg("48000");
        } else {
            command.arg("-an");
        }
        command.arg("-f").arg("mp4").arg(temporary_artifact);
        run_command(&mut command, "ffmpeg", cancellation)?;
        Ok(())
    }

    fn strict_decode(&self, artifact: &Path, cancellation: &CancellationToken) -> Result<()> {
        run_command(
            Command::new(&self.ffmpeg)
                .arg("-hide_banner")
                .arg("-nostdin")
                .arg("-v")
                .arg("error")
                .arg("-xerror")
                .arg("-protocol_whitelist")
                .arg("file,pipe")
                .arg("-f")
                .arg("mov")
                .arg("-i")
                .arg(artifact)
                .arg("-map")
                .arg("0:v:0")
                .arg("-map")
                .arg("0:a?")
                .arg("-f")
                .arg("null")
                .arg("-"),
            "ffmpeg",
            cancellation,
        )?;
        Ok(())
    }
}

#[derive(Clone, Debug)]
struct PreparedClip {
    source: PathBuf,
    expected_sha256: String,
    probe: MediaProbe,
    range: CompiledRange,
}

#[derive(Clone, Debug, Serialize)]
struct CompiledRange {
    video_start_pts: i128,
    video_end_pts: i128,
    #[serde(skip_serializing_if = "Option::is_none")]
    audio_start_pts: Option<i128>,
    #[serde(skip_serializing_if = "Option::is_none")]
    audio_end_pts: Option<i128>,
}

#[derive(Serialize)]
struct RenderConfig<'a> {
    preset: &'static str,
    clips: [DigestClip<'a>; 2],
}

#[derive(Serialize)]
struct DigestClip<'a> {
    source_sha256: &'a str,
    video_time_base: &'a RationalTimeBase,
    audio_time_base: Option<&'a RationalTimeBase>,
    range: &'a CompiledRange,
}

fn render_config_digest(clips: &[PreparedClip; 2]) -> Result<String> {
    let digest_clips = [
        DigestClip {
            source_sha256: &clips[0].expected_sha256,
            video_time_base: &clips[0].probe.video.time_base,
            audio_time_base: clips[0].probe.audio.as_ref().map(|audio| &audio.time_base),
            range: &clips[0].range,
        },
        DigestClip {
            source_sha256: &clips[1].expected_sha256,
            video_time_base: &clips[1].probe.video.time_base,
            audio_time_base: clips[1].probe.audio.as_ref().map(|audio| &audio.time_base),
            range: &clips[1].range,
        },
    ];
    let bytes = serde_json::to_vec(&RenderConfig {
        preset: "1080p_sdr_h264_aac",
        clips: digest_clips,
    })?;
    Ok(hex_digest(Sha256::digest(bytes).as_slice()))
}

fn compile_range(range: &SourceRange, probe: &MediaProbe) -> Result<CompiledRange> {
    let video_start_pts = exact_stream_ticks(&range.start, &probe.video.time_base, &range.source)?;
    let video_end_pts = exact_stream_ticks(&range.end, &probe.video.time_base, &range.source)?;
    let video_duration = parse_ticks(&probe.video.duration.ticks, &range.source)?;
    if video_end_pts <= video_start_pts {
        return Err(MediaError::InvalidRange {
            source_path: range.source.clone(),
            reason: "end must be greater than start for a half-open interval".into(),
        });
    }
    if video_end_pts > video_duration {
        return Err(MediaError::InvalidRange {
            source_path: range.source.clone(),
            reason: "end exceeds the exact video duration".into(),
        });
    }
    validate_video_frame_alignment(video_start_pts, video_end_pts, probe, &range.source)?;

    let (audio_start_pts, audio_end_pts) = match &probe.audio {
        Some(audio) => {
            let start = exact_stream_ticks(&range.start, &audio.time_base, &range.source)?;
            let end = exact_stream_ticks(&range.end, &audio.time_base, &range.source)?;
            let duration = parse_ticks(&audio.duration.ticks, &range.source)?;
            if end <= start || end > duration {
                return Err(MediaError::InvalidRange {
                    source_path: range.source.clone(),
                    reason: "range is not a nonempty interval within exact audio duration".into(),
                });
            }
            validate_audio_sample_alignment(start, end, audio, &range.source)?;
            (Some(start), Some(end))
        }
        None => (None, None),
    };
    Ok(CompiledRange {
        video_start_pts,
        video_end_pts,
        audio_start_pts,
        audio_end_pts,
    })
}

fn exact_stream_ticks(
    value: &RationalTime,
    stream_time_base: &RationalTimeBase,
    source: &Path,
) -> Result<i128> {
    let ticks =
        value
            .exact_ticks_in(stream_time_base)
            .map_err(|error| MediaError::InvalidRange {
                source_path: source.to_path_buf(),
                reason: format!("time cannot be represented exactly in stream ticks: {error}"),
            })?;
    parse_ticks(&ticks, source)
}

fn validate_video_frame_alignment(
    start: i128,
    end: i128,
    probe: &MediaProbe,
    source: &Path,
) -> Result<()> {
    let stride = stream_units_per_frame(&probe.video.time_base, &probe.video.frame_rate)?;
    if start % stride != 0 || end % stride != 0 {
        return Err(MediaError::InvalidRange {
            source_path: source.to_path_buf(),
            reason: format!(
                "range endpoints must align to whole video frames ({stride} stream ticks)"
            ),
        });
    }
    Ok(())
}

fn validate_audio_sample_alignment(
    start: i128,
    end: i128,
    audio: &AudioProbe,
    source: &Path,
) -> Result<()> {
    let stride = stream_units_per_sample(&audio.time_base, audio.sample_rate)?;
    if start % stride != 0 || end % stride != 0 {
        return Err(MediaError::InvalidRange {
            source_path: source.to_path_buf(),
            reason: format!(
                "range endpoints must align to whole audio samples ({stride} stream ticks)"
            ),
        });
    }
    Ok(())
}

fn stream_units_per_frame(
    time_base: &RationalTimeBase,
    frame_rate: &RationalTimeBase,
) -> Result<i128> {
    let numerator = (time_base.den as i128)
        .checked_mul(frame_rate.den as i128)
        .ok_or_else(|| {
            MediaError::UnsupportedMedia("frame alignment arithmetic overflows i128".into())
        })?;
    let denominator = (time_base.num as i128)
        .checked_mul(frame_rate.num as i128)
        .ok_or_else(|| {
            MediaError::UnsupportedMedia("frame alignment arithmetic overflows i128".into())
        })?;
    exact_positive_quotient(numerator, denominator, "video frame duration")
}

fn stream_units_per_sample(time_base: &RationalTimeBase, sample_rate: u32) -> Result<i128> {
    let denominator = (time_base.num as i128)
        .checked_mul(sample_rate as i128)
        .ok_or_else(|| {
            MediaError::UnsupportedMedia("audio alignment arithmetic overflows i128".into())
        })?;
    exact_positive_quotient(time_base.den as i128, denominator, "audio sample duration")
}

fn exact_positive_quotient(numerator: i128, denominator: i128, label: &str) -> Result<i128> {
    if numerator <= 0 || denominator <= 0 || numerator % denominator != 0 {
        return Err(MediaError::UnsupportedMedia(format!(
            "{label} is not exactly representable in stream ticks"
        )));
    }
    Ok(numerator / denominator)
}

fn validate_audio_compatibility(clips: &[PreparedClip; 2]) -> Result<()> {
    match (&clips[0].probe.audio, &clips[1].probe.audio) {
        (None, None) => Ok(()),
        (Some(left), Some(right))
            if left.codec == "aac"
                && right.codec == "aac"
                && left.sample_rate == 48_000
                && right.sample_rate == 48_000
                && left.channels == right.channels
                && (1..=2).contains(&left.channels) =>
        {
            Ok(())
        }
        _ => Err(MediaError::UnsupportedMedia(
            "initial two-range render requires matching AAC/48 kHz audio in both clips or no audio in both clips".into(),
        )),
    }
}

fn validate_renderable_source(probe: &MediaProbe) -> Result<()> {
    let video = &probe.video;
    if video.codec != "h264" || video.pixel_format != "yuv420p" {
        return Err(MediaError::UnsupportedMedia(
            "initial render supports SDR H.264/yuv420p video only".into(),
        ));
    }
    if video.frame_rate.num != OUTPUT_FRAME_RATE_NUMERATOR
        || video.frame_rate.den != OUTPUT_FRAME_RATE_DENOMINATOR
    {
        return Err(MediaError::UnsupportedMedia(
            "initial render supports constant 24 fps video only".into(),
        ));
    }
    if video.rotation_degrees != 0 {
        return Err(MediaError::UnsupportedMedia(
            "initial render does not transform rotated video".into(),
        ));
    }
    if is_hdr(&video.color) {
        return Err(MediaError::UnsupportedMedia(
            "HDR source is rejected because this B0 render has no HDR-to-SDR transform".into(),
        ));
    }
    Ok(())
}

fn is_hdr(color: &ColorMetadata) -> bool {
    matches!(
        color.color_transfer.as_deref(),
        Some("smpte2084") | Some("arib-std-b67")
    )
}

fn render_filter_graph(clips: &[PreparedClip; 2]) -> Result<String> {
    let first_video = &clips[0].range;
    let second_video = &clips[1].range;
    let mut graph = format!(
        "[0:v]trim=start_pts={}:end_pts={},setpts=PTS-STARTPTS,scale={}:{}:flags=lanczos,format=yuv420p[v0];\
         [1:v]trim=start_pts={}:end_pts={},setpts=PTS-STARTPTS,scale={}:{}:flags=lanczos,format=yuv420p[v1];",
        first_video.video_start_pts,
        first_video.video_end_pts,
        OUTPUT_WIDTH,
        OUTPUT_HEIGHT,
        second_video.video_start_pts,
        second_video.video_end_pts,
        OUTPUT_WIDTH,
        OUTPUT_HEIGHT,
    );
    match (
        first_video.audio_start_pts,
        first_video.audio_end_pts,
        second_video.audio_start_pts,
        second_video.audio_end_pts,
    ) {
        (Some(first_start), Some(first_end), Some(second_start), Some(second_end)) => {
            graph.push_str(&format!(
                "[0:a]atrim=start_pts={first_start}:end_pts={first_end},asetpts=PTS-STARTPTS[a0];\
                 [1:a]atrim=start_pts={second_start}:end_pts={second_end},asetpts=PTS-STARTPTS[a1];\
                 [v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]"
            ));
        }
        (None, None, None, None) => graph.push_str("[v0][v1]concat=n=2:v=1:a=0[v]"),
        _ => {
            return Err(MediaError::UnsupportedMedia(
                "clips have incompatible audio presence".into(),
            ));
        }
    }
    Ok(graph)
}

fn verify_render_output(clips: &[PreparedClip; 2], output: &MediaProbe) -> Result<()> {
    validate_renderable_source(output)?;
    if output.video.width != OUTPUT_WIDTH || output.video.height != OUTPUT_HEIGHT {
        return Err(MediaError::VerificationFailed(format!(
            "expected {OUTPUT_WIDTH}x{OUTPUT_HEIGHT} output, got {}x{}",
            output.video.width, output.video.height
        )));
    }
    let expected_video_ticks = clips.iter().try_fold(0_i128, |sum, clip| {
        let source_duration = clip
            .range
            .video_end_pts
            .checked_sub(clip.range.video_start_pts)
            .ok_or_else(|| {
                MediaError::VerificationFailed("negative compiled video duration".into())
            })?;
        let converted =
            RationalTime::from_ticks(source_duration, clip.probe.video.time_base.clone())
                .and_then(|time| time.exact_ticks_in(&output.video.time_base))
                .map_err(MediaError::Time)?;
        let converted = parse_ticks(&converted, &clip.source)?;
        sum.checked_add(converted).ok_or_else(|| {
            MediaError::VerificationFailed("expected duration overflows i128".into())
        })
    })?;
    if output.video.duration.ticks != expected_video_ticks.to_string() {
        return Err(MediaError::VerificationFailed(format!(
            "video duration mismatch: expected {expected_video_ticks} ticks in {}, got {}",
            time_base_label(&output.video.time_base),
            output.video.duration.ticks
        )));
    }
    let expect_audio = clips[0].probe.audio.is_some();
    if output.audio.is_some() != expect_audio {
        return Err(MediaError::VerificationFailed(
            "output audio stream presence does not match the sources".into(),
        ));
    }
    if let Some(audio) = &output.audio
        && (audio.codec != "aac" || audio.sample_rate != 48_000)
    {
        return Err(MediaError::VerificationFailed(
            "output audio must be AAC at 48 kHz".into(),
        ));
    }
    Ok(())
}

fn promote_without_clobber(temporary_artifact: &Path, destination: &Path) -> Result<()> {
    match fs::hard_link(temporary_artifact, destination) {
        Ok(()) => {
            let _ = fs::remove_file(temporary_artifact);
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            Err(MediaError::DestinationExists(destination.to_path_buf()))
        }
        Err(error) => Err(MediaError::Io(error)),
    }
}

fn canonical_media_file(path: &Path) -> Result<PathBuf> {
    let demuxer = source_demuxer(path)?;
    let metadata = fs::metadata(path).map_err(|error| {
        MediaError::InvalidInput(format!(
            "source must be an existing local regular file {}: {error}",
            path.display()
        ))
    })?;
    if !metadata.is_file() {
        return Err(MediaError::InvalidInput(format!(
            "source must be a regular file: {}",
            path.display()
        )));
    }
    validate_container_signature(path, demuxer)?;
    Ok(fs::canonicalize(path)?)
}

fn validate_container_signature(path: &Path, demuxer: &str) -> Result<()> {
    let mut file = File::open(path)?;
    let mut header = [0_u8; 12];
    let count = file.read(&mut header)?;
    let valid = match demuxer {
        "mov" => count >= 8 && &header[4..8] == b"ftyp",
        "matroska" => count >= 4 && header[..4] == [0x1a, 0x45, 0xdf, 0xa3],
        _ => false,
    };
    if !valid {
        return Err(MediaError::UnsupportedMedia(format!(
            "source does not match its permitted {demuxer} container signature"
        )));
    }
    Ok(())
}

fn source_demuxer(path: &Path) -> Result<&'static str> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("mp4") | Some("mov") | Some("m4v") => Ok("mov"),
        Some("mkv") => Ok("matroska"),
        _ => Err(MediaError::UnsupportedMedia(
            "B0 accepts only MP4/MOV/M4V or Matroska local media; playlists and manifests are rejected".into(),
        )),
    }
}

fn canonical_destination(path: &Path) -> Result<PathBuf> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| {
            MediaError::InvalidInput("destination must include an existing parent directory".into())
        })?;
    let filename = path
        .file_name()
        .ok_or_else(|| MediaError::InvalidInput("destination has no filename".into()))?;
    if path.extension().and_then(|extension| extension.to_str()) != Some("mp4") {
        return Err(MediaError::InvalidInput(
            "B0 render destination must use the .mp4 extension".into(),
        ));
    }
    let canonical_parent = fs::canonicalize(parent).map_err(|error| {
        MediaError::InvalidInput(format!(
            "destination parent must exist and be local: {error}"
        ))
    })?;
    Ok(canonical_parent.join(filename))
}

fn ensure_destination_is_not_source(destination: &Path, source: &Path) -> Result<()> {
    if destination == source {
        return Err(MediaError::DestinationAliasesSource(
            destination.to_path_buf(),
        ));
    }
    Ok(())
}

fn validate_expected_hash(hash: &str) -> Result<()> {
    if hash.len() != 64
        || !hash
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(MediaError::InvalidInput(
            "expected_sha256 must be a 64-character lowercase hexadecimal digest".into(),
        ));
    }
    Ok(())
}

fn hash_file(path: &Path) -> Result<String> {
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hex_digest(hasher.finalize().as_slice()))
}

fn hex_digest(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn ensure_not_cancelled(cancellation: &CancellationToken) -> Result<()> {
    if cancellation.is_cancelled() {
        Err(MediaError::Cancelled)
    } else {
        Ok(())
    }
}

const MAX_PROCESS_CAPTURE_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug)]
struct CapturedOutput {
    stdout: Vec<u8>,
}

fn run_command(
    command: &mut Command,
    program: &'static str,
    cancellation: &CancellationToken,
) -> Result<CapturedOutput> {
    ensure_not_cancelled(cancellation)?;
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| MediaError::InvalidInput("failed to capture child stdout".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| MediaError::InvalidInput("failed to capture child stderr".into()))?;
    let stdout_reader = thread::spawn(move || drain_stream(stdout));
    let stderr_reader = thread::spawn(move || drain_stream(stderr));

    let status = wait_for_child(&mut child, cancellation);
    let stdout = join_stream(stdout_reader)?;
    let stderr = join_stream(stderr_reader)?;
    let status = status?;
    if status.success() {
        return Ok(CapturedOutput { stdout });
    }
    Err(MediaError::ProcessFailed {
        program,
        status: status.to_string(),
        stderr: bounded_stderr(&stderr),
    })
}

fn wait_for_child(child: &mut Child, cancellation: &CancellationToken) -> Result<ExitStatus> {
    loop {
        if cancellation.is_cancelled() {
            terminate_owned_child(child)?;
            return Err(MediaError::Cancelled);
        }
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) => thread::sleep(PROCESS_POLL_INTERVAL),
            Err(error) => {
                let _ = terminate_owned_child(child);
                return Err(MediaError::Io(error));
            }
        }
    }
}

fn terminate_owned_child(child: &mut Child) -> std::io::Result<ExitStatus> {
    if let Err(error) = child.kill()
        && error.kind() != std::io::ErrorKind::InvalidInput
    {
        return Err(error);
    }
    child.wait()
}

fn drain_stream(mut stream: impl Read) -> std::io::Result<Vec<u8>> {
    let mut captured = Vec::new();
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let count = stream.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        let remaining = MAX_PROCESS_CAPTURE_BYTES.saturating_sub(captured.len());
        if count > remaining {
            while stream.read(&mut buffer)? != 0 {}
            return Err(std::io::Error::other(
                "process output exceeded bounded capture limit",
            ));
        }
        captured.extend_from_slice(&buffer[..count]);
    }
    Ok(captured)
}

fn join_stream(reader: thread::JoinHandle<std::io::Result<Vec<u8>>>) -> Result<Vec<u8>> {
    reader
        .join()
        .map_err(|_| MediaError::InvalidInput("process output reader panicked".into()))?
        .map_err(MediaError::Io)
}

fn bounded_stderr(stderr: &[u8]) -> String {
    const MAX: usize = 4_096;
    let truncated = stderr.len() > MAX;
    let mut text = String::from_utf8_lossy(&stderr[..stderr.len().min(MAX)]).into_owned();
    if truncated {
        text.push('…');
    }
    text
}

fn parse_ticks(value: &str, source: &Path) -> Result<i128> {
    value.parse::<i128>().map_err(|_| {
        MediaError::VerificationFailed(format!(
            "ffprobe returned a non-i128 tick value {value:?} for {}",
            source.display()
        ))
    })
}

fn time_base_label(time_base: &RationalTimeBase) -> String {
    format!("{}/{}", time_base.num, time_base.den)
}

struct OwnedTempDirectory {
    path: PathBuf,
}

impl OwnedTempDirectory {
    fn create(parent: &Path) -> Result<Self> {
        for _ in 0..128 {
            let sequence = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = parent.join(format!(
                ".cutroom-media-render-{}-{sequence}",
                std::process::id()
            ));
            match fs::create_dir(&path) {
                Ok(()) => return Ok(Self { path }),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(MediaError::Io(error)),
            }
        }
        Err(MediaError::InvalidInput(
            "could not allocate a unique owned render directory".into(),
        ))
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for OwnedTempDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[derive(Debug, Deserialize)]
struct FfprobeReport {
    #[serde(default)]
    streams: Vec<FfprobeStream>,
}

#[derive(Debug, Deserialize)]
struct FfprobeStream {
    #[serde(default)]
    codec_type: String,
    #[serde(default)]
    codec_name: String,
    width: Option<u32>,
    height: Option<u32>,
    time_base: Option<String>,
    r_frame_rate: Option<String>,
    avg_frame_rate: Option<String>,
    pix_fmt: Option<String>,
    duration_ts: Option<serde_json::Value>,
    channels: Option<u32>,
    sample_rate: Option<String>,
    color_space: Option<String>,
    color_transfer: Option<String>,
    color_primaries: Option<String>,
    #[serde(default)]
    side_data_list: Vec<FfprobeSideData>,
}

#[derive(Debug, Deserialize)]
struct FfprobeSideData {
    rotation: Option<serde_json::Value>,
}

fn media_probe_from_report(
    source: PathBuf,
    sha256: String,
    report: FfprobeReport,
) -> Result<MediaProbe> {
    let video_stream = report
        .streams
        .iter()
        .find(|stream| stream.codec_type == "video")
        .ok_or_else(|| MediaError::UnsupportedMedia("no video stream found".into()))?;
    let video_time_base = parse_time_base(required_string(
        video_stream.time_base.as_deref(),
        "video time_base",
    )?)?;
    let frame_rate = parse_time_base(required_string(
        video_stream.r_frame_rate.as_deref(),
        "video r_frame_rate",
    )?)?;
    let average_frame_rate = parse_time_base(required_string(
        video_stream.avg_frame_rate.as_deref(),
        "video avg_frame_rate",
    )?)?;
    if frame_rate != average_frame_rate {
        return Err(MediaError::UnsupportedMedia(
            "variable-frame-rate video is unsupported by the exact B0 renderer".into(),
        ));
    }
    let video_duration_ticks =
        json_integer(video_stream.duration_ts.as_ref(), "video duration_ts")?;
    let video = VideoProbe {
        codec: required_string(Some(&video_stream.codec_name), "video codec")?.to_owned(),
        width: video_stream
            .width
            .ok_or_else(|| MediaError::UnsupportedMedia("video width missing".into()))?,
        height: video_stream
            .height
            .ok_or_else(|| MediaError::UnsupportedMedia("video height missing".into()))?,
        duration: RationalTime::from_ticks(video_duration_ticks, video_time_base.clone())?,
        time_base: video_time_base,
        frame_rate,
        pixel_format: required_string(video_stream.pix_fmt.as_deref(), "video pixel format")?
            .to_owned(),
        rotation_degrees: rotation_degrees(&video_stream.side_data_list)?,
        color: ColorMetadata {
            color_space: video_stream.color_space.clone(),
            color_transfer: video_stream.color_transfer.clone(),
            color_primaries: video_stream.color_primaries.clone(),
        },
    };
    let audio = report
        .streams
        .iter()
        .find(|stream| stream.codec_type == "audio")
        .map(audio_probe_from_stream)
        .transpose()?;
    Ok(MediaProbe {
        source,
        sha256,
        video,
        audio,
    })
}

fn audio_probe_from_stream(stream: &FfprobeStream) -> Result<AudioProbe> {
    let time_base = parse_time_base(required_string(
        stream.time_base.as_deref(),
        "audio time_base",
    )?)?;
    let duration_ticks = json_integer(stream.duration_ts.as_ref(), "audio duration_ts")?;
    let sample_rate = required_string(stream.sample_rate.as_deref(), "audio sample_rate")?
        .parse::<u32>()
        .map_err(|_| {
            MediaError::UnsupportedMedia("audio sample_rate is not an unsigned integer".into())
        })?;
    Ok(AudioProbe {
        codec: required_string(Some(&stream.codec_name), "audio codec")?.to_owned(),
        channels: stream
            .channels
            .ok_or_else(|| MediaError::UnsupportedMedia("audio channels missing".into()))?,
        sample_rate,
        duration: RationalTime::from_ticks(duration_ticks, time_base.clone())?,
        time_base,
    })
}

fn required_string<'a>(value: Option<&'a str>, field: &str) -> Result<&'a str> {
    value.filter(|value| !value.is_empty()).ok_or_else(|| {
        MediaError::UnsupportedMedia(format!("ffprobe did not provide required {field}"))
    })
}

fn parse_time_base(value: &str) -> Result<RationalTimeBase> {
    let (numerator, denominator) = value.split_once('/').ok_or_else(|| {
        MediaError::UnsupportedMedia(format!("invalid rational time base {value:?}"))
    })?;
    if denominator.contains('/') {
        return Err(MediaError::UnsupportedMedia(format!(
            "invalid rational time base {value:?}"
        )));
    }
    let numerator = numerator.parse::<i64>().map_err(|_| {
        MediaError::UnsupportedMedia(format!("invalid rational numerator {numerator:?}"))
    })?;
    let denominator = denominator.parse::<i64>().map_err(|_| {
        MediaError::UnsupportedMedia(format!("invalid rational denominator {denominator:?}"))
    })?;
    RationalTimeBase::new(numerator, denominator).map_err(MediaError::Time)
}

fn json_integer(value: Option<&serde_json::Value>, field: &str) -> Result<i128> {
    let value = value
        .ok_or_else(|| MediaError::UnsupportedMedia(format!("ffprobe did not provide {field}")))?;
    let text = match value {
        serde_json::Value::Number(number) => number.to_string(),
        serde_json::Value::String(string) => string.clone(),
        _ => {
            return Err(MediaError::UnsupportedMedia(format!(
                "ffprobe {field} is not an integer"
            )));
        }
    };
    let ticks = text
        .parse::<i128>()
        .map_err(|_| MediaError::UnsupportedMedia(format!("ffprobe {field} is outside i128")))?;
    if ticks < 0 {
        return Err(MediaError::UnsupportedMedia(format!(
            "ffprobe {field} must not be negative"
        )));
    }
    Ok(ticks)
}

fn rotation_degrees(side_data: &[FfprobeSideData]) -> Result<i32> {
    let Some(rotation) = side_data.iter().find_map(|data| data.rotation.as_ref()) else {
        return Ok(0);
    };
    let text = match rotation {
        serde_json::Value::Number(number) => number.to_string(),
        serde_json::Value::String(string) => string.clone(),
        _ => {
            return Err(MediaError::UnsupportedMedia(
                "rotation is not an integer".into(),
            ));
        }
    };
    text.parse::<i32>()
        .map_err(|_| MediaError::UnsupportedMedia("rotation is outside i32".into()))
}

#[cfg(test)]
mod process_helper_tests {
    use std::{
        process::Command,
        thread,
        time::{Duration, Instant},
    };

    use super::{
        CancellationToken, MAX_PROCESS_CAPTURE_BYTES, MediaError, bounded_stderr, run_command,
        wait_for_child,
    };

    const SHELL: &str = "/bin/sh";

    #[test]
    fn concurrent_drainers_handle_output_larger_than_pipe_capacity() {
        let mut command = Command::new(SHELL);
        command.args([
            "-c",
            "i=0; while [ $i -lt 8192 ]; do printf 'stdout-pipe-drain\n'; printf 'stderr-pipe-drain\n' >&2; i=$((i + 1)); done",
        ]);
        let output = run_command(&mut command, "test-shell", &CancellationToken::new())
            .expect("drainers must prevent the child from blocking on full pipes");
        assert!(output.stdout.len() > 64 * 1024);
    }

    #[test]
    fn output_capture_overflow_is_bounded_and_reported() {
        let block = "x".repeat(1024);
        let script = format!(
            "i=0; while [ $i -lt {} ]; do printf '%s' '{block}'; i=$((i + 1)); done",
            MAX_PROCESS_CAPTURE_BYTES / block.len() + 1
        );
        let mut command = Command::new(SHELL);
        command.args(["-c", &script]);
        let error = run_command(&mut command, "test-shell", &CancellationToken::new())
            .expect_err("capture larger than the fixed bound must fail");
        assert!(
            matches!(error, MediaError::Io(error) if error.to_string().contains("capture limit"))
        );
    }

    #[test]
    fn bounded_stderr_handles_a_truncated_multibyte_codepoint() {
        let mut stderr = vec![b'a'; 4_095];
        stderr.extend_from_slice("🙂failure".as_bytes());
        let message = bounded_stderr(&stderr);
        assert!(message.ends_with('…'));
        assert!(message.starts_with(&"a".repeat(4_095)));
    }

    #[test]
    fn failed_process_reports_utf8_safe_bounded_stderr() {
        let prefix = "a".repeat(4_095);
        let script = format!(
            "printf '%s' '{prefix}' >&2; printf '\\360\\237\\230\\200failure' >&2; exit 17"
        );
        let mut command = Command::new(SHELL);
        command.args(["-c", &script]);
        let error = run_command(&mut command, "test-shell", &CancellationToken::new())
            .expect_err("fixed non-zero child must return ProcessFailed");
        let MediaError::ProcessFailed { status, stderr, .. } = error else {
            panic!("expected process failure");
        };
        assert!(status.contains("17"));
        assert!(stderr.ends_with('…'));
        assert!(stderr.starts_with(&prefix));
    }

    #[test]
    fn cancellation_kills_and_reaps_the_owned_child() {
        let mut child = Command::new(SHELL)
            .args(["-c", "exec sleep 30"])
            .spawn()
            .expect("start fixed test child");
        let cancellation = CancellationToken::new();
        let canceller = cancellation.clone();
        let started = Instant::now();
        let cancel_thread = thread::spawn(move || {
            thread::sleep(Duration::from_millis(40));
            canceller.cancel();
        });

        let error = wait_for_child(&mut child, &cancellation).expect_err("child must be cancelled");
        cancel_thread.join().expect("join cancellation thread");
        assert!(matches!(error, MediaError::Cancelled));
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(child.try_wait().expect("child status after wait").is_some());
    }
}

// ==================== Pro render pipeline (v1) ====================
//
// The pro pipeline widens the B0 preset: up to 4K UHD input, up to 120 fps
// constant frame rate, H.264/H.265, 8/10-bit SDR, HDR (PQ/HLG), log inputs,
// rotated phone footage, per-clip color grades, user .cube LUTs, and output
// presets (720p/1080p/4K at 24/25/30/50/60 fps, H.264/H.265, SDR/HDR10).
//
// The safety contract is unchanged: typed requests only, no caller-provided
// filtergraphs, SHA-256 identity checks, owned temp directories, bounded
// process capture, and post-render verification.

const PRO_MAX_WIDTH: u32 = 3840;
const PRO_MAX_HEIGHT: u32 = 2160;
const PRO_MAX_FPS: f64 = 120.0;
const MAX_LUT_BYTES: usize = 16 * 1024 * 1024;
const MAX_LUT_DIMENSION: u32 = 64;

/// Built-in S-Log3/S-Gamut3 -> Rec.709 de-log LUT (33^3), generated from
/// Sony's published S-Log3 inverse EOTF and the S-Gamut3 primaries via
/// `assets/luts/generate.py`. Embedded so renders never depend on runtime
/// file layout.
const BUILTIN_SLOG3_CUBE: &[u8] = include_bytes!("../assets/luts/slog3_to_rec709.cube");
const BUILTIN_SLOG3_FILENAME: &str = "cutroom-slog3-to-rec709.cube";

const PRO_OUTPUT_SIZES: [(u32, u32); 3] = [(1280, 720), (1920, 1080), (3840, 2160)];
const PRO_OUTPUT_FRAME_RATES: [(i64, i64); 5] = [(24, 1), (25, 1), (30, 1), (50, 1), (60, 1)];

#[derive(Clone, Debug)]
struct ValidatedLut {
    sha256: String,
    /// Canonical path of the exact bytes that were validated. The render must
    /// use this path, never the caller-supplied `LutSpec.path`, so a swapped
    /// symlink or relative-path alias cannot change what FFmpeg reads.
    canonical_path: PathBuf,
}

#[derive(Clone, Debug)]
struct ProClip {
    prepared: PreparedClip,
    grade: ColorGrade,
    input_color_space: InputColorSpace,
    lut: Option<ValidatedLut>,
    normalization: Normalization,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Normalization {
    None,
    TonemapHdr { transfer_in: &'static str },
    DelogSLog3,
    GamutBt2020To709,
    HdrPassthrough,
}

impl Normalization {
    fn label(&self) -> &'static str {
        match self {
            Normalization::None => "none",
            Normalization::TonemapHdr { .. } => "tonemap_hdr",
            Normalization::DelogSLog3 => "delog_slog3",
            Normalization::GamutBt2020To709 => "gamut_bt2020_to_709",
            Normalization::HdrPassthrough => "hdr_passthrough",
        }
    }
}

impl MediaEngine {
    /// Renders two typed source ranges with per-clip color grades to a pro
    /// output preset (resolution / frame rate / codec / SDR-or-HDR10).
    pub fn render_pro(
        &self,
        request: &ProRenderRequest,
        cancellation: &CancellationToken,
    ) -> Result<RenderArtifact> {
        ensure_not_cancelled(cancellation)?;
        validate_output_spec(&request.output)?;
        let destination = canonical_destination(&request.destination)?;
        let artifact_path = request.destination.clone();

        let mut prepared = Vec::with_capacity(2);
        for range in &request.clips {
            validate_expected_hash(&range.expected_sha256)?;
            let source = canonical_media_file(&range.source)?;
            ensure_destination_is_not_source(&destination, &source)?;
            let actual_hash = hash_file(&source)?;
            if actual_hash != range.expected_sha256 {
                return Err(MediaError::SourceIdentityMismatch {
                    source_path: source,
                    expected: range.expected_sha256.clone(),
                    actual: actual_hash,
                });
            }
            let probe =
                self.probe_canonical(&source, range.expected_sha256.clone(), cancellation)?;
            validate_pro_source(&probe)?;
            let lut = match &range.color.lut {
                Some(spec) => Some(validate_lut_spec(spec, &source)?),
                None => None,
            };
            validate_color_grade(&range.color)?;
            let normalization = normalization_for(
                &probe,
                range.input_color_space,
                range.color.lut.is_some(),
                &request.output,
            )?;
            prepared.push(ProClip {
                prepared: PreparedClip {
                    source,
                    expected_sha256: range.expected_sha256.clone(),
                    probe: probe.clone(),
                    range: compile_range(range, &probe)?,
                },
                grade: range.color.clone(),
                input_color_space: range.input_color_space,
                lut,
                normalization,
            });
        }
        let prepared: [ProClip; 2] = prepared
            .try_into()
            .map_err(|_| MediaError::InvalidInput("two source ranges are required".into()))?;
        if destination.exists() {
            return Err(MediaError::DestinationExists(destination));
        }
        validate_pro_audio_compatibility(&prepared)?;

        let config_digest = pro_config_digest(&prepared, &request.output)?;
        let temp = OwnedTempDirectory::create(
            destination.parent().expect("validated destination parent"),
        )?;
        let temporary_artifact = temp.path().join("artifact.mp4");
        if prepared
            .iter()
            .any(|clip| clip.normalization == Normalization::DelogSLog3)
        {
            fs::write(temp.path().join(BUILTIN_SLOG3_FILENAME), BUILTIN_SLOG3_CUBE)?;
        }
        let filter_graph = pro_filter_graph(&prepared, &request.output, temp.path())?;
        self.run_render_pro(
            &prepared,
            &request.output,
            &filter_graph,
            &temporary_artifact,
            cancellation,
        )?;

        for clip in &prepared {
            let actual_hash = hash_file(&clip.prepared.source)?;
            if actual_hash != clip.prepared.expected_sha256 {
                return Err(MediaError::SourceChanged(clip.prepared.source.clone()));
            }
            if let Some(lut) = &clip.lut {
                let lut_hash = hash_file(&lut.canonical_path)?;
                if lut_hash != lut.sha256 {
                    return Err(MediaError::SourceChanged(lut.canonical_path.clone()));
                }
            }
        }

        let output_hash = hash_file(&temporary_artifact)?;
        let mut output_probe =
            self.probe_canonical(&temporary_artifact, output_hash.clone(), cancellation)?;
        verify_render_output_pro(&prepared, &request.output, &output_probe)?;
        self.strict_decode(&temporary_artifact, cancellation)?;
        ensure_not_cancelled(cancellation)?;
        promote_without_clobber(&temporary_artifact, &destination)?;
        output_probe.source = destination.clone();

        Ok(RenderArtifact {
            path: artifact_path,
            sha256: output_hash,
            config_digest,
            probe: output_probe,
        })
    }

    /// Validates a user-supplied `.cube` file without rendering. Returns its
    /// parsed description; the caller stores the sha256 on its `LutSpec`.
    pub fn validate_lut(path: &Path) -> Result<LutInfo> {
        let canonical = fs::canonicalize(path).map_err(|error| {
            MediaError::InvalidInput(format!(
                "LUT path is not a readable local file {}: {error}",
                path.display()
            ))
        })?;
        let metadata = fs::metadata(&canonical).map_err(MediaError::Io)?;
        if !metadata.is_file() {
            return Err(MediaError::InvalidInput(format!(
                "LUT must be a regular file: {}",
                canonical.display()
            )));
        }
        parse_cube_file(&canonical)
    }

    fn run_render_pro(
        &self,
        clips: &[ProClip; 2],
        output: &OutputSpec,
        filter_graph: &str,
        temporary_artifact: &Path,
        cancellation: &CancellationToken,
    ) -> Result<()> {
        let has_audio = clips[0].prepared.probe.audio.is_some();
        let first_demuxer = source_demuxer(&clips[0].prepared.source)?;
        let second_demuxer = source_demuxer(&clips[1].prepared.source)?;
        let mut command = Command::new(&self.ffmpeg);
        command
            .arg("-hide_banner")
            .arg("-nostdin")
            .arg("-v")
            .arg("error")
            .arg("-xerror")
            .arg("-protocol_whitelist")
            .arg("file,pipe")
            .arg("-f")
            .arg(first_demuxer)
            .arg("-i")
            .arg(&clips[0].prepared.source)
            .arg("-f")
            .arg(second_demuxer)
            .arg("-i")
            .arg(&clips[1].prepared.source)
            .arg("-filter_complex")
            .arg(filter_graph)
            .arg("-map")
            .arg("[v]");
        match output.codec {
            VideoCodec::H264 => {
                command
                    .arg("-c:v")
                    .arg("libx264")
                    .arg("-pix_fmt")
                    .arg("yuv420p")
                    .arg("-crf")
                    .arg("18")
                    .arg("-preset")
                    .arg("medium");
                if output.color == OutputColor::SdrRec709 {
                    // `-color_*` is belt-and-braces; the encoder params below
                    // are what this FFmpeg build actually writes to the file.
                    command
                        .arg("-color_primaries")
                        .arg("bt709")
                        .arg("-color_trc")
                        .arg("bt709")
                        .arg("-colorspace")
                        .arg("bt709")
                        .arg("-x264-params")
                        .arg("colorprim=bt709:transfer=bt709:colormatrix=bt709");
                }
            }
            VideoCodec::H265 => {
                command
                    .arg("-c:v")
                    .arg("libx265")
                    .arg("-preset")
                    .arg("medium");
                if output.color == OutputColor::Hdr10 {
                    command
                        .arg("-pix_fmt")
                        .arg("yuv420p10le")
                        .arg("-crf")
                        .arg("20")
                        .arg("-color_primaries")
                        .arg("bt2020")
                        .arg("-color_trc")
                        .arg("smpte2084")
                        .arg("-colorspace")
                        .arg("bt2020nc")
                        .arg("-x265-params")
                        .arg("colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):max-cll=1000,400");
                } else {
                    command
                        .arg("-pix_fmt")
                        .arg("yuv420p")
                        .arg("-crf")
                        .arg("20")
                        .arg("-color_primaries")
                        .arg("bt709")
                        .arg("-color_trc")
                        .arg("bt709")
                        .arg("-colorspace")
                        .arg("bt709")
                        .arg("-x265-params")
                        .arg("colorprim=bt709:transfer=bt709:colormatrix=bt709");
                }
            }
        }
        command
            .arg("-r")
            .arg(format!(
                "{}/{}",
                output.frame_rate.num, output.frame_rate.den
            ))
            .arg("-movflags")
            .arg("+faststart");
        if has_audio {
            command
                .arg("-map")
                .arg("[a]")
                .arg("-c:a")
                .arg("aac")
                .arg("-ar")
                .arg("48000");
        } else {
            command.arg("-an");
        }
        command.arg("-f").arg("mp4").arg(temporary_artifact);
        run_command(&mut command, "ffmpeg", cancellation)?;
        Ok(())
    }
}

fn validate_output_spec(output: &OutputSpec) -> Result<()> {
    if !PRO_OUTPUT_SIZES.contains(&(output.width, output.height)) {
        return Err(MediaError::InvalidInput(format!(
            "pro output size must be one of 1280x720, 1920x1080, 3840x2160; got {}x{}",
            output.width, output.height
        )));
    }
    if !PRO_OUTPUT_FRAME_RATES.contains(&(output.frame_rate.num, output.frame_rate.den)) {
        return Err(MediaError::InvalidInput(format!(
            "pro output frame rate must be one of 24, 25, 30, 50, 60 fps; got {}/{}",
            output.frame_rate.num, output.frame_rate.den
        )));
    }
    if output.color == OutputColor::Hdr10 && output.codec != VideoCodec::H265 {
        return Err(MediaError::InvalidInput(
            "HDR10 output requires the H.265 codec".into(),
        ));
    }
    Ok(())
}

fn validate_pro_source(probe: &MediaProbe) -> Result<()> {
    let video = &probe.video;
    if video.codec != "h264" && video.codec != "hevc" {
        return Err(MediaError::UnsupportedMedia(format!(
            "pro render supports H.264/H.265 video only; got {}",
            video.codec
        )));
    }
    match video.pixel_format.as_str() {
        "yuv420p" | "yuv422p" | "yuv444p" | "yuv420p10le" | "yuv422p10le" | "yuv444p10le" => {}
        other => {
            return Err(MediaError::UnsupportedMedia(format!(
                "pro render supports 8/10-bit YUV pixel formats only; got {other}"
            )));
        }
    }
    if video.width < 16
        || video.width > PRO_MAX_WIDTH
        || video.height < 16
        || video.height > PRO_MAX_HEIGHT
    {
        return Err(MediaError::UnsupportedMedia(format!(
            "pro render supports up to 3840x2160 input; got {}x{}",
            video.width, video.height
        )));
    }
    let fps = video.frame_rate.num as f64 / video.frame_rate.den as f64;
    if !(fps > 0.0 && fps <= PRO_MAX_FPS) {
        return Err(MediaError::UnsupportedMedia(format!(
            "pro render supports constant frame rates up to 120 fps; got {fps}"
        )));
    }
    if !matches!(video.rotation_degrees, 0 | 90 | 180 | 270) {
        return Err(MediaError::UnsupportedMedia(format!(
            "pro render supports 0/90/180/270 degree rotation only; got {}",
            video.rotation_degrees
        )));
    }
    Ok(())
}

fn validate_color_grade(grade: &ColorGrade) -> Result<()> {
    // Ranges are enforced once in cutroom-core so edits fail fast; the
    // engine re-validates so a queued job can never render a bad grade.
    grade
        .validate()
        .map_err(|error| MediaError::InvalidInput(error.to_string()))
}

fn validate_lut_spec(spec: &LutSpec, source: &Path) -> Result<ValidatedLut> {
    validate_expected_hash(&spec.expected_sha256)?;
    let canonical = fs::canonicalize(&spec.path).map_err(|error| {
        MediaError::InvalidInput(format!(
            "LUT path is not a readable local file {}: {error}",
            spec.path.display()
        ))
    })?;
    let info = parse_cube_file(&canonical)?;
    if info.sha256 != spec.expected_sha256 {
        return Err(MediaError::SourceIdentityMismatch {
            source_path: canonical.clone(),
            expected: spec.expected_sha256.clone(),
            actual: info.sha256,
        });
    }
    let _ = source;
    Ok(ValidatedLut {
        sha256: info.sha256,
        canonical_path: canonical,
    })
}

fn clip_is_hdr(probe: &MediaProbe, declared: InputColorSpace) -> bool {
    matches!(declared, InputColorSpace::PqHdr | InputColorSpace::HlgHdr)
        || matches!(
            probe.video.color.color_transfer.as_deref(),
            Some("smpte2084") | Some("arib-std-b67")
        )
}

fn normalization_for(
    probe: &MediaProbe,
    declared: InputColorSpace,
    has_lut: bool,
    output: &OutputSpec,
) -> Result<Normalization> {
    let hdr = clip_is_hdr(probe, declared);
    match output.color {
        OutputColor::Hdr10 => {
            if !hdr {
                return Err(MediaError::UnsupportedMedia(
                    "HDR10 output requires HDR (PQ) sources; SDR-to-HDR upmapping is unsupported"
                        .into(),
                ));
            }
            let transfer = probe.video.color.color_transfer.as_deref();
            if declared == InputColorSpace::HlgHdr || transfer == Some("arib-std-b67") {
                return Err(MediaError::UnsupportedMedia(
                    "HDR10 output supports PQ sources only; HLG is tone-mapped to SDR".into(),
                ));
            }
            Ok(Normalization::HdrPassthrough)
        }
        OutputColor::SdrRec709 => {
            if hdr {
                let transfer_in = match declared {
                    InputColorSpace::HlgHdr => "arib-std-b67",
                    InputColorSpace::PqHdr => "smpte2084",
                    _ => match probe.video.color.color_transfer.as_deref() {
                        Some("arib-std-b67") => "arib-std-b67",
                        _ => "smpte2084",
                    },
                };
                return Ok(Normalization::TonemapHdr { transfer_in });
            }
            match declared {
                InputColorSpace::SLog3 => Ok(Normalization::DelogSLog3),
                InputColorSpace::VLog | InputColorSpace::CLog3 if !has_lut => {
                    Err(MediaError::UnsupportedMedia(
                        "no built-in de-log LUT for V-Log/C-Log3 yet; import the manufacturer's official .cube LUT instead".into(),
                    ))
                }
                InputColorSpace::VLog | InputColorSpace::CLog3 => {
                    // The user's own LUT performs the de-log; the pipeline
                    // stays in the source gamut until the LUT runs.
                    Ok(Normalization::None)
                }
                _ => {
                    let wide_gamut = probe.video.color.color_primaries.as_deref() == Some("bt2020")
                        || declared == InputColorSpace::Bt2020Sdr;
                    if wide_gamut {
                        Ok(Normalization::GamutBt2020To709)
                    } else {
                        Ok(Normalization::None)
                    }
                }
            }
        }
    }
}

fn validate_pro_audio_compatibility(clips: &[ProClip; 2]) -> Result<()> {
    match (
        &clips[0].prepared.probe.audio,
        &clips[1].prepared.probe.audio,
    ) {
        (None, None) => Ok(()),
        (Some(_), Some(_)) => Ok(()),
        _ => Err(MediaError::UnsupportedMedia(
            "pro render requires audio in both clips or in neither clip".into(),
        )),
    }
}

fn escape_filter_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    let mut escaped = String::with_capacity(text.len());
    for ch in text.chars() {
        if ch == '\'' || ch == '\\' || ch == ':' {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    escaped
}

fn derotate_filter(rotation_degrees: i32) -> &'static str {
    match rotation_degrees {
        90 => "transpose=1,",
        180 => "hflip,vflip,",
        270 => "transpose=2,",
        _ => "",
    }
}

fn normalization_filters(normalization: Normalization) -> Result<String> {
    match normalization {
        Normalization::None => Ok(String::new()),
        Normalization::TonemapHdr { transfer_in } => Ok(format!(
            "zscale=tin={transfer_in}:min=bt2020nc:pin=bt2020:t=linear,tonemap=hable:desat=0,\
             zscale=t=bt709:m=bt709:p=bt709:range=tv,format=yuv420p,"
        )),
        Normalization::DelogSLog3 => {
            // Applied in the RGB section of the graph (see pro_filter_graph):
            // the built-in LUT expects S-Log3-encoded RGB, not YUV.
            Ok(String::new())
        }
        Normalization::GamutBt2020To709 => Ok(
            "zscale=m=bt709:t=bt709:p=bt709:range=tv,format=yuv420p,".to_string(),
        ),
        Normalization::HdrPassthrough => Ok(
            "zscale=tin=smpte2084:min=bt2020nc:pin=bt2020:t=smpte2084:m=bt2020nc:p=bt2020:range=tv,\
             format=yuv420p10le,"
                .to_string(),
        ),
    }
}

fn grade_filters(grade: &ColorGrade, lut: Option<&ValidatedLut>) -> String {
    let mut chain = String::new();
    if grade.exposure_ev != 0.0 {
        chain.push_str(&format!("exposure=exposure={:.4},", grade.exposure_ev));
    }
    if grade.contrast != 1.0 || grade.saturation != 1.0 {
        chain.push_str(&format!(
            "eq=contrast={:.4}:saturation={:.4},",
            grade.contrast, grade.saturation
        ));
    }
    if grade.wb_temp != 0.0 || grade.wb_tint != 0.0 {
        // Temperature: warm pushes red up / blue down; tint: magenta pushes
        // red+blue up / green down. Applied uniformly across shadows/mids/highs.
        let r = 0.25 * grade.wb_temp + 0.15 * grade.wb_tint;
        let g = -0.15 * grade.wb_tint;
        let b = -0.25 * grade.wb_temp + 0.15 * grade.wb_tint;
        chain.push_str(&format!(
            "colorbalance=rs={r:.4}:gs={g:.4}:bs={b:.4}:rm={r:.4}:gm={g:.4}:bm={b:.4}:rh={r:.4}:gh={g:.4}:bh={b:.4},"
        ));
    }
    if let Some(lut) = lut {
        chain.push_str(&format!(
            "lut3d=file='{}',",
            escape_filter_path(&lut.canonical_path)
        ));
    }
    chain
}

fn pro_filter_graph(clips: &[ProClip; 2], output: &OutputSpec, temp_dir: &Path) -> Result<String> {
    let mut graph = String::new();
    for (index, clip) in clips.iter().enumerate() {
        let range = &clip.prepared.range;
        graph.push_str(&format!(
            "[{index}:v]trim=start_pts={}:end_pts={},setpts=PTS-STARTPTS,{}",
            range.video_start_pts,
            range.video_end_pts,
            derotate_filter(clip.prepared.probe.video.rotation_degrees),
        ));
        graph.push_str(&format!(
            "scale={}:{}:flags=lanczos:force_original_aspect_ratio=decrease,\
             pad={}:{}:(ow-iw)/2:(oh-ih)/2:color=black,fps={}/{},",
            output.width,
            output.height,
            output.width,
            output.height,
            output.frame_rate.num,
            output.frame_rate.den
        ));
        graph.push_str(&normalization_filters(clip.normalization)?);
        // Grades and LUTs are defined in RGB: convert here so exposure,
        // white balance, and .cube LUTs all see display-referred RGB.
        let rgb_format = if output.color == OutputColor::Hdr10 {
            "gbrp10le"
        } else {
            "gbrp"
        };
        graph.push_str(&format!("format={rgb_format},"));
        if clip.normalization == Normalization::DelogSLog3 {
            let lut_path = temp_dir.join(BUILTIN_SLOG3_FILENAME);
            graph.push_str(&format!("lut3d=file='{}',", escape_filter_path(&lut_path)));
        }
        graph.push_str(&grade_filters(&clip.grade, clip.lut.as_ref()));
        let pix_fmt = if output.color == OutputColor::Hdr10 {
            "yuv420p10le"
        } else {
            "yuv420p"
        };
        graph.push_str(&format!("format={pix_fmt}[v{index}];"));
    }
    let has_audio = clips[0].prepared.probe.audio.is_some();
    if has_audio {
        for (index, clip) in clips.iter().enumerate() {
            let range = &clip.prepared.range;
            let (start, end) = match (range.audio_start_pts, range.audio_end_pts) {
                (Some(start), Some(end)) => (start, end),
                _ => {
                    return Err(MediaError::UnsupportedMedia(
                        "clip audio range missing while audio is present".into(),
                    ));
                }
            };
            graph.push_str(&format!(
                "[{index}:a]atrim=start_pts={start}:end_pts={end},asetpts=PTS-STARTPTS,\
                 aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a{index}];"
            ));
        }
        graph.push_str("[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]");
    } else {
        graph.push_str("[v0][v1]concat=n=2:v=1:a=0[v]");
    }
    Ok(graph)
}

fn verify_render_output_pro(
    clips: &[ProClip; 2],
    output: &OutputSpec,
    rendered: &MediaProbe,
) -> Result<()> {
    if rendered.video.width != output.width || rendered.video.height != output.height {
        return Err(MediaError::VerificationFailed(format!(
            "expected {}x{} output, got {}x{}",
            output.width, output.height, rendered.video.width, rendered.video.height
        )));
    }
    if rendered.video.frame_rate != output.frame_rate {
        return Err(MediaError::VerificationFailed(format!(
            "expected {} fps output, got {}/{}",
            output.frame_rate.num, rendered.video.frame_rate.num, rendered.video.frame_rate.den
        )));
    }
    let expected_codec = match output.codec {
        VideoCodec::H264 => "h264",
        VideoCodec::H265 => "hevc",
    };
    if rendered.video.codec != expected_codec {
        return Err(MediaError::VerificationFailed(format!(
            "expected {expected_codec} output, got {}",
            rendered.video.codec
        )));
    }
    let expected_pix_fmt = if output.color == OutputColor::Hdr10 {
        "yuv420p10le"
    } else {
        "yuv420p"
    };
    if rendered.video.pixel_format != expected_pix_fmt {
        return Err(MediaError::VerificationFailed(format!(
            "expected {expected_pix_fmt} output, got {}",
            rendered.video.pixel_format
        )));
    }
    // Duration: sum the compiled source ranges in seconds and compare with
    // the rendered duration within a small tolerance. Exact tick equality
    // cannot hold across differing source/output time bases (e.g. 120 fps
    // sources rendered to 24 fps), so this is a bounded approximation
    // check, not a frame-count proof.
    let mut expected_seconds = 0.0_f64;
    for clip in clips {
        let source_ticks = clip
            .prepared
            .range
            .video_end_pts
            .checked_sub(clip.prepared.range.video_start_pts)
            .ok_or_else(|| {
                MediaError::VerificationFailed("negative compiled video duration".into())
            })?;
        let time_base = &clip.prepared.probe.video.time_base;
        expected_seconds += source_ticks as f64 * time_base.num as f64 / time_base.den as f64;
    }
    let rendered_ticks = parse_ticks(&rendered.video.duration.ticks, &rendered.source)?;
    let rendered_time_base = &rendered.video.time_base;
    let rendered_seconds =
        rendered_ticks as f64 * rendered_time_base.num as f64 / rendered_time_base.den as f64;
    let output_fps = output.frame_rate.num as f64 / output.frame_rate.den as f64;
    let tolerance = 2.0 / output_fps + 1e-3;
    if (rendered_seconds - expected_seconds).abs() > tolerance {
        return Err(MediaError::VerificationFailed(format!(
            "video duration mismatch: expected {expected_seconds:.3}s, got {rendered_seconds:.3}s"
        )));
    }
    let expect_audio = clips[0].prepared.probe.audio.is_some();
    if rendered.audio.is_some() != expect_audio {
        return Err(MediaError::VerificationFailed(
            "output audio stream presence does not match the sources".into(),
        ));
    }
    if let Some(audio) = &rendered.audio
        && (audio.codec != "aac" || audio.sample_rate != 48_000 || audio.channels != 2)
    {
        return Err(MediaError::VerificationFailed(
            "pro output audio must be stereo AAC at 48 kHz".into(),
        ));
    }
    Ok(())
}

#[derive(Serialize)]
struct ProRenderConfig<'a> {
    preset: &'static str,
    output: &'a OutputSpec,
    clips: [ProDigestClip<'a>; 2],
}

#[derive(Serialize)]
struct ProDigestClip<'a> {
    source_sha256: &'a str,
    video_time_base: &'a RationalTimeBase,
    audio_time_base: Option<&'a RationalTimeBase>,
    range: &'a CompiledRange,
    grade: &'a ColorGrade,
    input_color_space: &'a InputColorSpace,
    lut_sha256: Option<&'a str>,
    normalization: &'a str,
}

fn pro_config_digest(clips: &[ProClip; 2], output: &OutputSpec) -> Result<String> {
    let digest_clips = [
        ProDigestClip {
            source_sha256: &clips[0].prepared.expected_sha256,
            video_time_base: &clips[0].prepared.probe.video.time_base,
            audio_time_base: clips[0]
                .prepared
                .probe
                .audio
                .as_ref()
                .map(|audio| &audio.time_base),
            range: &clips[0].prepared.range,
            grade: &clips[0].grade,
            input_color_space: &clips[0].input_color_space,
            lut_sha256: clips[0].lut.as_ref().map(|lut| lut.sha256.as_str()),
            normalization: clips[0].normalization.label(),
        },
        ProDigestClip {
            source_sha256: &clips[1].prepared.expected_sha256,
            video_time_base: &clips[1].prepared.probe.video.time_base,
            audio_time_base: clips[1]
                .prepared
                .probe
                .audio
                .as_ref()
                .map(|audio| &audio.time_base),
            range: &clips[1].prepared.range,
            grade: &clips[1].grade,
            input_color_space: &clips[1].input_color_space,
            lut_sha256: clips[1].lut.as_ref().map(|lut| lut.sha256.as_str()),
            normalization: clips[1].normalization.label(),
        },
    ];
    let bytes = serde_json::to_vec(&ProRenderConfig {
        preset: "pro_v1",
        output,
        clips: digest_clips,
    })?;
    Ok(hex_digest(Sha256::digest(bytes).as_slice()))
}

// ==================== .cube LUT parsing ====================

/// Parses and validates a `.cube` 3D LUT file. Strict: UTF-8, `LUT_3D_SIZE`
/// required (2..=64), exactly N^3 finite triplets within [-8, 8], no trailing
/// garbage. 1D LUTs are rejected.
fn parse_cube_file(path: &Path) -> Result<LutInfo> {
    let bytes = fs::read(path).map_err(MediaError::Io)?;
    if bytes.len() > MAX_LUT_BYTES {
        return Err(MediaError::InvalidInput(format!(
            "LUT exceeds the {} MiB limit: {}",
            MAX_LUT_BYTES / (1024 * 1024),
            path.display()
        )));
    }
    let sha256 = hex_digest(Sha256::digest(&bytes).as_slice());
    let text = std::str::from_utf8(&bytes).map_err(|_| {
        MediaError::InvalidInput(format!("LUT is not valid UTF-8 text: {}", path.display()))
    })?;
    let mut size: Option<u32> = None;
    let mut title: Option<String> = None;
    let mut triplets: usize = 0;
    for (line_number, raw_line) in text.lines().enumerate() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (keyword, rest) = match line.split_once(char::is_whitespace) {
            Some((keyword, rest)) => (keyword, rest.trim()),
            None => (line, ""),
        };
        match keyword {
            "TITLE" => {
                let unquoted = rest.trim_matches('"');
                if unquoted.is_empty() || unquoted.len() > 256 {
                    return Err(cube_error(path, line_number, "TITLE must be 1..=256 chars"));
                }
                title = Some(unquoted.to_string());
            }
            "LUT_1D_SIZE" | "LUT_1D_INPUT_RANGE" => {
                return Err(cube_error(
                    path,
                    line_number,
                    "1D LUTs are unsupported; provide a 3D LUT",
                ));
            }
            "LUT_3D_SIZE" => {
                let parsed: u32 = rest
                    .parse()
                    .map_err(|_| cube_error(path, line_number, "LUT_3D_SIZE must be an integer"))?;
                if !(2..=MAX_LUT_DIMENSION).contains(&parsed) {
                    return Err(cube_error(
                        path,
                        line_number,
                        "LUT_3D_SIZE must be within 2..=64",
                    ));
                }
                if size.replace(parsed).is_some() {
                    return Err(cube_error(path, line_number, "duplicate LUT_3D_SIZE"));
                }
            }
            "DOMAIN_MIN" | "DOMAIN_MAX" => {
                parse_triplet(rest).map_err(|reason| cube_error(path, line_number, reason))?;
            }
            _ => {
                // Data line: exactly three finite floats.
                if keyword.parse::<f32>().is_err() {
                    return Err(cube_error(
                        path,
                        line_number,
                        &format!("unrecognized .cube keyword {keyword:?}"),
                    ));
                }
                let values: Vec<&str> = line.split_whitespace().collect();
                if values.len() != 3 {
                    return Err(cube_error(
                        path,
                        line_number,
                        "LUT data lines must hold exactly three floats",
                    ));
                }
                for value in values {
                    let parsed: f32 = value.parse().map_err(|_| {
                        cube_error(path, line_number, "LUT data must be finite floats")
                    })?;
                    if !parsed.is_finite() || parsed < -8.0 || parsed > 8.0 {
                        return Err(cube_error(
                            path,
                            line_number,
                            "LUT values must be finite and within [-8, 8]",
                        ));
                    }
                }
                triplets += 1;
            }
        }
    }
    let size = size.ok_or_else(|| {
        MediaError::InvalidInput(format!("LUT is missing LUT_3D_SIZE: {}", path.display()))
    })?;
    let expected = size as usize * size as usize * size as usize;
    if triplets != expected {
        return Err(MediaError::InvalidInput(format!(
            "LUT declares LUT_3D_SIZE {size} but holds {triplets} triplets (expected {expected}): {}",
            path.display()
        )));
    }
    Ok(LutInfo {
        size,
        title,
        sha256,
    })
}

fn parse_triplet(rest: &str) -> std::result::Result<[f32; 3], &'static str> {
    let values: Vec<&str> = rest.split_whitespace().collect();
    if values.len() != 3 {
        return Err("domain bounds must hold exactly three floats");
    }
    let mut parsed = [0.0_f32; 3];
    for (index, value) in values.iter().enumerate() {
        parsed[index] = value
            .parse::<f32>()
            .map_err(|_| "domain bounds must be finite floats")?;
        if !parsed[index].is_finite() {
            return Err("domain bounds must be finite floats");
        }
    }
    Ok(parsed)
}

fn cube_error(path: &Path, line_number: usize, reason: &str) -> MediaError {
    MediaError::InvalidInput(format!(
        "invalid .cube LUT {} at line {}: {reason}",
        path.display(),
        line_number + 1
    ))
}
