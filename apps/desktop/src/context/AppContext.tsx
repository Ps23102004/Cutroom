import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { RouteId } from '../routes/manifest';
import { Project, Asset, Composition, Revision, Job, OutputPreset } from '../lib/contracts';
import { isNativeAvailable, dispatchNativeCommand, NATIVE_COMMANDS } from '../lib/native';
import {
  FIXTURE_PROJECT,
  FIXTURE_ASSETS,
  FIXTURE_COMPOSITION,
  FIXTURE_REVISIONS,
  FIXTURE_JOBS,
} from '../lib/fixtures';

export interface AppContextType {
  currentRoute: RouteId;
  navigate: (route: RouteId) => void;
  activeDrawer: 'jobs' | 'help' | null;
  setActiveDrawer: (drawer: 'jobs' | 'help' | null) => void;
  
  // Projects
  projects: Project[];
  activeProject: Project | null;
  setActiveProject: (p: Project | null) => void;
  createProject: (params: {
    name: string;
    path: string;
    aspectRatio: '16:9' | '9:16' | '1:1';
    fpsNumerator: number;
    fpsDenominator: number;
  }) => Promise<Project>;
  openProject: (id: string) => Promise<void>;

  // Media
  assets: Asset[];
  importAsset: (params: {
    name: string;
    path: string;
    importType: 'managed' | 'linked';
    sizeBytes?: number;
  }) => Promise<Asset>;

  // Composition & Timeline
  composition: Composition | null;
  setComposition: React.Dispatch<React.SetStateAction<Composition | null>>;
  splitClip: (clipId: string, splitPointTicks: string) => Promise<void>;
  trimClip: (clipId: string, newInTicks: string, newOutTicks: string) => Promise<void>;
  removeClip: (clipId: string) => Promise<void>;
  reorderClips: (clipId: string, direction: 'left' | 'right') => Promise<void>;

  // Revisions & Versions
  revisions: Revision[];
  createRevision: (commitNote: string) => Promise<Revision>;
  restoreRevision: (revisionId: string) => Promise<Revision>;

  // Render & Jobs
  jobs: Job[];
  enqueueRender: (preset: OutputPreset) => Promise<Job>;
  cancelJob: (jobId: string) => Promise<void>;
  retryJob: (jobId: string) => Promise<void>;

  // Environment & Fixtures
  isNativeConnected: boolean;
  isFixtureMode: boolean;
  enableFixtureMode: () => void;
  resetToEmpty: () => void;
  lastError: string | null;
  clearError: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentRoute, setCurrentRoute] = useState<RouteId>('home');
  const [activeDrawer, setActiveDrawer] = useState<'jobs' | 'help' | null>(null);
  const [isNativeConnected, setIsNativeConnected] = useState<boolean>(false);
  const [isFixtureMode, setIsFixtureMode] = useState<boolean>(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Production data states start strictly EMPTY
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [composition, setComposition] = useState<Composition | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);

  // Check native connection
  useEffect(() => {
    const native = isNativeAvailable();
    setIsNativeConnected(native);
    if (native) {
      // Query native health
      dispatchNativeCommand<{ tauriConnected: boolean }>({ command: NATIVE_COMMANDS.HEALTH_GET, payload: {} })
        .then((res) => {
          if (!res.ok) {
            console.warn('Native health check failed:', res.error);
          }
        });
    }
  }, []);

  const navigate = useCallback((route: RouteId) => {
    setCurrentRoute(route);
  }, []);

  const clearError = useCallback(() => setLastError(null), []);

  const handleMutationError = (error: { code: string; message: string; details?: Record<string, unknown> }): Error => {
    setLastError(error.message);
    const err = new Error(error.message);
    Object.assign(err, { code: error.code, details: error.details });
    return err;
  };

  // Explicit opt-in fixture loader (strictly development-only)
  const enableFixtureMode = useCallback(() => {
    if (!import.meta.env.DEV) {
      console.warn('Fixture mode is restricted to development builds.');
      return;
    }
    setIsFixtureMode(true);
    setProjects([FIXTURE_PROJECT]);
    setActiveProject(FIXTURE_PROJECT);
    setAssets(FIXTURE_ASSETS);
    setComposition(FIXTURE_COMPOSITION);
    setRevisions(FIXTURE_REVISIONS);
    setJobs(FIXTURE_JOBS);
  }, []);

  // Reset to empty production state
  const resetToEmpty = useCallback(() => {
    setIsFixtureMode(false);
    setProjects([]);
    setActiveProject(null);
    setAssets([]);
    setComposition(null);
    setRevisions([]);
    setJobs([]);
  }, []);

  // Create Project: every non-fixture mutation must dispatch native; NO in-memory fallback
  const createProject = useCallback(async (params: {
    name: string;
    path: string;
    aspectRatio: '16:9' | '9:16' | '1:1';
    fpsNumerator: number;
    fpsDenominator: number;
  }): Promise<Project> => {
    const res = await dispatchNativeCommand<Project>({
      command: NATIVE_COMMANDS.PROJECT_CREATE,
      payload: params,
    });
    if (!res.ok) {
      throw handleMutationError(res.error);
    }
    setProjects((prev) => [res.data, ...prev]);
    setActiveProject(res.data);
    return res.data;
  }, []);

  // Open Project: dispatches native; in fixture mode opens loaded fixture project
  const openProject = useCallback(async (id: string): Promise<void> => {
    if (isFixtureMode && import.meta.env.DEV) {
      const found = projects.find((p) => p.id === id);
      if (found) {
        setActiveProject(found);
        return;
      }
    }
    const res = await dispatchNativeCommand<Project>({
      command: NATIVE_COMMANDS.PROJECT_OPEN,
      project_id: id,
      payload: {},
    });
    if (!res.ok) {
      throw handleMutationError(res.error);
    }
    setActiveProject(res.data);
  }, [isFixtureMode, projects]);

  // Import Asset: dispatches native; NO invented metadata or local fallback
  const importAsset = useCallback(async (params: {
    name: string;
    path: string;
    importType: 'managed' | 'linked';
    sizeBytes?: number;
  }): Promise<Asset> => {
    if (!activeProject) {
      const err = new Error('Cannot import media without an active project');
      setLastError(err.message);
      throw err;
    }

    const res = await dispatchNativeCommand<Asset>({
      command: NATIVE_COMMANDS.ASSET_IMPORT,
      project_id: activeProject.id,
      payload: params,
    });
    if (!res.ok) {
      throw handleMutationError(res.error);
    }
    setAssets((prev) => [...prev, res.data]);
    return res.data;
  }, [activeProject]);

  // Split Clip
  const splitClip = useCallback(async (clipId: string, splitPointTicks: string): Promise<void> => {
    if (isFixtureMode && import.meta.env.DEV) {
      setComposition((prev) => {
        if (!prev) return null;
        const target = prev.clips.find((c) => c.id === clipId);
        if (!target) return prev;

        const splitNum = BigInt(splitPointTicks);
        const startNum = BigInt(target.timelineStartTicks);
        const durNum = BigInt(target.timelineDurationTicks);
        const inNum = BigInt(target.inTicks);

        if (splitNum <= startNum || splitNum >= startNum + durNum) return prev;

        const firstDur = splitNum - startNum;
        const secondDur = durNum - firstDur;

        const clipA = {
          ...target,
          id: `${target.id}-a`,
          timelineDurationTicks: firstDur.toString(),
          outTicks: (inNum + firstDur).toString(),
        };

        const clipB = {
          ...target,
          id: `${target.id}-b`,
          timelineStartTicks: splitNum.toString(),
          timelineDurationTicks: secondDur.toString(),
          inTicks: (inNum + firstDur).toString(),
        };

        const nextClips = prev.clips.flatMap((c) => (c.id === clipId ? [clipA, clipB] : [c]));
        return {
          ...prev,
          version: prev.version + 1,
          clips: nextClips,
          updatedAt: new Date().toISOString(),
        };
      });
      return;
    }

    // Production mutation: operation_id + expected_version sent to native backend
    const operation_id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `op-${Date.now()}`;
    const expected_version = composition?.version ?? 0;
    const res = await dispatchNativeCommand<Composition>({
      command: NATIVE_COMMANDS.COMPOSITION_APPLY,
      project_id: activeProject?.id,
      expected_version,
      operation_id,
      payload: {
        operation_id,
        action: 'split',
        clipId,
        splitPointTicks,
      },
    });

    if (!res.ok) {
      throw handleMutationError(res.error);
    }
    setComposition(res.data);
  }, [isFixtureMode, activeProject, composition]);

  // Trim Clip
  const trimClip = useCallback(async (clipId: string, newInTicks: string, newOutTicks: string): Promise<void> => {
    if (isFixtureMode && import.meta.env.DEV) {
      setComposition((prev) => {
        if (!prev) return null;
        const nextClips = prev.clips.map((c) => {
          if (c.id !== clipId) return c;
          const inVal = BigInt(newInTicks);
          const outVal = BigInt(newOutTicks);
          const newDur = outVal > inVal ? outVal - inVal : 0n;
          return {
            ...c,
            inTicks: newInTicks,
            outTicks: newOutTicks,
            timelineDurationTicks: newDur.toString(),
          };
        });
        return {
          ...prev,
          version: prev.version + 1,
          clips: nextClips,
          updatedAt: new Date().toISOString(),
        };
      });
      return;
    }

    const operation_id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `op-${Date.now()}`;
    const expected_version = composition?.version ?? 0;
    const res = await dispatchNativeCommand<Composition>({
      command: NATIVE_COMMANDS.COMPOSITION_APPLY,
      project_id: activeProject?.id,
      expected_version,
      operation_id,
      payload: {
        operation_id,
        action: 'trim',
        clipId,
        newInTicks,
        newOutTicks,
      },
    });

    if (!res.ok) {
      throw handleMutationError(res.error);
    }
    setComposition(res.data);
  }, [isFixtureMode, activeProject, composition]);

  // Remove Clip
  const removeClip = useCallback(async (clipId: string): Promise<void> => {
    if (isFixtureMode && import.meta.env.DEV) {
      setComposition((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          version: prev.version + 1,
          clips: prev.clips.filter((c) => c.id !== clipId),
          updatedAt: new Date().toISOString(),
        };
      });
      return;
    }

    const operation_id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `op-${Date.now()}`;
    const expected_version = composition?.version ?? 0;
    const res = await dispatchNativeCommand<Composition>({
      command: NATIVE_COMMANDS.COMPOSITION_APPLY,
      project_id: activeProject?.id,
      expected_version,
      operation_id,
      payload: {
        operation_id,
        action: 'remove',
        clipId,
      },
    });

    if (!res.ok) {
      throw handleMutationError(res.error);
    }
    setComposition(res.data);
  }, [isFixtureMode, activeProject, composition]);

  // Reorder Clips
  const reorderClips = useCallback(async (clipId: string, direction: 'left' | 'right'): Promise<void> => {
    if (isFixtureMode && import.meta.env.DEV) {
      setComposition((prev) => {
        if (!prev) return null;
        const idx = prev.clips.findIndex((c) => c.id === clipId);
        if (idx === -1) return prev;

        const targetIdx = direction === 'left' ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= prev.clips.length) return prev;

        const updated = [...prev.clips];
        const temp = updated[idx];
        updated[idx] = updated[targetIdx];
        updated[targetIdx] = temp;

        return {
          ...prev,
          version: prev.version + 1,
          clips: updated,
          updatedAt: new Date().toISOString(),
        };
      });
      return;
    }

    const operation_id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `op-${Date.now()}`;
    const expected_version = composition?.version ?? 0;
    const res = await dispatchNativeCommand<Composition>({
      command: NATIVE_COMMANDS.COMPOSITION_APPLY,
      project_id: activeProject?.id,
      expected_version,
      operation_id,
      payload: {
        operation_id,
        action: 'reorder',
        clipId,
        direction,
      },
    });

    if (!res.ok) {
      throw handleMutationError(res.error);
    }
    setComposition(res.data);
  }, [isFixtureMode, activeProject, composition]);

  // Create Revision
  const createRevision = useCallback(async (commitNote: string): Promise<Revision> => {
    if (!activeProject) {
      const err = new Error('No active project');
      setLastError(err.message);
      throw err;
    }

    if (isFixtureMode && import.meta.env.DEV) {
      const nextRevNum = revisions.length + 1;
      const newRev: Revision = {
        id: `rev-fixture-${Date.now()}`,
        projectId: activeProject.id,
        revisionNumber: nextRevNum,
        commitNote,
        author: 'Fixture Editor (Development)',
        createdAt: new Date().toISOString(),
        contentHash: `sha256:${Math.random().toString(16).substring(2, 10)}${Date.now().toString(16)}`,
        parentRevisionId: revisions[0]?.id,
        isFixture: true,
      };
      setRevisions((prev) => [newRev, ...prev]);
      setActiveProject((prev) => prev ? { ...prev, revisionCount: nextRevNum, latestRevisionId: newRev.id } : null);
      return newRev;
    }

    const res = await dispatchNativeCommand<Revision>({
      command: NATIVE_COMMANDS.REVISION_CREATE,
      project_id: activeProject.id,
      payload: { commitNote },
    });
    if (!res.ok) {
      throw handleMutationError(res.error);
    }
    setRevisions((prev) => [res.data, ...prev]);
    return res.data;
  }, [activeProject, isFixtureMode, revisions]);

  // Restore Revision
  const restoreRevision = useCallback(async (revisionId: string): Promise<Revision> => {
    if (!activeProject) {
      const err = new Error('No active project');
      setLastError(err.message);
      throw err;
    }

    if (isFixtureMode && import.meta.env.DEV) {
      const target = revisions.find((r) => r.id === revisionId);
      if (!target) throw new Error('Revision not found');

      const nextRevNum = revisions.length + 1;
      const restored: Revision = {
        id: `rev-fixture-${Date.now()}`,
        projectId: activeProject.id,
        revisionNumber: nextRevNum,
        commitNote: `Restored to Revision ${target.revisionNumber}: "${target.commitNote}"`,
        author: 'Fixture Editor (Development)',
        createdAt: new Date().toISOString(),
        contentHash: target.contentHash,
        parentRevisionId: revisions[0]?.id,
        isFixture: true,
      };
      setRevisions((prev) => [restored, ...prev]);
      setActiveProject((prev) => prev ? { ...prev, revisionCount: nextRevNum, latestRevisionId: restored.id } : null);
      return restored;
    }

    const res = await dispatchNativeCommand<Revision>({
      command: NATIVE_COMMANDS.REVISION_RESTORE,
      project_id: activeProject.id,
      payload: { revisionId },
    });
    if (!res.ok) {
      throw handleMutationError(res.error);
    }
    setRevisions((prev) => [res.data, ...prev]);
    return res.data;
  }, [activeProject, isFixtureMode, revisions]);

  // Enqueue Render
  const enqueueRender = useCallback(async (preset: OutputPreset): Promise<Job> => {
    if (!activeProject) {
      const err = new Error('No active project');
      setLastError(err.message);
      throw err;
    }

    if (isFixtureMode && import.meta.env.DEV) {
      const presetLabels: Record<OutputPreset, string> = {
        '1080p_sdr': '1080p Main SDR Master',
        'vertical_9_16': '9:16 Vertical Cut',
        'review_proxy': 'H.264 Fast Review Proxy',
        'subtitle_package': 'SRT & WebVTT Caption Bundle',
      };
      const newJob: Job = {
        id: `job-fixture-${Date.now()}`,
        projectId: activeProject.id,
        title: `Render ${presetLabels[preset]}`,
        kind: 'render',
        status: 'queued',
        step: 'Enqueued in development pipeline',
        currentStep: 0,
        totalSteps: 4,
        elapsedSeconds: 0,
        isFixture: true,
      };
      setJobs((prev) => [newJob, ...prev]);
      return newJob;
    }

    const res = await dispatchNativeCommand<Job>({
      command: NATIVE_COMMANDS.RENDER_ENQUEUE,
      project_id: activeProject.id,
      payload: { preset },
    });
    if (!res.ok) {
      throw handleMutationError(res.error);
    }
    setJobs((prev) => [res.data, ...prev]);
    return res.data;
  }, [activeProject, isFixtureMode]);

  // Cancel Job
  const cancelJob = useCallback(async (jobId: string): Promise<void> => {
    if (isFixtureMode && import.meta.env.DEV) {
      setJobs((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, status: 'cancelled', step: 'Cancelled by user' } : j))
      );
      return;
    }

    const res = await dispatchNativeCommand<{ jobId: string; status: string }>({
      command: NATIVE_COMMANDS.JOB_CANCEL,
      payload: { jobId },
    });
    if (!res.ok) {
      throw handleMutationError(res.error);
    }
    setJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, status: 'cancelled', step: 'Cancelled by user' } : j))
    );
  }, [isFixtureMode]);

  // Retry Job
  const retryJob = useCallback(async (jobId: string): Promise<void> => {
    if (isFixtureMode && import.meta.env.DEV) {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, status: 'queued', step: 'Retrying task...', currentStep: 0, error: undefined } : j
        )
      );
      return;
    }

    const res = await dispatchNativeCommand<{ jobId: string; status: string }>({
      command: NATIVE_COMMANDS.JOB_RETRY,
      payload: { jobId },
    });
    if (!res.ok) {
      throw handleMutationError(res.error);
    }
    setJobs((prev) =>
      prev.map((j) =>
        j.id === jobId ? { ...j, status: 'queued', step: 'Retrying task...', currentStep: 0, error: undefined } : j
      )
    );
  }, [isFixtureMode]);

  return (
    <AppContext.Provider
      value={{
        currentRoute,
        navigate,
        activeDrawer,
        setActiveDrawer,
        projects,
        activeProject,
        setActiveProject,
        createProject,
        openProject,
        assets,
        importAsset,
        composition,
        setComposition,
        splitClip,
        trimClip,
        removeClip,
        reorderClips,
        revisions,
        createRevision,
        restoreRevision,
        jobs,
        enqueueRender,
        cancelJob,
        retryJob,
        isNativeConnected,
        isFixtureMode,
        enableFixtureMode,
        resetToEmpty,
        lastError,
        clearError,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp(): AppContextType {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return ctx;
}
