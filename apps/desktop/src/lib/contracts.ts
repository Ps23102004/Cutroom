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
  isFixture?: boolean;
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

export type OutputPreset = '1080p_sdr' | 'vertical_9_16' | 'review_proxy' | 'subtitle_package';

export interface RenderRequest {
  projectId: string;
  revisionId: string;
  preset: OutputPreset;
  destinationPath: string;
}

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
  storageFreeBytes: number;
  modelsInstalled: string[];
}
