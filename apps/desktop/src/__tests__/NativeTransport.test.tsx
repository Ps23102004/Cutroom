import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isNativeAvailable, dispatchNativeCommand, NATIVE_COMMANDS } from '../lib/native';

describe('Native Transport Adapter', () => {
  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI__;
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI__;
  });

  it('detects browser mode when Tauri global is absent', () => {
    expect(isNativeAvailable()).toBe(false);
  });

  it('returns NATIVE_UNAVAILABLE error in browser mode without fake localStorage', async () => {
    const result = await dispatchNativeCommand({
      command: NATIVE_COMMANDS.PROJECT_LIST,
      payload: {},
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NATIVE_UNAVAILABLE');
      expect(result.error.message).toContain('unavailable in browser preview mode');
    }
  });

  it('correctly dispatches request when Tauri IPC is available', async () => {
    // Mock Tauri IPC
    window.__TAURI__ = {
      core: {
        invoke: async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
          expect(cmd).toBe('dispatch');
          expect(args).toBeDefined();
          return {
            ok: true,
            data: { id: 'proj-123', name: 'Test Native Project' },
          } as T;
        },
      },
    };

    expect(isNativeAvailable()).toBe(true);

    const res = await dispatchNativeCommand<{ id: string; name: string }>({
      command: NATIVE_COMMANDS.PROJECT_CREATE,
      payload: { name: 'Test Native Project' },
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.id).toBe('proj-123');
      expect(res.data.name).toBe('Test Native Project');
    }
  });

  it('handles backend error response envelope', async () => {
    window.__TAURI__ = {
      core: {
        invoke: async <T,>(): Promise<T> => ({
          ok: false,
          error: {
            code: 'VERSION_CONFLICT',
            message: 'Revision version mismatch',
          },
        } as T),
      },
    };

    const res = await dispatchNativeCommand({
      command: NATIVE_COMMANDS.COMPOSITION_APPLY,
      expected_version: 1,
      payload: {},
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('VERSION_CONFLICT');
      expect(res.error.message).toBe('Revision version mismatch');
    }
  });
});
