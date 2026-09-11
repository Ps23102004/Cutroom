import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { AppProvider, useApp } from '../context/AppContext';
import type { Asset, Composition, Job, Project, Revision } from '../lib/contracts';
import { createOperationId } from '../lib/native';

const project = (id: string): Project => ({
  id,
  name: `Project ${id}`,
  path: `/projects/${id}`,
  fpsNumerator: 24,
  fpsDenominator: 1,
  aspectRatio: '16:9',
  createdAt: '2026-09-08T00:00:00Z',
  updatedAt: '2026-09-08T00:00:00Z',
  revisionCount: 1,
  status: 'draft',
});

const asset: Asset = {
  id: 'asset-1',
  projectId: 'project-a',
  name: 'take.mov',
  path: '/media/take.mov',
  sizeBytes: 10,
  durationTicks: '48000',
  timeBase: { num: 1, den: 48000 },
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

const composition: Composition = {
  id: 'composition-1',
  projectId: 'project-a',
  version: 4,
  durationTicks: '48000',
  timeBase: { num: 1, den: 48000 },
  tracks: [{ id: 'track-primary', kind: 'primary_video', label: 'Primary Video', order: 0 }],
  clips: [],
  updatedAt: '2026-09-08T00:00:00Z',
};

const revision: Revision = {
  id: 'revision-1',
  projectId: 'project-a',
  revisionNumber: 1,
  commitNote: 'Initial cut',
  author: 'Editor',
  createdAt: '2026-09-08T00:00:00Z',
  contentHash: 'sha256:revision',
};

const job: Job = {
  id: 'job-1',
  projectId: 'project-a',
  title: 'Render master',
  kind: 'render',
  status: 'running',
  step: 'Encoding',
  currentStep: 2,
  totalSteps: 4,
  elapsedSeconds: 8,
};

const wrapper = ({ children }: { children: React.ReactNode }) => <AppProvider>{children}</AppProvider>;

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI__;
});

describe('Native vertical-slice frontend bindings', () => {
  it('hydrates all project-scoped state after project.open', async () => {
    const calls: Array<{ command: string; projectId?: string }> = [];
    window.__TAURI__ = {
      core: {
        invoke: async <T,>(_command: string, args?: Record<string, unknown>): Promise<T> => {
          const request = args?.request as { command: string; project_id?: string };
          calls.push({ command: request.command, projectId: request.project_id });
          const responses: Record<string, unknown> = {
            'health.get': { ok: true, data: { tauriConnected: true } },
            'project.list': { ok: true, data: [project('project-a')] },
            'project.open': { ok: true, data: project('project-a') },
            'asset.list': { ok: true, data: [asset] },
            'composition.get': { ok: true, data: composition },
            'revision.list': { ok: true, data: [revision] },
            'job.list': { ok: true, data: [job] },
            'brief.get': { ok: true, data: { goal: 'Test', targetDurationSeconds: 60 } },
          };
          return responses[request.command] as T;
        },
      },
    };

    const { result } = renderHook(() => useApp(), { wrapper });

    await act(async () => {
      await result.current.openProject('project-a');
    });

    expect(result.current.activeProject?.id).toBe('project-a');
    expect(result.current.assets).toEqual([asset]);
    expect(result.current.composition).toEqual(composition);
    expect(result.current.revisions).toEqual([revision]);
    expect(result.current.jobs).toEqual([job]);
    expect(calls.filter((call) => call.projectId === 'project-a').map((call) => call.command)).toContain('project.open');
    expect(calls.filter((call) => call.projectId === 'project-a').map((call) => call.command)).toContain('asset.list');
    expect(calls.filter((call) => call.projectId === 'project-a').map((call) => call.command)).toContain('composition.get');
    expect(calls.filter((call) => call.projectId === 'project-a').map((call) => call.command)).toContain('revision.list');
    expect(calls.filter((call) => call.projectId === 'project-a').map((call) => call.command)).toContain('job.list');
    expect(calls.filter((call) => call.projectId === 'project-a').map((call) => call.command)).toContain('brief.get');
    expect(result.current.brief).toEqual({ goal: 'Test', targetDurationSeconds: 60 });
  });

  it('hydrates the complete authoritative snapshot before committing createProject', async () => {
    const calls: string[] = [];
    window.__TAURI__ = {
      core: {
        invoke: async <T,>(_command: string, args?: Record<string, unknown>): Promise<T> => {
          const request = args?.request as { command: string };
          calls.push(request.command);
          if (request.command === 'project.create' || request.command === 'project.open') {
            return { ok: true, data: project('created-project') } as T;
          }
          if (request.command === 'asset.list') return { ok: true, data: [asset] } as T;
          if (request.command === 'composition.get') return { ok: true, data: composition } as T;
          if (request.command === 'revision.list') return { ok: true, data: [revision] } as T;
          if (request.command === 'job.list') return { ok: true, data: [job] } as T;
          return { ok: true, data: [] } as T;
        },
      },
    };

    const { result } = renderHook(() => useApp(), { wrapper });
    await act(async () => {
      await result.current.createProject({
        name: 'Created Project',
        path: '/projects/created-project',
        aspectRatio: '16:9',
        fpsNumerator: 24,
        fpsDenominator: 1,
      });
    });

    expect(result.current.activeProject?.id).toBe('created-project');
    expect(result.current.assets).toEqual([asset]);
    expect(result.current.composition).toEqual(composition);
    expect(result.current.revisions).toEqual([revision]);
    expect(result.current.jobs).toEqual([job]);
    expect(calls).toContain('project.open');
  });

  it('ignores stale project hydration responses when the user switches projects quickly', async () => {
    let resolveOpenA!: (value: unknown) => void;
    let resolveOpenB!: (value: unknown) => void;
    const openA = new Promise((resolve) => { resolveOpenA = resolve; });
    const openB = new Promise((resolve) => { resolveOpenB = resolve; });

    window.__TAURI__ = {
      core: {
        invoke: async <T,>(_command: string, args?: Record<string, unknown>): Promise<T> => {
          const request = args?.request as { command: string; project_id?: string };
          if (request.command === 'health.get') return { ok: true, data: { tauriConnected: true } } as T;
          if (request.command === 'project.list') return { ok: true, data: [] } as T;
          if (request.command === 'project.open') {
            return (request.project_id === 'project-a' ? openA : openB) as Promise<T>;
          }
          const id = request.project_id;
          if (request.command === 'asset.list') {
            return { ok: true, data: id === 'project-b' ? [asset] : [] } as T;
          }
          if (request.command === 'composition.get') {
            return { ok: true, data: id === 'project-b' ? composition : null } as T;
          }
          if (request.command === 'revision.list') {
            return { ok: true, data: id === 'project-b' ? [revision] : [] } as T;
          }
          return { ok: true, data: id === 'project-b' ? [job] : [] } as T;
        },
      },
    };

    const { result } = renderHook(() => useApp(), { wrapper });
    let firstOpen!: Promise<void>;
    let secondOpen!: Promise<void>;
    await act(async () => {
      firstOpen = result.current.openProject('project-a');
      secondOpen = result.current.openProject('project-b');
      resolveOpenB({ ok: true, data: project('project-b') });
      await secondOpen;
      resolveOpenA({ ok: true, data: project('project-a') });
      await firstOpen;
    });

    expect(result.current.activeProject?.id).toBe('project-b');
    expect(result.current.assets).toEqual([asset]);
  });

  it('refreshes composition and all scoped state after restoring a revision', async () => {
    const requests: string[] = [];
    const restoredRevision = { ...revision, id: 'revision-2', revisionNumber: 2, commitNote: 'Restored head' };
    const restoredComposition = { ...composition, version: 7 };
    window.__TAURI__ = {
      core: {
        invoke: async <T,>(_command: string, args?: Record<string, unknown>): Promise<T> => {
          const request = args?.request as { command: string };
          requests.push(request.command);
          if (request.command === 'revision.restore') return { ok: true, data: restoredRevision } as T;
          if (request.command === 'project.open') return { ok: true, data: project('project-a') } as T;
          if (request.command === 'asset.list') return { ok: true, data: [asset] } as T;
          if (request.command === 'composition.get') return { ok: true, data: restoredComposition } as T;
          if (request.command === 'revision.list') return { ok: true, data: [restoredRevision] } as T;
          if (request.command === 'job.list') return { ok: true, data: [job] } as T;
          return { ok: true, data: [] } as T;
        },
      },
    };

    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => {
      result.current.setActiveProject(project('project-a'));
      result.current.setComposition(composition);
    });

    await act(async () => {
      await result.current.restoreRevision('revision-1');
    });

    expect(result.current.composition).toEqual(restoredComposition);
    expect(result.current.revisions).toEqual([restoredRevision]);
    expect(requests.filter((command) => command === 'composition.get').length).toBe(1);
  });

  it('uses the native picker for imports without inventing path or size metadata', async () => {
    let importRequest: { operation_id?: string; payload: Record<string, unknown> } | undefined;
    window.__TAURI__ = {
      core: {
        invoke: async <T,>(_command: string, args?: Record<string, unknown>): Promise<T> => {
          const request = args?.request as { command: string; operation_id?: string; payload: Record<string, unknown> };
          if (request.command === 'asset.import') importRequest = request;
          if (request.command === 'asset.import') return { ok: true, data: asset } as T;
          return { ok: true, data: [] } as T;
        },
      },
    };

    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => result.current.setActiveProject(project('project-a')));

    await act(async () => {
      await result.current.importAsset({ importType: 'managed' });
    });

    expect(importRequest?.operation_id).toBeTruthy();
    expect(importRequest?.payload.openFileDialog).toBe(true);
    expect(importRequest?.payload.path).toBeUndefined();
    expect(importRequest?.payload.sizeBytes).toBeUndefined();
  });

  it('uses authoritative job snapshots after cancel/retry and serializes job reads', async () => {
    const runningJob = { ...job, status: 'running' as const };
    const failedJob = { ...job, status: 'failed' as const, error: 'Encoder exited with status 1' };
    let jobListCalls = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    window.__TAURI__ = {
      core: {
        invoke: async <T,>(_command: string, args?: Record<string, unknown>): Promise<T> => {
          const request = args?.request as { command: string };
          if (request.command === 'project.open') return { ok: true, data: project('project-a') } as T;
          if (request.command === 'asset.list') return { ok: true, data: [] } as T;
          if (request.command === 'composition.get') return { ok: true, data: composition } as T;
          if (request.command === 'revision.list') return { ok: true, data: [revision] } as T;
          if (request.command === 'job.list') {
            jobListCalls += 1;
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 5));
            inFlight -= 1;
            return { ok: true, data: jobListCalls === 1 ? [runningJob] : [failedJob] } as T;
          }
          if (request.command === 'job.cancel') return { ok: true, data: { jobId: 'job-1', status: 'cancellation_requested' } } as T;
          if (request.command === 'job.retry') return { ok: true, data: { jobId: 'job-1', status: 'retry_requested' } } as T;
          return { ok: true, data: [] } as T;
        },
      },
    };

    const { result } = renderHook(() => useApp(), { wrapper });
    await act(async () => {
      await result.current.openProject('project-a');
    });
    await act(async () => {
      await Promise.all([result.current.cancelJob('job-1'), result.current.retryJob('job-1')]);
    });

    expect(maxInFlight).toBe(1);
    expect(result.current.jobs[0].status).toBe('failed');
    expect(result.current.jobs[0].error).toContain('Encoder exited');
  });

  it('omits trackId for the first source range so native can create a primary track', async () => {
    let addRequest: Record<string, unknown> | undefined;
    const emptyComposition = { ...composition, tracks: [], clips: [], version: 0 };
    window.__TAURI__ = {
      core: {
        invoke: async <T,>(_command: string, args?: Record<string, unknown>): Promise<T> => {
          const request = args?.request as Record<string, unknown>;
          if (request.command === 'composition.apply') {
            addRequest = request;
            return { ok: true, data: emptyComposition } as T;
          }
          return { ok: true, data: [] } as T;
        },
      },
    };

    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => {
      result.current.setActiveProject(project('project-a'));
      result.current.setComposition(emptyComposition);
    });
    await act(async () => {
      await result.current.addClip({
        assetId: 'asset-1',
        sourceInTicks: '0',
        sourceOutTicks: '2400',
      });
    });

    expect(addRequest?.project_id).toBe('project-a');
    expect((addRequest?.payload as Record<string, unknown>).action).toBe('add');
    expect((addRequest?.payload as Record<string, unknown>).trackId).toBeUndefined();
  });

  it('creates UUIDv4 operation IDs and fails explicitly without secure UUID support', () => {
    expect(createOperationId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    vi.stubGlobal('crypto', {});
    expect(() => createOperationId()).toThrow(/Secure operation ID generation is unavailable/);
    vi.unstubAllGlobals();
  });

  it('sends exact source ranges and a required revision to native mutations', async () => {
    const requests: Array<{ command: string; request: Record<string, unknown> }> = [];
    window.__TAURI__ = {
      core: {
        invoke: async <T,>(_command: string, args?: Record<string, unknown>): Promise<T> => {
          const request = args?.request as Record<string, unknown>;
          requests.push({ command: request.command as string, request });
          if (request.command === 'composition.apply') return { ok: true, data: composition } as T;
          if (request.command === 'render.enqueue') return { ok: true, data: job } as T;
          return { ok: true, data: [] } as T;
        },
      },
    };

    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => {
      result.current.setActiveProject(project('project-a'));
      result.current.setComposition(composition);
    });

    await act(async () => {
      await result.current.addClip({
        assetId: 'asset-1',
        sourceInTicks: '1200',
        sourceOutTicks: '3600',
        trackId: 'track-primary',
      });
      await result.current.enqueueRender('1080p_sdr', 'revision-1');
    });

    const add = requests.find((entry) => entry.command === 'composition.apply')?.request;
    const render = requests.find((entry) => entry.command === 'render.enqueue')?.request;
    expect(add?.project_id).toBe('project-a');
    expect(add?.expected_version).toBe(4);
    expect((add?.payload as Record<string, unknown>).sourceInTicks).toBe('1200');
    expect((add?.payload as Record<string, unknown>).sourceOutTicks).toBe('3600');
    expect((add?.payload as Record<string, unknown>).action).toBe('add');
    expect(render?.project_id).toBe('project-a');
    expect(render?.expected_version).toBe(4);
    expect((render?.payload as Record<string, unknown>).revisionId).toBe('revision-1');
    expect((render?.payload as Record<string, unknown>).preset).toBe('1080p_sdr');
    expect((render?.payload as Record<string, unknown>).destinationPath).toBeUndefined();
  });

  it('does not let a late mutation response overwrite a newer active project', async () => {
    let resolveApply!: (value: unknown) => void;
    const delayedApply = new Promise((resolve) => { resolveApply = resolve; });
    const compositionB = { ...composition, id: 'composition-b', projectId: 'project-b', version: 8 };
    window.__TAURI__ = {
      core: {
        invoke: async <T,>(_command: string, args?: Record<string, unknown>): Promise<T> => {
          const request = args?.request as { command: string; project_id?: string };
          if (request.command === 'project.open') return { ok: true, data: project(request.project_id || 'project-a') } as T;
          if (request.command === 'asset.list') return { ok: true, data: [] } as T;
          if (request.command === 'composition.get') return { ok: true, data: request.project_id === 'project-b' ? compositionB : composition } as T;
          if (request.command === 'revision.list') return { ok: true, data: [revision] } as T;
          if (request.command === 'job.list') return { ok: true, data: [] } as T;
          if (request.command === 'composition.apply') return delayedApply as Promise<T>;
          return { ok: true, data: [] } as T;
        },
      },
    };

    const { result } = renderHook(() => useApp(), { wrapper });
    await act(async () => {
      await result.current.openProject('project-a');
    });

    let lateMutation!: Promise<void>;
    await act(async () => {
      lateMutation = result.current.splitClip('clip-1', '1200');
      await result.current.openProject('project-b');
      resolveApply({ ok: true, data: { ...composition, version: 99 } });
      await lateMutation;
    });

    expect(result.current.activeProject?.id).toBe('project-b');
    expect(result.current.composition?.id).toBe('composition-b');
    expect(result.current.composition?.version).toBe(8);
  });

  it('scopes reorder and revision mutations with the current composition version', async () => {
    const requests: Array<{ command: string; request: Record<string, unknown> }> = [];
    window.__TAURI__ = {
      core: {
        invoke: async <T,>(_command: string, args?: Record<string, unknown>): Promise<T> => {
          const request = args?.request as Record<string, unknown>;
          requests.push({ command: request.command as string, request });
          if (request.command === 'composition.apply') return { ok: true, data: composition } as T;
          if (request.command === 'revision.create') return { ok: true, data: revision } as T;
          return { ok: true, data: [] } as T;
        },
      },
    };

    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => {
      result.current.setActiveProject(project('project-a'));
      result.current.setComposition(composition);
    });

    await act(async () => {
      await result.current.reorderClips('clip-1', 'left');
      await result.current.reorderClips('clip-1', 'right');
      await result.current.createRevision('Save after reorder');
    });

    const reorderRequests = requests.filter((entry) => entry.command === 'composition.apply');
    expect(reorderRequests).toHaveLength(2);
    expect(reorderRequests.map((entry) => (entry.request.payload as Record<string, unknown>).direction)).toEqual(['left', 'right']);
    for (const entry of reorderRequests) {
      expect(entry.request.project_id).toBe('project-a');
      expect(entry.request.expected_version).toBe(4);
      expect(entry.request.operation_id).toBeTruthy();
    }

    const revisionRequest = requests.find((entry) => entry.command === 'revision.create')?.request;
    expect(revisionRequest?.project_id).toBe('project-a');
    expect(revisionRequest?.expected_version).toBe(4);
    expect(revisionRequest?.operation_id).toBeTruthy();
    expect((revisionRequest?.payload as Record<string, unknown>).commitNote).toBe('Save after reorder');
  });
  it('persists an edited brief and restores it after close/reopen from native', async () => {
    const saved: Record<string, unknown> = {
      goal: 'Default goal',
      audience: 'General',
      targetDurationSeconds: 60,
      aspectRatio: '16:9',
      requiredSegments: '',
      excludedSegments: '',
      tone: 'Direct, informative',
      style: 'Fast-paced, modern',
      cta: '',
      updatedAt: '2026-09-08T00:00:00Z',
     };
    window.__TAURI__ = {
      core: {
        invoke: async <T,>(_command: string, args?: Record<string, unknown>): Promise<T> => {
          const request = args?.request as {
            command: string;
            project_id?: string;
            payload?: Record<string, unknown>;
           };
          switch (request.command) {
            case 'health.get':
              return { ok: true, data: { tauriConnected: true } } as T;
            case 'project.list':
              return { ok: true, data: [project('project-a')] } as T;
            case 'project.open':
              return { ok: true, data: project('project-a') } as T;
            case 'asset.list':
              return { ok: true, data: [] } as T;
            case 'composition.get':
              return { ok: true, data: null } as T;
            case 'revision.list':
              return { ok: true, data: [] } as T;
            case 'job.list':
              return { ok: true, data: [] } as T;
            case 'brief.get':
              return { ok: true, data: { ...saved } } as T;
            case 'brief.set': {
              const brief = request.payload?.brief as Record<string, unknown>;
              saved.goal = String(brief.goal);
              saved.targetDurationSeconds = Number(brief.targetDurationSeconds);
              saved.updatedAt = new Date().toISOString();
              return { ok: true, data: { ...saved } } as T;
             }
            default:
              return { ok: true, data: [] } as T;
           }
         },
       },
     };

    const { result } = renderHook(() => useApp(), { wrapper });

    await act(async () => {
      await result.current.openProject('project-a');
      });
    expect(result.current.brief?.goal).toBe('Default goal');

    await act(async () => {
      await result.current.saveBrief({ goal: 'Launch announcement', targetDurationSeconds: 45 });
      });
    expect(result.current.brief?.goal).toBe('Launch announcement');
    expect(result.current.brief?.targetDurationSeconds).toBe(45);

    act(() => {
      result.current.closeProject();
      });
    expect(result.current.brief).toBeNull();

    await act(async () => {
      await result.current.openProject('project-a');
      });
    expect(result.current.brief?.goal).toBe('Launch announcement');
    expect(result.current.brief?.targetDurationSeconds).toBe(45);
    });

  it('does not leak a previous project brief when switching projects quickly', async () => {
    let resolveOpenA!: (value: unknown) => void;
    let resolveOpenB!: (value: unknown) => void;
    const openA = new Promise((resolve) => { resolveOpenA = resolve; });
    const openB = new Promise((resolve) => { resolveOpenB = resolve; });
    const briefs: Record<string, unknown> = {
       'project-a': { goal: 'Brief A', targetDurationSeconds: 60, updatedAt: '2026-09-08T00:00:00Z' },
       'project-b': { goal: 'Brief B', targetDurationSeconds: 30, updatedAt: '2026-09-08T00:00:00Z' },
     };
    window.__TAURI__ = {
      core: {
        invoke: async <T,>(_command: string, args?: Record<string, unknown>): Promise<T> => {
          const request = args?.request as { command: string; project_id?: string };
          if (request.command === 'health.get') return { ok: true, data: { tauriConnected: true } } as T;
          if (request.command === 'project.list') return { ok: true, data: [] } as T;
          if (request.command === 'project.open') {
            return (request.project_id === 'project-a' ? openA : openB) as unknown as Promise<T>;
           }
          if (request.command === 'asset.list') return { ok: true, data: [] } as T;
          if (request.command === 'composition.get') return { ok: true, data: null } as T;
          if (request.command === 'revision.list') return { ok: true, data: [] } as T;
          if (request.command === 'job.list') return { ok: true, data: [] } as T;
          if (request.command === 'brief.get') {
            return { ok: true, data: briefs[request.project_id ?? ''] } as T;
           }
          return { ok: true, data: [] } as T;
         },
       },
     };

    const { result } = renderHook(() => useApp(), { wrapper });
    let firstOpen!: Promise<void>;
    let secondOpen!: Promise<void>;
    await act(async () => {
      firstOpen = result.current.openProject('project-a');
      secondOpen = result.current.openProject('project-b');
      resolveOpenB({ ok: true, data: project('project-b') });
      await secondOpen;
      resolveOpenA({ ok: true, data: project('project-a') });
      await firstOpen;
      });

    expect(result.current.activeProject?.id).toBe('project-b');
    expect(result.current.brief?.goal).toBe('Brief B');
    expect(result.current.brief?.targetDurationSeconds).toBe(30);
    });

  it('surfaces a brief save failure without mutating local state', async () => {
    const knownBrief: Record<string, unknown> = {
      goal: 'Existing',
      audience: 'General',
      targetDurationSeconds: 60,
      aspectRatio: '16:9',
      requiredSegments: '',
      excludedSegments: '',
      tone: 'Direct, informative',
      style: 'Fast-paced, modern',
      cta: '',
      updatedAt: '2026-09-08T00:00:00Z',
     };
    window.__TAURI__ = {
      core: {
        invoke: async <T,>(_command: string, args?: Record<string, unknown>): Promise<T> => {
          const request = args?.request as { command: string; payload?: Record<string, unknown> };
          if (request.command === 'health.get') return { ok: true, data: { tauriConnected: true } } as T;
          if (request.command === 'project.open') return { ok: true, data: project('project-a') } as T;
          if (request.command === 'asset.list') return { ok: true, data: [] } as T;
          if (request.command === 'composition.get') return { ok: true, data: null } as T;
          if (request.command === 'revision.list') return { ok: true, data: [] } as T;
          if (request.command === 'job.list') return { ok: true, data: [] } as T;
          if (request.command === 'brief.get') return { ok: true, data: { ...knownBrief } } as T;
          if (request.command === 'brief.set') {
            return {
              ok: false,
              error: {
                code: 'IO_ERROR',
                message: 'Failed to write brief: disk full',
                details: { command: 'brief.set' },
               },
            } as T;
           }
          return { ok: true, data: [] } as T;
         },
       },
     };

    const { result } = renderHook(() => useApp(), { wrapper });
    await act(async () => {
      await result.current.openProject('project-a');
      });
    expect(result.current.brief?.goal).toBe('Existing');

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.saveBrief({ goal: 'Should not persist' });
       } catch (err) {
        caught = err;
       }
     });
    expect(caught).toBeInstanceOf(Error);
    expect(result.current.brief?.goal).toBe('Existing');
    expect(result.current.lastError ?? '').toContain('disk full');
    });
});
