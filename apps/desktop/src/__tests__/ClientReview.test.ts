import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Asset, Composition, ClientReviewComment } from '../lib/contracts';
import {
  assistClientCommentToPlan,
  findClipAtTimelineTicks,
} from '../lib/clientReview';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('Client Review Engine', () => {
  const composition: Composition = {
    id: 'comp-1',
    projectId: 'p1',
    version: 4,
    durationTicks: '120000',
    timeBase: { num: 1, den: 24000 },
    tracks: [{ id: 'track-1', kind: 'primary_video', label: 'Primary', order: 0 }],
    clips: [
      {
        id: 'clip-1',
        trackId: 'track-1',
        assetId: 'asset-1',
        name: 'Opening greeting',
        inTicks: '0',
        outTicks: '48000',
        timelineStartTicks: '0',
        timelineDurationTicks: '48000',
      },
      {
        id: 'clip-2',
        trackId: 'track-1',
        assetId: 'asset-2',
        name: 'Main discussion',
        inTicks: '0',
        outTicks: '72000',
        timelineStartTicks: '48000',
        timelineDurationTicks: '72000',
      },
    ],
    updatedAt: '2026-09-08T00:00:00Z',
  };

  const asset1: Asset = {
    id: 'asset-1',
    projectId: 'p1',
    name: 'Greeting.mov',
    path: '/media/greeting.mov',
    sizeBytes: 1000,
    durationTicks: '48000',
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

  it('locates target clip under comment timecode playhead', () => {
    // Tick 24000 is inside clip-1 (0..48000)
    const c1 = findClipAtTimelineTicks(composition, '24000');
    expect(c1?.id).toBe('clip-1');

    // Tick 60000 is inside clip-2 (48000..120000)
    const c2 = findClipAtTimelineTicks(composition, '60000');
    expect(c2?.id).toBe('clip-2');

    // Tick 200000 is outside timeline
    const none = findClipAtTimelineTicks(composition, '200000');
    expect(none).toBeUndefined();
  });

  it('translates client comment into previewable EditPlan without mutating timeline', async () => {
    const comment: ClientReviewComment = {
      id: 'comm-1',
      revisionId: 'rev-1',
      author: 'Director',
      timelineTicks: '24000',
      comment: 'Cut this pause shorter',
      resolved: false,
      createdAt: '2026-09-08T00:00:00Z',
    };

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
                summary: 'Shorten pause in opening greeting',
                operations: [
                  {
                    kind: 'trim',
                    clipId: 'clip-1',
                    newInTicks: '0',
                    newOutTicks: '24000',
                    reason: 'Address Director comment to cut pause shorter',
                  },
                ],
              }),
            },
            finish_reason: 'stop',
          },
        ],
      }),
    });

    const res = await assistClientCommentToPlan({
      comment,
      composition,
      targetClip: composition.clips[0],
      candidateAssets: [asset1],
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.plan.expectedVersion).toBe(4);
      expect(res.plan.operations).toHaveLength(1);
      expect(res.plan.operations[0].kind).toBe('trim');
    }
  });
});
