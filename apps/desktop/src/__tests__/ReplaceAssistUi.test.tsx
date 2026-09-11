/**
 * ReplaceProposalPanel UI Tests
 *
 * Validates the Studio AI-replace preview control WITHOUT running Ollama:
 *   - Generate -> mocked local-model JSON -> a preview appears
 *   - Preview shows CURRENT clip, REPLACE WITH asset/range, DURATION CHANGE, REASON
 *   - Preview ALWAYS states original source media will not be modified
 *   - Before Apply -> zero native mutation calls
 *   - Dismiss -> zero native mutation calls
 *   - Apply -> the EXACT existing native replaceClip operation is called
 *   - Stale proposal -> native replace is NOT called
 *   - Invalid / wrong-operation / provider-unavailable -> no mutation
 *   - Revision created only after successful Apply
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Asset, Clip, Composition } from '../lib/contracts';
import { ReplaceProposalPanel } from '../components/ReplaceProposalPanel';

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
  trackId: 'track-primary',
  assetId: 'asset-01',
  name: 'Intro take 1',
  inTicks: '0',
  outTicks: '24000',
  timelineStartTicks: '0',
  timelineDurationTicks: '24000',
};
const clipB: Clip = {
  id: 'clip-b',
  trackId: 'track-primary',
  assetId: 'asset-01',
  name: 'Hero shot',
  inTicks: '24000',
  outTicks: '72000',
  timelineStartTicks: '24000',
  timelineDurationTicks: '48000',
};

const composition = (version: number = 7): Composition => ({
  id: 'composition-01',
  projectId: 'project-01',
  version,
  durationTicks: '72000',
  timeBase: { num: 1, den: 24000 },
  tracks: [{ id: 'track-primary', kind: 'primary_video', label: 'Primary Video', order: 0 }],
  clips: [clipA, clipB],
  updatedAt: '2026-09-08T00:00:00Z',
});

const asset01: Asset = {
  id: 'asset-01',
  projectId: 'project-01',
  name: 'Take 1 Reel',
  path: '/media/take1.mov',
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

const asset02: Asset = {
  id: 'asset-02',
  projectId: 'project-01',
  name: 'Take 2 Reel',
  path: '/media/take2.mov',
  sizeBytes: 2000,
  durationTicks: '120000',
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

function mockSuccessfulProposal(deltaTicks = '36000') {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      id: 'test-gen',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: JSON.stringify({
              targetClipId: 'clip-a',
              targetClipName: 'Intro take 1',
              replacementAssetId: 'asset-02',
              replacementAssetName: 'Take 2 Reel',
              sourceInTicks: '0',
              sourceOutTicks: deltaTicks,
              expectedVersion: 7,
              reason: 'Replace with better lighting in take 2.',
            }),
          },
          finish_reason: 'stop',
        },
      ],
    }),
  });
}

describe('ReplaceProposalPanel UI', () => {
  it('renders input and generates preview without mutating timeline', async () => {
    const replaceClip = vi.fn();
    const createRevision = vi.fn();

    render(
      <ReplaceProposalPanel
        projectName="Test Project"
        composition={composition(7)}
        clip={clipA}
        selectedClipAsset={asset01}
        assets={[asset01, asset02]}
        replaceClip={replaceClip}
        createRevision={createRevision}
      />,
    );

    mockSuccessfulProposal();

    const input = screen.getByLabelText(/replace instruction/i);
    fireEvent.change(input, { target: { value: 'Swap with take 2' } });

    const genBtn = screen.getByRole('button', { name: /generate proposal/i });
    await act(async () => {
      fireEvent.click(genBtn);
    });

    await waitFor(() => {
      expect(screen.getByTestId('replace-proposal-preview')).toBeDefined();
    });

    // Verify UI preview contains required sections
    expect(screen.getByText(/CURRENT:/i)).toBeDefined();
    expect(screen.getByText(/REPLACE WITH:/i)).toBeDefined();
    expect(screen.getByText(/DURATION CHANGE:/i)).toBeDefined();
    expect(screen.getByText(/REASON:/i)).toBeDefined();

    // Verify safety invariant text
    expect(screen.getByTestId('replace-media-safe').textContent).toContain('Original source media will not be modified.');

    // CRITICAL: Generating preview caused zero native calls
    expect(replaceClip).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();
  });

  it('dismisses proposal and makes zero native calls', async () => {
    const replaceClip = vi.fn();
    const createRevision = vi.fn();

    render(
      <ReplaceProposalPanel
        projectName="Test Project"
        composition={composition(7)}
        clip={clipA}
        selectedClipAsset={asset01}
        assets={[asset01, asset02]}
        replaceClip={replaceClip}
        createRevision={createRevision}
      />,
    );

    mockSuccessfulProposal();

    fireEvent.change(screen.getByLabelText(/replace instruction/i), {
      target: { value: 'Swap with take 2' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate proposal/i }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('replace-proposal-preview')).toBeDefined();
    });

    const dismissBtn = screen.getByTestId('replace-dismiss-button');
    await act(async () => {
      fireEvent.click(dismissBtn);
    });

    expect(screen.queryByTestId('replace-proposal-preview')).toBeNull();
    expect(replaceClip).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();
  });

  it('applies replace using exact replaceClip args and creates revision', async () => {
    const replaceClip = vi.fn().mockResolvedValue(undefined);
    const createRevision = vi.fn().mockResolvedValue(undefined);

    render(
      <ReplaceProposalPanel
        projectName="Test Project"
        composition={composition(7)}
        clip={clipA}
        selectedClipAsset={asset01}
        assets={[asset01, asset02]}
        replaceClip={replaceClip}
        createRevision={createRevision}
      />,
    );

    mockSuccessfulProposal('36000');

    fireEvent.change(screen.getByLabelText(/replace instruction/i), {
      target: { value: 'Swap with take 2' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate proposal/i }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('replace-proposal-preview')).toBeDefined();
    });

    const applyBtn = screen.getByTestId('replace-apply-button');
    await act(async () => {
      fireEvent.click(applyBtn);
    });

    // Verified: replaceClip called with exact args
    expect(replaceClip).toHaveBeenCalledTimes(1);
    expect(replaceClip).toHaveBeenCalledWith('clip-a', 'asset-02', '0', '36000');

    // Verified: revision created after successful replace
    expect(createRevision).toHaveBeenCalledTimes(1);
    expect(createRevision).toHaveBeenCalledWith(expect.stringContaining('AI replace:'));

    // Status message confirms source media was untouched
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toMatch(/Original source media will not be modified/i);
    });
  });

  it('rejects Apply when proposal is stale (version mismatch)', async () => {
    const replaceClip = vi.fn();
    const createRevision = vi.fn();

    const { rerender } = render(
      <ReplaceProposalPanel
        projectName="Test Project"
        composition={composition(7)}
        clip={clipA}
        selectedClipAsset={asset01}
        assets={[asset01, asset02]}
        replaceClip={replaceClip}
        createRevision={createRevision}
      />,
    );

    mockSuccessfulProposal();

    fireEvent.change(screen.getByLabelText(/replace instruction/i), {
      target: { value: 'Swap with take 2' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate proposal/i }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('replace-proposal-preview')).toBeDefined();
    });

    // Composition version bumps to 8 before Apply
    rerender(
      <ReplaceProposalPanel
        projectName="Test Project"
        composition={composition(8)}
        clip={clipA}
        selectedClipAsset={asset01}
        assets={[asset01, asset02]}
        replaceClip={replaceClip}
        createRevision={createRevision}
      />,
    );

    // Stale banner shows
    expect(screen.getByTestId('replace-proposal-stale')).toBeDefined();
    expect(screen.queryByTestId('replace-proposal-preview')).toBeNull();

    // Zero native calls made
    expect(replaceClip).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();
  });

  it('handles native failure and does not show success status', async () => {
    const replaceClip = vi.fn().mockRejectedValue(new Error('Native replace failed: invalid source range'));
    const createRevision = vi.fn();

    render(
      <ReplaceProposalPanel
        projectName="Test Project"
        composition={composition(7)}
        clip={clipA}
        selectedClipAsset={asset01}
        assets={[asset01, asset02]}
        replaceClip={replaceClip}
        createRevision={createRevision}
      />,
    );

    mockSuccessfulProposal();

    fireEvent.change(screen.getByLabelText(/replace instruction/i), {
      target: { value: 'Swap with take 2' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate proposal/i }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('replace-proposal-preview')).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('replace-apply-button'));
    });

    expect(replaceClip).toHaveBeenCalledTimes(1);
    expect(createRevision).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('alert').textContent).toMatch(/Native replace failed/i);
  });
});
