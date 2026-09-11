/**
 * ReorderProposalPanel — UI integration tests
 *
 * Mirrors TrimAssistUi.test.tsx architecture:
 * - Proposal preview rendering
 * - Apply routes through existing native reorderClips()
 * - Dismiss makes zero native calls
 * - Staleness detection and rejection
 * - Current/Proposed order display
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReorderProposalPanel } from '../components/ReorderProposalPanel';
import type { Clip, Composition, Track } from '../lib/contracts';

// Mock the reorderAssist module
vi.mock('../lib/reorderAssist', async () => {
  const actual = await vi.importActual('../lib/reorderAssist');
  return {
    ...actual,
    assistReorder: vi.fn(),
  };
});

import { assistReorder } from '../lib/reorderAssist';
const mockAssistReorder = vi.mocked(assistReorder);

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
const track: Track = {
  id: 'track-1',
  kind: 'primary_video',
  label: 'Primary Video',
  order: 0,
};

const clipA: Clip = {
  id: 'clip-a',
  trackId: 'track-1',
  assetId: 'asset-a',
  name: 'Opening',
  inTicks: '0',
  outTicks: '250000',
  timelineStartTicks: '0',
  timelineDurationTicks: '250000',
};

const clipB: Clip = {
  id: 'clip-b',
  trackId: 'track-1',
  assetId: 'asset-b',
  name: 'Interview',
  inTicks: '0',
  outTicks: '500000',
  timelineStartTicks: '250000',
  timelineDurationTicks: '500000',
};

const clipC: Clip = {
  id: 'clip-c',
  trackId: 'track-1',
  assetId: 'asset-c',
  name: 'Closing',
  inTicks: '0',
  outTicks: '200000',
  timelineStartTicks: '750000',
  timelineDurationTicks: '200000',
};

const composition = (version = 3): Composition => ({
  id: 'comp-1',
  projectId: 'project-1',
  version,
  durationTicks: '950000',
  timeBase: { num: 1, den: 25000 },
  tracks: [track],
  clips: [clipA, clipB, clipC],
  updatedAt: '2026-09-09T00:00:00Z',
});

const mockReorderClips = vi.fn().mockResolvedValue(undefined);
const mockCreateRevision = vi.fn().mockResolvedValue({ id: 'rev-1' });

function renderPanel(comp: Composition = composition(3), clip: Clip = clipB) {
  return render(
    <ReorderProposalPanel
      projectName="Test Project"
      composition={comp}
      clip={clip}
      reorderClips={mockReorderClips}
      createRevision={mockCreateRevision}
    />,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ReorderProposalPanel', () => {
  it('renders the instruction input and Generate button', () => {
    renderPanel();
    expect(screen.getByLabelText('Reorder instruction')).toBeTruthy();
    expect(screen.getByText('Generate Proposal')).toBeTruthy();
  });

  it('shows the current track order', () => {
    renderPanel();
    // All three clip names should appear in the track order display
    expect(screen.getByText(/Opening/)).toBeTruthy();
    expect(screen.getByText(/Interview/)).toBeTruthy();
    expect(screen.getByText(/Closing/)).toBeTruthy();
  });

  it('generates and displays a reorder proposal', async () => {
    mockAssistReorder.mockResolvedValueOnce({
      ok: true,
      proposal: {
        clipId: 'clip-b',
        clipName: 'Interview',
        direction: 'left' as const,
        expectedVersion: 3,
        reason: 'Move the interview earlier for stronger pacing.',
      },
    });

    renderPanel();
    const input = screen.getByLabelText('Reorder instruction');
    fireEvent.change(input, { target: { value: 'Move interview earlier' } });
    fireEvent.click(screen.getByText('Generate Proposal'));

    await waitFor(() => {
      expect(screen.getByTestId('reorder-proposal-preview')).toBeTruthy();
    });

    expect(screen.getByText(/Move the interview earlier/)).toBeTruthy();
    expect(screen.getByText('Apply Edit')).toBeTruthy();
    expect(screen.getByText('Dismiss')).toBeTruthy();
  });

  it('Apply routes through the existing native reorderClips path', async () => {
    mockAssistReorder.mockResolvedValueOnce({
      ok: true,
      proposal: {
        clipId: 'clip-b',
        clipName: 'Interview',
        direction: 'left' as const,
        expectedVersion: 3,
        reason: 'Stronger opening.',
      },
    });

    renderPanel();
    fireEvent.change(screen.getByLabelText('Reorder instruction'), { target: { value: 'Move earlier' } });
    fireEvent.click(screen.getByText('Generate Proposal'));

    await waitFor(() => {
      expect(screen.getByText('Apply Edit')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Apply Edit'));

    await waitFor(() => {
      expect(mockReorderClips).toHaveBeenCalledWith('clip-b', 'left');
    });
    expect(mockCreateRevision).toHaveBeenCalledWith(expect.stringContaining('AI reorder'));
  });

  it('Dismiss makes zero native calls', async () => {
    mockAssistReorder.mockResolvedValueOnce({
      ok: true,
      proposal: {
        clipId: 'clip-b',
        clipName: 'Interview',
        direction: 'left' as const,
        expectedVersion: 3,
        reason: 'Stronger opening.',
      },
    });

    renderPanel();
    fireEvent.change(screen.getByLabelText('Reorder instruction'), { target: { value: 'Move earlier' } });
    fireEvent.click(screen.getByText('Generate Proposal'));

    await waitFor(() => {
      expect(screen.getByText('Dismiss')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Dismiss'));

    // Zero native calls
    expect(mockReorderClips).not.toHaveBeenCalled();
    expect(mockCreateRevision).not.toHaveBeenCalled();

    // Proposal is cleared
    expect(screen.queryByTestId('reorder-proposal-preview')).toBeNull();
  });

  it('rejects a stale proposal before Apply', async () => {
    mockAssistReorder.mockResolvedValueOnce({
      ok: true,
      proposal: {
        clipId: 'clip-b',
        clipName: 'Interview',
        direction: 'left' as const,
        expectedVersion: 3,
        reason: 'Stronger opening.',
      },
    });

    // Render with version 3, then re-render with version 4 (simulating a timeline change)
    const { rerender } = renderPanel(composition(3));
    fireEvent.change(screen.getByLabelText('Reorder instruction'), { target: { value: 'Move earlier' } });
    fireEvent.click(screen.getByText('Generate Proposal'));

    await waitFor(() => {
      expect(screen.getByTestId('reorder-proposal-preview')).toBeTruthy();
    });

    // Re-render with a newer composition version (timeline changed)
    rerender(
      <ReorderProposalPanel
        projectName="Test Project"
        composition={composition(4)}
        clip={clipB}
        reorderClips={mockReorderClips}
        createRevision={mockCreateRevision}
      />,
    );

    // Stale message should appear, proposal preview should be gone
    expect(screen.getByTestId('reorder-proposal-stale')).toBeTruthy();
    expect(screen.queryByText('Apply Edit')).toBeNull();
  });

  it('shows an error when generation fails', async () => {
    mockAssistReorder.mockResolvedValueOnce({
      ok: false,
      error: 'Local AI unavailable: ECONNREFUSED',
      code: 'LOCAL_AI_UNAVAILABLE',
    });

    renderPanel();
    fireEvent.change(screen.getByLabelText('Reorder instruction'), { target: { value: 'Move earlier' } });
    fireEvent.click(screen.getByText('Generate Proposal'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    expect(screen.getByText(/ECONNREFUSED/)).toBeTruthy();
  });

  it('shows an error for empty instruction', async () => {
    renderPanel();
    fireEvent.click(screen.getByText('Generate Proposal'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    expect(screen.getByText(/describe how you want to reorder/)).toBeTruthy();
  });

  it('shows success status after apply', async () => {
    mockAssistReorder.mockResolvedValueOnce({
      ok: true,
      proposal: {
        clipId: 'clip-b',
        clipName: 'Interview',
        direction: 'left' as const,
        expectedVersion: 3,
        reason: 'Better.',
      },
    });

    renderPanel();
    fireEvent.change(screen.getByLabelText('Reorder instruction'), { target: { value: 'Move earlier' } });
    fireEvent.click(screen.getByText('Generate Proposal'));

    await waitFor(() => {
      expect(screen.getByText('Apply Edit')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Apply Edit'));

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeTruthy();
    });
    expect(screen.getByText(/Applied AI reorder/)).toBeTruthy();
  });
});
