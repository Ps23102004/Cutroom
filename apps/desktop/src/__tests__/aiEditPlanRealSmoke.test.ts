/**
 * REAL local-model smoke for AI EditPlan / Assembly.
 *
 * SKIPPED by default so unit/integration suite stays fast and hermetic.
 * Run explicitly:
 *   RUN_REAL_LOCAL_AI=1 pnpm --filter @cutroom/desktop test -- aiEditPlanRealSmoke
 */
import { describe, it, expect } from 'vitest';
import {
  assistEditPlan,
  buildEditPlanContext,
  validateEditPlan,
  type EditPlan,
} from '../lib/editPlanAssist';
import type { Asset, Clip, Composition } from '../lib/contracts';

const REAL = process.env.RUN_REAL_LOCAL_AI === '1';

const assetA: Asset = {
  id: 'asset-plan-a',
  projectId: 'project-smoke',
  name: 'Interview Intro',
  path: '/media/interview.mov',
  sizeBytes: 1000,
  durationTicks: '480000', // 20s
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
  id: 'asset-plan-b',
  projectId: 'project-smoke',
  name: 'Product Demo',
  path: '/media/demo.mov',
  sizeBytes: 2000,
  durationTicks: '720000', // 30s
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

const clip1: Clip = {
  id: 'clip-interview',
  trackId: 'track-v1',
  assetId: 'asset-plan-a',
  name: 'Interview Opening',
  inTicks: '0',
  outTicks: '240000', // 10s
  timelineStartTicks: '0',
  timelineDurationTicks: '240000',
};

const clip2: Clip = {
  id: 'clip-demo',
  trackId: 'track-v1',
  assetId: 'asset-plan-b',
  name: 'Demo Feature',
  inTicks: '0',
  outTicks: '240000', // 10s
  timelineStartTicks: '240000',
  timelineDurationTicks: '240000',
};

const composition = (version: number = 4): Composition => ({
  id: 'comp-smoke',
  projectId: 'project-smoke',
  version,
  durationTicks: '480000',
  timeBase: { num: 1, den: 24000 },
  tracks: [{ id: 'track-v1', kind: 'primary_video', label: 'Primary Video', order: 0 }],
  clips: [clip1, clip2],
  updatedAt: '2026-09-08T00:00:00Z',
});

describe.runIf(REAL)('real local-model edit-plan smoke', () => {
  it('produces a schema- and domain-valid multi-step edit plan from real local model', async () => {
    const ctx = buildEditPlanContext(
      'Assembly Project',
      composition(4),
      [assetA, assetB],
      'Create a tighter cut: shorten the interview opening to 5 seconds (120000 ticks) and move demo feature to the start.',
    );

    console.log('REAL SMOKE (edit plan) -> building context, version', ctx.composition.version);

    const result = await assistEditPlan(
      ctx,
      { baseUrl: 'http://127.0.0.1:11434', model: process.env.LOCAL_AI_MODEL ?? 'gemma4:e4b-mlx' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const plan: EditPlan = result.plan;
    console.log('REAL SMOKE (edit plan) -> plan', JSON.stringify(plan));

    expect(plan.expectedVersion).toBe(4);
    expect(plan.operations.length).toBeGreaterThanOrEqual(1);

    // Initial domain validation
    const domain = validateEditPlan(plan, {
      composition: composition(4),
      assets: [assetA, assetB],
    });
    expect(domain.valid).toBe(true);
  }, 180000);
});
