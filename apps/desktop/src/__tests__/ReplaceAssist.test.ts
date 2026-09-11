/**
 * AI Replace Assist Tests
 *
 * Covers the pure domain validator (validateReplaceProposal), delta calculation
 * (calculateReplaceDelta), the model-boundary schema validator (exercised through
 * assistReplace), the narrow context builder, and proposal staleness.
 * All model inference is mocked -- no real Ollama / network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Asset, Clip, Composition } from '../lib/contracts';
import {
  assistReplace,
  buildReplaceContext,
  calculateReplaceDelta,
  isReplaceProposalStale,
  sourceTicksToTimelineTicks,
  validateReplaceProposal,
  type ReplaceProposal,
} from '../lib/replaceAssist';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fixture state
// ---------------------------------------------------------------------------
const clipA: Clip = {
  id: 'clip-a',
  trackId: 'track-v1',
  assetId: 'asset-a',
  name: 'Intro take 1',
  inTicks: '0',
  outTicks: '24000',
  timelineStartTicks: '0',
  timelineDurationTicks: '24000',
};
const clipB: Clip = {
  id: 'clip-b',
  trackId: 'track-v1',
  assetId: 'asset-a',
  name: 'Hero shot',
  inTicks: '24000',
  outTicks: '72000',
  timelineStartTicks: '24000',
  timelineDurationTicks: '48000',
};

const composition = (version: number = 7): Composition => ({
  id: 'composition-1',
  projectId: 'project-a',
  version,
  durationTicks: '72000',
  timeBase: { num: 1, den: 24000 },
  tracks: [{ id: 'track-v1', kind: 'primary_video', label: 'Primary Video', order: 0 }],
  clips: [clipA, clipB],
  updatedAt: '2026-09-08T00:00:00Z',
});

const assetA: Asset = {
  id: 'asset-a',
  projectId: 'project-a',
  name: 'A-Roll',
  path: '/media/a-roll.mov',
  sizeBytes: 1000,
  durationTicks: '96000',
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

const assetB: Asset = {
  id: 'asset-b',
  projectId: 'project-a',
  name: 'B-Roll Take 2',
  path: '/media/b-roll.mov',
  sizeBytes: 2000,
  durationTicks: '120000',
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

const validProposal = (over: Partial<ReplaceProposal> = {}): ReplaceProposal => ({
  targetClipId: 'clip-a',
  targetClipName: 'Intro take 1',
  replacementAssetId: 'asset-b',
  replacementAssetName: 'B-Roll Take 2',
  sourceInTicks: '12000',
  sourceOutTicks: '48000',
  expectedVersion: 7,
  reason: 'Swap out shaky intro with clean B-roll take 2.',
  ...over,
});

function mockCompletion(content: string) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      id: 'test',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    }),
  });
}

// ---------------------------------------------------------------------------
// Delta & Duration Math
// ---------------------------------------------------------------------------
describe('calculateReplaceDelta', () => {
  it('calculates duration delta accurately when replacement is longer', () => {
    // Current clip-a duration is 24000. Replacement source 12000..48000 is 36000.
    // Delta = +12000
    const delta = calculateReplaceDelta(clipA, assetB, '12000', '48000', { num: 1, den: 24000 });
    expect(delta.currentDurationTicks).toBe('24000');
    expect(delta.newDurationTicks).toBe('36000');
    expect(delta.durationDeltaTicks).toBe('12000');
  });

  it('calculates duration delta accurately when replacement is shorter', () => {
    // Current clip-a duration is 24000. Replacement source 0..12000 is 12000.
    // Delta = -12000
    const delta = calculateReplaceDelta(clipA, assetB, '0', '12000', { num: 1, den: 24000 });
    expect(delta.currentDurationTicks).toBe('24000');
    expect(delta.newDurationTicks).toBe('12000');
    expect(delta.durationDeltaTicks).toBe('-12000');
  });

  it('converts across different timebases correctly', () => {
    // Replacement asset in 1/12288 (source duration 6144 ticks).
    // Composition in 1/24000.
    // 6144 * 24000 / 12288 = 12000 ticks.
    const res = sourceTicksToTimelineTicks(6144n, { num: 1, den: 12288 }, { num: 1, den: 24000 });
    expect(res).toBe(12000n);
  });
});

// ---------------------------------------------------------------------------
// Domain Validation
// ---------------------------------------------------------------------------
describe('validateReplaceProposal', () => {
  const ctx = {
    composition: composition(7),
    targetClip: clipA,
    candidateAssets: [assetA, assetB],
  };

  it('accepts a valid proposal', () => {
    const res = validateReplaceProposal(validProposal(), ctx);
    expect(res.valid).toBe(true);
  });

  it('rejects wrong target clip ID', () => {
    const res = validateReplaceProposal(validProposal({ targetClipId: 'clip-b' }), ctx);
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toContain('Proposal targets clip');
  });

  it('rejects target clip not present in composition', () => {
    const res = validateReplaceProposal(validProposal(), {
      ...ctx,
      composition: { ...ctx.composition, clips: [clipB] },
    });
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toContain('no longer present');
  });

  it('rejects wrong or unknown replacement asset', () => {
    const res = validateReplaceProposal(validProposal({ replacementAssetId: 'asset-unknown' }), ctx);
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toContain('not one of the available assets');
  });

  it('rejects mismatched replacement asset name', () => {
    const res = validateReplaceProposal(validProposal({ replacementAssetName: 'Wrong Name' }), ctx);
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toContain('does not match asset');
  });

  it('rejects negative sourceInTicks', () => {
    const res = validateReplaceProposal(validProposal({ sourceInTicks: '-10' }), ctx);
    expect(res.valid).toBe(false);
  });

  it('rejects non-integer source ticks', () => {
    const res = validateReplaceProposal(validProposal({ sourceInTicks: 'abc' }), ctx);
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toContain('integer ticks');
  });

  it('rejects sourceIn >= sourceOut', () => {
    const res = validateReplaceProposal(validProposal({ sourceInTicks: '48000', sourceOutTicks: '48000' }), ctx);
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toContain('greater than the in-point');

    const inverted = validateReplaceProposal(validProposal({ sourceInTicks: '50000', sourceOutTicks: '48000' }), ctx);
    expect(inverted.valid).toBe(false);
  });

  it('rejects sourceOut exceeding replacement asset duration', () => {
    // assetB duration is 120000
    const res = validateReplaceProposal(validProposal({ sourceOutTicks: '120001' }), ctx);
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toContain('exceeds the asset duration');
  });

  it('rejects stale composition version', () => {
    const res = validateReplaceProposal(validProposal({ expectedVersion: 6 }), ctx);
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toContain('Timeline changed');
  });

  it('rejects empty reason', () => {
    const res = validateReplaceProposal(validProposal({ reason: '   ' }), ctx);
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toContain('Proposal must include a reason');
  });

  it('rejects filesystem paths in reason', () => {
    const res = validateReplaceProposal(validProposal({ reason: 'Load from /Users/parthsingh/clip.mov' }), ctx);
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toContain('filesystem paths');
  });
});

// ---------------------------------------------------------------------------
// Proposal Staleness
// ---------------------------------------------------------------------------
describe('isReplaceProposalStale', () => {
  it('returns false when version matches', () => {
    expect(isReplaceProposalStale(validProposal({ expectedVersion: 7 }), 7)).toBe(false);
  });

  it('returns true when version diverges', () => {
    expect(isReplaceProposalStale(validProposal({ expectedVersion: 7 }), 8)).toBe(true);
    expect(isReplaceProposalStale(validProposal({ expectedVersion: 7 }), 6)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Narrow Context Builder
// ---------------------------------------------------------------------------
describe('buildReplaceContext', () => {
  it('builds narrow context without exposing filesystem paths', () => {
    const ctx = buildReplaceContext('My Film', composition(7), clipA, [assetA, assetB], 'Replace intro');
    expect(ctx.project.name).toBe('My Film');
    expect(ctx.composition.version).toBe(7);
    expect(ctx.targetClip.id).toBe('clip-a');
    expect(ctx.candidateAssets).toHaveLength(2);
    expect(ctx.candidateAssets[0].name).toBe('A-Roll');
    // None of candidateAssets should have path property exposed
    for (const ca of ctx.candidateAssets) {
      expect((ca as Record<string, unknown>).path).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// assistReplace (Model Boundary Schema Validation)
// ---------------------------------------------------------------------------
describe('assistReplace', () => {
  const context = buildReplaceContext('My Film', composition(7), clipA, [assetA, assetB], 'Replace with B-roll take 2');

  it('rejects empty instruction without querying the model', async () => {
    const res = await assistReplace({ ...context, instruction: '   ' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('EMPTY_INPUT');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects when no candidate assets are available', async () => {
    const res = await assistReplace({ ...context, candidateAssets: [] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('NO_ASSETS');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('parses and accepts valid model output', async () => {
    mockCompletion(JSON.stringify({
      targetClipId: 'clip-a',
      targetClipName: 'Intro take 1',
      replacementAssetId: 'asset-b',
      replacementAssetName: 'B-Roll Take 2',
      sourceInTicks: '12000',
      sourceOutTicks: '48000',
      reason: 'Use cleaner B-roll intro angle.',
    }));

    const res = await assistReplace(context);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.proposal.targetClipId).toBe('clip-a');
      expect(res.proposal.replacementAssetId).toBe('asset-b');
      expect(res.proposal.sourceInTicks).toBe('12000');
      expect(res.proposal.sourceOutTicks).toBe('48000');
      expect(res.proposal.expectedVersion).toBe(7);
      expect(res.proposal.reason).toBe('Use cleaner B-roll intro angle.');
    }
  });

  it('rejects unknown fields in model output', async () => {
    mockCompletion(JSON.stringify({
      targetClipId: 'clip-a',
      targetClipName: 'Intro take 1',
      replacementAssetId: 'asset-b',
      replacementAssetName: 'B-Roll Take 2',
      sourceInTicks: '12000',
      sourceOutTicks: '48000',
      reason: 'Valid reason',
      dangerScript: 'rm -rf /',
    }));

    const res = await assistReplace(context);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('Unknown field: "dangerScript"');
  });

  it('rejects invented targetClipId', async () => {
    mockCompletion(JSON.stringify({
      targetClipId: 'clip-invented',
      targetClipName: 'Intro take 1',
      replacementAssetId: 'asset-b',
      replacementAssetName: 'B-Roll Take 2',
      sourceInTicks: '12000',
      sourceOutTicks: '48000',
      reason: 'Valid reason',
    }));

    const res = await assistReplace(context);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('does not match target clip');
  });

  it('rejects invented replacementAssetId', async () => {
    mockCompletion(JSON.stringify({
      targetClipId: 'clip-a',
      targetClipName: 'Intro take 1',
      replacementAssetId: 'asset-ghost',
      replacementAssetName: 'B-Roll Take 2',
      sourceInTicks: '12000',
      sourceOutTicks: '48000',
      reason: 'Valid reason',
    }));

    const res = await assistReplace(context);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('is not one of the candidate assets');
  });

  it('rejects sourceOutTicks exceeding asset duration', async () => {
    mockCompletion(JSON.stringify({
      targetClipId: 'clip-a',
      targetClipName: 'Intro take 1',
      replacementAssetId: 'asset-b',
      replacementAssetName: 'B-Roll Take 2',
      sourceInTicks: '12000',
      sourceOutTicks: '999999',
      reason: 'Valid reason',
    }));

    const res = await assistReplace(context);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('exceeds replacement asset duration');
  });

  it('rejects malformed JSON', async () => {
    mockCompletion('Not a json response');

    const res = await assistReplace(context);
    expect(res.ok).toBe(false);
  });

  it('handles provider / network failure gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const res = await assistReplace(context);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('Connection refused');
  });
});
