/**
 * Cutroom Domain Contracts & TypeScript Types
 * 
 * PROVISIONAL: Domain contracts and TypeScript types subject to native backend verification.
 * Provisional native transport is not an implemented backend.
 * Times and ticks are strictly rational string representations ("ticks * num / den").
 * Canonical rational timeBase is explicit and required for all assets and compositions.
 */

export interface RationalTimeBase {
  num: number;
  den: number;
}

export interface ProjectBrief {
  goal: string;
  audience: string;
  targetDurationSeconds: number;
  aspectRatio: '16:9' | '9:16' | '1:1';
  requiredSegments: string;
  excludedSegments: string;
  tone: string;
  style: string;
  cta: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  fpsNumerator: number;
  fpsDenominator: number;
  aspectRatio: '16:9' | '9:16' | '1:1';
  createdAt: string;
  updatedAt: string;
  revisionCount: number;
  latestRevisionId?: string;
  status: 'draft' | 'in_review' | 'approved';
  isFixture?: boolean;
}

export interface Asset {
  id: string;
  projectId: string;
  name: string;
  path: string;
  sizeBytes: number;
  durationTicks: string; // Rational ticks as string e.g. "72000"
  timeBase: RationalTimeBase; // Canonical rational timeBase explicit and required (e.g. { num: 1, den: 24000 })
  width: number;
  height: number;
  fpsNumerator: number;
  fpsDenominator: number;
  format: string;
  codec: string;
  audioChannels: number;
  importType: 'managed' | 'linked';
  proxyStatus: 'ready' | 'generating' | 'none';
  sha256?: string;
  isFixture?: boolean;
}

export type TrackKind = 'overlay_video' | 'primary_video' | 'dialogue_audio' | 'music_audio' | 'captions' | 'graphics';

export interface Track {
  id: string;
  kind: TrackKind;
  label: string;
  order: number;
  isMuted?: boolean;
  isLocked?: boolean;
}

export interface Clip {
  id: string;
  trackId: string;
  assetId: string;
  name: string;
  inTicks: string;
  outTicks: string;
  timelineStartTicks: string;
  timelineDurationTicks: string;
  color?: string;
  /** Per-clip color grade state, mirrored from the native `clip_dto` `color` field. */
  colorGrade?: ClipColor;
  isFixture?: boolean;
}

/**
 * Per-clip color grading state. Mirrors the native `ClipColor` contract
 * (camelCase JSON): input color space declaration plus the grade.
 */
export type InputColorSpace =
  | 'auto'
  | 'rec709'
  | 'bt2020_sdr'
  | 's_log3'
  | 'v_log'
  | 'c_log3'
  | 'pq_hdr'
  | 'hlg_hdr';

export interface LutRef {
  path: string;
  expectedSha256: string;
}

export interface ColorGradeState {
  exposureEv: number;
  contrast: number;
  saturation: number;
  wbTemp: number;
  wbTint: number;
  lut: LutRef | null;
}

export interface ClipColor {
  inputColorSpace: InputColorSpace;
  grade: ColorGradeState;
}

/** Neutral grade: every adjustment at its identity value. */
export function neutralColorGrade(): ColorGradeState {
  return {
    exposureEv: 0,
    contrast: 1,
    saturation: 1,
    wbTemp: 0,
    wbTint: 0,
    lut: null,
  };
}

/** Neutral clip color: auto input detection, no grade. */
export function neutralClipColor(): ClipColor {
  return {
    inputColorSpace: 'auto',
    grade: neutralColorGrade(),
  };
}

export interface Composition {
  id: string;
  projectId: string;
  version: number;
  durationTicks: string;
  timeBase: RationalTimeBase; // Canonical composition time base (e.g. { num: 1, den: 24000 })
  tracks: Track[];
  clips: Clip[];
  updatedAt: string;
}

export interface Revision {
  id: string;
  projectId: string;
  revisionNumber: number;
  commitNote: string;
  author: string;
  createdAt: string;
  contentHash: string;
  parentRevisionId?: string;
  reviewPackageId?: string;
  isFixture?: boolean;
}

export type JobKind = 'proxy' | 'render' | 'asr' | 'preflight';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  projectId: string;
  title: string;
  kind: JobKind;
  status: JobStatus;
  step: string;
  currentStep: number;
  totalSteps: number;
  elapsedSeconds: number;
  error?: string;
  isFixture?: boolean;
}

export type OutputPreset =
  | '1080p_sdr'
  | '720p_h264'
  | '1080p_h264'
  | '2160p_h265'
  | '2160p60_h265'
  | '2160p_hdr10';

export interface RenderRequest {
  projectId: string;
  revisionId: string;
  preset: OutputPreset;
}

export interface PresetSpec {
  label: string;
  video: string;
  audio: string;
  color: string;
}

/**
 * The six native render presets and their implemented render specifications.
 * Single source of truth for the Deliver preset picker, spec text, and
 * fixture-mode job labels.
 */
export const OUTPUT_PRESET_SPECS: Record<OutputPreset, PresetSpec> = {
  '1080p_sdr': {
    label: '1080p24 H.264 SDR Master',
    video: 'H.264 (libx264), 1080p24',
    audio: 'AAC',
    color: 'Rec.709 SDR',
  },
  '720p_h264': {
    label: '720p30 H.264 SDR',
    video: 'H.264 (libx264), 720p30',
    audio: 'AAC',
    color: 'Rec.709 SDR',
  },
  '1080p_h264': {
    label: '1080p30 H.264 SDR',
    video: 'H.264 (libx264), 1080p30',
    audio: 'AAC',
    color: 'Rec.709 SDR',
  },
  '2160p_h265': {
    label: '4K30 H.265 SDR',
    video: 'H.265 (libx265), 2160p30',
    audio: 'AAC',
    color: 'Rec.709 SDR',
  },
  '2160p60_h265': {
    label: '4K60 H.265 SDR',
    video: 'H.265 (libx265), 2160p60',
    audio: 'AAC',
    color: 'Rec.709 SDR',
  },
  '2160p_hdr10': {
    label: '4K30 H.265 HDR10',
    video: 'H.265 (libx265), 2160p30',
    audio: 'AAC',
    color: 'BT.2020 PQ HDR10',
  },
};

export interface PreflightItem {
  id: string;
  label: string;
  category: 'media' | 'disk' | 'system' | 'approvals';
  status: 'passed' | 'failed' | 'warning' | 'pending';
  details: string;
}

export interface SystemHealth {
  tauriConnected: boolean;
  ffmpegAvailable: boolean;
  ffmpegVersion?: string;
  /** Null when the native host cannot obtain a truthful platform free-space reading. */
  storageFreeBytes?: number;
  modelsInstalled: string[];
}

// ---------------------------------------------------------------------------
// Media Understanding Contracts (Transcripts, Silences, Moments)
// ---------------------------------------------------------------------------

export interface TranscriptWord {
  word: string;
  startTicks: string;
  endTicks: string;
  confidence?: number;
}

export interface TranscriptSegment {
  id: string;
  assetId: string;
  speaker?: string;
  text: string;
  startTicks: string;
  endTicks: string;
  words?: TranscriptWord[];
}

export interface SilenceInterval {
  assetId: string;
  startTicks: string;
  endTicks: string;
  durationTicks: string;
}

export interface MediaMoment {
  id: string;
  assetId: string;
  label: string;
  category: 'hook' | 'demo' | 'interview' | 'cta' | 'b-roll' | 'quote';
  startTicks: string;
  endTicks: string;
  summary: string;
}

export interface MediaUnderstandingMetadata {
  assetId: string;
  transcripts: TranscriptSegment[];
  silences: SilenceInterval[];
  moments: MediaMoment[];
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Client Review Contracts
// ---------------------------------------------------------------------------

export interface ClientReviewComment {
  id: string;
  revisionId: string;
  author: string;
  timelineTicks: string;
  comment: string;
  resolved: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Delivery / Archive Contracts
// ---------------------------------------------------------------------------

export interface DeliveryManifest {
  projectId: string;
  projectName: string;
  revisionId: string;
  contentHash: string;
  renderJobId: string;
  artifactPath: string;
  artifactSha256: string;
  exportedAt: string;
  aspectRatio: string;
  durationSeconds: number;
}
