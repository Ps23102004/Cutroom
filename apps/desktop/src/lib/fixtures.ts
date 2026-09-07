import { Project, Asset, Composition, Revision, Job, Track } from './contracts';

/**
 * Cutroom Explicit Sample Fixtures
 * 
 * Sourced for development exploration only.
 * Uses synthetic portable paths (no user-specific paths).
 * Strictly marked with isFixture: true.
 */

export const FIXTURE_TRACKS: Track[] = [
  { id: 'track-broll', kind: 'overlay_video', label: 'B-Roll / Overlay', order: 0 },
  { id: 'track-primary', kind: 'primary_video', label: 'Primary Video', order: 1 },
  { id: 'track-dialogue', kind: 'dialogue_audio', label: 'Dialogue Audio', order: 2 },
  { id: 'track-music', kind: 'music_audio', label: 'Music Bed', order: 3 },
  { id: 'track-captions', kind: 'captions', label: 'Subtitles / Captions', order: 4 },
  { id: 'track-graphics', kind: 'graphics', label: 'Graphics & Titles', order: 5 },
];

export const FIXTURE_PROJECT: Project = {
  id: 'fixture-proj-001',
  name: '[FIXTURE] Speech Edit Demo',
  path: '/workspace/fixtures/demo_project',
  fpsNumerator: 24,
  fpsDenominator: 1,
  aspectRatio: '16:9',
  createdAt: '2026-09-07T14:00:00Z',
  updatedAt: '2026-09-07T15:30:00Z',
  revisionCount: 3,
  latestRevisionId: 'fixture-rev-003',
  status: 'draft',
  isFixture: true,
};

export const FIXTURE_ASSETS: Asset[] = [
  {
    id: 'fixture-asset-001',
    projectId: 'fixture-proj-001',
    name: 'interview_main_take01.mov',
    path: '/workspace/fixtures/demo_project/media/interview_main_take01.mov',
    sizeBytes: 104857600,
    durationTicks: '72000', // 3000 frames @ 24fps
    timeBase: { num: 1, den: 24000 },
    width: 1920,
    height: 1080,
    fpsNumerator: 24,
    fpsDenominator: 1,
    format: 'QuickTime / MOV',
    codec: 'ProRes 422',
    audioChannels: 2,
    importType: 'managed',
    proxyStatus: 'none',
    sha256: '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b',
    isFixture: true,
  },
  {
    id: 'fixture-asset-002',
    projectId: 'fixture-proj-001',
    name: 'broll_workspace_pan.mp4',
    path: '/workspace/fixtures/demo_project/media/broll_workspace_pan.mp4',
    sizeBytes: 41943040,
    durationTicks: '28800', // 1200 frames @ 24fps
    timeBase: { num: 1, den: 24000 },
    width: 1920,
    height: 1080,
    fpsNumerator: 24,
    fpsDenominator: 1,
    format: 'MPEG-4',
    codec: 'H.264',
    audioChannels: 0,
    importType: 'linked',
    proxyStatus: 'none',
    sha256: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b',
    isFixture: true,
  },
];

export const FIXTURE_COMPOSITION: Composition = {
  id: 'fixture-comp-001',
  projectId: 'fixture-proj-001',
  version: 3,
  durationTicks: '36000', // 1500 frames @ 24fps
  timeBase: { num: 1, den: 24000 },
  tracks: FIXTURE_TRACKS,
  clips: [
    {
      id: 'clip-01',
      trackId: 'track-primary',
      assetId: 'fixture-asset-001',
      name: 'Intro Sentence',
      inTicks: '0',
      outTicks: '7200',
      timelineStartTicks: '0',
      timelineDurationTicks: '7200',
      color: '#A18AF7',
      isFixture: true,
    },
    {
      id: 'clip-02',
      trackId: 'track-primary',
      assetId: 'fixture-asset-001',
      name: 'Main Explanation',
      inTicks: '9600',
      outTicks: '24000',
      timelineStartTicks: '7200',
      timelineDurationTicks: '14400',
      color: '#A18AF7',
      isFixture: true,
    },
    {
      id: 'clip-03',
      trackId: 'track-broll',
      assetId: 'fixture-asset-002',
      name: 'B-Roll Cutaway',
      inTicks: '2400',
      outTicks: '7200',
      timelineStartTicks: '9600',
      timelineDurationTicks: '4800',
      color: '#D6AE69',
      isFixture: true,
    },
  ],
  updatedAt: '2026-09-07T15:30:00Z',
};

export const FIXTURE_REVISIONS: Revision[] = [
  {
    id: 'fixture-rev-001',
    projectId: 'fixture-proj-001',
    revisionNumber: 1,
    commitNote: 'Initial rough cut assembly',
    author: 'Editor (Local)',
    createdAt: '2026-09-07T14:15:00Z',
    contentHash: 'sha256:d41d8cd98f00b204e9800998ecf8427e',
    isFixture: true,
  },
  {
    id: 'fixture-rev-002',
    projectId: 'fixture-proj-001',
    revisionNumber: 2,
    commitNote: 'Trimmed pauses and inserted B-roll cutaway',
    author: 'Editor (Local)',
    createdAt: '2026-09-07T14:50:00Z',
    contentHash: 'sha256:5d41402abc4b2a76b9719d911017c592',
    parentRevisionId: 'fixture-rev-001',
    isFixture: true,
  },
  {
    id: 'fixture-rev-003',
    projectId: 'fixture-proj-001',
    revisionNumber: 3,
    commitNote: 'Audio levels normalized; caption cues aligned',
    author: 'Editor (Local)',
    createdAt: '2026-09-07T15:30:00Z',
    contentHash: 'sha256:7d793037a0760186574b0282f2f435e7',
    parentRevisionId: 'fixture-rev-002',
    isFixture: true,
  },
];

export const FIXTURE_JOBS: Job[] = [
  {
    id: 'job-001',
    projectId: 'fixture-proj-001',
    title: 'Generate proxy for interview_main_take01.mov',
    kind: 'proxy',
    status: 'completed',
    step: 'Proxy generation complete (1080p ProRes Proxy)',
    currentStep: 3,
    totalSteps: 3,
    elapsedSeconds: 14,
    isFixture: true,
  },
  {
    id: 'job-002',
    projectId: 'fixture-proj-001',
    title: 'Preflight check for Revision 3',
    kind: 'preflight',
    status: 'completed',
    step: 'Preflight verification passed (4 checks ok)',
    currentStep: 4,
    totalSteps: 4,
    elapsedSeconds: 2,
    isFixture: true,
  },
];
