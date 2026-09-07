import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { AppProvider, useApp } from '../context/AppContext';

describe('Project Lifecycle & Native Contract Enforcement', () => {
  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI__;
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI__;
  });

  it('starts with strictly empty state in production (no fake project data)', () => {
    const { result } = renderHook(() => useApp(), {
      wrapper: ({ children }) => <AppProvider>{children}</AppProvider>,
    });

    expect(result.current.projects.length).toBe(0);
    expect(result.current.activeProject).toBeNull();
    expect(result.current.assets.length).toBe(0);
    expect(result.current.composition).toBeNull();
    expect(result.current.revisions.length).toBe(0);
    expect(result.current.jobs.length).toBe(0);
    expect(result.current.isFixtureMode).toBe(false);
  });

  // Replaces previous test per F1R and Master Sections 6 & 10 (Strict prohibition of fake backends)
  it('rejects project creation in browser mode with NATIVE_UNAVAILABLE and leaves state unchanged', async () => {
    const { result } = renderHook(() => useApp(), {
      wrapper: ({ children }) => <AppProvider>{children}</AppProvider>,
    });

    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.createProject({
          name: 'Podcast Interview 01',
          path: '/workspace/projects/Podcast01',
          aspectRatio: '16:9',
          fpsNumerator: 24,
          fpsDenominator: 1,
        });
      } catch (err) {
        caughtError = err;
      }
    });

    // Must reject with NATIVE_UNAVAILABLE
    expect(caughtError).toBeDefined();
    expect((caughtError as { code?: string })?.code).toBe('NATIVE_UNAVAILABLE');
    expect((caughtError as Error)?.message).toContain('unavailable in browser preview mode');

    // State MUST remain completely untouched (no fabricated in-memory projects)
    expect(result.current.projects.length).toBe(0);
    expect(result.current.activeProject).toBeNull();
    expect(result.current.lastError).toContain('unavailable in browser preview mode');
  });

  it('rejects media import in browser mode without mutating asset state or inventing metadata', async () => {
    const { result } = renderHook(() => useApp(), {
      wrapper: ({ children }) => <AppProvider>{children}</AppProvider>,
    });

    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.importAsset({
          name: 'raw_footage.mov',
          path: '/workspace/media/raw_footage.mov',
          importType: 'managed',
        });
      } catch (err) {
        caughtError = err;
      }
    });

    expect(caughtError).toBeDefined();
    expect((caughtError as Error)?.message).toContain('Cannot import media without an active project');
    expect(result.current.assets.length).toBe(0);
  });

  it('rejects job render and revisions in browser mode outside fixture mode without mutating synthetic state', async () => {
    const { result } = renderHook(() => useApp(), {
      wrapper: ({ children }) => <AppProvider>{children}</AppProvider>,
    });

    // Attempting to create revision without active project
    let revError: unknown;
    await act(async () => {
      try {
        await result.current.createRevision('Snapshot test');
      } catch (err) {
        revError = err;
      }
    });
    expect(revError).toBeDefined();
    expect(result.current.revisions.length).toBe(0);

    // Attempting to enqueue render without active project
    let renderError: unknown;
    await act(async () => {
      try {
        await result.current.enqueueRender('1080p_sdr');
      } catch (err) {
        renderError = err;
      }
    });
    expect(renderError).toBeDefined();
    expect(result.current.jobs.length).toBe(0);
  });

  it('handles native IPC success flow with authoritative backend response (clearly marked mock)', async () => {
    // Clearly marked mock representing active Tauri desktop runtime
    window.__TAURI__ = {
      core: {
        invoke: async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
          expect(cmd).toBe('dispatch');
          const req = args?.request as { command: string; payload: Record<string, unknown> };
          if (req.command === 'project.create') {
            return {
              ok: true,
              data: {
                id: 'proj-native-001',
                name: req.payload.name,
                path: req.payload.path,
                fpsNumerator: 24,
                fpsDenominator: 1,
                aspectRatio: '16:9',
                createdAt: '2026-09-07T16:00:00Z',
                updatedAt: '2026-09-07T16:00:00Z',
                revisionCount: 0,
                status: 'draft',
              },
            } as T;
          }
          throw new Error(`Unhandled mock command: ${req.command}`);
        },
      },
    };

    const { result } = renderHook(() => useApp(), {
      wrapper: ({ children }) => <AppProvider>{children}</AppProvider>,
    });

    await act(async () => {
      await result.current.createProject({
        name: 'Native Authoritative Project',
        path: '/workspace/projects/native_01',
        aspectRatio: '16:9',
        fpsNumerator: 24,
        fpsDenominator: 1,
      });
    });

    expect(result.current.projects.length).toBe(1);
    expect(result.current.activeProject).not.toBeNull();
    expect(result.current.activeProject?.id).toBe('proj-native-001');
    expect(result.current.activeProject?.name).toBe('Native Authoritative Project');
    expect(result.current.lastError).toBeNull();
  });

  it('handles native IPC error flow by rejecting, setting lastError, and leaving state unchanged', async () => {
    // Clearly marked mock returning a typed backend error (e.g. DISK_FULL)
    window.__TAURI__ = {
      core: {
        invoke: async <T,>(): Promise<T> => ({
          ok: false,
          error: {
            code: 'DISK_FULL',
            message: 'Insufficient storage volume space',
          },
        } as T),
      },
    };

    const { result } = renderHook(() => useApp(), {
      wrapper: ({ children }) => <AppProvider>{children}</AppProvider>,
    });

    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.createProject({
          name: 'Failing Project',
          path: '/workspace/projects/fail',
          aspectRatio: '16:9',
          fpsNumerator: 24,
          fpsDenominator: 1,
        });
      } catch (err) {
        caughtError = err;
      }
    });

    expect(caughtError).toBeDefined();
    expect((caughtError as { code?: string })?.code).toBe('DISK_FULL');
    expect(result.current.projects.length).toBe(0);
    expect(result.current.activeProject).toBeNull();
    expect(result.current.lastError).toBe('Insufficient storage volume space');
  });

  it('handles composition stale write conflict (VERSION_CONFLICT) and surfaces conflict', async () => {
    // Clearly marked mock returning VERSION_CONFLICT
    window.__TAURI__ = {
      core: {
        invoke: async <T,>(): Promise<T> => ({
          ok: false,
          error: {
            code: 'VERSION_CONFLICT',
            message: 'Expected composition version 1 but current authoritative version is 3',
          },
        } as T),
      },
    };

    const { result } = renderHook(() => useApp(), {
      wrapper: ({ children }) => <AppProvider>{children}</AppProvider>,
    });

    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.splitClip('clip-01', '3600');
      } catch (err) {
        caughtError = err;
      }
    });

    expect(caughtError).toBeDefined();
    expect((caughtError as { code?: string })?.code).toBe('VERSION_CONFLICT');
    expect(result.current.lastError).toContain('Expected composition version 1');
    expect(result.current.composition).toBeNull();
  });

  it('strictly enforces no invented asset metadata by binding to authoritative native response', async () => {
    const authoritativeAsset = {
      id: 'asset-native-exact-1',
      projectId: 'proj-1',
      name: 'authoritative_take.mov',
      path: '/workspace/media/authoritative_take.mov',
      sizeBytes: 524288000,
      durationTicks: '144000',
      timeBase: { num: 1, den: 24000 },
      width: 3840,
      height: 2160,
      fpsNumerator: 24,
      fpsDenominator: 1,
      format: 'QuickTime / MOV',
      codec: 'Apple ProRes 422 HQ',
      audioChannels: 8,
      importType: 'managed' as const,
      proxyStatus: 'generating' as const,
      sha256: 'abc123fed456...',
    };

    window.__TAURI__ = {
      core: {
        invoke: async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
          expect(cmd).toBe('dispatch');
          const req = args?.request as { command: string };
          if (req.command === 'project.create') {
            return {
              ok: true,
              data: {
                id: 'proj-1',
                name: 'Active Project',
                path: '/workspace/projects/p1',
                fpsNumerator: 24,
                fpsDenominator: 1,
                aspectRatio: '16:9',
                createdAt: '2026-09-07T16:00:00Z',
                updatedAt: '2026-09-07T16:00:00Z',
                revisionCount: 0,
                status: 'draft',
              },
            } as T;
          }
          if (req.command === 'asset.import') {
            return {
              ok: true,
              data: authoritativeAsset,
            } as T;
          }
          throw new Error(`Unexpected command: ${req.command}`);
        },
      },
    };

    const { result } = renderHook(() => useApp(), {
      wrapper: ({ children }) => <AppProvider>{children}</AppProvider>,
    });

    // Create project first
    await act(async () => {
      await result.current.createProject({
        name: 'Active Project',
        path: '/workspace/projects/p1',
        aspectRatio: '16:9',
        fpsNumerator: 24,
        fpsDenominator: 1,
      });
    });

    // Import asset
    await act(async () => {
      await result.current.importAsset({
        name: 'authoritative_take.mov',
        path: '/workspace/media/authoritative_take.mov',
        importType: 'managed',
      });
    });

    expect(result.current.assets.length).toBe(1);
    const imported = result.current.assets[0];
    // Must match backend values EXACTLY, NOT fabricated fallback values (not 1080p, not 2 channels, not 72000 ticks)
    expect(imported.width).toBe(3840);
    expect(imported.height).toBe(2160);
    expect(imported.codec).toBe('Apple ProRes 422 HQ');
    expect(imported.audioChannels).toBe(8);
    expect(imported.durationTicks).toBe('144000');
  });

  it('opt-in fixture mode is development-only, labeled [FIXTURE], and resets cleanly to empty', () => {
    const { result } = renderHook(() => useApp(), {
      wrapper: ({ children }) => <AppProvider>{children}</AppProvider>,
    });

    act(() => {
      result.current.enableFixtureMode();
    });

    expect(result.current.isFixtureMode).toBe(true);
    expect(result.current.projects.length).toBe(1);
    expect(result.current.activeProject?.isFixture).toBe(true);
    expect(result.current.activeProject?.name).toContain('[FIXTURE]');

    // Exiting fixture mode resets cleanly to empty
    act(() => {
      result.current.resetToEmpty();
    });

    expect(result.current.isFixtureMode).toBe(false);
    expect(result.current.projects.length).toBe(0);
    expect(result.current.activeProject).toBeNull();
  });
});
