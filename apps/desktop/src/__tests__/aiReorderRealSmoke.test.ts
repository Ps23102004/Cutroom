/**
 * REAL local model smoke for the AI Reorder vertical slice.
 *
 * SKIPPED by default so the hermetic unit/integration suite never touches the
 * network. Run explicitly after a green suite:
 *
 *    RUN_REAL_LOCAL_AI=1 pnpm --filter @cutroom/desktop test -- aiReorderRealSmoke
 *
 * It exercises the ACTUAL pipeline: build context -> local model -> JSON parse ->
 * model-boundary schema validation -> domain validation.
 */
import { describe, it, expect } from 'vitest';
import {
  assistReorder,
  buildReorderContext,
  validateReorderProposal,
  type ReorderProposal,
} from '../lib/reorderAssist';
import type { Clip, Composition, Track } from '../lib/contracts';

const REAL = process.env.RUN_REAL_LOCAL_AI === '1';
const REAL_MODEL = process.env.LOCAL_AI_MODEL ?? 'gemma4:e4b-mlx';

const track: Track = {
  id: 'track-smoke',
  kind: 'primary_video',
  label: 'Primary Video',
  order: 0,
};

const clipA: Clip = {
  id: 'clip-opening',
  trackId: 'track-smoke',
  assetId: 'asset-a',
  name: 'Opening Shot',
  inTicks: '0',
  outTicks: '250000',
  timelineStartTicks: '0',
  timelineDurationTicks: '250000',
};

const clipB: Clip = {
  id: 'clip-interview',
  trackId: 'track-smoke',
  assetId: 'asset-b',
  name: 'Interview Segment',
  inTicks: '0',
  outTicks: '500000',
  timelineStartTicks: '250000',
  timelineDurationTicks: '500000',
};

const clipC: Clip = {
  id: 'clip-closing',
  trackId: 'track-smoke',
  assetId: 'asset-c',
  name: 'Closing Shot',
  inTicks: '0',
  outTicks: '200000',
  timelineStartTicks: '750000',
  timelineDurationTicks: '200000',
};

const composition = (version: number = 5): Composition => ({
  id: 'comp-smoke',
  projectId: 'project-smoke',
  version,
  durationTicks: '950000',
  timeBase: { num: 1, den: 25000 },
  tracks: [track],
  clips: [clipA, clipB, clipC],
  updatedAt: '2026-09-09T00:00:00Z',
});

describe.runIf(REAL)('real local AI reorder smoke', () => {
  it('produces a schema- and domain-valid reorder proposal from a real local model', async () => {
    const ctx = buildReorderContext(
      'Smoke Project',
      composition(5),
      clipB,
      'Move the interview segment to the beginning of the track for a stronger opening.',
    );

    console.log('REAL REORDER SMOKE -> model', REAL_MODEL);

    const result = await assistReorder(
      ctx,
      { baseUrl: 'http://127.0.0.1:11434', model: REAL_MODEL },
    );

    console.log('REAL REORDER SMOKE -> result', JSON.stringify(result));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const proposal: ReorderProposal = result.proposal;
    console.log('REAL REORDER SMOKE -> proposal', JSON.stringify(proposal));

    // Correct identity + version echoed
    expect(proposal.clipId).toBe('clip-interview');
    expect(proposal.expectedVersion).toBe(5);

    // Direction must be valid
    expect(['left', 'right']).toContain(proposal.direction);

    // For this instruction, moving left is the correct choice
    expect(proposal.direction).toBe('left');

    // Domain validator accepts it
    const domain = validateReorderProposal(proposal, {
      composition: composition(5),
      clip: clipB,
    });
    expect(domain.valid).toBe(true);

    // Useful reason
    expect(proposal.reason.trim().length).toBeGreaterThan(0);
  }, 180000);
});
