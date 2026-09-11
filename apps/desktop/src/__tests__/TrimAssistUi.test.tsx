/**
 * TrimProposalPanel UI tests
 *
 * Validates the Studio AI-trim preview control WITHOUT running Ollama:
 *  - Generate -> mocked local-model JSON -> a preview appears
 *  - Before Apply -> zero native mutation calls
 *  - Dismiss -> zero native mutation calls
 *  - Apply -> the EXACT existing native trimClip operation is called
 *  - Stale proposal -> native trim is NOT called
 *  - Invalid proposal -> no mutation
 *  - Provider unavailable -> no mutation
 *
 * The panel receives trimClip / createRevision as injected props, so the tests
 * spy the exact native operations the UI is allowed to call and prove that raw
 * model output never mutates the timeline until the user applies a validated,
 * non-stale proposal.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Asset, Clip, Composition } from '../lib/contracts';
import { TrimProposalPanel } from '../components/TrimProposalPanel';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fixture state (composition timebase 1/24000; asset 6.0s; clip 4.0s; v7)
// ---------------------------------------------------------------------------
const asset: Asset = {
  id: 'asset-01',
  projectId: 'project-01',
  name: 'source.mov',
  path: '/media/source.mov',
  sizeBytes: 10,
  durationTicks: '144000', // 6.0s at 1/24000
  timeBase: { num: 1, den: 24000 },
  width: 1920,
  height: 1080,
  fpsNumerator: 24,
  fpsDenominator: 1,
  format: 'MOV',
  codec: 'H.264',
  audioChannels: 2,
  importType: 'managed',
  proxyStatus: 'none',
};

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

// "Shorten this clip by two seconds from the end" -> tail of a 4s clip -> 2s
const TWO_SECONDS_OFF_TAIL = JSON.stringify({
  clipId: 'clip-01',
  clipName: 'Take A',
  newInTicks: '0',
  newOutTicks: '48000', // 48000 ticks = 2.0s
  expectedVersion: 7,
  reason: 'Shorten the tail by two seconds.',
});

describe('TrimProposalPanel', () => {
  it('generates a preview from a mocked local model with no mutation yet', async () => {
    const trimClip = vi.fn(async () => undefined);
    const createRevision = vi.fn(async () => undefined);

    mockCompletion(TWO_SECONDS_OFF_TAIL);

    render(
       <TrimProposalPanel
        projectName="Demo Project"
        composition={composition(7)}
        clip={clip}
        asset={asset}
        trimClip={trimClip}
        createRevision={createRevision}
       />,
     );

    fireEvent.change(screen.getByLabelText('Trim instruction'), {
      target: { value: 'Shorten this clip by two seconds from the end.' },
     });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Proposal/i }));
     });

    // Preview appears.
    await waitFor(() => expect(screen.getByTestId('trim-proposal-preview')).toBeDefined());
    expect(screen.getByText(/CURRENT/i)).toBeDefined();
    expect(screen.getByText(/PROPOSED/i)).toBeDefined();
    expect(screen.getByText(/DIFFERENCE/i)).toBeDefined();
    expect(screen.getByText(/Take A/i)).toBeDefined();
    expect(screen.getByText(/Shorten the tail by two seconds/i)).toBeDefined();

     // Before Apply, NOTHING was mutated.
    expect(trimClip).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();
   });

  it('falls back to the clip name when the model omits clipName', async () => {
    const trimClip = vi.fn(async () => undefined);
    const createRevision = vi.fn(async () => undefined);

    mockCompletion(JSON.stringify({
      clipId: 'clip-01',
      newInTicks: '0',
      newOutTicks: '48000',
      expectedVersion: 7,
      reason: 'Tighten the start.',
     }));

    render(
       <TrimProposalPanel
        projectName="Demo Project"
        composition={composition(7)}
        clip={clip}
        asset={asset}
        trimClip={trimClip}
        createRevision={createRevision}
       />,
     );

    fireEvent.change(screen.getByLabelText('Trim instruction'), {
      target: { value: 'Tighten the start' },
     });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Proposal/i }));
     });

    await waitFor(() => expect(screen.getByTestId('trim-proposal-preview')).toBeDefined());
    expect(screen.getByText(/Hero shot/i)).toBeDefined();
   });

  it('dismissing makes zero native calls and clears the proposal', async () => {
    const trimClip = vi.fn(async () => undefined);
    const createRevision = vi.fn(async () => undefined);

    mockCompletion(TWO_SECONDS_OFF_TAIL);

    render(
       <TrimProposalPanel
        projectName="Demo Project"
        composition={composition(7)}
        clip={clip}
        asset={asset}
        trimClip={trimClip}
        createRevision={createRevision}
       />,
     );

    fireEvent.change(screen.getByLabelText('Trim instruction'), {
      target: { value: 'Shorten this clip by two seconds from the end.' },
     });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Proposal/i }));
     });
    await waitFor(() => expect(screen.getByTestId('trim-proposal-preview')).toBeDefined());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Dismiss/i }));
     });

    expect(screen.queryByTestId('trim-proposal-preview')).toBeNull();
    expect(trimClip).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();
   });

  it('Apply calls the exact existing native trim operation with the proposal ticks', async () => {
    const trimClip = vi.fn(async () => undefined);
    const createRevision = vi.fn(async () => undefined);

    mockCompletion(TWO_SECONDS_OFF_TAIL);

    render(
       <TrimProposalPanel
        projectName="Demo Project"
        composition={composition(7)}
        clip={clip}
        asset={asset}
        trimClip={trimClip}
        createRevision={createRevision}
       />,
     );

    fireEvent.change(screen.getByLabelText('Trim instruction'), {
      target: { value: 'Shorten this clip by two seconds from the end.' },
     });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Proposal/i }));
     });
    await waitFor(() => expect(screen.getByTestId('trim-proposal-preview')).toBeDefined());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Apply Edit/i }));
     });

     // Exactly the existing native trim path, with the proposal's source ticks.
    expect(trimClip).toHaveBeenCalledTimes(1);
    expect(trimClip).toHaveBeenCalledWith('clip-01', '0', '48000');
     // A revision is created from the applied proposal.
    expect(createRevision).toHaveBeenCalledTimes(1);
    const appliedNote = (createRevision.mock.calls[0] as unknown[])[0];
    expect(String(appliedNote)).toContain('Shorten the tail');
   });

  it('a stale proposal does NOT call native trim', async () => {
    const trimClip = vi.fn(async () => undefined);
    const createRevision = vi.fn(async () => undefined);

    mockCompletion(TWO_SECONDS_OFF_TAIL); // expectedVersion 7

     const { rerender } = render(
       <TrimProposalPanel
        projectName="Demo Project"
        composition={composition(7)}
        clip={clip}
        asset={asset}
        trimClip={trimClip}
        createRevision={createRevision}
       />,
     );

    fireEvent.change(screen.getByLabelText('Trim instruction'), {
      target: { value: 'Shorten this clip by two seconds from the end.' },
     });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Proposal/i }));
     });
    await waitFor(() => expect(screen.getByTestId('trim-proposal-preview')).toBeDefined());

     // The timeline advanced under the proposal -- re-read current version.
    rerender(
       <TrimProposalPanel
        projectName="Demo Project"
        composition={composition(8)}
        clip={clip}
        asset={asset}
        trimClip={trimClip}
        createRevision={createRevision}
       />,
     );
    await waitFor(() => expect(screen.getByTestId('trim-proposal-stale')).toBeDefined());

     // Stale: the preview (with its Apply button) is replaced by the warning,
     // and no native mutation occurs.
    expect(screen.queryByTestId('trim-proposal-preview')).toBeNull();
    expect(trimClip).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();
   });

  it('an invalid model proposal (wrong clip id) produces no preview and no mutation', async () => {
    const trimClip = vi.fn(async () => undefined);
    const createRevision = vi.fn(async () => undefined);

    mockCompletion(JSON.stringify({
      clipId: 'clip-99',
      newInTicks: '0',
      newOutTicks: '48000',
      expectedVersion: 7,
      reason: 'x',
     }));

    render(
       <TrimProposalPanel
        projectName="Demo Project"
        composition={composition(7)}
        clip={clip}
        asset={asset}
        trimClip={trimClip}
        createRevision={createRevision}
       />,
     );

    fireEvent.change(screen.getByLabelText('Trim instruction'), { target: { value: 'Do something' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Proposal/i }));
     });

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.queryByTestId('trim-proposal-preview')).toBeNull();
    expect(trimClip).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();
   });

  it('a wrong-operation model proposal is rejected with no mutation', async () => {
    const trimClip = vi.fn(async () => undefined);
    const createRevision = vi.fn(async () => undefined);

    mockCompletion(JSON.stringify({
      clipId: 'clip-01',
      action: 'split',
      splitAtTicks: '12000',
      newInTicks: '0',
      newOutTicks: '48000',
      expectedVersion: 7,
      reason: 'split',
     }));

    render(
       <TrimProposalPanel
        projectName="Demo Project"
        composition={composition(7)}
        clip={clip}
        asset={asset}
        trimClip={trimClip}
        createRevision={createRevision}
       />,
     );

    fireEvent.change(screen.getByLabelText('Trim instruction'), { target: { value: 'Split it' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Proposal/i }));
     });

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.queryByTestId('trim-proposal-preview')).toBeNull();
    expect(trimClip).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();
   });

  it('a provider-unavailable response produces no preview and no mutation', async () => {
    const trimClip = vi.fn(async () => undefined);
    const createRevision = vi.fn(async () => undefined);

    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    render(
       <TrimProposalPanel
        projectName="Demo Project"
        composition={composition(7)}
        clip={clip}
        asset={asset}
        trimClip={trimClip}
        createRevision={createRevision}
       />,
     );

    fireEvent.change(screen.getByLabelText('Trim instruction'), { target: { value: 'Shorten it' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Proposal/i }));
     });

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.queryByTestId('trim-proposal-preview')).toBeNull();
    expect(trimClip).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();
   });

  it('an out-point beyond the source asset is rejected with no mutation', async () => {
    const trimClip = vi.fn(async () => undefined);
    const createRevision = vi.fn(async () => undefined);

    mockCompletion(JSON.stringify({
      clipId: 'clip-01',
      newInTicks: '0',
      newOutTicks: '720000', // far beyond asset duration 144000
      expectedVersion: 7,
      reason: 'x',
     }));

    render(
       <TrimProposalPanel
        projectName="Demo Project"
        composition={composition(7)}
        clip={clip}
        asset={asset}
        trimClip={trimClip}
        createRevision={createRevision}
       />,
     );

    fireEvent.change(screen.getByLabelText('Trim instruction'), { target: { value: 'Make it huge' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate Proposal/i }));
     });

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.queryByTestId('trim-proposal-preview')).toBeNull();
    expect(trimClip).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();
   });
});
