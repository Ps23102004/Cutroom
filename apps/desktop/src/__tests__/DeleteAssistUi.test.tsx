/**
 * DeleteProposalPanel UI tests
 *
 * Validates the Studio AI-delete preview control WITHOUT running Ollama:
 *   - Generate -> mocked local-model JSON -> a preview appears
 *   - Preview ALWAYS states that original source media is not deleted
 *   - Before Apply -> zero native mutation calls
 *   - Dismiss -> zero native mutation calls
 *   - Apply -> the EXACT existing native removeClip operation is called
 *   - Stale proposal -> native remove is NOT called
 *   - Invalid / wrong-operation / provider-unavailable -> no mutation
 *
 * The panel receives removeClip / createRevision as injected props, so the tests
 * spy the exact native operations the UI is allowed to call and prove that raw
 * model output never mutates the timeline until the user applies a validated,
 * non-stale proposal.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Clip, Composition } from '../lib/contracts';
import { DeleteProposalPanel } from '../components/DeleteProposalPanel';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fixture state (composition timebase 1/24000; one clip; v7)
// ---------------------------------------------------------------------------
const clip: Clip = {
  id: 'clip-01',
  trackId: 'track-primary',
  assetId: 'asset-01',
  name: 'Hero shot',
  inTicks: '0',
  outTicks: '96000', // 4.0s
  timelineStartTicks: '0',
  timelineDurationTicks: '96000',
};

const composition = (version: number = 7): Composition => ({
  id: 'composition-01',
  projectId: 'project-01',
  version,
  durationTicks: '96000',
  timeBase: { num: 1, den: 24000 },
  tracks: [{ id: 'track-primary', kind: 'primary_video', label: 'Primary Video', order: 0 }],
  clips: [clip],
  updatedAt: '2026-09-08T00:00:00Z',
});

// One chat-completion response with the given assistant content.
function mockCompletion(content: string) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      id: 'test',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      }),
    });
}

const VALID_DELETE = JSON.stringify({
  clipId: 'clip-01',
  clipName: 'Take A',
  expectedVersion: 7,
  reason: 'Remove the duplicate hero shot.',
});

function renderPanel(v = 7, extra: Record<string, unknown> = {}) {
  const removeClip = vi.fn(async () => undefined);
  const createRevision = vi.fn(async () => undefined);
  const utils = render(
      <DeleteProposalPanel
      projectName="Demo Project"
      composition={composition(v)}
      clip={clip}
      removeClip={removeClip}
      createRevision={createRevision}
      {...extra}
      />,
    );
  return { ...utils, removeClip, createRevision };
}

describe('DeleteProposalPanel', () => {
  it('generates a preview from a mocked local model with no mutation yet', async () => {
    const { removeClip, createRevision } = renderPanel(7);
    mockCompletion(VALID_DELETE);

    fireEvent.change(screen.getByLabelText('Delete instruction'), {
      target: { value: 'Remove the duplicate hero shot.' },
      });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Proposal/i }));
      });

    await waitFor(() => expect(screen.getByTestId('delete-proposal-preview')).toBeDefined());
    expect(screen.getByText(/Remove clip/i)).toBeDefined();
    expect(screen.getByText(/Take A/i)).toBeDefined();
    expect(screen.getByText(/Remove the duplicate hero shot/i)).toBeDefined();

      // The preview ALWAYS makes the media-safety invariant explicit.
    expect(screen.getByTestId('delete-media-safe')).toBeDefined();
    expect(screen.getByText(/Original source media will not be deleted/i)).toBeDefined();

      // Before Apply, NOTHING was mutated.
    expect(removeClip).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();
    });

  it('falls back to the clip name / id when the model omits clipName', async () => {
    const { removeClip } = renderPanel(7);
    mockCompletion(JSON.stringify({
      clipId: 'clip-01', expectedVersion: 7, reason: 'Tighten the start.',
       }));

    fireEvent.change(screen.getByLabelText('Delete instruction'), {
      target: { value: 'Tighten the start' },
      });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Proposal/i }));
      });

    await waitFor(() => expect(screen.getByTestId('delete-proposal-preview')).toBeDefined());
    expect(screen.getByText(/Hero shot/i)).toBeDefined();
    expect(removeClip).not.toHaveBeenCalled();
    });

  it('dismissing makes zero native calls and clears the proposal', async () => {
    const { removeClip, createRevision } = renderPanel(7);
    mockCompletion(VALID_DELETE);

    fireEvent.change(screen.getByLabelText('Delete instruction'), {
      target: { value: 'Remove duplicate' },
      });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Proposal/i }));
      });
    await waitFor(() => expect(screen.getByTestId('delete-proposal-preview')).toBeDefined());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Dismiss/i }));
      });

    expect(screen.queryByTestId('delete-proposal-preview')).toBeNull();
    expect(removeClip).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();
    });

  it('Apply calls the exact existing native remove operation with the proposal clip id', async () => {
    const { removeClip, createRevision } = renderPanel(7);
    mockCompletion(VALID_DELETE);

    fireEvent.change(screen.getByLabelText('Delete instruction'), {
      target: { value: 'Remove the duplicate hero shot.' },
      });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Proposal/i }));
      });
    await waitFor(() => expect(screen.getByTestId('delete-proposal-preview')).toBeDefined());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Apply Deletion/i }));
      });

      // Exactly the existing native remove path, with the proposal clip id.
    expect(removeClip).toHaveBeenCalledTimes(1);
    expect(removeClip).toHaveBeenCalledWith('clip-01');
      // A revision is created from the applied proposal.
    expect(createRevision).toHaveBeenCalledTimes(1);
    const appliedNote = (createRevision.mock.calls[0] as unknown[])[0];
    expect(String(appliedNote)).toContain('AI delete');
    expect(String(appliedNote)).toContain('Remove the duplicate');
    });

  it('a stale proposal does NOT call native remove', async () => {
    const removeClip = vi.fn(async () => undefined);
    const createRevision = vi.fn(async () => undefined);

    mockCompletion(VALID_DELETE); // expectedVersion 7

     const { rerender } = render(
        <DeleteProposalPanel
        projectName="Demo Project"
        composition={composition(7)}
        clip={clip}
        removeClip={removeClip}
        createRevision={createRevision}
        />,
      );

    fireEvent.change(screen.getByLabelText('Delete instruction'), {
      target: { value: 'Remove duplicate' },
      });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Proposal/i }));
      });
    await waitFor(() => expect(screen.getByTestId('delete-proposal-preview')).toBeDefined());

      // The timeline advanced under the proposal -- re-read current version.
    rerender(
        <DeleteProposalPanel
        projectName="Demo Project"
        composition={composition(8)}
        clip={clip}
        removeClip={removeClip}
        createRevision={createRevision}
        />,
      );
    await waitFor(() => expect(screen.getByTestId('delete-proposal-stale')).toBeDefined());

      // Stale: the preview (with its Apply button) is replaced by the warning,
    // and no native mutation occurs.
    expect(screen.queryByTestId('delete-proposal-preview')).toBeNull();
    expect(removeClip).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();
    });

  it('an invalid model proposal (wrong clip id) produces no preview and no mutation', async () => {
    const { removeClip, createRevision } = renderPanel(7);
    mockCompletion(JSON.stringify({
      clipId: 'clip-99', expectedVersion: 7, reason: 'x',
      }));

    fireEvent.change(screen.getByLabelText('Delete instruction'), { target: { value: 'X' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Proposal/i }));
      });

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.queryByTestId('delete-proposal-preview')).toBeNull();
    expect(removeClip).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();
    });

  it('a wrong-operation model proposal (unknown field) is rejected with no mutation', async () => {
    const { removeClip, createRevision } = renderPanel(7);
    mockCompletion(JSON.stringify({
      clipId: 'clip-01', action: 'split', splitAtTicks: '12000',
      expectedVersion: 7, reason: 'split',
      }));

    fireEvent.change(screen.getByLabelText('Delete instruction'), { target: { value: 'Split it' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Proposal/i }));
      });

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.queryByTestId('delete-proposal-preview')).toBeNull();
    expect(removeClip).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();
    });

  it('a provider-unavailable response produces no preview and no mutation', async () => {
    const { removeClip, createRevision } = renderPanel(7);
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    fireEvent.change(screen.getByLabelText('Delete instruction'), { target: { value: 'X' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Proposal/i }));
      });

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.queryByTestId('delete-proposal-preview')).toBeNull();
    expect(removeClip).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();
    });

  it('an empty instruction blocks generation with no native call', async () => {
    const { removeClip, createRevision } = renderPanel(7);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Proposal/i }));
      });

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.queryByTestId('delete-proposal-preview')).toBeNull();
    expect(removeClip).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();
    });
});
