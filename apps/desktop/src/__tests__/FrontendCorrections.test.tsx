import React, { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { AppProvider, useApp } from '../context/AppContext';
import { StudioRoute, mapPlayheadToSourceBoundary } from '../routes/StudioRoute';
import { DeliverRoute } from '../routes/DeliverRoute';
import { ProjectsRoute } from '../routes/ProjectsRoute';
import { HomeRoute } from '../routes/HomeRoute';
import { FIXTURE_COMPOSITION, FIXTURE_PROJECT } from '../lib/fixtures';

const FixtureStudio: React.FC = () => {
  const { enableFixtureMode } = useApp();
  useEffect(() => {
    enableFixtureMode();
  }, [enableFixtureMode]);
  return <StudioRoute />;
};

const FixtureDeliver: React.FC = () => {
  const { enableFixtureMode } = useApp();
  useEffect(() => {
    enableFixtureMode();
  }, [enableFixtureMode]);
  return <DeliverRoute />;
};

describe('bounded frontend corrections', () => {
  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI__;
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI__;
  });

  it('uses the composition timebase and starts the fixture playhead at zero', async () => {
    const CompositionTimebaseHarness: React.FC = () => {
      const { enableFixtureMode, setComposition } = useApp();
      useEffect(() => {
        enableFixtureMode();
        setComposition({ ...FIXTURE_COMPOSITION, durationTicks: '96000', timeBase: { num: 1, den: 48000 } });
      }, [enableFixtureMode, setComposition]);
      return <StudioRoute />;
    };

    render(
      <AppProvider>
        <CompositionTimebaseHarness />
      </AppProvider>,
    );

    await waitFor(() => expect(screen.getAllByText('00:00:00:00').length).toBeGreaterThan(0));
    const timelineLane = screen.getAllByTestId('timeline-lane')[1];
    Object.defineProperty(timelineLane, 'getBoundingClientRect', { value: () => ({ left: 0, width: 100, top: 0, right: 100, bottom: 40, height: 40 }) });
    fireEvent.click(timelineLane, { clientX: 50 });
    await waitFor(() => expect(screen.getAllByText('00:00:01:00').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText(/All operations write immutable content-hashed revisions/i));
    await waitFor(() => expect(screen.getAllByText('00:00:00:10').length).toBeGreaterThan(0));
    expect(screen.queryAllByText('00:00:00:21')).toHaveLength(0);
    expect(screen.getByText(/Fixture transcript sample/i)).toBeDefined();
  });

  it('maps a non-zero composition playhead to an exact source-frame boundary', () => {
    const clip = {
      ...FIXTURE_COMPOSITION.clips[0],
      timelineStartTicks: '8000',
      timelineDurationTicks: '50000',
      inTicks: '2048',
      outTicks: '14848',
    };
    const asset = {
      timeBase: { num: 1, den: 12288 },
      fpsNumerator: 24,
      fpsDenominator: 1,
      durationTicks: '30000',
    };
    expect(
      mapPlayheadToSourceBoundary('48000', clip, { num: 1, den: 48000 }, asset),
    ).toBe('12288');
  });

  it('keeps split points in composition ticks and rejects invalid source range alignment', async () => {
    const { result } = await import('@testing-library/react').then(({ renderHook }) => renderHook(() => useApp(), {
      wrapper: ({ children }) => <AppProvider>{children}</AppProvider>,
    }));
    act(() => result.current.enableFixtureMode());
    act(() => result.current.setComposition({ ...FIXTURE_COMPOSITION, timeBase: { num: 1, den: 48000 } }));
    await act(async () => {
      await result.current.splitClip('clip-01', '4000');
    });
    const split = result.current.composition?.clips.find((clip) => clip.id === 'clip-01-a');
    expect(split?.timelineDurationTicks).toBe('4000');
    expect(() => mapPlayheadToSourceBoundary('4100', { ...FIXTURE_COMPOSITION.clips[0], timelineStartTicks: '0', timelineDurationTicks: '10000' }, { num: 1, den: 48000 }, { timeBase: { num: 1, den: 12288 }, fpsNumerator: 24, fpsDenominator: 1, durationTicks: '30000' })).toThrow(/frame-aligned|exact/);
  });

  it('resets source range to a full valid frame-aligned duration after asset selection', async () => {
    render(
      <AppProvider>
        <FixtureStudio />
      </AppProvider>,
    );
    const assetSelect = await screen.findByLabelText('Source Asset');
    await act(async () => {
      fireEvent.change(assetSelect, { target: { value: 'fixture-asset-001' } });
    });
    await waitFor(() => expect((screen.getByLabelText('Source Out (ticks)') as HTMLInputElement).value).toBe('72000'));
    expect((screen.getByLabelText('Source In (ticks)') as HTMLInputElement).value).toBe('0');
  });

  it('rejects an explicitly invalid source alignment without adding a clip', async () => {
    render(
      <AppProvider>
        <FixtureStudio />
      </AppProvider>,
    );
    fireEvent.change(await screen.findByLabelText('Source Asset'), { target: { value: 'fixture-asset-001' } });
    await waitFor(() => expect((screen.getByLabelText('Source Out (ticks)') as HTMLInputElement).value).toBe('72000'));
    fireEvent.change(screen.getByLabelText('Destination Track'), { target: { value: 'track-primary' } });
    fireEvent.change(screen.getByLabelText('Source Out (ticks)'), { target: { value: '2400' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Range' }));
    expect(screen.getByRole('alert').textContent).toMatch(/frame-aligned/i);
    expect(screen.queryByRole('button', { name: 'Selected source range' })).toBeNull();
  });

  it('defaults Deliver to the highest revision and preserves an explicit valid choice', async () => {
    render(
      <AppProvider>
        <FixtureDeliver />
      </AppProvider>,
    );
    const revisionSelect = await screen.findByLabelText('Saved Revision to Render');
    await waitFor(() => expect((revisionSelect as HTMLSelectElement).value).toBe('fixture-rev-003'));
    fireEvent.change(revisionSelect, { target: { value: 'fixture-rev-002' } });
    expect((revisionSelect as HTMLSelectElement).value).toBe('fixture-rev-002');
  });

  it('disables reorder at track boundaries and keeps valid adjacent actions available', async () => {
    render(
      <AppProvider>
        <FixtureStudio />
      </AppProvider>,
    );
    const firstClip = await screen.findByRole('button', { name: 'Intro Sentence' });
    fireEvent.click(firstClip);
    expect((screen.getByRole('button', { name: /Move Left/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Move Right/ }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Main Explanation' }));
    expect((screen.getByRole('button', { name: /Move Left/ }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: /Move Right/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('uses native directory selection for production project creation without a path field', async () => {
    const requests: Array<Record<string, unknown>> = [];
    window.__TAURI__ = {
      core: {
        invoke: async <T,>(_command: string, args?: Record<string, unknown>): Promise<T> => {
          const request = args?.request as Record<string, unknown> | undefined;
          if (request) requests.push(request);
          switch (request?.command) {
            case 'project.create':
            case 'project.open':
              return { ok: true, data: { ...FIXTURE_PROJECT, id: 'native-project', name: 'Native Project', isFixture: false } } as T;
            case 'project.list':
            case 'asset.list':
            case 'revision.list':
            case 'job.list':
              return { ok: true, data: [] } as T;
            case 'composition.get':
              return { ok: true, data: null } as T;
            case 'health.get':
              return { ok: true, data: { tauriConnected: true } } as T;
            default:
              throw new Error(`Unexpected command ${String(request?.command)}`);
          }
        },
      },
    };

    render(
      <AppProvider>
        <ProjectsRoute />
      </AppProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'New Project' }));
    expect(screen.queryByLabelText('Storage Directory')).toBeNull();
    expect(screen.queryByText(/Source File Path/i)).toBeNull();
    fireEvent.change(screen.getByLabelText('Project Name'), { target: { value: 'Native Project' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() => expect(requests.some((request) => request.command === 'project.create')).toBe(true));
    const create = requests.find((request) => request.command === 'project.create');
    expect((create?.payload as Record<string, unknown>).selectDirectory).toBe(true);
    expect((create?.payload as Record<string, unknown>).path).toBeUndefined();
  });

  it('keeps Home Create name-only and delegates storage selection to native', async () => {
    const requests: Array<Record<string, unknown>> = [];
    window.__TAURI__ = {
      core: {
        invoke: async <T,>(_command: string, args?: Record<string, unknown>): Promise<T> => {
          const request = args?.request as Record<string, unknown> | undefined;
          if (request) requests.push(request);
          switch (request?.command) {
            case 'project.create':
            case 'project.open':
              return { ok: true, data: { ...FIXTURE_PROJECT, id: 'home-native-project', name: 'Home Native Project', isFixture: false } } as T;
            case 'project.list':
            case 'asset.list':
            case 'revision.list':
            case 'job.list':
              return { ok: true, data: [] } as T;
            case 'composition.get':
              return { ok: true, data: null } as T;
            case 'health.get':
              return { ok: true, data: { tauriConnected: true } } as T;
            default:
              throw new Error(`Unexpected command ${String(request?.command)}`);
          }
        },
      },
    };

    render(
      <AppProvider>
        <HomeRoute />
      </AppProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'New Project' }));
    expect(screen.queryByLabelText('Storage Directory')).toBeNull();
    fireEvent.change(screen.getByLabelText('Project Name'), { target: { value: 'Home Native Project' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() => expect(requests.some((request) => request.command === 'project.create')).toBe(true));
    const create = requests.find((request) => request.command === 'project.create');
    expect((create?.payload as Record<string, unknown>).selectDirectory).toBe(true);
    expect((create?.payload as Record<string, unknown>).path).toBeUndefined();
  });
});
