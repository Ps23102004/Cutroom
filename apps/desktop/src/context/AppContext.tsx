import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { RouteId } from '../routes/manifest';
import { Project, Asset, Composition, Revision, Job, OutputPreset, ProjectBrief } from '../lib/contracts';
import { isNativeAvailable, dispatchNativeCommand, NATIVE_COMMANDS, createOperationId, NativeResponse } from '../lib/native';
import {
  FIXTURE_PROJECT,
  FIXTURE_ASSETS,
  FIXTURE_COMPOSITION,
  FIXTURE_REVISIONS,
  FIXTURE_JOBS,
} from '../lib/fixtures';

export const FIXTURE_BRIEF: ProjectBrief = {
  goal: 'Create an engaging 60-second summary from the keynote interview',
  audience: 'Product engineering leaders and developers',
  targetDurationSeconds: 60,
  aspectRatio: '16:9',
  requiredSegments: 'Key announcement at 00:02:14; closing question at 00:04:30',
  excludedSegments: 'Confidential roadmap slides between 00:01:10 and 00:01:45',
  tone: 'Direct, informative',
  style: 'Fast-paced, tech-focused',
  cta: 'Visit cutroom.studio to get started',
  updatedAt: '2026-09-09T12:00:00Z',
};

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
    path?: string;
    aspectRatio: '16:9' | '9:16' | '1:1';
    fpsNumerator: number;
    fpsDenominator: number;
  }) => Promise<Project>;
  openProject: (id: string) => Promise<void>;
  closeProject: () => void;

  // Media
  assets: Asset[];
  importAsset: (params: {
    name?: string;
    path?: string;
    importType: 'managed' | 'linked';
  }) => Promise<Asset>;

  // Composition & Timeline
  composition: Composition | null;
  setComposition: React.Dispatch<React.SetStateAction<Composition | null>>;
  addClip: (params: {
    assetId: string;
    sourceInTicks: string;
    sourceOutTicks: string;
    trackId?: string;
    timelineStartTicks?: string;
  }) => Promise<void>;
  splitClip: (clipId: string, splitPointTicks: string) => Promise<void>;
  trimClip: (clipId: string, newInTicks: string, newOutTicks: string) => Promise<void>;
  replaceClip: (clipId: string, assetId: string, sourceInTicks: string, sourceOutTicks: string) => Promise<void>;
  removeClip: (clipId: string) => Promise<void>;
  reorderClips: (clipId: string, direction: 'left' | 'right') => Promise<void>;

  // Revisions & Versions
  revisions: Revision[];
  createRevision: (commitNote: string) => Promise<Revision>;
  restoreRevision: (revisionId: string) => Promise<Revision>;

  // Project Brief & Constraints
  brief: ProjectBrief | null;
  saveBrief: (brief: Partial<ProjectBrief>) => Promise<ProjectBrief>;

  // Render & Jobs
  jobs: Job[];
  enqueueRender: (preset: OutputPreset, revisionId?: string) => Promise<Job>;
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
  const [brief, setBrief] = useState<ProjectBrief | null>(null);
  const openSequenceRef = useRef(0);
  const activeProjectIdRef = useRef<string | null>(null);
  const projectGenerationRef = useRef(0);
  const jobRequestQueueRef = useRef<Promise<void>>(Promise.resolve());

  type ProjectSnapshot = {
    project: Project;
    assets: Asset[];
    composition: Composition | null;
    revisions: Revision[];
    jobs: Job[];
    brief: ProjectBrief | null;
  };

  useEffect(() => {
    activeProjectIdRef.current = activeProject?.id ?? null;
  }, [activeProject?.id]);

  // Check native connection and load the workspace directory.
  useEffect(() => {
    const native = isNativeAvailable();
    setIsNativeConnected(native);
    if (native) {
      dispatchNativeCommand<{ tauriConnected: boolean }>({ command: NATIVE_COMMANDS.HEALTH_GET, payload: {} })
        .then((res) => {
          if (!res.ok) {
            console.warn('Native health check failed:', res.error);
          }
        });
      dispatchNativeCommand<Project[] | { projects: Project[] }>({
        command: NATIVE_COMMANDS.PROJECT_LIST,
        payload: {},
      }).then((res) => {
        if (!res.ok) {
          console.warn('Native project list failed:', res.error);
          return;
        }
        const listed = Array.isArray(res.data) ? res.data : res.data.projects;
        setProjects(listed);
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

  const getOperationId = (): string => {
    try {
      return createOperationId();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setLastError(message);
      throw error;
    }
  };

  const requestJobList = (projectId: string): Promise<NativeResponse<Job[]>> => {
    const request = jobRequestQueueRef.current.then(() =>
      dispatchNativeCommand<Job[]>({
        command: NATIVE_COMMANDS.JOB_LIST,
        project_id: projectId,
        payload: {},
      })
    );
    jobRequestQueueRef.current = request.then(() => undefined, () => undefined);
    return request;
  };

  const isCurrentProjectGeneration = (projectId: string, generation: number): boolean =>
    projectGenerationRef.current === generation && activeProjectIdRef.current === projectId;

  // Explicit opt-in fixture loader (strictly development-only)
  const enableFixtureMode = useCallback(() => {
    if (!import.meta.env.DEV) {
      console.warn('Fixture mode is restricted to development builds.');
      return;
    }
    projectGenerationRef.current += 1;
    setIsFixtureMode(true);
    setProjects([FIXTURE_PROJECT]);
    setActiveProject(FIXTURE_PROJECT);
    setAssets(FIXTURE_ASSETS);
    setComposition(FIXTURE_COMPOSITION);
    setRevisions(FIXTURE_REVISIONS);
    setJobs(FIXTURE_JOBS);
    setBrief(FIXTURE_BRIEF);
  }, []);

  // Reset to empty production state
  const resetToEmpty = useCallback(() => {
    projectGenerationRef.current += 1;
    setIsFixtureMode(false);
    setProjects([]);
    setActiveProject(null);
    setAssets([]);
    setComposition(null);
    setRevisions([]);
    setJobs([]);
  }, []);

  const readProjectSnapshot = async (id: string, generation: number): Promise<ProjectSnapshot | null> => {
    const opened = await dispatchNativeCommand<Project>({
      command: NATIVE_COMMANDS.PROJECT_OPEN,
      project_id: id,
      payload: {},
    });
    if (!opened.ok) {
      if (generation === projectGenerationRef.current) {
        throw handleMutationError(opened.error);
      }
      return null;
    }

    const [assetRes, compositionRes, revisionRes, jobRes, briefRes] = await Promise.all([
      dispatchNativeCommand<Asset[]>({ command: NATIVE_COMMANDS.ASSET_LIST, project_id: id, payload: {} }),
      dispatchNativeCommand<Composition | null>({ command: NATIVE_COMMANDS.COMPOSITION_GET, project_id: id, payload: {} }),
      dispatchNativeCommand<Revision[]>({ command: NATIVE_COMMANDS.REVISION_LIST, project_id: id, payload: {} }),
      requestJobList(id),
      dispatchNativeCommand<ProjectBrief>({ command: NATIVE_COMMANDS.BRIEF_GET, project_id: id, payload: {} }),
    ]);

    if (generation !== projectGenerationRef.current) return null;
    if (!assetRes.ok) throw handleMutationError(assetRes.error);
    if (!compositionRes.ok) throw handleMutationError(compositionRes.error);
    if (!revisionRes.ok) throw handleMutationError(revisionRes.error);
    if (!jobRes.ok) throw handleMutationError(jobRes.error);

    return {
      project: opened.data,
      assets: assetRes.data,
      composition: compositionRes.data,
      revisions: revisionRes.data,
      jobs: jobRes.data,
      brief: briefRes?.ok ? briefRes.data : null,
    };
  };

  const commitProjectSnapshot = (snapshot: ProjectSnapshot, generation: number): boolean => {
    if (generation !== projectGenerationRef.current) return false;
    setProjects((previous) => {
      const exists = previous.some((project) => project.id === snapshot.project.id);
      return exists
        ? previous.map((project) => (project.id === snapshot.project.id ? snapshot.project : project))
        : [snapshot.project, ...previous];
    });
    setActiveProject(snapshot.project);
    setAssets(snapshot.assets);
    setComposition(snapshot.composition);
    setRevisions(snapshot.revisions);
    setJobs(snapshot.jobs);
    setBrief(snapshot.brief);
    return true;
  };

  // Create Project: hydrate the native-created project before exposing it as active.
  const createProject = useCallback(async (params: {
    name: string;
    path?: string;
    aspectRatio: '16:9' | '9:16' | '1:1';
    fpsNumerator: number;
    fpsDenominator: number;
  }): Promise<Project> => {
    const generation = ++projectGenerationRef.current;
    const operation_id = getOperationId();
    const hasTauri = isNativeAvailable();
    const res = await dispatchNativeCommand<Project>({
      command: NATIVE_COMMANDS.PROJECT_CREATE,
      operation_id,
      payload: hasTauri
        ? {
            name: params.name,
            aspectRatio: params.aspectRatio,
            fpsNumerator: params.fpsNumerator,
            fpsDenominator: params.fpsDenominator,
            selectDirectory: true,
            operation_id,
          }
        : {
            ...params,
            path: params.path || `/tmp/cutroom-projects/${params.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
            operation_id,
          },
    });
    if (!res.ok) {
      if (generation === projectGenerationRef.current) throw handleMutationError(res.error);
      throw new Error('Project creation was superseded by a newer project operation.');
    }

    const snapshot = await readProjectSnapshot(res.data.id, generation);
    if (!snapshot) return res.data;
    commitProjectSnapshot(snapshot, generation);
    return snapshot.project;
  }, [isFixtureMode]);

  // Open Project: acquire and commit one coherent native snapshot.
  const openProject = useCallback(async (id: string): Promise<void> => {
    const generation = ++projectGenerationRef.current;
    openSequenceRef.current = generation;

    if (isFixtureMode && import.meta.env.DEV) {
      const found = projects.find((p) => p.id === id);
      if (found) setActiveProject(found);
      return;
    }

    const snapshot = await readProjectSnapshot(id, generation);
    if (snapshot) commitProjectSnapshot(snapshot, generation);
  }, [isFixtureMode, projects]);

  // Close active project atomically clearing all project-scoped state
  const closeProject = useCallback(() => {
    projectGenerationRef.current += 1;
    setActiveProject(null);
    setAssets([]);
    setComposition(null);
    setRevisions([]);
    setJobs([]);
    setBrief(null);
    setLastError(null);
  }, []);

  // Import Asset: native owns selection and probing; browser mode never invents metadata.
  const importAsset = useCallback(async (params: {
    name?: string;
    path?: string;
    importType: 'managed' | 'linked';
  }): Promise<Asset> => {
    if (!activeProject) {
      const err = new Error('Cannot import media without an active project');
      setLastError(err.message);
      throw err;
    }

    if (isFixtureMode && import.meta.env.DEV) {
      const err = new Error('Exit fixture mode before importing media with the native file picker.');
      setLastError(err.message);
      throw err;
    }

    const projectId = activeProject.id;
    const generation = projectGenerationRef.current;
    const operation_id = getOperationId();
    const res = await dispatchNativeCommand<Asset>({
      command: NATIVE_COMMANDS.ASSET_IMPORT,
      project_id: projectId,
      operation_id,
      payload: {
        name: params.name,
        importType: params.importType,
        operation_id,
        openFileDialog: true,
      },
    });
    if (!res.ok) {
      if (isCurrentProjectGeneration(projectId, generation)) throw handleMutationError(res.error);
      throw new Error('Media import was superseded by a newer project operation.');
    }
    if (!isCurrentProjectGeneration(projectId, generation)) return res.data;
    setAssets((prev) => [...prev, res.data]);
    return res.data;
  }, [activeProject, isFixtureMode]);

  // Add an explicit source interval to the composition.
  const addClip = useCallback(async (params: {
    assetId: string;
    sourceInTicks: string;
    sourceOutTicks: string;
    trackId?: string;
    timelineStartTicks?: string;
  }): Promise<void> => {
    if (!activeProject) {
      const err = new Error('Cannot add a clip without an active project');
      setLastError(err.message);
      throw err;
    }

    const sourceIn = BigInt(params.sourceInTicks);
    const sourceOut = BigInt(params.sourceOutTicks);
    if (sourceOut <= sourceIn) {
      const err = new Error('Source out-point must be greater than the in-point');
      setLastError(err.message);
      throw err;
    }
    const hasPrimaryTrack = composition?.tracks.some((track) => track.kind === 'primary_video') ?? false;
    if (hasPrimaryTrack && !params.trackId) {
      const err = new Error('Choose a destination video track before adding a source range');
      setLastError(err.message);
      throw err;
    }

    if (isFixtureMode && import.meta.env.DEV) {
      setComposition((prev) => {
        if (!prev) return null;
        const targetTrackId = params.trackId ?? prev.tracks.find((track) => track.kind === 'primary_video')?.id;
        if (!targetTrackId) return prev;
        const duration = sourceOut - sourceIn;
        const start = BigInt(params.timelineStartTicks ?? prev.durationTicks);
        const nextClip = {
          id: `fixture-clip-${Date.now()}`,
          trackId: targetTrackId,
          assetId: params.assetId,
          name: 'Selected source range',
          inTicks: params.sourceInTicks,
          outTicks: params.sourceOutTicks,
          timelineStartTicks: start.toString(),
          timelineDurationTicks: duration.toString(),
          color: 'var(--accent-violet, #C4B5FD)',
          isFixture: true,
        };
        const nextDuration = start + duration > BigInt(prev.durationTicks) ? start + duration : BigInt(prev.durationTicks);
        return {
          ...prev,
          version: prev.version + 1,
          durationTicks: nextDuration.toString(),
          clips: [...prev.clips, nextClip],
          updatedAt: new Date().toISOString(),
        };
      });
      return;
    }

    const projectId = activeProject.id;
    const generation = projectGenerationRef.current;
    const operation_id = getOperationId();
    const expected_version = composition?.version ?? 0;
    const res = await dispatchNativeCommand<Composition>({
      command: NATIVE_COMMANDS.COMPOSITION_APPLY,
      project_id: projectId,
      expected_version,
      operation_id,
      payload: {
        operation_id,
        action: 'add',
        assetId: params.assetId,
        sourceInTicks: params.sourceInTicks,
        sourceOutTicks: params.sourceOutTicks,
        ...(params.trackId ? { trackId: params.trackId } : {}),
        timelineStartTicks: params.timelineStartTicks,
      },
    });
    if (!res.ok) {
      if (isCurrentProjectGeneration(projectId, generation)) throw handleMutationError(res.error);
      throw new Error('Clip insertion was superseded by a newer project operation.');
    }
    if (isCurrentProjectGeneration(projectId, generation)) setComposition(res.data);
  }, [activeProject, composition, isFixtureMode]);

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
    const projectId = activeProject?.id;
    const generation = projectGenerationRef.current;
    const operation_id = getOperationId();
    const expected_version = composition?.version ?? 0;
    const res = await dispatchNativeCommand<Composition>({
      command: NATIVE_COMMANDS.COMPOSITION_APPLY,
      project_id: projectId,
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
      if (projectId && isCurrentProjectGeneration(projectId, generation)) throw handleMutationError(res.error);
      throw new Error('Clip split was superseded by a newer project operation.');
    }
    if (projectId && isCurrentProjectGeneration(projectId, generation)) setComposition(res.data);
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

    const projectId = activeProject?.id;
    const generation = projectGenerationRef.current;
    const operation_id = getOperationId();
    const expected_version = composition?.version ?? 0;
    const res = await dispatchNativeCommand<Composition>({
      command: NATIVE_COMMANDS.COMPOSITION_APPLY,
      project_id: projectId,
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
      if (projectId && isCurrentProjectGeneration(projectId, generation)) throw handleMutationError(res.error);
      throw new Error('Clip trim was superseded by a newer project operation.');
    }
    if (projectId && isCurrentProjectGeneration(projectId, generation)) setComposition(res.data);
  }, [isFixtureMode, activeProject, composition]);

  // Replace Clip — swap a timeline clip's source asset/range in place.
  const replaceClip = useCallback(async (
    clipId: string,
    assetId: string,
    sourceInTicks: string,
    sourceOutTicks: string,
  ): Promise<void> => {
    if (isFixtureMode && import.meta.env.DEV) {
      setComposition((prev) => {
        if (!prev) return null;
        const nextClips = prev.clips.map((c) => {
          if (c.id !== clipId) return c;
          const inVal = BigInt(sourceInTicks);
          const outVal = BigInt(sourceOutTicks);
          const newDur = outVal > inVal ? outVal - inVal : 0n;
          return {
            ...c,
            assetId,
            inTicks: sourceInTicks,
            outTicks: sourceOutTicks,
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

    const projectId = activeProject?.id;
    const generation = projectGenerationRef.current;
    const operation_id = getOperationId();
    const expected_version = composition?.version ?? 0;
    const res = await dispatchNativeCommand<Composition>({
      command: NATIVE_COMMANDS.COMPOSITION_APPLY,
      project_id: projectId,
      expected_version,
      operation_id,
      payload: {
        operation_id,
        action: 'replace',
        clipId,
        assetId,
        sourceInTicks,
        sourceOutTicks,
      },
    });

    if (!res.ok) {
      if (projectId && isCurrentProjectGeneration(projectId, generation)) throw handleMutationError(res.error);
      throw new Error('Clip replacement was superseded by a newer project operation.');
    }
    if (projectId && isCurrentProjectGeneration(projectId, generation)) setComposition(res.data);
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

    const projectId = activeProject?.id;
    const generation = projectGenerationRef.current;
    const operation_id = getOperationId();
    const expected_version = composition?.version ?? 0;
    const res = await dispatchNativeCommand<Composition>({
      command: NATIVE_COMMANDS.COMPOSITION_APPLY,
      project_id: projectId,
      expected_version,
      operation_id,
      payload: {
        operation_id,
        action: 'remove',
        clipId,
      },
    });

    if (!res.ok) {
      if (projectId && isCurrentProjectGeneration(projectId, generation)) throw handleMutationError(res.error);
      throw new Error('Clip removal was superseded by a newer project operation.');
    }
    if (projectId && isCurrentProjectGeneration(projectId, generation)) setComposition(res.data);
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

    const projectId = activeProject?.id;
    const generation = projectGenerationRef.current;
    const operation_id = getOperationId();
    const expected_version = composition?.version ?? 0;
    const res = await dispatchNativeCommand<Composition>({
      command: NATIVE_COMMANDS.COMPOSITION_APPLY,
      project_id: projectId,
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
      if (projectId && isCurrentProjectGeneration(projectId, generation)) throw handleMutationError(res.error);
      throw new Error('Clip reorder was superseded by a newer project operation.');
    }
    if (projectId && isCurrentProjectGeneration(projectId, generation)) setComposition(res.data);
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

    const projectId = activeProject.id;
    const generation = projectGenerationRef.current;
    const operation_id = getOperationId();
    const expected_version = composition?.version ?? 0;
    const res = await dispatchNativeCommand<Revision>({
      command: NATIVE_COMMANDS.REVISION_CREATE,
      project_id: projectId,
      expected_version,
      operation_id,
      payload: { commitNote, operation_id },
    });
    if (!res.ok) {
      if (isCurrentProjectGeneration(projectId, generation)) throw handleMutationError(res.error);
      throw new Error('Revision creation was superseded by a newer project operation.');
    }
    if (!isCurrentProjectGeneration(projectId, generation)) return res.data;
    setRevisions((prev) => [res.data, ...prev]);
    setActiveProject((prev) => prev ? { ...prev, revisionCount: Math.max(prev.revisionCount, res.data.revisionNumber), latestRevisionId: res.data.id } : prev);
    return res.data;
  }, [activeProject, composition, isFixtureMode, revisions]);

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

    const projectId = activeProject.id;
    const generation = projectGenerationRef.current;
    const operation_id = getOperationId();
    const expected_version = composition?.version ?? 0;
    const res = await dispatchNativeCommand<Revision>({
      command: NATIVE_COMMANDS.REVISION_RESTORE,
      project_id: projectId,
      operation_id,
      expected_version,
      payload: { revisionId, operation_id },
    });
    if (!res.ok) {
      if (isCurrentProjectGeneration(projectId, generation)) throw handleMutationError(res.error);
      throw new Error('Revision restore was superseded by a newer project operation.');
    }
    if (!isCurrentProjectGeneration(projectId, generation)) return res.data;

    // Restore changes the authoritative composition as well as revision history.
    const snapshot = await readProjectSnapshot(projectId, generation);
    if (snapshot) commitProjectSnapshot(snapshot, generation);
    return res.data;
  }, [activeProject, composition, isFixtureMode, revisions]);

  // Project Brief: persistent structured constraints
  const saveBrief = useCallback(async (updates: Partial<ProjectBrief>): Promise<ProjectBrief> => {
    if (!activeProject) {
      const err = new Error('Cannot save brief without an active project');
      setLastError(err.message);
      throw err;
    }

    if (isFixtureMode && import.meta.env.DEV) {
      const nextBrief: ProjectBrief = {
        goal: updates.goal ?? brief?.goal ?? '',
        audience: updates.audience ?? brief?.audience ?? '',
        targetDurationSeconds: updates.targetDurationSeconds ?? brief?.targetDurationSeconds ?? 60,
        aspectRatio: updates.aspectRatio ?? brief?.aspectRatio ?? activeProject.aspectRatio,
        requiredSegments: updates.requiredSegments ?? brief?.requiredSegments ?? '',
        excludedSegments: updates.excludedSegments ?? brief?.excludedSegments ?? '',
        tone: updates.tone ?? brief?.tone ?? 'Direct, informative',
        style: updates.style ?? brief?.style ?? 'Fast-paced, modern',
        cta: updates.cta ?? brief?.cta ?? '',
        updatedAt: new Date().toISOString(),
      };
      setBrief(nextBrief);
      return nextBrief;
    }

    const projectId = activeProject.id;
    const generation = projectGenerationRef.current;
    const operation_id = getOperationId();
    const res = await dispatchNativeCommand<ProjectBrief>({
      command: NATIVE_COMMANDS.BRIEF_SET,
      project_id: projectId,
      operation_id,
      payload: {
        operation_id,
        brief: {
          ...brief,
          ...updates,
        },
      },
    });

    if (!res.ok) {
      if (isCurrentProjectGeneration(projectId, generation)) throw handleMutationError(res.error);
      throw new Error('Brief save was superseded by a newer project operation.');
    }

    if (isCurrentProjectGeneration(projectId, generation)) {
      setBrief(res.data);
    }
    return res.data;
  }, [activeProject, brief, isFixtureMode]);

  // Enqueue Render: a render must name an immutable saved revision.
  const enqueueRender = useCallback(async (preset: OutputPreset, revisionId?: string): Promise<Job> => {
    if (!activeProject) {
      const err = new Error('No active project');
      setLastError(err.message);
      throw err;
    }
    if (!revisionId) {
      const err = new Error('Save a revision before starting a render');
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

    const projectId = activeProject.id;
    const generation = projectGenerationRef.current;
    const operation_id = getOperationId();
    const expected_version = composition?.version ?? 0;
    const res = await dispatchNativeCommand<Job>({
      command: NATIVE_COMMANDS.RENDER_ENQUEUE,
      project_id: projectId,
      operation_id,
      expected_version,
      payload: { preset, revisionId, operation_id },
    });
    if (!res.ok) {
      if (isCurrentProjectGeneration(projectId, generation)) throw handleMutationError(res.error);
      throw new Error('Render enqueue was superseded by a newer project operation.');
    }
    if (isCurrentProjectGeneration(projectId, generation)) setJobs((prev) => [res.data, ...prev]);
    return res.data;
  }, [activeProject, composition, isFixtureMode]);

  // Cancel Job
  const cancelJob = useCallback(async (jobId: string): Promise<void> => {
    if (isFixtureMode && import.meta.env.DEV) {
      setJobs((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, status: 'cancelled', step: 'Cancelled by user' } : j))
      );
      return;
    }

    const projectId = activeProject?.id;
    const generation = projectGenerationRef.current;
    const operation_id = getOperationId();
    const res = await dispatchNativeCommand<{ jobId: string; status: string }>({
      command: NATIVE_COMMANDS.JOB_CANCEL,
      project_id: projectId,
      operation_id,
      payload: { jobId, operation_id },
    });
    if (!res.ok) {
      if (projectId && isCurrentProjectGeneration(projectId, generation)) throw handleMutationError(res.error);
      throw new Error('Job cancellation was superseded by a newer project operation.');
    }
    if (!projectId || !isCurrentProjectGeneration(projectId, generation)) return;
    const jobsRes = await requestJobList(projectId);
    if (!jobsRes.ok) throw handleMutationError(jobsRes.error);
    if (isCurrentProjectGeneration(projectId, generation)) setJobs(jobsRes.data);
  }, [activeProject?.id, isFixtureMode]);

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

    const projectId = activeProject?.id;
    const generation = projectGenerationRef.current;
    const operation_id = getOperationId();
    const res = await dispatchNativeCommand<{ jobId: string; status: string }>({
      command: NATIVE_COMMANDS.JOB_RETRY,
      project_id: projectId,
      operation_id,
      payload: { jobId, operation_id },
    });
    if (!res.ok) {
      if (projectId && isCurrentProjectGeneration(projectId, generation)) throw handleMutationError(res.error);
      throw new Error('Job retry was superseded by a newer project operation.');
    }
    if (!projectId || !isCurrentProjectGeneration(projectId, generation)) return;
    const jobsRes = await requestJobList(projectId);
    if (!jobsRes.ok) throw handleMutationError(jobsRes.error);
    if (isCurrentProjectGeneration(projectId, generation)) setJobs(jobsRes.data);
  }, [activeProject?.id, isFixtureMode]);

  // Reconcile native jobs while the active project is open. The native snapshot
  // remains authoritative; this never manufactures progress in the browser.
  const refreshJobs = useCallback(async (projectId: string, generation: number) => {
    const res = await requestJobList(projectId);
    if (!res.ok) {
      console.warn('Native job list failed:', res.error);
      return;
    }
    if (isCurrentProjectGeneration(projectId, generation)) {
      setJobs(res.data);
    }
  }, []);

  useEffect(() => {
    const projectId = activeProject?.id;
    const generation = projectGenerationRef.current;
    if (!isNativeConnected || !projectId) return;

    void refreshJobs(projectId, generation);
    const interval = window.setInterval(() => {
      void refreshJobs(projectId, generation);
    }, 2000);
    return () => window.clearInterval(interval);
  }, [activeProject?.id, isNativeConnected, refreshJobs]);

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
        closeProject,
        assets,
        importAsset,
        composition,
        setComposition,
        addClip,
        splitClip,
        trimClip,
        removeClip,
        reorderClips,
        replaceClip,
        revisions,
        createRevision,
        restoreRevision,
        brief,
        saveBrief,
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
