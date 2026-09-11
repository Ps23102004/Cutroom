/**
 * Cutroom AI Delete Assist
 *
 * Generates structured delete proposals from natural-language instructions.
 * Delete = remove a clip from the timeline. Source media is never deleted.
 *
 * Safety chain:
 *   user instruction → local model → DeleteProposal → validate → preview → Apply → removeClip()
 */

import type { Clip, Composition } from './contracts';
import {
  generateStructured,
  LocalAiError,
  type LocalAiConfig,
} from './localAi';
import { TRIM_AI_CONFIG } from './trimAssist';

// ---------------------------------------------------------------------------
// Config — shares the same local model
// ---------------------------------------------------------------------------

export const DELETE_AI_CONFIG: LocalAiConfig = { ...TRIM_AI_CONFIG };

// ---------------------------------------------------------------------------
// DeleteProposal Schema
// ---------------------------------------------------------------------------

/**
 * A structured AI-generated delete proposal. Maps to the native
 * composition.apply({ action: 'remove', clipId }) contract.
 *
 * DELETE removes a clip from the timeline only.
 * It NEVER deletes the source asset or original media file.
 */
export interface DeleteProposal {
  /** The clip to remove — must match an existing Clip.id */
  clipId: string;

  /** Display-only clip name for human confirmation */
  clipName: string;

  /**
   * Composition version this proposal was generated from.
   * Apply must be rejected if current version !== expectedVersion.
   */
  expectedVersion: number;

  /** Human-readable summary of what the deletion does and why */
  reason: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type DeleteValidationResult =
  | { valid: true }
  | { valid: false; error: string };

export interface DeleteValidationContext {
  composition: Composition;
  clip: Clip;
}

export function validateDeleteProposal(
  proposal: DeleteProposal,
  ctx: DeleteValidationContext,
): DeleteValidationResult {
  if (proposal.clipId !== ctx.clip.id) {
    return { valid: false, error: `Proposal targets clip "${proposal.clipId}" but selected clip is "${ctx.clip.id}"` };
  }
  if (!ctx.composition.clips.some((c) => c.id === ctx.clip.id)) {
    return { valid: false, error: `Selected clip "${ctx.clip.id}" is no longer present in the composition` };
  }
  if (proposal.expectedVersion !== ctx.composition.version) {
    return {
      valid: false,
      error: `Timeline changed since this proposal was generated (expected version ${proposal.expectedVersion}, current ${ctx.composition.version}). Regenerate the proposal.`,
    };
  }
  if (!proposal.reason || proposal.reason.trim().length === 0) {
    return { valid: false, error: 'Proposal must include a reason' };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------

export function isDeleteProposalStale(proposal: DeleteProposal, currentVersion: number): boolean {
  return proposal.expectedVersion !== currentVersion;
}

// ---------------------------------------------------------------------------
// AI Context Builder
// ---------------------------------------------------------------------------

export interface DeleteAiContext {
  project: { name: string };
  composition: {
    id: string;
    version: number;
    timeBase: { num: number; den: number };
  };
  selectedClip: {
    id: string;
    name: string;
    trackId: string;
    assetId: string;
    timelineStartTicks: string;
    timelineDurationTicks: string;
    inTicks: string;
    outTicks: string;
  };
  /** All clips on the same track for neighbourhood context */
  trackClips: Array<{
    id: string;
    name: string;
    timelineStartTicks: string;
    timelineDurationTicks: string;
  }>;
  trackLabel: string;
  instruction: string;
}

export function buildDeleteContext(
  projectName: string,
  composition: Composition,
  clip: Clip,
  instruction: string,
): DeleteAiContext {
  const track = composition.tracks.find((t) => t.id === clip.trackId);
  const trackClips = composition.clips
    .filter((c) => c.trackId === clip.trackId)
    .sort((a, b) => {
      const aS = BigInt(a.timelineStartTicks), bS = BigInt(b.timelineStartTicks);
      return aS < bS ? -1 : aS > bS ? 1 : 0;
    })
    .map((c) => ({
      id: c.id, name: c.name,
      timelineStartTicks: c.timelineStartTicks,
      timelineDurationTicks: c.timelineDurationTicks,
    }));

  return {
    project: { name: projectName },
    composition: { id: composition.id, version: composition.version, timeBase: composition.timeBase },
    selectedClip: {
      id: clip.id, name: clip.name, trackId: clip.trackId, assetId: clip.assetId,
      timelineStartTicks: clip.timelineStartTicks, timelineDurationTicks: clip.timelineDurationTicks,
      inTicks: clip.inTicks, outTicks: clip.outTicks,
    },
    trackClips,
    trackLabel: track?.label ?? 'Unknown Track',
    instruction,
  };
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const DELETE_SYSTEM_PROMPT = `You are a video editing assistant for Cutroom. You generate precise clip deletion proposals.

Given a clip on a timeline track and the user's instruction, decide whether this clip should be removed from the timeline.

IMPORTANT: Deleting a clip removes it from the timeline ONLY. The original source media file is NEVER deleted.

Return ONLY valid JSON matching this exact schema:
{
    "clipId": string,
    "clipName": string,
    "expectedVersion": number,
    "reason": string
}

RULES:
- clipId must match the provided clip ID exactly. Do not invent clip IDs.
- expectedVersion must match the provided composition version exactly.
- clipName should be the human-readable name of the clip.
- reason must briefly explain why the clip should be removed from the timeline.
- Return only the JSON object. No explanation, no markdown fencing.`;

// ---------------------------------------------------------------------------
// Generate delete proposal
// ---------------------------------------------------------------------------

export type DeleteAssistResult =
  | { ok: true; proposal: DeleteProposal }
  | { ok: false; error: string; code: string };

export async function assistDelete(
  context: DeleteAiContext,
  config: LocalAiConfig = DELETE_AI_CONFIG,
): Promise<DeleteAssistResult> {
  if (!context.instruction.trim()) {
    return { ok: false, error: 'Please describe why you want to remove this clip.', code: 'EMPTY_INPUT' };
  }

  const clipList = context.trackClips
    .map((c, i) => `  ${i + 1}. "${c.name}" (ID: ${c.id})`)
    .join('\n');

  const userMessage = `Track: ${context.trackLabel}
Clips on track:
${clipList}

Selected clip: "${context.selectedClip.name}" (ID: ${context.selectedClip.id})
Source range: ${context.selectedClip.inTicks} → ${context.selectedClip.outTicks} ticks
Timeline position: ${context.selectedClip.timelineStartTicks} ticks
Timeline duration: ${context.selectedClip.timelineDurationTicks} ticks

Composition version: ${context.composition.version}

User instruction: ${context.instruction}`;

  try {
    const parsed = await generateStructured<DeleteProposal>(
      [
        { role: 'system', content: DELETE_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      (p) => validateModelDeleteOutput(p, context),
      config,
    );

    const proposal: DeleteProposal = {
      clipId: context.selectedClip.id,
      clipName: String((parsed as DeleteProposal).clipName ?? '').trim() || context.selectedClip.name,
      expectedVersion: context.composition.version,
      reason: (parsed as DeleteProposal).reason,
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
// Model output validation
// ---------------------------------------------------------------------------

function validateModelDeleteOutput(parsed: unknown, context: DeleteAiContext): string | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'Expected a JSON object';
  const obj = parsed as Record<string, unknown>;

  const ALLOWED = new Set(['clipId', 'clipName', 'expectedVersion', 'reason']);
  for (const key of Object.keys(obj)) {
    if (!ALLOWED.has(key)) return `Unknown field: "${key}"`;
  }
  if (typeof obj.clipId !== 'string') return 'clipId must be a string';
  if (typeof obj.expectedVersion !== 'number') return 'expectedVersion must be a number';
  if (typeof obj.reason !== 'string' || obj.reason.length === 0) return 'reason must be a non-empty string';
  if (obj.clipName !== undefined && typeof obj.clipName !== 'string') return 'clipName must be a string';
  if (obj.clipId !== context.selectedClip.id) return `clipId "${obj.clipId}" does not match expected "${context.selectedClip.id}"`;
  if (obj.expectedVersion !== context.composition.version) return `expectedVersion ${obj.expectedVersion} does not match context ${context.composition.version}`;

  return null;
}
