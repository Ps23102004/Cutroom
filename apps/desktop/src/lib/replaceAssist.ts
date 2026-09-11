/**
 * Cutroom AI Replace Assist
 *
 * Generates structured replace proposals from natural-language instructions.
 * Replace = swap a timeline clip's source asset and in/out range in place.
 * Later clips on the same track ripple by the duration delta.
 * Source media files are never modified or moved.
 *
 * Safety chain:
 *   user instruction → local model → ReplaceProposal → validate → preview → Apply → replaceClip()
 *
 * Native semantics:
 *   AppContext.replaceClip() dispatches composition.apply action="replace" with
 *   { clipId, assetId, sourceInTicks, sourceOutTicks }.
 *   The native layer keeps the target clip ID, track, sort order, and timeline start,
 *   swaps asset and source range, and ripples subsequent clips on the track.
 */

import type { Asset, Clip, Composition } from './contracts';
import {
  generateStructured,
  LocalAiError,
  type LocalAiConfig,
} from './localAi';
import { TRIM_AI_CONFIG } from './trimAssist';

// ---------------------------------------------------------------------------
// Config — shares the same local model
// ---------------------------------------------------------------------------

export const REPLACE_AI_CONFIG: LocalAiConfig = { ...TRIM_AI_CONFIG };

// ---------------------------------------------------------------------------
// ReplaceProposal Schema
// ---------------------------------------------------------------------------

export interface ReplaceProposal {
  /** The clip to replace — must match the selected/target Clip.id */
  targetClipId: string;
  /** Display-only clip name for human confirmation */
  targetClipName: string;
  /** Asset to replace with — must match a candidate asset */
  replacementAssetId: string;
  /** Display-only asset name for human confirmation */
  replacementAssetName: string;
  /** Source in-point in replacement asset timebase ticks */
  sourceInTicks: string;
  /** Source out-point in replacement asset timebase ticks */
  sourceOutTicks: string;
  /**
   * Composition version this proposal was generated from.
   * Apply must be rejected if current version !== expectedVersion.
   */
  expectedVersion: number;
  /** Human-readable summary of what the replacement does and why */
  reason: string;
}

// ---------------------------------------------------------------------------
// Duration / Delta calculation (pure helper functions over real composition)
// ---------------------------------------------------------------------------

/**
 * Convert source duration in asset timebase to composition timebase ticks.
 */
export function sourceTicksToTimelineTicks(
  sourceTicks: bigint,
  assetTimeBase: { num: number; den: number },
  compositionTimeBase: { num: number; den: number },
): bigint {
  const numerator = BigInt(Math.abs(compositionTimeBase.den) * Math.abs(assetTimeBase.num));
  const denominator = BigInt(Math.abs(compositionTimeBase.num) * Math.abs(assetTimeBase.den));
  const scaled = sourceTicks * numerator;
  const q = scaled / denominator;
  return scaled % denominator === 0n ? q : q + 1n;
}

export interface ReplaceDeltaResult {
  currentDurationTicks: string;
  newDurationTicks: string;
  durationDeltaTicks: string;
}

export function calculateReplaceDelta(
  targetClip: Clip,
  replacementAsset: Asset,
  sourceInTicks: string,
  sourceOutTicks: string,
  compositionTimeBase: { num: number; den: number },
): ReplaceDeltaResult {
  const currentDur = BigInt(targetClip.timelineDurationTicks);
  const sourceIn = BigInt(sourceInTicks);
  const sourceOut = BigInt(sourceOutTicks);
  const sourceDur = sourceOut > sourceIn ? sourceOut - sourceIn : 0n;
  const newDur = sourceTicksToTimelineTicks(sourceDur, replacementAsset.timeBase, compositionTimeBase);
  const delta = newDur - currentDur;

  return {
    currentDurationTicks: currentDur.toString(),
    newDurationTicks: newDur.toString(),
    durationDeltaTicks: delta.toString(),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ReplaceValidationResult =
  | { valid: true }
  | { valid: false; error: string };

export interface ReplaceValidationContext {
  composition: Composition;
  targetClip: Clip;
  candidateAssets: Asset[];
}

function looksLikeFilesystemPath(value: string): boolean {
  return /(^|[\s"'`(=])(\/|~\/|\.{1,2}\/|[A-Za-z]:\\)/.test(value);
}

export function validateReplaceProposal(
  proposal: ReplaceProposal,
  ctx: ReplaceValidationContext,
): ReplaceValidationResult {
  if (proposal.targetClipId !== ctx.targetClip.id) {
    return {
      valid: false,
      error: `Proposal targets clip "${proposal.targetClipId}" but selected clip is "${ctx.targetClip.id}"`,
    };
  }
  if (!ctx.composition.clips.some((c) => c.id === ctx.targetClip.id)) {
    return {
      valid: false,
      error: `Selected clip "${ctx.targetClip.id}" is no longer present in the composition`,
    };
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
  if (looksLikeFilesystemPath(proposal.reason)) {
    return { valid: false, error: 'Proposal must not reference filesystem paths' };
  }

  const asset = ctx.candidateAssets.find((a) => a.id === proposal.replacementAssetId);
  if (!asset) {
    return {
      valid: false,
      error: `Replacement asset "${proposal.replacementAssetId}" is not one of the available assets`,
    };
  }
  if (proposal.replacementAssetName && proposal.replacementAssetName !== asset.name) {
    return {
      valid: false,
      error: `Replacement asset name "${proposal.replacementAssetName}" does not match asset "${asset.name}"`,
    };
  }

  let inTicks: bigint, outTicks: bigint;
  try {
    inTicks = BigInt(proposal.sourceInTicks);
    outTicks = BigInt(proposal.sourceOutTicks);
  } catch {
    return { valid: false, error: 'Source range must be integer ticks' };
  }
  let assetDuration: bigint;
  try {
    assetDuration = BigInt(asset.durationTicks);
  } catch {
    return { valid: false, error: 'Asset duration is invalid' };
  }

  if (inTicks < 0n) {
    return { valid: false, error: 'Source in-point must be >= 0' };
  }
  if (outTicks > assetDuration) {
    return { valid: false, error: 'Source out-point exceeds the asset duration' };
  }
  if (inTicks >= outTicks) {
    return { valid: false, error: 'Source out-point must be greater than the in-point' };
  }

  if (!ctx.composition.tracks.some((t) => t.id === ctx.targetClip.trackId)) {
    return {
      valid: false,
      error: `Target track "${ctx.targetClip.trackId}" does not exist in the composition`,
    };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------

export function isReplaceProposalStale(proposal: ReplaceProposal, currentVersion: number): boolean {
  return proposal.expectedVersion !== currentVersion;
}

// ---------------------------------------------------------------------------
// AI Context Builder — narrow: project, composition, target clip, candidate assets, instruction
// ---------------------------------------------------------------------------

export interface ReplaceAiContext {
  project: { name: string };
  composition: {
    id: string;
    version: number;
    timeBase: { num: number; den: number };
  };
  targetClip: {
    id: string;
    name: string;
    trackId: string;
    assetId: string;
    timelineStartTicks: string;
    timelineDurationTicks: string;
    inTicks: string;
    outTicks: string;
  };
  /** Clips on the same track for neighbourhood context */
  trackClips: Array<{
    id: string;
    name: string;
    timelineStartTicks: string;
    timelineDurationTicks: string;
  }>;
  /** Candidate replacement assets (no paths) */
  candidateAssets: Array<{
    id: string;
    name: string;
    durationTicks: string;
    timeBase: { num: number; den: number };
  }>;
  instruction: string;
}

export function buildReplaceContext(
  projectName: string,
  composition: Composition,
  targetClip: Clip,
  candidateAssets: Asset[],
  instruction: string,
): ReplaceAiContext {
  const trackClips = composition.clips
    .filter((c) => c.trackId === targetClip.trackId)
    .sort((a, b) => {
      const aS = BigInt(a.timelineStartTicks), bS = BigInt(b.timelineStartTicks);
      return aS < bS ? -1 : aS > bS ? 1 : 0;
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
    targetClip: {
      id: targetClip.id,
      name: targetClip.name,
      trackId: targetClip.trackId,
      assetId: targetClip.assetId,
      timelineStartTicks: targetClip.timelineStartTicks,
      timelineDurationTicks: targetClip.timelineDurationTicks,
      inTicks: targetClip.inTicks,
      outTicks: targetClip.outTicks,
    },
    trackClips,
    candidateAssets: candidateAssets.map((a) => ({
      id: a.id,
      name: a.name,
      durationTicks: a.durationTicks,
      timeBase: a.timeBase,
    })),
    instruction,
  };
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const REPLACE_SYSTEM_PROMPT = `You are a video editing assistant for Cutroom. You generate precise clip replacement proposals.

Given a target clip currently on the timeline, a set of available replacement assets, and the user's instruction, propose replacing the clip with a source interval from one of the available assets.

Replacing swaps the source asset and in/out points in place on the timeline. Later clips on the track ripple by the duration delta. Original media files are NEVER modified or deleted.

Return ONLY valid JSON matching this exact schema:
{
    "targetClipId": string,
    "targetClipName": string,
    "replacementAssetId": string,
    "replacementAssetName": string,
    "sourceInTicks": string,
    "sourceOutTicks": string,
    "reason": string
}

RULES:
- targetClipId must match the target clip ID provided.
- replacementAssetId must be one of the provided candidate asset IDs. Never invent asset IDs.
- sourceInTicks/sourceOutTicks are integer ticks in the REPLACEMENT ASSET timebase. 0 <= in < out <= replacement asset duration ticks.
- reason must briefly explain why this replacement is proposed.
- Do not include filesystem paths, extra fields, or markdown. Return only the JSON object.`;

// ---------------------------------------------------------------------------
// Generate replace proposal
// ---------------------------------------------------------------------------

export type ReplaceAssistResult =
  | { ok: true; proposal: ReplaceProposal }
  | { ok: false; error: string; code: string };

export async function assistReplace(
  context: ReplaceAiContext,
  config: LocalAiConfig = REPLACE_AI_CONFIG,
): Promise<ReplaceAssistResult> {
  if (!context.instruction.trim()) {
    return { ok: false, error: 'Describe what you want to replace this clip with.', code: 'EMPTY_INPUT' };
  }
  if (context.candidateAssets.length === 0) {
    return { ok: false, error: 'Import a source asset before requesting a replacement.', code: 'NO_ASSETS' };
  }

  const assetList = context.candidateAssets
    .map((a, i) => `  ${i + 1}. "${a.name}" (ID: ${a.id}) — duration ${a.durationTicks} ticks @ ${a.timeBase.num}/${a.timeBase.den}`)
    .join('\n');

  const clipList = context.trackClips
    .map((c, i) => `  ${i + 1}. "${c.name}" (ID: ${c.id}) start ${c.timelineStartTicks} dur ${c.timelineDurationTicks}`)
    .join('\n');

  const userMessage = `Available replacement assets (the ONLY assets you may reference):
${assetList}

Track clips:
${clipList}

Target clip to replace:
- Name: "${context.targetClip.name}" (ID: ${context.targetClip.id})
- Current source range: ${context.targetClip.inTicks} → ${context.targetClip.outTicks} ticks
- Current timeline start: ${context.targetClip.timelineStartTicks} ticks
- Current timeline duration: ${context.targetClip.timelineDurationTicks} ticks

Composition version: ${context.composition.version}

User instruction: ${context.instruction}`;

  try {
    const parsed = await generateStructured<ReplaceProposal>(
      [
        { role: 'system', content: REPLACE_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      (p) => validateModelReplaceOutput(p, context),
      config,
    );

    const proposal: ReplaceProposal = {
      ...(parsed as ReplaceProposal),
      targetClipId: context.targetClip.id,
      targetClipName: context.targetClip.name,
      expectedVersion: context.composition.version,
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
// Model output validation (strict — unknown fields/actions rejected)
// ---------------------------------------------------------------------------

function validateModelReplaceOutput(parsed: unknown, context: ReplaceAiContext): string | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'Expected a JSON object';
  const obj = parsed as Record<string, unknown>;

  const ALLOWED = new Set([
    'targetClipId', 'targetClipName', 'replacementAssetId', 'replacementAssetName',
    'sourceInTicks', 'sourceOutTicks', 'expectedVersion', 'reason',
  ]);
  for (const key of Object.keys(obj)) {
    if (!ALLOWED.has(key)) return `Unknown field: "${key}"`;
  }

  if (typeof obj.targetClipId !== 'string') return 'targetClipId must be a string';
  if (obj.targetClipId !== context.targetClip.id) {
    return `targetClipId "${obj.targetClipId}" does not match target clip "${context.targetClip.id}"`;
  }
  if (typeof obj.replacementAssetId !== 'string') return 'replacementAssetId must be a string';
  if (typeof obj.replacementAssetName !== 'string') return 'replacementAssetName must be a string';
  if (typeof obj.sourceInTicks !== 'string' || !/^\d+$/.test(obj.sourceInTicks)) {
    return 'sourceInTicks must be a non-negative integer tick string';
  }
  if (typeof obj.sourceOutTicks !== 'string' || !/^\d+$/.test(obj.sourceOutTicks)) {
    return 'sourceOutTicks must be a non-negative integer tick string';
  }
  if (typeof obj.reason !== 'string' || obj.reason.length === 0) return 'reason must be a non-empty string';
  if (looksLikeFilesystemPath(obj.reason)) return 'reason must not contain filesystem paths';

  if (obj.expectedVersion !== undefined && obj.expectedVersion !== context.composition.version) {
    return `expectedVersion ${obj.expectedVersion} does not match context ${context.composition.version}`;
  }

  const asset = context.candidateAssets.find((a) => a.id === obj.replacementAssetId);
  if (!asset) return `replacementAssetId "${obj.replacementAssetId}" is not one of the candidate assets`;
  if (obj.replacementAssetName !== asset.name) {
    return `replacementAssetName "${obj.replacementAssetName}" does not match candidate asset "${asset.name}"`;
  }

  if (BigInt(obj.sourceOutTicks) > BigInt(asset.durationTicks)) {
    return 'sourceOutTicks exceeds replacement asset duration';
  }
  if (BigInt(obj.sourceInTicks) >= BigInt(obj.sourceOutTicks)) {
    return 'sourceInTicks must be less than sourceOutTicks';
  }

  return null;
}
