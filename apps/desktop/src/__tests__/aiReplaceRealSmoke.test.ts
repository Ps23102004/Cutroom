/**
 * REAL local-model smoke for the AI Replace vertical slice.
 *
 * SKIPPED by default so the hermetic unit/integration suite never touches the
 * network. Run explicitly after a green suite:
 *
 *    RUN_REAL_LOCAL_AI=1 pnpm --filter @cutroom/desktop test -- aiReplaceRealSmoke
 *
 * It exercises the ACTUAL pipeline: build context -> local model -> JSON parse ->
 * model-boundary schema validation -> domain validation. It does NOT touch any
 * media; it only builds and validates a disposable proposal over a synthetic
 * in-memory composition.
 */
import { describe, it, expect } from 'vitest';
import {
  assistReplace,
  buildReplaceContext,
  validateReplaceProposal,
  type ReplaceProposal,
} from '../lib/replaceAssist';
import type { Asset, Clip, Composition } from '../lib/contracts';

const REAL = process.env.RUN_REAL_LOCAL_AI === '1';

const assetA: Asset = {
  id: 'asset-smoke-a',
  projectId: 'project-smoke',
  name: 'Smoke Interview Take 1',
  path: '/media/smoke-take1.mov',
  sizeBytes: 1000,
  durationTicks: '480000', // 20s at 1/24000
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
  id: 'asset-smoke-b',
  projectId: 'project-smoke',
  name: 'Smoke Interview Take 2',
  path: '/media/smoke-take2.mov',
  sizeBytes: 2000,
  durationTicks: '720000', // 30s at 1/24000
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
  assetId: 'asset-smoke-a',
  name: 'Smoke Opening',
  inTicks: '0',
  outTicks: '120000', // 5s
  timelineStartTicks: '0',
  timelineDurationTicks: '120000',
};

const composition = (version: number = 3): Composition => ({
  id: 'composition-smoke',
  projectId: 'project-smoke',
  version,
  durationTicks: '120000',
  timeBase: { num: 1, den: 24000 },
  tracks: [{ id: 'track-smoke', kind: 'primary_video', label: 'Primary Video', order: 0 }],
  clips: [clip],
  updatedAt: '2026-09-08T00:00:00Z',
});

describe.runIf(REAL)('real local-model replace smoke', () => {
  it('produces a schema- and domain-valid replace proposal from a real local model', async () => {
    const ctx = buildReplaceContext(
      'Smoke Project',
      composition(3),
      clip,
      [assetA, assetB],
      'Replace this opening clip with a 5 second segment from Smoke Interview Take 2.',
    );

    console.log('REAL SMOKE (replace) -> building context, version', ctx.composition.version);

    const result = await assistReplace(
      ctx,
      { baseUrl: 'http://127.0.0.1:11434', model: process.env.LOCAL_AI_MODEL ?? 'gemma4:e4b-mlx' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const proposal: ReplaceProposal = result.proposal;
    console.log('REAL SMOKE (replace) -> proposal', JSON.stringify(proposal));

    // Correct identity + version bound from the context.
    expect(proposal.targetClipId).toBe('clip-smoke');
    expect(proposal.replacementAssetId).toBe('asset-smoke-b');
    expect(proposal.expectedVersion).toBe(3);

    // Domain validator accepts it against the current composition.
    const domain = validateReplaceProposal(proposal, {
      composition: composition(3),
      targetClip: clip,
      candidateAssets: [assetA, assetB],
    });
    expect(domain.valid).toBe(true);

    // Useful reason.
    expect(proposal.reason.trim().length).toBeGreaterThan(0);
  }, 180000);
});
