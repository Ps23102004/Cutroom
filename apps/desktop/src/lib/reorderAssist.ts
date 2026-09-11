/**
 * Cutroom AI Reorder Assist
 *
 * Generates structured reorder proposals from natural-language instructions
 * using the local AI provider. The user reviews proposals before applying
 * them through the existing native reorderClips() path.
 *
 * Safety chain:
 *   user instruction → local model → ReorderProposal → validate → preview → Apply → reorderClips()
 *
 * Reuses the same local AI provider (generateStructured/health) and config
 * pattern as trimAssist. No second AI system is created.
 */

import type { Clip, Composition } from './contracts';
import {
  generateStructured,
  LocalAiError,
  type LocalAiConfig,
} from './localAi';
import { TRIM_AI_CONFIG } from './trimAssist';

// ---------------------------------------------------------------------------
// Model configuration — shares the same local model as Trim
// ---------------------------------------------------------------------------

export const REORDER_AI_CONFIG: LocalAiConfig = {
  baseUrl: TRIM_AI_CONFIG.baseUrl,
  model: TRIM_AI_CONFIG.model,
};

// ---------------------------------------------------------------------------
// ReorderProposal Schema
// ---------------------------------------------------------------------------

/**
 * A structured AI-generated reorder proposal. Maps directly to the native
 * composition.apply({ action: 'reorder', clipId, direction }) contract
 * but includes validation and preview metadata.
 *
 * The native reorder is an adjacent swap: one clip moves left or right by
 * one position on its track. The AI layer reasons about the desired clip
 * order and produces the minimal swap needed.
 */
export interface ReorderProposal {
  /** The clip to move — must match an existing Clip.id on the track */
  clipId: string;

  /** Display-only clip name for human confirmation. Not used in apply. */
  clipName: string;

  /** Swap direction: 'left' or 'right' (one adjacent position) */
  direction: 'left' | 'right';

  /**
   * Composition version this proposal was generated from.
   * Apply must be rejected if current version !== expectedVersion.
   */
  expectedVersion: number;

  /** Human-readable summary of what the reorder does and why (max 280 chars) */
  reason: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ReorderValidationResult =
  | { valid: true }
  | { valid: false; error: string };

export interface ReorderValidationContext {
  composition: Composition;
  /** The clip the user wants to move */
  clip: Clip;
}

/**
 * Pure deterministic validator — no side effects, no network.
 * Validates a ReorderProposal against the current composition state.
 */
export function validateReorderProposal(
  proposal: ReorderProposal,
  ctx: ReorderValidationContext,
): ReorderValidationResult {
  // 1. Clip identity must match
  if (proposal.clipId !== ctx.clip.id) {
    return {
      valid: false,
      error: `Proposal targets clip "${proposal.clipId}" but selected clip is "${ctx.clip.id}"`,
    };
  }

  // 2. Clip must exist in the composition
  if (!ctx.composition.clips.some((c) => c.id === ctx.clip.id)) {
    return {
      valid: false,
      error: `Selected clip "${ctx.clip.id}" is no longer present in the composition`,
    };
  }

  // 3. Version check
  if (proposal.expectedVersion !== ctx.composition.version) {
    return {
      valid: false,
      error: `Timeline changed since this proposal was generated (expected version ${proposal.expectedVersion}, current ${ctx.composition.version}). Regenerate the proposal.`,
    };
  }

  // 4. Direction must be valid
  if (proposal.direction !== 'left' && proposal.direction !== 'right') {
    return {
      valid: false,
      error: `Direction must be "left" or "right", got "${proposal.direction}"`,
    };
  }

  // 5. Boundary check — clip must not already be at the requested edge
  const trackClips = ctx.composition.clips
    .filter((c) => c.trackId === ctx.clip.trackId)
    .sort((a, b) => {
      // Sort by timelineStartTicks (BigInt comparison)
      const aStart = BigInt(a.timelineStartTicks);
      const bStart = BigInt(b.timelineStartTicks);
      if (aStart < bStart) return -1;
      if (aStart > bStart) return 1;
      return 0;
    });

  const clipIndex = trackClips.findIndex((c) => c.id === ctx.clip.id);
  if (clipIndex === -1) {
    return {
      valid: false,
      error: `Clip "${ctx.clip.id}" is not found on its track`,
    };
  }

  if (proposal.direction === 'left' && clipIndex === 0) {
    return {
      valid: false,
      error: 'Clip is already at the left edge of the track — cannot move left',
    };
  }

  if (proposal.direction === 'right' && clipIndex === trackClips.length - 1) {
    return {
      valid: false,
      error: 'Clip is already at the right edge of the track — cannot move right',
    };
  }

  // 6. Must not be a no-op (single clip on the track)
  if (trackClips.length < 2) {
    return {
      valid: false,
      error: 'Track has only one clip — reorder is not possible',
    };
  }

  // 7. Reason must be present
  if (!proposal.reason || proposal.reason.trim().length === 0) {
    return { valid: false, error: 'Proposal must include a reason' };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Staleness check
// ---------------------------------------------------------------------------

export function isReorderProposalStale(
  proposal: ReorderProposal,
  currentVersion: number,
): boolean {
  return proposal.expectedVersion !== currentVersion;
}

// ---------------------------------------------------------------------------
// AI Context Builder (task-specific, narrow)
// ---------------------------------------------------------------------------

export interface ReorderAiContext {
  project: { name: string };
  composition: {
    id: string;
    version: number;
    timeBase: { num: number; den: number };
  };
  /** The clip the user selected (the one to potentially move) */
  selectedClip: {
    id: string;
    name: string;
    trackId: string;
    timelineStartTicks: string;
    timelineDurationTicks: string;
  };
  /** All clips on the same track, sorted by timeline position */
  trackClips: Array<{
    id: string;
    name: string;
    timelineStartTicks: string;
    timelineDurationTicks: string;
  }>;
  trackLabel: string;
  instruction: string;
}

/**
 * Build narrow AI context for a reorder operation. Only includes
 * the selected clip, its track siblings, and composition version.
 * Does not include asset details, revision history, or unrelated tracks.
 */
export function buildReorderContext(
  projectName: string,
  composition: Composition,
  clip: Clip,
  instruction: string,
): ReorderAiContext {
  const track = composition.tracks.find((t) => t.id === clip.trackId);
  const trackClips = composition.clips
    .filter((c) => c.trackId === clip.trackId)
    .sort((a, b) => {
      const aStart = BigInt(a.timelineStartTicks);
      const bStart = BigInt(b.timelineStartTicks);
      if (aStart < bStart) return -1;
      if (aStart > bStart) return 1;
      return 0;
    })
    .map((c) => ({
      id: c.id,
      name: c.name,
      timelineStartTicks: c.timelineStartTicks,
      timelineDurationTicks: c.timelineDurationTicks,
    }));

  return {
    project: { name: projectName },
    composition: {
      id: composition.id,
      version: composition.version,
      timeBase: composition.timeBase,
    },
    selectedClip: {
      id: clip.id,
      name: clip.name,
      trackId: clip.trackId,
      timelineStartTicks: clip.timelineStartTicks,
      timelineDurationTicks: clip.timelineDurationTicks,
    },
    trackClips,
    trackLabel: track?.label ?? 'Unknown Track',
    instruction,
  };
}

// ---------------------------------------------------------------------------
// System prompt for reorder proposals
// ---------------------------------------------------------------------------

const REORDER_SYSTEM_PROMPT = `You are a video editing assistant for Cutroom. You generate precise clip reorder proposals.

Given the current order of clips on a timeline track and the user's instruction, propose ONE adjacent swap to improve the clip order.

Return ONLY valid JSON matching this exact schema:
{
    "clipId": string,
    "clipName": string,
    "direction": "left" | "right",
    "expectedVersion": number,
    "reason": string
}

RULES:
- Propose ONE swap only. A reorder moves one clip left or right by one position.
- clipId must match one of the provided clip IDs exactly. Do not invent clip IDs.
- direction is "left" (move earlier on the timeline) or "right" (move later).
- expectedVersion must match the provided composition version exactly.
- The clip must not already be at the boundary in the chosen direction.
- clipName should be the human-readable name of the clip being moved.
- reason must briefly explain what the reorder achieves and why.
- Return only the JSON object. No explanation, no markdown fencing.`;

// ---------------------------------------------------------------------------
// Generate reorder proposal
// ---------------------------------------------------------------------------

export type ReorderAssistResult =
  | { ok: true; proposal: ReorderProposal }
  | { ok: false; error: string; code: string };

/**
 * Generate a structured reorder proposal from natural language.
 */
export async function assistReorder(
  context: ReorderAiContext,
  config: LocalAiConfig = REORDER_AI_CONFIG,
): Promise<ReorderAssistResult> {
  if (!context.instruction.trim()) {
    return {
      ok: false,
      error: 'Please describe how you want to reorder the clips.',
      code: 'EMPTY_INPUT',
    };
  }

  const clipList = context.trackClips
    .map((c, i) => `  ${i + 1}. "${c.name}" (ID: ${c.id}, start: ${c.timelineStartTicks}, duration: ${c.timelineDurationTicks})`)
    .join('\n');

  const selectedIndex = context.trackClips.findIndex(
    (c) => c.id === context.selectedClip.id,
  );

  const userMessage = `Track: ${context.trackLabel}
Current clip order (left to right):
${clipList}

Selected clip: "${context.selectedClip.name}" (ID: ${context.selectedClip.id}, position ${selectedIndex + 1} of ${context.trackClips.length})

Composition version: ${context.composition.version}

User instruction: ${context.instruction}`;

  try {
    const parsed = await generateStructured<ReorderProposal>(
      [
        { role: 'system', content: REORDER_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      (parsed) => validateModelReorderOutput(parsed, context),
      config,
    );

    // Build a fully-formed proposal using authoritative context values.
    const matchedClip = context.trackClips.find((c) => c.id === (parsed as ReorderProposal).clipId);
    const proposal: ReorderProposal = {
      clipId: context.selectedClip.id,
      clipName: String((parsed as ReorderProposal).clipName ?? '').trim() || matchedClip?.name || context.selectedClip.name,
      direction: (parsed as ReorderProposal).direction,
      expectedVersion: context.composition.version,
      reason: (parsed as ReorderProposal).reason,
    };

    return { ok: true, proposal };
  } catch (err: unknown) {
    if (err instanceof LocalAiError) {
      return { ok: false, error: err.message, code: err.code };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, code: 'UNKNOWN' };
  }
}

// ---------------------------------------------------------------------------
// Model output validation (pre-parse, before domain validation)
// ---------------------------------------------------------------------------

function validateModelReorderOutput(
  parsed: unknown,
  context: ReorderAiContext,
): string | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return 'Expected a JSON object';
  }

  const obj = parsed as Record<string, unknown>;

  // Schema forbids extra fields
  const ALLOWED_KEYS = new Set([
    'clipId', 'clipName', 'direction', 'expectedVersion', 'reason',
  ]);
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_KEYS.has(key)) return `Unknown field: "${key}"`;
  }

  // Required fields
  if (typeof obj.clipId !== 'string') return 'clipId must be a string';
  if (typeof obj.direction !== 'string') return 'direction must be a string';
  if (obj.direction !== 'left' && obj.direction !== 'right') {
    return 'direction must be "left" or "right"';
  }
  if (typeof obj.expectedVersion !== 'number') {
    return 'expectedVersion must be a number';
  }
  if (typeof obj.reason !== 'string' || obj.reason.length === 0) {
    return 'reason must be a non-empty string';
  }
  if (obj.clipName !== undefined && typeof obj.clipName !== 'string') {
    return 'clipName must be a string';
  }

  // Clip ID must reference a clip on the track
  const validClipIds = new Set(context.trackClips.map((c) => c.id));
  if (!validClipIds.has(obj.clipId as string)) {
    return `clipId "${obj.clipId}" is not a clip on the track`;
  }

  // Version must match context
  if (obj.expectedVersion !== context.composition.version) {
    return `expectedVersion ${obj.expectedVersion} does not match context ${context.composition.version}`;
  }

  // Boundary check
  const trackClipIds = context.trackClips.map((c) => c.id);
  const clipIdx = trackClipIds.indexOf(obj.clipId as string);
  if (obj.direction === 'left' && clipIdx === 0) {
    return 'Clip is already at the left edge — cannot move left';
  }
  if (obj.direction === 'right' && clipIdx === trackClipIds.length - 1) {
    return 'Clip is already at the right edge — cannot move right';
  }

  return null;
}
