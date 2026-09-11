/**
 * REAL Qwen 3.8 27B smoke for the AI Trim vertical slice.
 *
 * SKIPPED by default so the hermetic unit/integration suite never touches the
 * network. Run explicitly after a green suite:
 *
 *    RUN_REAL_LOCAL_AI=1 pnpm --filter @cutroom/desktop test -- aiTrimRealSmoke
 *
 * It exercises the ACTUAL pipeline: build context -> local model -> JSON parse ->
 * model-boundary schema validation -> domain validation. It does NOT apply the
 * proposal to important media; it uses a disposable synthesis and only validates.
 */
import { describe, it, expect } from 'vitest';
import {
  assistTrim,
  buildTrimContext,
  validateTrimProposal,
  type TrimProposal,
} from '../lib/trimAssist';
import type { Asset, Clip, Composition } from '../lib/contracts';

const REAL = process.env.RUN_REAL_LOCAL_AI === '1';
// The installed local Qwen 3.8 27B MLX engine.
const REAL_MODEL = process.env.LOCAL_AI_MODEL ?? 'gemma4:e4b-mlx';

const asset: Asset = {
  id: 'asset-smoke',
  projectId: 'project-smoke',
  name: 'synthetic-source.mov',
  path: '/tmp/synthetic-source.mov',
  sizeBytes: 0,
  durationTicks: '1000000', // 40s at 1/25000
  timeBase: { num: 1, den: 25000 },
  width: 1920,
  height: 1080,
  fpsNumerator: 25,
  fpsDenominator: 1,
  format: 'MOV',
  codec: 'H.264',
  audioChannels: 2,
  importType: 'managed',
  proxyStatus: 'none',
};

const clip: Clip = {
  id: 'clip-smoke',
  trackId: 'track-smoke',
  assetId: 'asset-smoke',
  name: 'Smoke Clip',
  inTicks: '100000',
  outTicks: '600000', // 4s..24s
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

describe.runIf(REAL)('real qwen3.8:27b-mlx trim smoke', () => {
  it('produces a schema- and domain-valid trim proposal from a real local model', async () => {
    const ctx = buildTrimContext(
      'Smoke Project',
      composition(3),
      clip,
      asset,
      'Shorten this clip by two seconds from the end.',
     );

     console.log('REAL SMOKE -> model', REAL_MODEL);

    const result = await assistTrim(
      ctx,
      { baseUrl: 'http://127.0.0.1:11434', model: REAL_MODEL },
     );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const proposal: TrimProposal = result.proposal;
     console.log('REAL SMOKE -> proposal', JSON.stringify(proposal));

      // Correct identity + version echoed by the model.
    expect(proposal.clipId).toBe('clip-smoke');
    expect(proposal.expectedVersion).toBe(3);

      // Domain validator accepts it against the current composition + source bounds.
    const domain = validateTrimProposal(proposal, {
      composition: composition(3),
      clip,
      asset,
    });
    expect(domain.valid).toBe(true);

      // Source bounds are exact and within the asset duration.
    const newIn = BigInt(proposal.newInTicks);
    const newOut = BigInt(proposal.newOutTicks);
    expect(newIn).toBeGreaterThanOrEqual(0n);
    expect(newIn).toBeLessThan(newOut);
    expect(newOut).toBeLessThanOrEqual(BigInt(asset.durationTicks));

      // Useful reason.
    expect(proposal.reason.trim().length).toBeGreaterThan(0);
    }, 180000);
});
