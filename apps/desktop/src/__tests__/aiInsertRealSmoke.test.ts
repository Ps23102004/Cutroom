/**
 * REAL local-model smoke for the AI Insert vertical slice.
 *
 * SKIPPED by default so the hermetic unit/integration suite never touches the
 * network. Run explicitly after a green suite:
 *
 *    RUN_REAL_LOCAL_AI=1 pnpm --filter @cutroom/desktop test -- aiInsertRealSmoke
 *
 * It exercises the ACTUAL pipeline: build context -> local model -> JSON parse ->
 * model-boundary schema validation -> domain validation. It does NOT touch any
 * media; it only builds and validates a disposable proposal over a synthetic
 * in-memory composition with a gapped timeline.
 */
import { describe, it, expect } from 'vitest';
import {
  assistInsert,
  buildInsertContext,
  validateInsertProposal,
  type InsertProposal,
} from '../lib/insertAssist';
import type { Asset, Clip, Composition } from '../lib/contracts';

const REAL = process.env.RUN_REAL_LOCAL_AI === '1';

const asset: Asset = {
  id: 'asset-smoke',
  projectId: 'project-smoke',
  name: 'Smoke Interview',
  path: '/media/smoke-interview.mov',
  sizeBytes: 1000,
  durationTicks: '960000', // 40s at 1/24000
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

const clip: Clip = {
  id: 'clip-smoke',
  trackId: 'track-smoke',
  assetId: 'asset-smoke',
  name: 'Opening',
  inTicks: '0',
  outTicks: '240000',
  timelineStartTicks: '0',
  timelineDurationTicks: '240000',
};

const composition = (version: number = 3): Composition => ({
  id: 'composition-smoke',
  projectId: 'project-smoke',
  version,
  durationTicks: '240000',
  timeBase: { num: 1, den: 24000 },
  tracks: [{ id: 'track-smoke', kind: 'primary_video', label: 'Primary Video', order: 0 }],
  clips: [clip],
  updatedAt: '2026-09-08T00:00:00Z',
});

describe.runIf(REAL)('real local-model insert smoke', () => {
  it('produces a schema- and domain-valid insert proposal from a real local model', async () => {
    const ctx = buildInsertContext(
      'Smoke Project',
      composition(3),
      [asset],
      'Insert a 5 second clip from Smoke Interview at the end of the timeline.',
    );

    console.log('REAL SMOKE (insert) -> building context, version', ctx.composition.version);

    const result = await assistInsert(
      ctx,
      { baseUrl: 'http://127.0.0.1:11434', model: process.env.LOCAL_AI_MODEL ?? 'gemma4:e4b-mlx' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const proposal: InsertProposal = result.proposal;
    console.log('REAL SMOKE (insert) -> proposal', JSON.stringify(proposal));

    // Correct identity + version bound from the context.
    expect(proposal.assetId).toBe('asset-smoke');
    expect(proposal.expectedVersion).toBe(3);

    // Domain validator accepts it against the current composition.
    const domain = validateInsertProposal(proposal, {
      composition: composition(3),
      candidateAssets: [asset],
    });
    expect(domain.valid).toBe(true);

    // Useful reason.
    expect(proposal.reason.trim().length).toBeGreaterThan(0);
  }, 180000);
});
