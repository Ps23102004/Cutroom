/**
 * Cutroom Native Transport Adapter
 * 
 * Isolates IPC communication with Tauri backend.
 * PROVISIONAL: Provisional native transport is not an implemented backend.
 * Contract: Tauri invoke('dispatch', { request })
 * JSON Request:  { command, operation_id?, project_id?, expected_version?, payload }
 * JSON Response: { ok: true, data: T } | { ok: false, error: { code, message, details? } }
 * 
 * Browser mode strictly shows native-unavailable; NO fake database or localStorage fallback.
 */

export interface NativeRequest<P = Record<string, unknown>> {
  command: string;
  operation_id?: string;
  project_id?: string;
  expected_version?: number;
  payload: P;
}

export interface NativeSuccessResponse<T> {
  ok: true;
  data: T;
}

export interface NativeErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface NativeErrorResponse {
  ok: false;
  error: NativeErrorPayload;
}

export type NativeResponse<T> = NativeSuccessResponse<T> | NativeErrorResponse;

// Declaring Tauri globals on Window
declare global {
  interface Window {
    __TAURI__?: {
      core?: {
        invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
      };
      invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    };
  }
}

/**
 * Checks if the actual Tauri desktop runtime is active.
 */
export function isNativeAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.__TAURI__?.core?.invoke ||
    window.__TAURI__?.invoke
  );
}

/**
 * Generates the UUIDv4 operation IDs required by native mutation idempotency.
 * There is intentionally no timestamp fallback: the core rejects non-UUID IDs.
 */
export function createOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  throw new Error('Secure operation ID generation is unavailable in this environment.');
}

/**
 * Low-level dispatch to Tauri native backend.
 */
async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (window.__TAURI__?.core?.invoke) {
    return window.__TAURI__.core.invoke<T>(cmd, args);
  }
  if (window.__TAURI__?.invoke) {
    return window.__TAURI__.invoke<T>(cmd, args);
  }
  throw new Error('Tauri IPC is not available in this environment');
}

/**
 * Dispatches a typed command to the Cutroom native core.
 */
export async function dispatchNativeCommand<T, P = Record<string, unknown>>(
  request: NativeRequest<P>
): Promise<NativeResponse<T>> {
  if (!isNativeAvailable()) {
    return {
      ok: false,
      error: {
        code: 'NATIVE_UNAVAILABLE',
        message: 'Tauri desktop native transport is unavailable in browser preview mode.',
        details: { command: request.command },
      },
    };
  }

  try {
    const response = await invokeTauri<NativeResponse<T>>('dispatch', { request });
    return response;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: {
        code: 'IPC_DISPATCH_FAILURE',
        message: `Native IPC dispatch failed: ${errorMsg}`,
        details: { command: request.command, originalError: errorMsg },
      },
    };
  }
}

/**
 * Standard coordinated command names matching backend contract:
 */
export const NATIVE_COMMANDS = {
  PROJECT_LIST: 'project.list',
  PROJECT_CREATE: 'project.create',
  PROJECT_OPEN: 'project.open',
  ASSET_IMPORT: 'asset.import',
  ASSET_LIST: 'asset.list',
  COMPOSITION_GET: 'composition.get',
  COMPOSITION_APPLY: 'composition.apply',
  REVISION_CREATE: 'revision.create',
  REVISION_LIST: 'revision.list',
  REVISION_RESTORE: 'revision.restore',
  RENDER_ENQUEUE: 'render.enqueue',
  JOB_LIST: 'job.list',
  JOB_CANCEL: 'job.cancel',
  JOB_RETRY: 'job.retry',
  HEALTH_GET: 'health.get',
  BRIEF_GET: 'brief.get',
  BRIEF_SET: 'brief.set',
} as const;
