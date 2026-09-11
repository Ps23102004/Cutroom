/**
 * AI Delete Assist Tests
 *
 * Covers the pure domain validator (validateDeleteProposal), the model-boundary
 * schema validator (validateModelDeleteOutput, exercised through assistDelete),
 * the narrow context builder, and proposal staleness. All model inference is
 * mocked -- no real Ollama / network is required.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Clip, Composition } from '../lib/contracts';
import {
  assistDelete,
  buildDeleteContext,
  isDeleteProposalStale,
  validateDeleteProposal,
  DELETE_AI_CONFIG,
  type DeleteProposal,
} from '../lib/deleteAssist';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fixture state (composition timebase 1/24000; three clips on one track; v7)
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

const validProposal = (over: Partial<DeleteProposal> = {}): DeleteProposal => ({
  clipId: 'clip-b',
  clipName: 'Hero shot',
  expectedVersion: 7,
  reason: 'Remove the duplicate hero shot.',
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
describe('validateDeleteProposal (pure domain validation)', () => {
  it('accepts a valid delete at the current version', () => {
    const res = validateDeleteProposal(validProposal(), { composition: composition(7), clip: clipB });
    expect(res).toEqual({ valid: true });
  });

  it('rejects a proposal whose clip id is not the selected clip', () => {
    const res = validateDeleteProposal(validProposal({ clipId: 'clip-c' }), { composition: composition(7), clip: clipB });
    expect(res.valid).toBe(false);
    expect((res as { error: string }).error).toContain('targets clip');
  });

  it('rejects a clip that is no longer present in the composition', () => {
    const emptyComp = { ...composition(7), clips: [clipA, clipC] as Clip[] };
    const res = validateDeleteProposal(validProposal(), { composition: emptyComp, clip: clipB });
    expect(res.valid).toBe(false);
    expect((res as { error: string }).error).toContain('no longer present');
  });

  it('rejects a stale composition version', () => {
    const res = validateDeleteProposal(validProposal({ expectedVersion: 7 }), { composition: composition(8), clip: clipB });
    expect(res.valid).toBe(false);
    expect((res as { error: string }).error).toContain('Timeline changed');
  });

  it('rejects an empty reason', () => {
    const res = validateDeleteProposal(validProposal({ reason: '   ' }), { composition: composition(7), clip: clipB });
    expect(res.valid).toBe(false);
    expect((res as { error: string }).error).toContain('reason');
  });
});

// ---------------------------------------------------------------------------
// Staleness helper
// ---------------------------------------------------------------------------
describe('isDeleteProposalStale', () => {
  it('is false when expected version matches', () => {
    expect(isDeleteProposalStale(validProposal({ expectedVersion: 7 }), 7)).toBe(false);
  });
  it('is true when expected version is behind', () => {
    expect(isDeleteProposalStale(validProposal({ expectedVersion: 7 }), 8)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Narrow context builder
// ---------------------------------------------------------------------------
describe('buildDeleteContext', () => {
  it('includes only the selected clip, its track, and composition identity', () => {
    const ctx = buildDeleteContext('Demo', composition(7), clipB, 'Remove duplicate');
    expect(ctx.selectedClip.id).toBe('clip-b');
    expect(ctx.composition.version).toBe(7);
    // Three clips share the track -- all three appear as neighbourhood context.
    expect(ctx.trackClips.map((c) => c.id).sort()).toEqual(['clip-a', 'clip-b', 'clip-c']);
    // Narrow: no full DB / all assets / all revisions / job history.
    expect((ctx as unknown as Record<string, unknown>).assets).toBeUndefined();
    expect((ctx as unknown as Record<string, unknown>).assets).toBeUndefined();
    expect((ctx as unknown as Record<string, unknown>).revisions).toBeUndefined();
    expect((ctx as unknown as Record<string, unknown>).jobs).toBeUndefined();
    expect(ctx.instruction).toBe('Remove duplicate');
   });
});

// ---------------------------------------------------------------------------
// assistDelete: model boundary (mocked inference)
// ---------------------------------------------------------------------------
describe('assistDelete (model boundary, mocked)', () => {
  it('produces a fully-formed proposal from structured JSON', async () => {
    mockCompletion(JSON.stringify({
      clipId: 'clip-b',
      clipName: 'Hero shot',
      expectedVersion: 7,
      reason: 'Remove the duplicate hero shot.',
     }));
    const res = await assistDelete(buildDeleteContext('Demo', composition(7), clipB, 'Remove duplicate'));
    expect(res.ok).toBe(true);
    if (res.ok) {
      // The proposal targets the SELECTED clip even though the model echoed its id.
      expect(res.proposal.clipId).toBe('clip-b');
      expect(res.proposal.expectedVersion).toBe(7);
      expect(res.proposal.clipName).toBe('Hero shot');
      expect(res.proposal.reason).toBe('Remove the duplicate hero shot.');
      }
    });

  it('falls back to the selected clip name / id when the model omits them', async () => {
    mockCompletion(JSON.stringify({
      clipId: 'clip-b',
      expectedVersion: 7,
      reason: 'Tighten the cut.',
      }));
    const res = await assistDelete(buildDeleteContext('Demo', composition(7), clipB, 'X'));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.proposal.clipId).toBe('clip-b');
      expect(res.proposal.clipName).toBe('Hero shot');
      }
    });

  it('accepts fenced JSON output', async () => {
    mockCompletion('\n```json\n' + JSON.stringify({
      clipId: 'clip-b', expectedVersion: 7, reason: 'OK',
     }) + '\n```');
    const res = await assistDelete(buildDeleteContext('Demo', composition(7), clipB, 'X'));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.proposal.clipId).toBe('clip-b');
   });

  it('rejects an empty instruction', async () => {
    const res = await assistDelete(buildDeleteContext('Demo', composition(7), clipB, '   '));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('EMPTY_INPUT');
   });

  it('rejects a wrong clip id from the model', async () => {
    mockCompletion(JSON.stringify({
      clipId: 'clip-99', expectedVersion: 7, reason: 'x',
     }));
    const res = await assistDelete(buildDeleteContext('Demo', composition(7), clipB, 'X'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('does not match');
   });

  it('rejects a wrong expected version from the model', async () => {
    mockCompletion(JSON.stringify({
      clipId: 'clip-b', expectedVersion: 9, reason: 'x',
     }));
    const res = await assistDelete(buildDeleteContext('Demo', composition(7), clipB, 'X'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('expectedVersion');
   });

  it('rejects a wrong operation (unknown action field) from the model', async () => {
    mockCompletion(JSON.stringify({
      clipId: 'clip-b', action: 'split', splitAtTicks: '12000',
      expectedVersion: 7, reason: 'split',
     }));
    const res = await assistDelete(buildDeleteContext('Demo', composition(7), clipB, 'Split it'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('Unknown field');
   });

  it('rejects an unknown field from the model', async () => {
    mockCompletion(JSON.stringify({
      clipId: 'clip-b', deleteSourceMedia: true, expectedVersion: 7, reason: 'x',
     }));
    const res = await assistDelete(buildDeleteContext('Demo', composition(7), clipB, 'X'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('Unknown field');
   });

  it('rejects a malformed (non-JSON) model output', async () => {
    mockCompletion('I cannot produce JSON right now');
    const res = await assistDelete(buildDeleteContext('Demo', composition(7), clipB, 'X'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('LOCAL_AI_JSON_PARSE_FAILED');
   });

  it('fails gracefully when the local provider is unavailable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
    const res = await assistDelete(buildDeleteContext('Demo', composition(7), clipB, 'X'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('LOCAL_AI_UNAVAILABLE');
   });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Delete model configuration (shares the local model; no cloud fallback)
// ---------------------------------------------------------------------------
describe('DELETE_AI_CONFIG', () => {
  it('points at a loopback local endpoint, never a remote host', () => {
    const host = new URL(DELETE_AI_CONFIG.baseUrl).hostname;
    expect(['127.0.0.1', 'localhost', '::1']).toContain(host);
    });
});
