import { describe, it, expect } from 'vitest';
import type { Composition, MediaUnderstandingMetadata, TranscriptSegment } from '../lib/contracts';
import {
  buildRemoveSilencePlan,
  classifyMoments,
  detectSilenceIntervals,
  searchMediaIndex,
} from '../lib/mediaUnderstanding';

describe('MediaUnderstanding Engine', () => {
  const transcripts: TranscriptSegment[] = [
    {
      id: 'seg-1',
      assetId: 'asset-1',
      speaker: 'Host',
      text: 'Welcome to the presentation and introduction.',
      startTicks: '24000', // 1s
      endTicks: '72000',   // 3s
    },
    {
      id: 'seg-2',
      assetId: 'asset-1',
      speaker: 'Guest',
      text: 'Here is how the product demo works in real time.',
      startTicks: '120000', // 5s (leaving 2s silence 72000..120000)
      endTicks: '192000',  // 8s
    },
    {
      id: 'seg-3',
      assetId: 'asset-1',
      speaker: 'Host',
      text: 'Click the link to sign up today!',
      startTicks: '240000', // 10s (leaving 2s silence 192000..240000)
      endTicks: '288000',  // 12s
    },
  ];

  it('detects silence intervals between speech segments accurately', () => {
    // Total duration 360000 ticks (15s)
    const silences = detectSilenceIntervals('asset-1', '360000', transcripts, 24000n);
    expect(silences.length).toBeGreaterThanOrEqual(3);

    // Leading silence 0..24000 (1s)
    expect(silences[0].startTicks).toBe('0');
    expect(silences[0].endTicks).toBe('24000');

    // Gap between seg-1 and seg-2: 72000..120000 (48000 ticks = 2s)
    expect(silences[1].startTicks).toBe('72000');
    expect(silences[1].endTicks).toBe('120000');
    expect(silences[1].durationTicks).toBe('48000');
  });

  it('classifies moments into hook, demo, and cta based on semantics', () => {
    const moments = classifyMoments('asset-1', transcripts);
    expect(moments).toHaveLength(3);
    expect(moments[0].category).toBe('hook');
    expect(moments[1].category).toBe('demo');
    expect(moments[2].category).toBe('cta');
  });

  it('searches media index by keyword across transcripts and moments', () => {
    const moments = classifyMoments('asset-1', transcripts);
    const meta: MediaUnderstandingMetadata[] = [
      {
        assetId: 'asset-1',
        transcripts,
        silences: [],
        moments,
        updatedAt: '2026-09-08T00:00:00Z',
      },
    ];

    const demoResults = searchMediaIndex(meta, 'demo');
    expect(demoResults.length).toBeGreaterThanOrEqual(1);
    expect(demoResults[0].assetId).toBe('asset-1');

    const hookResults = searchMediaIndex(meta, 'welcome');
    expect(hookResults.length).toBeGreaterThanOrEqual(1);

    const emptyResults = searchMediaIndex(meta, 'nonexistent word');
    expect(emptyResults).toHaveLength(0);
  });

  it('builds an automatic silence removal EditPlan', () => {
    const composition: Composition = {
      id: 'comp-1',
      projectId: 'proj-1',
      version: 2,
      durationTicks: '72000',
      timeBase: { num: 1, den: 24000 },
      tracks: [{ id: 'track-1', kind: 'primary_video', label: 'Video', order: 0 }],
      clips: [
        {
          id: 'clip-1',
          trackId: 'track-1',
          assetId: 'asset-1',
          name: 'Take with silence',
          inTicks: '0', // Clip includes leading silence 0..24000
          outTicks: '72000',
          timelineStartTicks: '0',
          timelineDurationTicks: '72000',
        },
      ],
      updatedAt: '2026-09-08T00:00:00Z',
    };

    const silences = detectSilenceIntervals('asset-1', '360000', transcripts, 24000n);
    const metaMap = new Map<string, MediaUnderstandingMetadata>([
      [
        'asset-1',
        {
          assetId: 'asset-1',
          transcripts,
          silences,
          moments: [],
          updatedAt: '2026-09-08T00:00:00Z',
        },
      ],
    ]);

    const plan = buildRemoveSilencePlan(composition, metaMap);
    expect(plan).not.toBeNull();
    if (plan && plan.operations[0].kind === 'trim') {
      expect(plan.operations).toHaveLength(1);
      expect(plan.operations[0].kind).toBe('trim');
      expect(plan.operations[0].newInTicks).toBe('24000');
    }
  });
});
