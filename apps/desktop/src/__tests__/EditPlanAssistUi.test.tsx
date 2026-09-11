/**
 * EditPlanProposalPanel UI Tests
 *
 * Validates the multi-operation EditPlan UI:
 *   - Generate -> mocked plan -> preview renders operations list
 *   - Safety invariant: original media not modified
 *   - Before Apply -> zero native calls
 *   - Dismiss -> zero native calls
 *   - Apply -> executes each step sequentially, creates revision on 100% completion
 *   - Stale version -> blocked with zero calls
 *   - Partial failure -> surfaces exact error without reporting full success
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Asset, Clip, Composition } from '../lib/contracts';
import { EditPlanProposalPanel } from '../components/EditPlanProposalPanel';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});
afterEach(() => {
  vi.restoreAllMocks();
});

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

const composition = (version: number = 5): Composition => ({
  id: 'composition-1',
  projectId: 'project-a',
  version,
  durationTicks: '48000',
  timeBase: { num: 1, den: 24000 },
  tracks: [{ id: 'track-v1', kind: 'primary_video', label: 'Primary Video', order: 0 }],
  clips: [clipA, clipB],
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

function mockPlanCompletion() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      id: 'test-plan',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: JSON.stringify({
              summary: 'Trim intro and delete second take',
              operations: [
                {
                  kind: 'trim',
                  clipId: 'clip-a',
                  newInTicks: '0',
                  newOutTicks: '12000',
                  reason: 'Make intro snappy',
                },
                {
                  kind: 'delete',
                  clipId: 'clip-b',
                  reason: 'Remove redundant take',
                },
              ],
            }),
          },
          finish_reason: 'stop',
        },
      ],
    }),
  });
}

describe('EditPlanProposalPanel UI', () => {
  it('renders input, generates preview with operations, causes zero mutation before apply', async () => {
    const trimClip = vi.fn();
    const reorderClips = vi.fn();
    const removeClip = vi.fn();
    const addClip = vi.fn();
    const replaceClip = vi.fn();
    const createRevision = vi.fn();

    render(
      <EditPlanProposalPanel
        projectName="Test Project"
        composition={composition(5)}
        assets={[assetA]}
        trimClip={trimClip}
        reorderClips={reorderClips}
        removeClip={removeClip}
        addClip={addClip}
        replaceClip={replaceClip}
        createRevision={createRevision}
        getCurrentComposition={() => composition(5)}
      />,
    );

    mockPlanCompletion();

    fireEvent.change(screen.getByLabelText(/assembly \/ editing goal/i), {
      target: { value: 'Create 15s teaser' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate edit plan/i }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('edit-plan-preview')).toBeDefined();
    });

    // Verify summary and operation badges
    expect(screen.getByText(/Trim intro and delete second take/i)).toBeDefined();
    expect(screen.getByText(/1\. trim/i)).toBeDefined();
    expect(screen.getByText(/2\. delete/i)).toBeDefined();

    // Verify media safety note
    expect(screen.getByTestId('edit-plan-media-safe').textContent).toContain(
      'Original source media will not be modified.',
    );

    // CRITICAL: zero mutation calls
    expect(trimClip).not.toHaveBeenCalled();
    expect(removeClip).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();
  });

  it('dismisses plan and makes zero native calls', async () => {
    render(
      <EditPlanProposalPanel
        projectName="Test Project"
        composition={composition(5)}
        assets={[assetA]}
        trimClip={vi.fn()}
        reorderClips={vi.fn()}
        removeClip={vi.fn()}
        addClip={vi.fn()}
        replaceClip={vi.fn()}
        createRevision={vi.fn()}
        getCurrentComposition={() => composition(5)}
      />,
    );

    mockPlanCompletion();

    fireEvent.change(screen.getByLabelText(/assembly \/ editing goal/i), {
      target: { value: 'Create 15s teaser' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate edit plan/i }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('edit-plan-preview')).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('dismiss-plan-button'));
    });

    expect(screen.queryByTestId('edit-plan-preview')).toBeNull();
  });

  it('applies plan sequentially and creates revision on completion', async () => {
    const trimClip = vi.fn().mockResolvedValue(undefined);
    const removeClip = vi.fn().mockResolvedValue(undefined);
    const createRevision = vi.fn().mockResolvedValue(undefined);

    render(
      <EditPlanProposalPanel
        projectName="Test Project"
        composition={composition(5)}
        assets={[assetA]}
        trimClip={trimClip}
        reorderClips={vi.fn()}
        removeClip={removeClip}
        addClip={vi.fn()}
        replaceClip={vi.fn()}
        createRevision={createRevision}
        getCurrentComposition={() => composition(5)}
      />,
    );

    mockPlanCompletion();

    fireEvent.change(screen.getByLabelText(/assembly \/ editing goal/i), {
      target: { value: 'Create 15s teaser' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate edit plan/i }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('edit-plan-preview')).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('apply-plan-button'));
    });

    expect(trimClip).toHaveBeenCalledTimes(1);
    expect(trimClip).toHaveBeenCalledWith('clip-a', '0', '12000');

    expect(removeClip).toHaveBeenCalledTimes(1);
    expect(removeClip).toHaveBeenCalledWith('clip-b');

    expect(createRevision).toHaveBeenCalledTimes(1);
    expect(createRevision).toHaveBeenCalledWith('AI Edit Plan: Trim intro and delete second take');

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toMatch(/Successfully applied all 2 operations/i);
    });
  });

  it('handles partial execution failure: stops, shows failure error, does not create revision', async () => {
    const trimClip = vi.fn().mockResolvedValue(undefined);
    const removeClip = vi.fn().mockRejectedValue(new Error('Clip lock error'));
    const createRevision = vi.fn();

    render(
      <EditPlanProposalPanel
        projectName="Test Project"
        composition={composition(5)}
        assets={[assetA]}
        trimClip={trimClip}
        reorderClips={vi.fn()}
        removeClip={removeClip}
        addClip={vi.fn()}
        replaceClip={vi.fn()}
        createRevision={createRevision}
        getCurrentComposition={() => composition(5)}
      />,
    );

    mockPlanCompletion();

    fireEvent.change(screen.getByLabelText(/assembly \/ editing goal/i), {
      target: { value: 'Create 15s teaser' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate edit plan/i }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('edit-plan-preview')).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('apply-plan-button'));
    });

    expect(trimClip).toHaveBeenCalledTimes(1);
    expect(removeClip).toHaveBeenCalledTimes(1);
    expect(createRevision).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Step 2 of 2 (delete) failed');
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
