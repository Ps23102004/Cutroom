/**
 * REAL local-model smoke for the AI Delete vertical slice.
 *
 * SKIPPED by default so the hermetic unit/integration suite never touches the
 * network. Run explicitly after a green suite:
 *
 *    RUN_REAL_LOCAL_AI=1 pnpm --filter @cutroom/desktop test -- aiDeleteRealSmoke
 *
 * It exercises the ACTUAL pipeline: build context -> local model -> JSON parse ->
 * model-boundary schema validation -> domain validation. It does NOT delete any
 * media; it only builds and validates a disposable proposal over a synthetic
 * in-memory composition.
 */
import { describe, it, expect } from 'vitest';
import {
  assistDelete,
  buildDeleteContext,
  validateDeleteProposal,
  type DeleteProposal,
} from '../lib/deleteAssist';
import type { Clip, Composition } from '../lib/contracts';

const REAL = process.env.RUN_REAL_LOCAL_AI === '1';

const clip: Clip = {
  id: 'clip-smoke',
  trackId: 'track-smoke',
  assetId: 'asset-smoke',
  name: 'Smoke Clip',
  inTicks: '100000',
  outTicks: '600000', // 4s..24s at 1/25000
  timelineStartTicks: '0',
  timelineDurationTicks: '500000',
};

const composition = (version: number = 3): Composition => ({
  id: 'composition-smoke',
  projectId: 'project-smoke',
  version,
  durationTicks: '500000',
  timeBase: { num: 1, den: 25000 },
  tracks: [{ id: 'track-smoke', kind: 'primary_video', label: 'Primary Video', order: 0 }],
  clips: [clip],
  updatedAt: '2026-09-08T00:00:00Z',
});

describe.runIf(REAL)('real local-model delete smoke', () => {
  it('produces a schema- and domain-valid delete proposal from a real local model', async () => {
    const ctx = buildDeleteContext(
      'Smoke Project',
      composition(3),
      clip,
        'This clip is duplicated content and should be removed from the timeline.',
      );

    console.log('REAL SMOKE (delete) -> building context, version', ctx.composition.version);

    const result = await assistDelete(
      ctx,
        { baseUrl: 'http://127.0.0.1:11434', model: process.env.LOCAL_AI_MODEL ?? 'gemma4:e4b-mlx' },
      );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const proposal: DeleteProposal = result.proposal;
    console.log('REAL SMOKE (delete) -> proposal', JSON.stringify(proposal));

       // Correct identity + version echoed by the model.
    expect(proposal.clipId).toBe('clip-smoke');
    expect(proposal.expectedVersion).toBe(3);

       // Domain validator accepts it against the current composition.
    const domain = validateDeleteProposal(proposal, {
      composition: composition(3),
      clip,
     });
    expect(domain.valid).toBe(true);

       // Useful reason.
    expect(proposal.reason.trim().length).toBeGreaterThan(0);
     }, 180000);
});
