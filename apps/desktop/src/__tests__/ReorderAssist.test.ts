/**
 * ReorderAssist — focused unit + integration tests
 *
 * Mirrors TrimAssist.test.ts architecture:
 * - Domain validation (pure, deterministic)
 * - Staleness detection
 * - Context building
 * - Model output validation (via mocked generateStructured)
 * - Error handling
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Clip, Composition, Track } from '../lib/contracts';
import {
  assistReorder,
  buildReorderContext,
  isReorderProposalStale,
  validateReorderProposal,
  type ReorderProposal,
} from '../lib/reorderAssist';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const track: Track = {
  id: 'track-1',
  kind: 'primary_video',
  label: 'Primary Video',
  order: 0,
};

const clipA: Clip = {
  id: 'clip-a',
  trackId: 'track-1',
  assetId: 'asset-a',
  name: 'Opening Shot',
  inTicks: '0',
  outTicks: '250000',
  timelineStartTicks: '0',
  timelineDurationTicks: '250000',
};

const clipB: Clip = {
  id: 'clip-b',
  trackId: 'track-1',
  assetId: 'asset-b',
  name: 'Interview',
  inTicks: '0',
  outTicks: '500000',
  timelineStartTicks: '250000',
  timelineDurationTicks: '500000',
};

const clipC: Clip = {
  id: 'clip-c',
  trackId: 'track-1',
  assetId: 'asset-c',
  name: 'Closing Shot',
  inTicks: '0',
  outTicks: '200000',
  timelineStartTicks: '750000',
  timelineDurationTicks: '200000',
};

const composition = (version = 3): Composition => ({
  id: 'comp-1',
  projectId: 'project-1',
  version,
  durationTicks: '950000',
  timeBase: { num: 1, den: 25000 },
  tracks: [track],
  clips: [clipA, clipB, clipC],
  updatedAt: '2026-09-09T00:00:00Z',
});

const singleClipComposition = (version = 1): Composition => ({
  id: 'comp-single',
  projectId: 'project-1',
  version,
  durationTicks: '250000',
  timeBase: { num: 1, den: 25000 },
  tracks: [track],
  clips: [clipA],
  updatedAt: '2026-09-09T00:00:00Z',
});

// ---------------------------------------------------------------------------
// Helper: mock a successful model response
// ---------------------------------------------------------------------------
function mockModelResponse(response: Record<string, unknown>): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      choices: [{
        index: 0,
        message: { role: 'assistant', content: JSON.stringify(response) },
        finish_reason: 'stop',
      }],
    }),
  });
}

// ---------------------------------------------------------------------------
// validateReorderProposal — domain validation
// ---------------------------------------------------------------------------
describe('validateReorderProposal', () => {
  const validProposal: ReorderProposal = {
    clipId: 'clip-b',
    clipName: 'Interview',
    direction: 'left',
    expectedVersion: 3,
    reason: 'Move the interview earlier to hook viewers faster.',
  };

  it('accepts a valid left-swap proposal', () => {
    const result = validateReorderProposal(validProposal, {
      composition: composition(3),
      clip: clipB,
    });
    expect(result.valid).toBe(true);
  });

  it('accepts a valid right-swap proposal', () => {
    const result = validateReorderProposal(
      { ...validProposal, clipId: 'clip-a', clipName: 'Opening Shot', direction: 'right' },
      { composition: composition(3), clip: clipA },
    );
    expect(result.valid).toBe(true);
  });

  it('rejects mismatched clip identity', () => {
    const result = validateReorderProposal(
      { ...validProposal, clipId: 'clip-wrong' },
      { composition: composition(3), clip: clipB },
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('clip-wrong');
  });

  it('rejects a clip not in the composition', () => {
    const orphanComposition: Composition = {
      ...composition(3),
      clips: [clipA, clipC],
    };
    const result = validateReorderProposal(validProposal, {
      composition: orphanComposition,
      clip: clipB,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('no longer present');
  });

  it('rejects a stale composition version', () => {
    const result = validateReorderProposal(validProposal, {
      composition: composition(5),
      clip: clipB,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('Regenerate');
  });

  it('rejects an invalid direction value', () => {
    const result = validateReorderProposal(
      { ...validProposal, direction: 'up' as 'left' | 'right' },
      { composition: composition(3), clip: clipB },
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('left');
  });

  it('rejects moving the leftmost clip further left', () => {
    const result = validateReorderProposal(
      { ...validProposal, clipId: 'clip-a', clipName: 'Opening', direction: 'left' },
      { composition: composition(3), clip: clipA },
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('left edge');
  });

  it('rejects moving the rightmost clip further right', () => {
    const result = validateReorderProposal(
      { ...validProposal, clipId: 'clip-c', clipName: 'Closing', direction: 'right' },
      { composition: composition(3), clip: clipC },
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('right edge');
  });

  it('rejects reorder on a single-clip track', () => {
    // A single clip is simultaneously at both edges, so the boundary check
    // fires first regardless of direction — this is correct behaviour.
    const resultRight = validateReorderProposal(
      { ...validProposal, clipId: 'clip-a', clipName: 'Opening', expectedVersion: 1, direction: 'right' },
      { composition: singleClipComposition(1), clip: clipA },
    );
    expect(resultRight.valid).toBe(false);
    if (!resultRight.valid) expect(resultRight.error).toContain('right edge');

    const resultLeft = validateReorderProposal(
      { ...validProposal, clipId: 'clip-a', clipName: 'Opening', expectedVersion: 1, direction: 'left' },
      { composition: singleClipComposition(1), clip: clipA },
    );
    expect(resultLeft.valid).toBe(false);
    if (!resultLeft.valid) expect(resultLeft.error).toContain('left edge');
  });

  it('rejects a proposal with an empty reason', () => {
    const result = validateReorderProposal(
      { ...validProposal, reason: '' },
      { composition: composition(3), clip: clipB },
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('reason');
  });
});

// ---------------------------------------------------------------------------
// isReorderProposalStale
// ---------------------------------------------------------------------------
describe('isReorderProposalStale', () => {
  it('is false when expected version matches', () => {
    expect(isReorderProposalStale({ clipId: 'x', clipName: 'x', direction: 'left', expectedVersion: 3, reason: 'x' }, 3)).toBe(false);
  });

  it('is true when expected version is behind', () => {
    expect(isReorderProposalStale({ clipId: 'x', clipName: 'x', direction: 'left', expectedVersion: 3, reason: 'x' }, 4)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildReorderContext
// ---------------------------------------------------------------------------
describe('buildReorderContext', () => {
  it('includes only the selected clip, its track siblings, and composition identity', () => {
    const ctx = buildReorderContext('My Project', composition(3), clipB, 'Move interview earlier');
    expect(ctx.project.name).toBe('My Project');
    expect(ctx.composition.version).toBe(3);
    expect(ctx.selectedClip.id).toBe('clip-b');
    expect(ctx.trackClips).toHaveLength(3);
    expect(ctx.trackClips[0].id).toBe('clip-a');
    expect(ctx.trackClips[1].id).toBe('clip-b');
    expect(ctx.trackClips[2].id).toBe('clip-c');
    expect(ctx.trackLabel).toBe('Primary Video');
    expect(ctx.instruction).toBe('Move interview earlier');
  });

  it('sorts track clips by timelineStartTicks', () => {
    // If clips are in reverse order in the composition, context should still sort them
    const reversed: Composition = {
      ...composition(3),
      clips: [clipC, clipA, clipB],
    };
    const ctx = buildReorderContext('Test', reversed, clipB, 'test');
    expect(ctx.trackClips[0].id).toBe('clip-a');
    expect(ctx.trackClips[1].id).toBe('clip-b');
    expect(ctx.trackClips[2].id).toBe('clip-c');
  });
});

// ---------------------------------------------------------------------------
// assistReorder — structured generation (mocked model)
// ---------------------------------------------------------------------------
describe('assistReorder', () => {
  it('produces a fully-formed proposal from structured JSON', async () => {
    mockModelResponse({
      clipId: 'clip-b',
      clipName: 'Interview',
      direction: 'left',
      expectedVersion: 3,
      reason: 'Move the interview segment earlier for a stronger opening.',
    });

    const ctx = buildReorderContext('My Project', composition(3), clipB, 'Move interview earlier');
    const result = await assistReorder(ctx);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.clipId).toBe('clip-b');
    expect(result.proposal.direction).toBe('left');
    expect(result.proposal.expectedVersion).toBe(3);
    expect(result.proposal.reason).toContain('interview');
  });

  it('keeps a model-supplied clipName', async () => {
    mockModelResponse({
      clipId: 'clip-b',
      clipName: 'The Interview',
      direction: 'left',
      expectedVersion: 3,
      reason: 'Earlier is better.',
    });

    const ctx = buildReorderContext('P', composition(3), clipB, 'Move earlier');
    const result = await assistReorder(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.proposal.clipName).toBe('The Interview');
  });

  it('accepts fenced JSON output', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: '```json\n{"clipId":"clip-b","clipName":"Interview","direction":"left","expectedVersion":3,"reason":"Better pacing."}\n```',
          },
          finish_reason: 'stop',
        }],
      }),
    });

    const ctx = buildReorderContext('P', composition(3), clipB, 'Move earlier');
    const result = await assistReorder(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.proposal.direction).toBe('left');
  });

  it('rejects an empty instruction', async () => {
    const ctx = buildReorderContext('P', composition(3), clipB, '');
    const result = await assistReorder(ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('EMPTY_INPUT');
  });

  it('rejects a clip id not on the track', async () => {
    mockModelResponse({
      clipId: 'clip-nonexistent',
      clipName: 'Ghost',
      direction: 'left',
      expectedVersion: 3,
      reason: 'Reorder.',
    });

    const ctx = buildReorderContext('P', composition(3), clipB, 'Move something');
    const result = await assistReorder(ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('not a clip on the track');
  });

  it('rejects a wrong expected version from the model', async () => {
    mockModelResponse({
      clipId: 'clip-b',
      clipName: 'Interview',
      direction: 'left',
      expectedVersion: 99,
      reason: 'Reorder.',
    });

    const ctx = buildReorderContext('P', composition(3), clipB, 'Move earlier');
    const result = await assistReorder(ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('does not match');
  });

  it('rejects a boundary violation from the model', async () => {
    mockModelResponse({
      clipId: 'clip-a',
      clipName: 'Opening Shot',
      direction: 'left',
      expectedVersion: 3,
      reason: 'Move left.',
    });

    const ctx = buildReorderContext('P', composition(3), clipA, 'Move opening left');
    const result = await assistReorder(ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('left edge');
  });

  it('rejects an invalid direction from the model', async () => {
    mockModelResponse({
      clipId: 'clip-b',
      clipName: 'Interview',
      direction: 'up',
      expectedVersion: 3,
      reason: 'Move up.',
    });

    const ctx = buildReorderContext('P', composition(3), clipB, 'Move up');
    const result = await assistReorder(ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('left');
  });

  it('rejects an unknown extra field from the model', async () => {
    mockModelResponse({
      clipId: 'clip-b',
      clipName: 'Interview',
      direction: 'left',
      expectedVersion: 3,
      reason: 'Reorder.',
      extraField: true,
    });

    const ctx = buildReorderContext('P', composition(3), clipB, 'Move earlier');
    const result = await assistReorder(ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Unknown field');
  });

  it('rejects malformed (non-JSON) model output', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'I cannot do that.' },
          finish_reason: 'stop',
        }],
      }),
    });

    const ctx = buildReorderContext('P', composition(3), clipB, 'Move earlier');
    const result = await assistReorder(ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toContain('JSON');
  });

  it('fails gracefully when the local provider is unavailable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const ctx = buildReorderContext('P', composition(3), clipB, 'Move earlier');
    const result = await assistReorder(ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('unavailable');
  });
});
