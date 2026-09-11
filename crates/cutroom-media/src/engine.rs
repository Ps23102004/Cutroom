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
    AudioProbe, ColorMetadata, MediaError, MediaProbe, RationalTime, RationalTimeBase,
    RenderArtifact, Result, SourceRange, TwoClipRenderRequest, VideoProbe,
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
