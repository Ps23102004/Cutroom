/**
 * InsertProposalPanel UI tests
 *
 * Validates the Studio AI-insert preview control WITHOUT running Ollama:
 *   - Generate -> mocked local-model JSON -> a preview appears
 *   - Preview shows SOURCE range, INSERT destination, RESULTING order, REASON
 *   - Preview ALWAYS states original source media is not modified
 *   - Before Apply -> zero native mutation calls
 *   - Dismiss -> zero native mutation calls
 *   - Apply -> the EXACT existing native addClip operation is called
 *   - Stale proposal -> native add is NOT called
 *   - Invalid / wrong-operation / provider-unavailable -> no mutation
 *
 * The panel receives addClip / createRevision as injected props, so the tests
 * spy the exact native operations the UI is allowed to call and prove that raw
 * model output never mutates the timeline until the user applies a validated,
 * non-stale proposal.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Asset, Clip, Composition } from '../lib/contracts';
import { InsertProposalPanel } from '../components/InsertProposalPanel';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fixture state (composition timebase 1/24000; one track, two clips; v7)
// ---------------------------------------------------------------------------
const clipA: Clip = {
  id: 'clip-a',
  trackId: 'track-primary',
  assetId: 'asset-01',
  name: 'Intro',
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
  inTicks: '0',
  outTicks: '48000',
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

const asset: Asset = {
  id: 'asset-01',
  projectId: 'project-01',
  name: 'Demo Reel',
  path: '/media/demo-reel.mov',
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

const VALID_INSERT = JSON.stringify({
  assetId: 'asset-01',
  assetName: 'Demo Reel',
  sourceInTicks: '48000',
  sourceOutTicks: '72000',
  targetTrackId: 'track-primary',
  placement: { mode: 'atEnd' },
  reason: 'Insert the closing shot at the end.',
});

function renderPanel(v = 7, extra: Record<string, unknown> = {}) {
  const addClip = vi.fn(async () => undefined);
  const createRevision = vi.fn(async () => undefined);
  const utils = render(
    <InsertProposalPanel
      projectName="Demo Project"
      composition={composition(v)}
      assets={[asset]}
      addClip={addClip}
      createRevision={createRevision}
      {...extra}
    />,
  );
  return { ...utils, addClip, createRevision };
}

describe('InsertProposalPanel', () => {
  it('generates a preview from a mocked local model with no mutation yet', async () => {
    const { addClip, createRevision } = renderPanel(7);
    mockCompletion(VALID_INSERT);

    fireEvent.change(screen.getByLabelText('Insert instruction'), {
      target: { value: 'Insert the closing shot at the end.' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Proposal/i }));
    });

    await waitFor(() => expect(screen.getByTestId('insert-proposal-preview')).toBeDefined());
    // SOURCE / INSERT / RESULT / REASON preview sections.
    expect(screen.getAllByText(/Demo Reel/).length).toBeGreaterThan(0);
    expect(screen.getByText(/00:00:02:00 → 00:00:03:00/)).toBeDefined();
    expect(screen.getByText(/Insert the closing shot at the end/i)).toBeDefined();
    expect(screen.getByText(/Intro.*Hero shot.*Demo Reel/i)).toBeDefined();

    // The preview ALWAYS makes the media-safety invariant explicit.
    expect(screen.getByTestId('insert-media-safe')).toBeDefined();
    expect(screen.getByText(/Original media will not be modified/i)).toBeDefined();

    // Before Apply, NOTHING was mutated.
    expect(addClip).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();
  });

  it('dismissing makes zero native calls and clears the proposal', async () => {
    const { addClip, createRevision } = renderPanel(7);
    mockCompletion(VALID_INSERT);

    fireEvent.change(screen.getByLabelText('Insert instruction'), { target: { value: 'X' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Proposal/i }));
    });
    await waitFor(() => expect(screen.getByTestId('insert-proposal-preview')).toBeDefined());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Dismiss/i }));
    });

    expect(screen.queryByTestId('insert-proposal-preview')).toBeNull();
    expect(addClip).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();
  });

  it('Apply calls the exact existing native addClip operation with resolved placement', async () => {
    const { addClip, createRevision } = renderPanel(7);
    mockCompletion(VALID_INSERT);

    fireEvent.change(screen.getByLabelText('Insert instruction'), { target: { value: 'Insert closing shot' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Proposal/i }));
    });
    await waitFor(() => expect(screen.getByTestId('insert-proposal-preview')).toBeDefined());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Apply Insert/i }));
    });

    // Exactly the existing native add path: asset, source range, track, and a
    // timeline start resolved from the CURRENT composition (track end 72000).
    expect(addClip).toHaveBeenCalledTimes(1);
    expect(addClip).toHaveBeenCalledWith({
      assetId: 'asset-01',
      sourceInTicks: '48000',
      sourceOutTicks: '72000',
      trackId: 'track-primary',
      timelineStartTicks: '72000',
    });
    // A revision is created from the applied proposal.
    expect(createRevision).toHaveBeenCalledTimes(1);
    const appliedNote = (createRevision.mock.calls[0] as unknown[])[0];
    expect(String(appliedNote)).toContain('AI insert');
    expect(String(appliedNote)).toContain('closing shot');
  });

  it('a stale proposal does NOT call native add', async () => {
    const addClip = vi.fn(async () => undefined);
    const createRevision = vi.fn(async () => undefined);

    mockCompletion(VALID_INSERT); // expectedVersion 7

    const { rerender } = render(
      <InsertProposalPanel
        projectName="Demo Project"
        composition={composition(7)}
        assets={[asset]}
        addClip={addClip}
        createRevision={createRevision}
      />,
    );

    fireEvent.change(screen.getByLabelText('Insert instruction'), { target: { value: 'X' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Proposal/i }));
    });
    await waitFor(() => expect(screen.getByTestId('insert-proposal-preview')).toBeDefined());

    // The timeline advanced under the proposal -- re-read current version.
    rerender(
      <InsertProposalPanel
        projectName="Demo Project"
        composition={composition(8)}
        assets={[asset]}
        addClip={addClip}
        createRevision={createRevision}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('insert-proposal-stale')).toBeDefined());

    // Stale: the preview (with its Apply button) is replaced by the warning,
    // and no native mutation occurs.
    expect(screen.queryByTestId('insert-proposal-preview')).toBeNull();
    expect(addClip).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();
  });

  it('an invalid model proposal (unknown asset) produces no preview and no mutation', async () => {
    const { addClip, createRevision } = renderPanel(7);
    mockCompletion(JSON.stringify({
      assetId: 'asset-ghost', assetName: 'Ghost',
      sourceInTicks: '0', sourceOutTicks: '1000',
      targetTrackId: 'track-primary', placement: { mode: 'atEnd' }, reason: 'x',
    }));

    fireEvent.change(screen.getByLabelText('Insert instruction'), { target: { value: 'X' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Proposal/i }));
    });

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.queryByTestId('insert-proposal-preview')).toBeNull();
    expect(addClip).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();
  });

  it('a wrong-operation model proposal (unknown field) is rejected with no mutation', async () => {
    const { addClip, createRevision } = renderPanel(7);
    mockCompletion(JSON.stringify({
      assetId: 'asset-01', assetName: 'Demo Reel',
      sourceInTicks: '0', sourceOutTicks: '1000',
      targetTrackId: 'track-primary', placement: { mode: 'atEnd' },
      action: 'split', reason: 'x',
    }));

    fireEvent.change(screen.getByLabelText('Insert instruction'), { target: { value: 'Split it' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Proposal/i }));
    });

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.queryByTestId('insert-proposal-preview')).toBeNull();
    expect(addClip).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();
  });

  it('a provider-unavailable response produces no preview and no mutation', async () => {
    const { addClip, createRevision } = renderPanel(7);
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    fireEvent.change(screen.getByLabelText('Insert instruction'), { target: { value: 'X' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Proposal/i }));
    });

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.queryByTestId('insert-proposal-preview')).toBeNull();
    expect(addClip).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();
  });

  it('an empty instruction blocks generation with no native call', async () => {
    const { addClip, createRevision } = renderPanel(7);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Proposal/i }));
    });

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.queryByTestId('insert-proposal-preview')).toBeNull();
    expect(addClip).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();
  });
});
