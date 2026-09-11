/**
 * AI Trim Assist Tests
 *
 * Covers the pure domain validator (validateTrimProposal), the model-boundary
 * schema validator (validateModelTrimOutput, exercised through assistTrim), the
 * narrow context builder, and proposal availability. All model inference is
 * mocked — no real Ollama / network is required.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Asset, Clip, Composition } from '../lib/contracts';
import {
  assistTrim,
  buildTrimContext,
  isTrimProposalStale,
  trimAssistAvailable,
  validateTrimProposal,
  TRIM_AI_CONFIG,
  type TrimProposal,
} from '../lib/trimAssist';

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
const asset: Asset = {
  id: 'asset-1',
  projectId: 'project-a',
  name: 'take.mov',
  path: '/media/take.mov',
  sizeBytes: 10,
  durationTicks: '48000',
  timeBase: { num: 1, den: 24000 },
  width: 1920,
  height: 1080,
  fpsNumerator: 24,
  fpsDenominator: 1,
  format: 'MOV',
  codec: 'H.264',
  audioChannels: 2,
  importType: 'managed',
  proxyStatus: 'none',
};

const clip: Clip = {
  id: 'clip-01',
  trackId: 'track-v1',
  assetId: 'asset-1',
  name: 'Hero shot',
  inTicks: '0',
  outTicks: '24000',
  timelineStartTicks: '0',
  timelineDurationTicks: '24000',
};

const composition = (version: number = 7): Composition => ({
  id: 'composition-1',
  projectId: 'project-a',
  version,
  durationTicks: '24000',
  timeBase: { num: 1, den: 24000 },
  tracks: [{ id: 'track-v1', kind: 'primary_video', label: 'Primary Video', order: 0 }],
  clips: [clip],
  updatedAt: '2026-09-08T00:00:00Z',
});

const validProposal = (over: Partial<TrimProposal> = {}): TrimProposal => ({
  clipId: 'clip-01',
  clipName: 'Hero shot',
  newInTicks: '0',
  newOutTicks: '24000',
  expectedVersion: 7,
  reason: 'Trim tail off.',
  ...over,
});

// Mock one chat-completion response with the given assistant content.
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
// Pure domain validator
// ---------------------------------------------------------------------------
describe('validateTrimProposal (pure domain validation)', () => {
  it('accepts a valid trim within source bounds at the current version', () => {
    const res = validateTrimProposal(validProposal(), { composition: composition(7), clip, asset });
    expect(res).toEqual({ valid: true });
  });

  it('rejects a proposal whose clip id is not the selected clip', () => {
    const res = validateTrimProposal(validProposal({ clipId: 'clip-99' }), { composition: composition(7), clip, asset });
    expect(res.valid).toBe(false);
    expect((res as { error: string }).error).toContain('targets clip');
  });

  it('rejects a clip that is no longer present in the composition', () => {
    const emptyComp = { ...composition(7), clips: [] as Clip[] };
    const res = validateTrimProposal(validProposal(), { composition: emptyComp, clip, asset });
    expect(res.valid).toBe(false);
    expect((res as { error: string }).error).toContain('no longer present');
  });

  it('rejects a mismatched source asset', () => {
    const wrongAsset: Asset = { ...asset, id: 'asset-2' };
    const res = validateTrimProposal(validProposal(), { composition: composition(7), clip, asset: wrongAsset });
    expect(res.valid).toBe(false);
    expect((res as { error: string }).error).toContain('belongs to asset');
  });

  it('rejects a negative in-point', () => {
    const res = validateTrimProposal(validProposal({ newInTicks: '-1' }), { composition: composition(7), clip, asset });
    expect(res.valid).toBe(false);
    expect((res as { error: string }).error).toContain('negative');
  });

  it('rejects an out-point beyond source duration', () => {
    const res = validateTrimProposal(validProposal({ newOutTicks: '49000' }), { composition: composition(7), clip, asset });
    expect(res.valid).toBe(false);
    expect((res as { error: string }).error).toContain('exceeds');
  });

  it('rejects a zero-duration trim where in equals out', () => {
    const res = validateTrimProposal(validProposal({ newInTicks: '5000', newOutTicks: '5000' }), { composition: composition(7), clip, asset });
    expect(res.valid).toBe(false);
    expect((res as { error: string }).error).toContain('before out-point');
  });

  it('rejects an in-point after the out-point', () => {
    const res = validateTrimProposal(validProposal({ newInTicks: '30000', newOutTicks: '5000' }), { composition: composition(7), clip, asset });
    expect(res.valid).toBe(false);
    expect((res as { error: string }).error).toContain('before out-point');
  });

  it('rejects a stale composition version', () => {
    const res = validateTrimProposal(validProposal({ expectedVersion: 7 }), { composition: composition(8), clip, asset });
    expect(res.valid).toBe(false);
    expect((res as { error: string }).error).toContain('Timeline changed');
  });

  it('rejects non-integer tick values', () => {
    const res = validateTrimProposal(validProposal({ newInTicks: 'abc' }), { composition: composition(7), clip, asset });
    expect(res.valid).toBe(false);
    expect((res as { error: string }).error).toContain('valid integers');
  });

  it('rejects an empty reason', () => {
    const res = validateTrimProposal(validProposal({ reason: '   ' }), { composition: composition(7), clip, asset });
    expect(res.valid).toBe(false);
    expect((res as { error: string }).error).toContain('reason');
  });
});

// ---------------------------------------------------------------------------
// Staleness helper
// ---------------------------------------------------------------------------
describe('isTrimProposalStale', () => {
  it('is false when expected version matches', () => {
    expect(isTrimProposalStale(validProposal({ expectedVersion: 7 }), 7)).toBe(false);
  });
  it('is true when expected version is behind', () => {
    expect(isTrimProposalStale(validProposal({ expectedVersion: 7 }), 8)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Narrow context builder
// ---------------------------------------------------------------------------
describe('buildTrimContext', () => {
  it('includes only the selected clip, asset, and composition identity', () => {
    const ctx = buildTrimContext('Demo', composition(7), clip, asset, 'Shorten by two seconds');
    expect(ctx.clip.id).toBe('clip-01');
    expect(ctx.clip.assetId).toBe('asset-1');
    expect(ctx.asset.id).toBe('asset-1');
    expect(ctx.asset.durationTicks).toBe('48000');
    expect(ctx.composition.version).toBe(7);
    expect(ctx.instruction).toBe('Shorten by two seconds');
    // Narrow: no full DB / all assets / all revisions / job history.
    expect((ctx as unknown as Record<string, unknown>).assets).toBeUndefined();
    expect((ctx as unknown as Record<string, unknown>).revisions).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// assistTrim: model boundary (mocked inference)
// ---------------------------------------------------------------------------
describe('assistTrim (model boundary, mocked)', () => {
  it('produces a fully-formed proposal from structured JSON', async () => {
    mockCompletion(JSON.stringify({
      clipId: 'clip-01',
      newInTicks: '0',
      newOutTicks: '21600',
      expectedVersion: 7,
      reason: 'Cut two seconds off the tail.',
    }));
    const res = await assistTrim(buildTrimContext('Demo', composition(7), clip, asset, 'Shorten by two seconds'));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.proposal.newInTicks).toBe('0');
      expect(res.proposal.newOutTicks).toBe('21600');
      expect(res.proposal.expectedVersion).toBe(7);
      // clipName falls back to the clip name when the model omits it.
      expect(res.proposal.clipName).toBe('Hero shot');
    }
  });

  it('keeps a model-supplied clipName', async () => {
    mockCompletion(JSON.stringify({
      clipId: 'clip-01', clipName: 'Take A', newInTicks: '0',
      newOutTicks: '20000', expectedVersion: 7, reason: 'Tighten the start.',
    }));
    const res = await assistTrim(buildTrimContext('Demo', composition(7), clip, asset, 'Tighten start'));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.proposal.clipName).toBe('Take A');
  });

  it('accepts fenced JSON output', async () => {
    mockCompletion('\n```json\n' + JSON.stringify({
      clipId: 'clip-01', newInTicks: '1000', newOutTicks: '24000', expectedVersion: 7, reason: 'OK',
    }) + '\n```');
    const res = await assistTrim(buildTrimContext('Demo', composition(7), clip, asset, 'X'));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.proposal.newInTicks).toBe('1000');
  });

  it('rejects an empty instruction', async () => {
    const res = await assistTrim(buildTrimContext('Demo', composition(7), clip, asset, '   '));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('EMPTY_INPUT');
  });

  it('rejects a wrong clip id from the model', async () => {
    mockCompletion(JSON.stringify({
      clipId: 'clip-99', newInTicks: '0', newOutTicks: '24000', expectedVersion: 7, reason: 'x',
    }));
    const res = await assistTrim(buildTrimContext('Demo', composition(7), clip, asset, 'X'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('does not match');
  });

  it('rejects a wrong expected version from the model', async () => {
    mockCompletion(JSON.stringify({
      clipId: 'clip-01', newInTicks: '0', newOutTicks: '24000', expectedVersion: 9, reason: 'x',
    }));
    const res = await assistTrim(buildTrimContext('Demo', composition(7), clip, asset, 'X'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('expectedVersion');
  });

  it('rejects an out-point beyond source duration from the model', async () => {
    mockCompletion(JSON.stringify({
      clipId: 'clip-01', newInTicks: '0', newOutTicks: '72000', expectedVersion: 7, reason: 'x',
    }));
    const res = await assistTrim(buildTrimContext('Demo', composition(7), clip, asset, 'X'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('exceeds');
  });

  it('rejects a wrong operation (unknown action field) from the model', async () => {
    mockCompletion(JSON.stringify({
      clipId: 'clip-01', action: 'split', splitAtTicks: '12000',
      newInTicks: '0', newOutTicks: '24000', expectedVersion: 7, reason: 'x',
    }));
    const res = await assistTrim(buildTrimContext('Demo', composition(7), clip, asset, 'Split it'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('Unknown field');
  });

  it('rejects malformed (non-JSON) model output', async () => {
    mockCompletion('I cannot produce JSON right now');
    const res = await assistTrim(buildTrimContext('Demo', composition(7), clip, asset, 'X'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('LOCAL_AI_JSON_PARSE_FAILED');
  });

  it('fails gracefully when the local provider is unavailable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
    const res = await assistTrim(buildTrimContext('Demo', composition(7), clip, asset, 'X'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('LOCAL_AI_UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// Trim model availability
// ---------------------------------------------------------------------------
describe('trimAssistAvailable', () => {
  it('is available when the configured model is installed', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'gemma4:e4b-mlx' }] }),
    });
    const res = await trimAssistAvailable();
    expect(res.available).toBe(true);
    expect(res.model).toBe(TRIM_AI_CONFIG.model);
  });

  it('is unavailable when the model is not installed', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'other-model' }] }),
    });
    const res = await trimAssistAvailable();
    expect(res.available).toBe(false);
    expect(res.error).toContain('not found');
  });
});
