import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Asset, Composition, ProjectBrief, MediaUnderstandingMetadata } from '../lib/contracts';
import {
  assistSmartAssembly,
  buildSmartAssemblyContext,
} from '../lib/smartAssembly';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('Smart Assembly Engine', () => {
  const brief: ProjectBrief = {
    goal: 'Create an engaging 30-second teaser',
    audience: 'Tech professionals',
    targetDurationSeconds: 30,
    aspectRatio: '16:9',
    requiredSegments: 'Hook, Demo, CTA',
    excludedSegments: 'Off-topic banter',
    tone: 'Confident and dynamic',
    style: 'Fast-paced',
    cta: 'Visit cutroom.app',
    updatedAt: '2026-09-08T00:00:00Z',
  };

  const asset1: Asset = {
    id: 'asset-1',
    projectId: 'p1',
    name: 'Demo Reel',
    path: '/media/demo.mov',
    sizeBytes: 1000,
    durationTicks: '720000',
    timeBase: { num: 1, den: 24000 },
    width: 1920,
    height: 1080,
    fpsNumerator: 24,
    fpsDenominator: 1,
    format: 'mov',
    codec: 'h264',
    audioChannels: 2,
    importType: 'managed',
    proxyStatus: 'ready',
  };

  const composition: Composition = {
    id: 'comp-1',
    projectId: 'p1',
    version: 3,
    durationTicks: '240000',
    timeBase: { num: 1, den: 24000 },
    tracks: [{ id: 'track-1', kind: 'primary_video', label: 'Primary', order: 0 }],
    clips: [
      {
        id: 'clip-1',
        trackId: 'track-1',
        assetId: 'asset-1',
        name: 'Initial clip',
        inTicks: '0',
        outTicks: '240000',
        timelineStartTicks: '0',
        timelineDurationTicks: '240000',
      },
    ],
    updatedAt: '2026-09-08T00:00:00Z',
  };

  const metaMap = new Map<string, MediaUnderstandingMetadata>([
    [
      'asset-1',
      {
        assetId: 'asset-1',
        transcripts: [],
        silences: [],
        moments: [
          {
            id: 'm1',
            assetId: 'asset-1',
            category: 'demo',
            label: 'Core Demo',
            startTicks: '24000',
            endTicks: '144000',
            summary: 'Shows real-time cutline timeline',
          },
        ],
        updatedAt: '2026-09-08T00:00:00Z',
      },
    ],
  ]);

  it('builds smart assembly context incorporating brief and moments', () => {
    const ctx = buildSmartAssemblyContext(brief, composition, [asset1], metaMap, 'Assemble teaser');
    expect(ctx.brief.targetDurationSeconds).toBe(30);
    expect(ctx.availableMoments).toHaveLength(1);
    expect(ctx.availableMoments[0].category).toBe('demo');
    expect(ctx.candidateAssets).toHaveLength(1);
  });

  it('rejects hallucinated asset IDs in model assembly plan', async () => {
    const ctx = buildSmartAssemblyContext(brief, composition, [asset1], metaMap, 'Assemble teaser');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'test',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                summary: 'Hallucinated assembly',
                operations: [
                  {
                    kind: 'insert',
                    assetId: 'asset-hallucinated',
                    sourceInTicks: '0',
                    sourceOutTicks: '24000',
                    targetTrackId: 'track-1',
                    placement: { mode: 'atEnd' },
                    reason: 'Fake clip',
                  },
                ],
              }),
            },
            finish_reason: 'stop',
          },
        ],
      }),
    });

    const res = await assistSmartAssembly(ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('unknown asset ID');
  });

  it('accepts valid smart assembly plan with real asset IDs and in-bound ranges', async () => {
    const ctx = buildSmartAssemblyContext(brief, composition, [asset1], metaMap, 'Assemble teaser');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'test',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                summary: 'Trim clip to core demo moment',
                operations: [
                  {
                    kind: 'trim',
                    clipId: 'clip-1',
                    newInTicks: '24000',
                    newOutTicks: '144000',
                    reason: 'Align with core demo soundbite',
                  },
                ],
              }),
            },
            finish_reason: 'stop',
          },
        ],
      }),
    });

    const res = await assistSmartAssembly(ctx);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.plan.operations[0].kind).toBe('trim');
      expect(res.plan.expectedVersion).toBe(3);
    }
  });
});
