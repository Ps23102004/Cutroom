/**
 * AI Insert Assist Tests
 *
 * Covers the pure domain validator (validateInsertProposal), placement
 * resolution (resolveInsertPlacement), the model-boundary schema validator
 * (exercised through assistInsert), the narrow context builder, and proposal
 * staleness. All model inference is mocked -- no real Ollama / network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Asset, Clip, Composition } from '../lib/contracts';
import {
  assistInsert,
  buildInsertContext,
  isInsertProposalStale,
  resolveInsertPlacement,
  sourceTicksToTimelineTicks,
  validateInsertProposal,
  INSERT_AI_CONFIG,
  type InsertProposal,
} from '../lib/insertAssist';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fixture state (composition timebase 1/24000; one track, three clips; v7)
// ---------------------------------------------------------------------------
const clipA: Clip = {
  id: 'clip-a',
  trackId: 'track-v1',
  assetId: 'asset-a',
  name: 'Intro',
  inTicks: '0',
  outTicks: '24000',
  timelineStartTicks: '0',
  timelineDurationTicks: '24000',
};
const clipB: Clip = {
  id: 'clip-b',
  trackId: 'track-v1',
  assetId: 'asset-b',
  name: 'Hero shot',
  inTicks: '0',
  outTicks: '48000',
  timelineStartTicks: '24000',
  timelineDurationTicks: '48000',
};
const clipC: Clip = {
  id: 'clip-c',
  trackId: 'track-v1',
  assetId: 'asset-a',
  name: 'Outro',
  inTicks: '0',
  outTicks: '24000',
  timelineStartTicks: '72000',
  timelineDurationTicks: '24000',
};

// The track layout leaves a gap 24000..48000 so gap-fitting placements can be
// resolved without tripping the overlap guard.

const composition = (version: number = 7): Composition => ({
  id: 'composition-1',
  projectId: 'project-a',
  version,
  durationTicks: '96000',
  timeBase: { num: 1, den: 24000 },
  tracks: [{ id: 'track-v1', kind: 'primary_video', label: 'Primary Video', order: 0 }],
  clips: [clipA, clipB, clipC],
  updatedAt: '2026-09-08T00:00:00Z',
});

const assetA: Asset = {
  id: 'asset-a',
  projectId: 'project-a',
  name: 'Interview Raw',
  path: '/media/interview.mov',
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

const validProposal = (over: Partial<InsertProposal> = {}): InsertProposal => ({
  assetId: 'asset-a',
  assetName: 'Interview Raw',
  sourceInTicks: '48000',
  sourceOutTicks: '72000',
  targetTrackId: 'track-v1',
  placement: { mode: 'atEnd' },
  expectedVersion: 7,
  reason: 'Insert the strongest interview soundbite at the end.',
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
// Placement resolution
// ---------------------------------------------------------------------------
// The shared fixture timeline is contiguous, so any mid-track insert would
// trip the overlap guard. These placement-math tests use a gapped layout.
const gappedComposition = (version: number = 7): Composition => ({
  ...composition(version),
  clips: [
    { ...clipA, timelineStartTicks: '0', timelineDurationTicks: '24000' },
    { ...clipB, timelineStartTicks: '48000', timelineDurationTicks: '48000' },
    { ...clipC, timelineStartTicks: '96000', timelineDurationTicks: '24000' },
  ],
  durationTicks: '120000',
});

describe('resolveInsertPlacement', () => {
  it('appends after the last clip on the target track for atEnd', () => {
    const res = resolveInsertPlacement(validProposal(), assetA.timeBase, composition(7));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.resolved.timelineStartTicks).toBe('96000');
  });

  it('starts an empty track at tick 0', () => {
    const emptyComp = { ...composition(7), clips: [] as Clip[] };
    const res = resolveInsertPlacement(validProposal(), assetA.timeBase, emptyComp);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.resolved.timelineStartTicks).toBe('0');
  });

  it('places afterClip at the neighbor end', () => {
    const p = validProposal({ placement: { mode: 'afterClip', clipId: 'clip-a' } });
    const res = resolveInsertPlacement(p, assetA.timeBase, gappedComposition(7));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.resolved.timelineStartTicks).toBe('24000');
  });

  it('rejects beforeClip placement (native add cannot ripple clips)', () => {
    const p = validProposal({ placement: { mode: 'beforeClip', clipId: 'clip-b' } as unknown as InsertProposal['placement'] });
    const res = resolveInsertPlacement(p, assetA.timeBase, gappedComposition(7));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('placement');
  });

  it('rejects a placement clip that is not on the target track', () => {
    const p = validProposal({ placement: { mode: 'afterClip', clipId: 'clip-nope' } });
    const res = resolveInsertPlacement(p, assetA.timeBase, composition(7));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('not found');
  });

  it('rejects an insert that would overlap an existing clip', () => {
    const p = validProposal({ placement: { mode: 'afterClip', clipId: 'clip-a' } });
    const res = resolveInsertPlacement(p, assetA.timeBase, composition(7));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('overlap');
  });

  it('converts asset ticks into the composition timebase', () => {
    // 24000 ticks @ 1/24000 (1s) into a 1/24 composition => 24 ticks.
    expect(sourceTicksToTimelineTicks(24000n, { num: 1, den: 24000 }, { num: 1, den: 24 })).toBe(24n);
    // Same timebase is identity.
    expect(sourceTicksToTimelineTicks(48000n, { num: 1, den: 24000 }, { num: 1, den: 24000 })).toBe(48000n);
  });
});

// ---------------------------------------------------------------------------
// Pure domain validator
// ---------------------------------------------------------------------------
describe('validateInsertProposal (pure domain validation)', () => {
  it('accepts a valid insert at the current version', () => {
    const res = validateInsertProposal(validProposal(), { composition: composition(7), candidateAssets: [assetA] });
    expect(res).toEqual({ valid: true });
  });

  it('rejects an asset that is not a candidate (wrong/missing asset)', () => {
    const res = validateInsertProposal(validProposal({ assetId: 'asset-ghost' }), { composition: composition(7), candidateAssets: [assetA] });
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toContain('not one of the available assets');
  });

  it('rejects a negative source in-point', () => {
    const res = validateInsertProposal(validProposal({ sourceInTicks: '-1' }), { composition: composition(7), candidateAssets: [assetA] });
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toContain('in-point');
  });

  it('rejects a source out-point beyond the asset duration', () => {
    const res = validateInsertProposal(validProposal({ sourceOutTicks: '96001' }), { composition: composition(7), candidateAssets: [assetA] });
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toContain('exceeds the asset duration');
  });

  it('rejects in >= out', () => {
    const res = validateInsertProposal(validProposal({ sourceInTicks: '72000', sourceOutTicks: '72000' }), { composition: composition(7), candidateAssets: [assetA] });
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toContain('greater than the in-point');
  });

  it('rejects a target track that does not exist', () => {
    const res = validateInsertProposal(validProposal({ targetTrackId: 'track-ghost' }), { composition: composition(7), candidateAssets: [assetA] });
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toContain('does not exist');
  });

  it('rejects an invalid destination (placement clip missing from track)', () => {
    const res = validateInsertProposal(validProposal({ placement: { mode: 'afterClip', clipId: 'clip-ghost' } }), { composition: composition(7), candidateAssets: [assetA] });
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toContain('not found');
  });

  it('rejects a mid-insert into a contiguous timeline via domain validation', () => {
    // The shared fixture timeline is contiguous: after clip-a the next clip
    // starts immediately, so a 1-second insert cannot fit.
    const res = validateInsertProposal(validProposal({ placement: { mode: 'afterClip', clipId: 'clip-a' } }), { composition: composition(7), candidateAssets: [assetA] });
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toContain('overlap');
  });

  it('rejects an unknown placement mode', () => {
    const res = validateInsertProposal(validProposal({ placement: { mode: 'overwriteAll' } as unknown as InsertProposal['placement'] }), { composition: composition(7), candidateAssets: [assetA] });
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toContain('placement');
  });

  it('rejects a stale composition version', () => {
    const res = validateInsertProposal(validProposal({ expectedVersion: 7 }), { composition: composition(8), candidateAssets: [assetA] });
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toContain('Timeline changed');
  });

  it('rejects an empty reason', () => {
    const res = validateInsertProposal(validProposal({ reason: '   ' }), { composition: composition(7), candidateAssets: [assetA] });
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toContain('reason');
  });

  it('rejects a reason containing a filesystem path', () => {
    const res = validateInsertProposal(validProposal({ reason: 'Insert /Users/evil/secret.mov please' }), { composition: composition(7), candidateAssets: [assetA] });
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toContain('filesystem paths');
  });
});

// ---------------------------------------------------------------------------
// Staleness helper
// ---------------------------------------------------------------------------
describe('isInsertProposalStale', () => {
  it('is false when expected version matches', () => {
    expect(isInsertProposalStale(validProposal({ expectedVersion: 7 }), 7)).toBe(false);
  });
  it('is true when expected version is behind', () => {
    expect(isInsertProposalStale(validProposal({ expectedVersion: 7 }), 8)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Narrow context builder
// ---------------------------------------------------------------------------
describe('buildInsertContext', () => {
  it('exposes only tracks, per-track clips, and candidate assets', () => {
    const ctx = buildInsertContext('Demo', composition(7), [assetA], 'Insert the good take');
    expect(ctx.composition.version).toBe(7);
    expect(ctx.tracks.map((t) => t.id)).toEqual(['track-v1']);
    expect(ctx.candidateAssets.map((a) => a.id)).toEqual(['asset-a']);
    // Narrow: no filesystem paths, no revisions, no jobs, no full DB.
    const serialized = JSON.stringify(ctx);
    expect(serialized).not.toContain('/media/interview.mov');
    expect((ctx as unknown as Record<string, unknown>).revisions).toBeUndefined();
    expect((ctx as unknown as Record<string, unknown>).jobs).toBeUndefined();
    expect(ctx.instruction).toBe('Insert the good take');
  });
});

// ---------------------------------------------------------------------------
// assistInsert: model boundary (mocked inference)
// ---------------------------------------------------------------------------
describe('assistInsert (model boundary, mocked)', () => {
  it('produces a fully-formed proposal from structured JSON', async () => {
    mockCompletion(JSON.stringify({
      assetId: 'asset-a',
      assetName: 'Interview Raw',
      sourceInTicks: '48000',
      sourceOutTicks: '72000',
      targetTrackId: 'track-v1',
      placement: { mode: 'atEnd' },
      reason: 'Strong closing soundbite.',
    }));
    const res = await assistInsert(buildInsertContext('Demo', composition(7), [assetA], 'Add the closing soundbite'));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.proposal.assetId).toBe('asset-a');
      expect(res.proposal.expectedVersion).toBe(7);
      expect(res.proposal.placement).toEqual({ mode: 'atEnd' });
    }
  });

  it('rejects a wrong asset id from the model', async () => {
    mockCompletion(JSON.stringify({
      assetId: 'asset-ghost', assetName: 'Ghost',
      sourceInTicks: '0', sourceOutTicks: '1000',
      targetTrackId: 'track-v1', placement: { mode: 'atEnd' }, reason: 'x',
    }));
    const res = await assistInsert(buildInsertContext('Demo', composition(7), [assetA], 'X'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('candidate');
  });

  it('rejects an out-point beyond the asset duration', async () => {
    mockCompletion(JSON.stringify({
      assetId: 'asset-a', assetName: 'Interview Raw',
      sourceInTicks: '0', sourceOutTicks: '96001',
      targetTrackId: 'track-v1', placement: { mode: 'atEnd' }, reason: 'x',
    }));
    const res = await assistInsert(buildInsertContext('Demo', composition(7), [assetA], 'X'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('asset duration');
  });

  it('rejects in >= out from the model', async () => {
    mockCompletion(JSON.stringify({
      assetId: 'asset-a', assetName: 'Interview Raw',
      sourceInTicks: '1000', sourceOutTicks: '1000',
      targetTrackId: 'track-v1', placement: { mode: 'atEnd' }, reason: 'x',
    }));
    const res = await assistInsert(buildInsertContext('Demo', composition(7), [assetA], 'X'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('less than sourceOutTicks');
  });

  it('rejects an invalid track from the model', async () => {
    mockCompletion(JSON.stringify({
      assetId: 'asset-a', assetName: 'Interview Raw',
      sourceInTicks: '0', sourceOutTicks: '1000',
      targetTrackId: 'track-ghost', placement: { mode: 'atEnd' }, reason: 'x',
    }));
    const res = await assistInsert(buildInsertContext('Demo', composition(7), [assetA], 'X'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('provided tracks');
  });

  it('rejects an invented placement clip id', async () => {
    mockCompletion(JSON.stringify({
      assetId: 'asset-a', assetName: 'Interview Raw',
      sourceInTicks: '0', sourceOutTicks: '1000',
      targetTrackId: 'track-v1', placement: { mode: 'afterClip', clipId: 'clip-ghost' }, reason: 'x',
    }));
    const res = await assistInsert(buildInsertContext('Demo', composition(7), [assetA], 'X'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('clipId');
  });

  it('rejects an unknown placement mode', async () => {
    mockCompletion(JSON.stringify({
      assetId: 'asset-a', assetName: 'Interview Raw',
      sourceInTicks: '0', sourceOutTicks: '1000',
      targetTrackId: 'track-v1', placement: { mode: 'drop', clipId: 'clip-a' }, reason: 'x',
    }));
    const res = await assistInsert(buildInsertContext('Demo', composition(7), [assetA], 'X'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('placement');
  });

  it('rejects a wrong expected version from the model', async () => {
    mockCompletion(JSON.stringify({
      assetId: 'asset-a', assetName: 'Interview Raw',
      sourceInTicks: '0', sourceOutTicks: '1000',
      targetTrackId: 'track-v1', placement: { mode: 'atEnd' },
      expectedVersion: 9, reason: 'x',
    }));
    const res = await assistInsert(buildInsertContext('Demo', composition(7), [assetA], 'X'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('expectedVersion');
  });

  it('rejects an unknown field from the model', async () => {
    mockCompletion(JSON.stringify({
      assetId: 'asset-a', assetName: 'Interview Raw',
      sourceInTicks: '0', sourceOutTicks: '1000',
      targetTrackId: 'track-v1', placement: { mode: 'atEnd' },
      sourcePath: '/media/interview.mov', reason: 'x',
    }));
    const res = await assistInsert(buildInsertContext('Demo', composition(7), [assetA], 'X'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('Unknown field');
  });

  it('rejects a malformed (non-JSON) model output', async () => {
    mockCompletion('I cannot produce JSON right now');
    const res = await assistInsert(buildInsertContext('Demo', composition(7), [assetA], 'X'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('LOCAL_AI_JSON_PARSE_FAILED');
  });

  it('rejects an empty instruction', async () => {
    const res = await assistInsert(buildInsertContext('Demo', composition(7), [assetA], '   '));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('EMPTY_INPUT');
  });

  it('rejects generation when there are no candidate assets', async () => {
    const res = await assistInsert(buildInsertContext('Demo', composition(7), [], 'X'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('NO_ASSETS');
  });

  it('fails gracefully when the local provider is unavailable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
    const res = await assistInsert(buildInsertContext('Demo', composition(7), [assetA], 'X'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('LOCAL_AI_UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// Insert model configuration (shares the local model; no cloud fallback)
// ---------------------------------------------------------------------------
describe('INSERT_AI_CONFIG', () => {
  it('points at a loopback local endpoint, never a remote host', () => {
    const host = new URL(INSERT_AI_CONFIG.baseUrl).hostname;
    expect(['127.0.0.1', 'localhost', '::1']).toContain(host);
  });
});
