/**
 * AI EditPlan / Assembly Assist Tests
 *
 * Covers domain validation, schema validation, narrow context building,
 * sequential plan execution with version propagation, partial failure detection,
 * and atomic revision creation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Asset, Clip, Composition } from '../lib/contracts';
import {
  assistEditPlan,
  buildEditPlanContext,
  executeEditPlan,
  validateEditPlan,
  validateEditPlanOperation,
  type EditPlan,
  type EditPlanOperation,
} from '../lib/editPlanAssist';

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
const clipA: Clip = {
  id: 'clip-a',
  trackId: 'track-v1',
  assetId: 'asset-a',
  name: 'Interview 1',
  inTicks: '0',
  outTicks: '24000',
  timelineStartTicks: '0',
  timelineDurationTicks: '24000',
};
const clipB: Clip = {
  id: 'clip-b',
  trackId: 'track-v1',
  assetId: 'asset-a',
  name: 'Interview 2',
  inTicks: '24000',
  outTicks: '48000',
  timelineStartTicks: '24000',
  timelineDurationTicks: '24000',
};
const clipC: Clip = {
  id: 'clip-c',
  trackId: 'track-v1',
  assetId: 'asset-b',
  name: 'Demo Hero',
  inTicks: '0',
  outTicks: '48000',
  timelineStartTicks: '48000',
  timelineDurationTicks: '48000',
};

const composition = (version: number = 5): Composition => ({
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
  name: 'Interview Reel',
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

const assetB: Asset = {
  id: 'asset-b',
  projectId: 'project-a',
  name: 'Demo Reel',
  path: '/media/demo.mov',
  sizeBytes: 2000,
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
// Domain Validation
// ---------------------------------------------------------------------------
describe('validateEditPlan', () => {
  const ctx = { composition: composition(5), assets: [assetA, assetB] };

  it('accepts a well-formed edit plan with valid first operation', () => {
    const plan: EditPlan = {
      summary: 'Shorten interview and replace outro',
      expectedVersion: 5,
      operations: [
        {
          kind: 'trim',
          clipId: 'clip-a',
          newInTicks: '0',
          newOutTicks: '12000',
          reason: 'Tighten intro',
        },
        {
          kind: 'delete',
          clipId: 'clip-b',
          reason: 'Cut redundant second take',
        },
      ],
    };
    const res = validateEditPlan(plan, ctx);
    expect(res.valid).toBe(true);
  });

  it('rejects stale expectedVersion', () => {
    const plan: EditPlan = {
      summary: 'Test plan',
      expectedVersion: 4,
      operations: [
        { kind: 'trim', clipId: 'clip-a', newInTicks: '0', newOutTicks: '12000', reason: 'Tighten' },
      ],
    };
    const res = validateEditPlan(plan, ctx);
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toContain('Timeline changed');
  });

  it('rejects plan with empty operations', () => {
    const plan: EditPlan = {
      summary: 'Empty plan',
      expectedVersion: 5,
      operations: [],
    };
    const res = validateEditPlan(plan, ctx);
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toContain('at least one operation');
  });

  it('rejects operation targeting unknown clip', () => {
    const op: EditPlanOperation = {
      kind: 'trim',
      clipId: 'clip-unknown',
      newInTicks: '0',
      newOutTicks: '12000',
      reason: 'Trim unknown',
    };
    const res = validateEditPlanOperation(op, 5, ctx);
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.error).toContain('non-existent clip');
  });
});

// ---------------------------------------------------------------------------
// assistEditPlan (Model Boundary Schema Validation)
// ---------------------------------------------------------------------------
describe('assistEditPlan', () => {
  const context = buildEditPlanContext(
    'My Project',
    composition(5),
    [assetA, assetB],
    'Cut repetition and start with demo hero',
  );

  it('rejects empty instruction without querying model', async () => {
    const res = await assistEditPlan({ ...context, instruction: '   ' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('EMPTY_INPUT');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('parses and accepts valid plan from model', async () => {
    mockCompletion(JSON.stringify({
      summary: 'Reorder demo to start and trim interview',
      operations: [
        {
          kind: 'reorder',
          clipId: 'clip-c',
          direction: 'left',
          reason: 'Start with hero demo shot',
        },
        {
          kind: 'trim',
          clipId: 'clip-a',
          newInTicks: '0',
          newOutTicks: '12000',
          reason: 'Shorten intro soundbite',
        },
      ],
    }));

    const res = await assistEditPlan(context);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.plan.expectedVersion).toBe(5);
      expect(res.plan.operations).toHaveLength(2);
      expect(res.plan.operations[0].kind).toBe('reorder');
      expect(res.plan.operations[1].kind).toBe('trim');
    }
  });

  it('rejects unknown operation kind', async () => {
    mockCompletion(JSON.stringify({
      summary: 'Invalid plan',
      operations: [
        {
          kind: 'colorGrade',
          clipId: 'clip-a',
          reason: 'Boost saturation',
        },
      ],
    }));

    const res = await assistEditPlan(context);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('unknown or invalid kind');
  });

  it('rejects operations with unknown clip IDs', async () => {
    mockCompletion(JSON.stringify({
      summary: 'Invalid clip plan',
      operations: [
        {
          kind: 'delete',
          clipId: 'clip-ghost',
          reason: 'Delete ghost clip',
        },
      ],
    }));

    const res = await assistEditPlan(context);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('references unknown clipId');
  });
});

// ---------------------------------------------------------------------------
// Sequential Execution Engine & Partial Failure Detection
// ---------------------------------------------------------------------------
describe('executeEditPlan', () => {
  it('executes operations in deterministic sequential order and creates revision on 100% success', async () => {
    const executed: string[] = [];
    let currentComp: Composition | null = composition(5);

    const callbacks = {
      trimClip: vi.fn().mockImplementation(async (clipId, inT, outT) => {
        executed.push(`trim:${clipId}:${inT}..${outT}`);
        if (currentComp) currentComp = { ...currentComp, version: currentComp.version + 1 };
      }),
      reorderClips: vi.fn().mockImplementation(async (clipId, dir) => {
        executed.push(`reorder:${clipId}:${dir}`);
        if (currentComp) currentComp = { ...currentComp, version: currentComp.version + 1 };
      }),
      removeClip: vi.fn().mockImplementation(async (clipId) => {
        executed.push(`remove:${clipId}`);
        if (currentComp) currentComp = { ...currentComp, version: currentComp.version + 1 };
      }),
      addClip: vi.fn().mockImplementation(async (p) => {
        executed.push(`add:${p.assetId}`);
        if (currentComp) currentComp = { ...currentComp, version: currentComp.version + 1 };
      }),
      replaceClip: vi.fn().mockImplementation(async (clipId, assetId) => {
        executed.push(`replace:${clipId}:${assetId}`);
        if (currentComp) currentComp = { ...currentComp, version: currentComp.version + 1 };
      }),
      createRevision: vi.fn().mockResolvedValue(undefined),
      getCurrentComposition: () => currentComp,
      getAssets: () => [assetA, assetB],
    };

    const plan: EditPlan = {
      summary: 'Three-step composite assembly',
      expectedVersion: 5,
      operations: [
        { kind: 'trim', clipId: 'clip-a', newInTicks: '0', newOutTicks: '12000', reason: 'Trim intro' },
        { kind: 'reorder', clipId: 'clip-c', direction: 'left', reason: 'Move hero left' },
        { kind: 'delete', clipId: 'clip-b', reason: 'Remove take 2' },
      ],
    };

    const res = await executeEditPlan(plan, callbacks);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.appliedCount).toBe(3);
      expect(res.revisionCreated).toBe(true);
    }

    // Verified: operations executed in exact order
    expect(executed).toEqual([
      'trim:clip-a:0..12000',
      'reorder:clip-c:left',
      'remove:clip-b',
    ]);

    // Revision created with plan summary
    expect(callbacks.createRevision).toHaveBeenCalledTimes(1);
    expect(callbacks.createRevision).toHaveBeenCalledWith('AI Edit Plan: Three-step composite assembly');
  });

  it('detects partial failure: halts immediately, records partial state, NEVER creates revision', async () => {
    let currentComp: Composition | null = composition(5);

    const callbacks = {
      trimClip: vi.fn().mockResolvedValue(undefined),
      reorderClips: vi.fn().mockRejectedValue(new Error('Track boundary conflict')),
      removeClip: vi.fn(),
      addClip: vi.fn(),
      replaceClip: vi.fn(),
      createRevision: vi.fn(),
      getCurrentComposition: () => currentComp,
      getAssets: () => [assetA, assetB],
    };

    const plan: EditPlan = {
      summary: 'Plan that fails on step 2',
      expectedVersion: 5,
      operations: [
        { kind: 'trim', clipId: 'clip-a', newInTicks: '0', newOutTicks: '12000', reason: 'Trim intro' },
        { kind: 'reorder', clipId: 'clip-c', direction: 'left', reason: 'Move hero' },
        { kind: 'delete', clipId: 'clip-b', reason: 'Remove take 2' },
      ],
    };

    const res = await executeEditPlan(plan, callbacks);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.appliedCount).toBe(1);
      expect(res.totalCount).toBe(3);
      expect(res.failedIndex).toBe(1);
      expect(res.error).toContain('Step 2 of 3 (reorder) failed');
      expect(res.error).toContain('1 operation(s) applied');
    }

    // Third step was never executed
    expect(callbacks.removeClip).not.toHaveBeenCalled();

    // CRITICAL: Revision was NOT created because execution failed partially!
    expect(callbacks.createRevision).not.toHaveBeenCalled();
  });
});
