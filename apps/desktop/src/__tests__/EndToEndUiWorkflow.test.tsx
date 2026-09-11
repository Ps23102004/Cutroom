import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { AppProvider } from '../context/AppContext';
import { App } from '../App';
import type { Asset, Composition, Job, Project, Revision } from '../lib/contracts';

const mockProject: Project = {
  id: 'proj-e2e-01',
  name: 'Showcase Video',
  path: '/workspace/showcase',
  fpsNumerator: 24,
  fpsDenominator: 1,
  aspectRatio: '16:9',
  createdAt: '2026-09-09T12:00:00Z',
  updatedAt: '2026-09-09T12:00:00Z',
  revisionCount: 0,
  status: 'draft',
};

const mockAsset: Asset = {
  id: 'asset-e2e-01',
  projectId: 'proj-e2e-01',
  name: 'keynote_take.mp4',
  path: '/workspace/showcase/.cutroom/media/keynote_take.mp4',
  sizeBytes: 1048576,
  durationTicks: '72000',
  timeBase: { num: 1, den: 48000 },
  width: 1920,
  height: 1080,
  fpsNumerator: 24,
  fpsDenominator: 1,
  format: 'MP4',
  codec: 'H.264',
  audioChannels: 2,
  importType: 'managed',
  proxyStatus: 'none',
};

const initialComposition: Composition = {
  id: 'comp-e2e-01',
  projectId: 'proj-e2e-01',
  version: 1,
  durationTicks: '0',
  timeBase: { num: 1, den: 48000 },
  tracks: [],
  clips: [],
  updatedAt: '2026-09-09T12:00:00Z',
};

const compositionWithClip: Composition = {
  id: 'comp-e2e-01',
  projectId: 'proj-e2e-01',
  version: 2,
  durationTicks: '72000',
  timeBase: { num: 1, den: 48000 },
  tracks: [{ id: 'track-v1', kind: 'primary_video', label: 'Primary Video', order: 0 }],
  clips: [
    {
      id: 'clip-e2e-01',
      trackId: 'track-v1',
      assetId: 'asset-e2e-01',
      name: 'keynote_take.mp4',
      timelineStartTicks: '0',
      timelineDurationTicks: '72000',
      inTicks: '0',
      outTicks: '72000',
    },
  ],
  updatedAt: '2026-09-09T12:01:00Z',
};

const trimmedComposition: Composition = {
  ...compositionWithClip,
  version: 3,
  durationTicks: '60000',
  clips: [
    {
      ...compositionWithClip.clips[0],
      timelineDurationTicks: '60000',
      inTicks: '12000',
      outTicks: '72000',
    },
  ],
  updatedAt: '2026-09-09T12:02:00Z',
};

const mockRevision: Revision = {
  id: 'rev-e2e-01',
  projectId: 'proj-e2e-01',
  revisionNumber: 1,
  commitNote: 'Initial trimmed cut',
  author: 'Local Editor',
  createdAt: '2026-09-09T12:03:00Z',
  contentHash: 'sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069',
};

const mockJob: Job = {
  id: 'job-e2e-01',
  projectId: 'proj-e2e-01',
  title: 'Export 1080p Master',
  kind: 'render',
  status: 'queued',
  step: 'Initializing FFmpeg pipeline',
  currentStep: 1,
  totalSteps: 4,
  elapsedSeconds: 0,
};

describe('End-to-End Product UI Workflow (Phase C)', () => {
  let capturedCommands: Array<{ command: string; payload?: unknown }> = [];
  let currentComposition = initialComposition;
  let currentAssets: Asset[] = [];
  let currentRevisions: Revision[] = [];
  let currentJobs: Job[] = [];

  beforeEach(() => {
    capturedCommands = [];
    currentComposition = initialComposition;
    currentAssets = [];
    currentRevisions = [];
    currentJobs = [];

    window.__TAURI__ = {
      core: {
        invoke: async <T,>(_cmd: string, args?: Record<string, unknown>): Promise<T> => {
          const req = args?.request as { command: string; payload?: Record<string, unknown> };
          if (req) {
            capturedCommands.push({ command: req.command, payload: req.payload });
          }

          switch (req?.command) {
            case 'health.get':
              return { ok: true, data: { tauriConnected: true, ffmpegAvailable: true, ffmpegVersion: '9.0.1' } } as T;
            case 'project.list':
              return { ok: true, data: [mockProject] } as T;
            case 'project.create':
              return { ok: true, data: mockProject } as T;
            case 'project.open':
              return { ok: true, data: mockProject } as T;
            case 'asset.import':
              currentAssets = [mockAsset];
              return { ok: true, data: mockAsset } as T;
            case 'asset.list':
              return { ok: true, data: currentAssets } as T;
            case 'composition.get':
              return { ok: true, data: currentComposition } as T;
            case 'composition.apply': {
              const action = req.payload?.action;
              if (action === 'add') {
                currentComposition = compositionWithClip;
              } else if (action === 'trim') {
                currentComposition = trimmedComposition;
              }
              return { ok: true, data: currentComposition } as T;
            }
            case 'revision.create':
              currentRevisions = [mockRevision];
              return { ok: true, data: mockRevision } as T;
            case 'revision.list':
              return { ok: true, data: currentRevisions } as T;
            case 'render.enqueue':
              currentJobs = [mockJob];
              return { ok: true, data: mockJob } as T;
            case 'job.list':
              return { ok: true, data: currentJobs } as T;
            default:
              return { ok: true, data: {} } as T;
          }
        },
      },
    };
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI__;
  });

  it('drives the complete project -> import -> timeline -> revision -> render lifecycle from the real UI', async () => {
    render(
      <AppProvider>
        <App />
      </AppProvider>
    );

    // 1. Initial route is Home: click New Project
    expect(await screen.findByText('Workspace Overview')).toBeDefined();
    const createBtn = screen.getByRole('button', { name: /New Project/i });
    fireEvent.click(createBtn);

    // Fill Create Project modal
    const nameInput = screen.getByLabelText(/Project Name/i);
    fireEvent.change(nameInput, { target: { value: 'Showcase Video' } });

    const submitCreateBtn = screen.getByRole('button', { name: /Create Project/i });
    await act(async () => {
      fireEvent.click(submitCreateBtn);
    });

    // 2. UI transitions to Studio with active project
    await waitFor(() => {
      expect(screen.getByText(/Studio: Showcase Video/i)).toBeDefined();
    });
    expect(screen.getByText(/v1 Working Cut/i)).toBeDefined();

    // 3. In Studio, click Import Media in the action bar
    const importMediaBtn = screen.getByRole('button', { name: /Import Media/i });
    await act(async () => {
      fireEvent.click(importMediaBtn);
    });

    // Asset imported and appears in Source Asset selector
    await waitFor(() => {
      expect(screen.getByLabelText(/Source Asset/i)).toBeDefined();
    });
    const assetSelect = screen.getByLabelText(/Source Asset/i) as HTMLSelectElement;
    expect(assetSelect.value).toBe('asset-e2e-01');

    // 4. Click Add Range to place clip on timeline
    const addRangeBtn = screen.getByRole('button', { name: /Add Range/i });
    await act(async () => {
      fireEvent.click(addRangeBtn);
    });

    // Timeline updates to v2 and displays the clip
    await waitFor(() => {
      expect(screen.getByText(/v2 Working Cut/i)).toBeDefined();
    });
    const clipButton = screen.getByRole('button', { name: /keynote_take\.mp4/i });
    expect(clipButton).toBeDefined();

    // 5. Select clip and Save Revision
    const saveRevisionBtn = screen.getByRole('button', { name: /Save Revision/i });
    fireEvent.click(saveRevisionBtn);

    const noteInput = screen.getByLabelText(/Commit Note/i);
    fireEvent.change(noteInput, { target: { value: 'Initial trimmed cut' } });

    const commitBtn = within(screen.getByRole('dialog')).getByRole('button', { name: /Save Revision/i });
    await act(async () => {
      fireEvent.click(commitBtn);
    });

    // 6. Navigate to Deliver Export
    const deliverBtn = screen.getByRole('button', { name: /Deliver Export/i });
    await act(async () => {
      fireEvent.click(deliverBtn);
    });

    // Verify Deliver screen shows project context and allows enqueuing render
    await waitFor(() => {
      expect(screen.getByText(/Implemented local master export and preflight validation checklist/i)).toBeDefined();
    });

    const enqueueBtn = screen.getByRole('button', { name: /Enqueue Render Master/i });
    await act(async () => {
      fireEvent.click(enqueueBtn);
    });

    // Verify render was submitted to native
    const renderCommands = capturedCommands.filter((c) => c.command === 'render.enqueue');
    expect(renderCommands.length).toBe(1);
    expect((renderCommands[0].payload as Record<string, unknown>).preset).toBe('1080p_sdr');

    // 7. Verify atomic Close Project via TopBar
    const closeBtn = screen.getByTitle(/Close active project/i);
    await act(async () => {
      fireEvent.click(closeBtn);
    });

    // Project context cleared: Deliver screen truthfully displays active project required gate
    expect(await screen.findByText('Deliver Requires Active Project')).toBeDefined();

    // Click Return to Home to return to workspace overview
    const returnHomeBtn = screen.getByRole('button', { name: /Return to Home/i });
    await act(async () => {
      fireEvent.click(returnHomeBtn);
    });

    // Back on Home workspace overview with project listed in recent projects
    expect(await screen.findByText('Workspace Overview')).toBeDefined();
    expect(screen.getByText('Recent Projects')).toBeDefined();

    // 8. Reopen project from recent projects list
    const reopenBtn = screen.getByRole('button', { name: /Showcase Video/i });
    await act(async () => {
      fireEvent.click(reopenBtn);
    });

    // Studio rehydrates with project name and persisted timeline state
    await waitFor(() => {
      expect(screen.getByText(/Studio: Showcase Video/i)).toBeDefined();
    });
    expect(screen.getByText(/v2 Working Cut/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /keynote_take\.mp4/i })).toBeDefined();
  });
});
