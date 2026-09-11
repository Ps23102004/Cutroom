/**
 * Cutroom AI Trim Assist
 *
 * Generates structured trim proposals from natural-language instructions
 * using the local AI provider. The user reviews proposals before applying
 * them through the existing native trimClip() path.
 *
 * Safety chain:
 *   user instruction → local model → TrimProposal → validate → preview → Apply → trimClip()
 */

import type { Clip, Composition, Asset } from './contracts';
import {
  generateStructured,
  health,
  LocalAiError,
  type LocalAiConfig,
  DEFAULT_LOCAL_AI_CONFIG,
} from './localAi';

// ---------------------------------------------------------------------------
// Model configuration
// ---------------------------------------------------------------------------

/**
 * Trim proposals target the local Gemma 4 E4B MLX model. This reuses the
 * existing local AI provider (generateStructured/health) — no new provider is
 * created. It only narrows the model target for the structured trim task.
 */
export const TRIM_AI_CONFIG: LocalAiConfig = {
  baseUrl: DEFAULT_LOCAL_AI_CONFIG.baseUrl,
  model: 'gemma4:e4b-mlx',
};

/**
 * Check whether the local trim model is available. Reuses health().
 */
export async function trimAssistAvailable(
  config: LocalAiConfig = TRIM_AI_CONFIG,
): Promise<{ available: boolean; error?: string; model: string }> {
  try {
    const result = await health(config);
    return { available: result.ok, error: result.error, model: result.model };
    } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { available: false, error: msg, model: config.model };
    }
}

// ---------------------------------------------------------------------------
// TrimProposal Schema
// ---------------------------------------------------------------------------

/**
 * A structured AI-generated trim proposal. Maps directly to the native
 * composition.apply({ action: 'trim', clipId, newInTicks, newOutTicks })
 * contract but includes validation and preview metadata.
 */
export interface TrimProposal {
  /** The clip to trim — must match an existing Clip.id */
  clipId: string;

  /** Display-only clip name for human confirmation. Not used in apply. */
  clipName: string;

  /** New source in-point in asset-timebase ticks */
  newInTicks: string;

  /** New source out-point in asset-timebase ticks */
  newOutTicks: string;

  /**
   * Composition version this proposal was generated from.
   * Apply must be rejected if current version !== expectedVersion.
   */
  expectedVersion: number;

  /** Human-readable summary of what the trim does and why (max 280 chars) */
  reason: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type TrimValidationResult =
  | { valid: true }
  | { valid: false; error: string };

/**
 * Context needed to validate a trim proposal against current state.
 */
export interface TrimValidationContext {
  composition: Composition;
  clip: Clip;
  asset: Asset;
}

/**
 * Pure deterministic validator — no side effects, no network.
 * Validates a TrimProposal against the current composition state.
 */
export function validateTrimProposal(
  proposal: TrimProposal,
  ctx: TrimValidationContext,
): TrimValidationResult {
    // 1. Clip exists, matches the selected clip, and belongs to this composition.
  if (proposal.clipId !== ctx.clip.id) {
    return { valid: false, error: `Proposal targets clip "${proposal.clipId}" but selected clip is "${ctx.clip.id}"` };
    }
  if (!ctx.composition.clips.some((c) => c.id === ctx.clip.id)) {
    return { valid: false, error: `Selected clip "${ctx.clip.id}" is no longer present in the composition` };
    }

    // 1b. The clip's source asset must be the asset validated against.
  if (ctx.clip.assetId !== ctx.asset.id) {
    return { valid: false, error: `Clip "${ctx.clip.id}" belongs to asset "${ctx.clip.assetId}", not "${ctx.asset.id}"` };
    }

    // 2. Version check
  if (proposal.expectedVersion !== ctx.composition.version) {
    return {
      valid: false,
      error: `Timeline changed since this proposal was generated (expected version ${proposal.expectedVersion}, current ${ctx.composition.version}). Regenerate the proposal.`,
    };
  }

  // 3. Parse tick values
  let newIn: bigint;
  let newOut: bigint;
  try {
    newIn = BigInt(proposal.newInTicks);
    newOut = BigInt(proposal.newOutTicks);
  } catch {
    return { valid: false, error: 'Proposed tick values are not valid integers' };
  }

  // 4. In must be >= 0
  if (newIn < 0n) {
    return { valid: false, error: 'Proposed in-point cannot be negative' };
  }

  // 5. In must be < Out
  if (newIn >= newOut) {
    return { valid: false, error: 'Proposed in-point must be before out-point (zero-duration trim)' };
  }

  // 6. Out must not exceed asset duration
  let assetDuration: bigint;
  try {
    assetDuration = BigInt(ctx.asset.durationTicks);
  } catch {
    return { valid: false, error: 'Asset duration ticks are invalid' };
  }

  if (newOut > assetDuration) {
    return {
      valid: false,
      error: `Proposed out-point (${proposal.newOutTicks}) exceeds source asset duration (${ctx.asset.durationTicks})`,
    };
  }

  // 7. Reason must be present
  if (!proposal.reason || proposal.reason.trim().length === 0) {
    return { valid: false, error: 'Proposal must include a reason' };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Staleness check (separate from full validation for UI)
// ---------------------------------------------------------------------------

export function isTrimProposalStale(proposal: TrimProposal, currentVersion: number): boolean {
  return proposal.expectedVersion !== currentVersion;
}

// ---------------------------------------------------------------------------
// AI Context Builder (task-specific, narrow)
// ---------------------------------------------------------------------------

export interface TrimAiContext {
  project: { name: string };
  composition: {
    id: string;
    version: number;
    timeBase: { num: number; den: number };
  };
  clip: {
    id: string;
    name: string;
    assetId: string;
    inTicks: string;
    outTicks: string;
    timelineStartTicks: string;
    timelineDurationTicks: string;
  };
  asset: {
    id: string;
    name: string;
    durationTicks: string;
    timeBase: { num: number; den: number };
    fpsNumerator: number;
    fpsDenominator: number;
  };
  instruction: string;
}

/**
 * Build narrow AI context for a trim operation. Only includes
 * the relevant clip, its source asset, and composition version.
 */
export function buildTrimContext(
  projectName: string,
  composition: Composition,
  clip: Clip,
  asset: Asset,
  instruction: string,
): TrimAiContext {
  return {
    project: { name: projectName },
    composition: {
      id: composition.id,
      version: composition.version,
      timeBase: composition.timeBase,
    },
    clip: {
      id: clip.id,
      name: clip.name,
      assetId: clip.assetId,
      inTicks: clip.inTicks,
      outTicks: clip.outTicks,
      timelineStartTicks: clip.timelineStartTicks,
      timelineDurationTicks: clip.timelineDurationTicks,
    },
    asset: {
      id: asset.id,
      name: asset.name,
      durationTicks: asset.durationTicks,
      timeBase: asset.timeBase,
      fpsNumerator: asset.fpsNumerator,
      fpsDenominator: asset.fpsDenominator,
    },
    instruction,
  };
}

// ---------------------------------------------------------------------------
// System prompt for trim proposals
// ---------------------------------------------------------------------------

const TRIM_SYSTEM_PROMPT = `You are a video editing assistant for Cutroom. You generate precise trim proposals for video clips.

Given a clip's current source range (inTicks to outTicks in the asset's timebase) and the user's instruction, return a JSON trim proposal.

Return ONLY valid JSON matching this exact schema:
{
    "clipId": string,
    "clipName": string,
    "newInTicks": string (integer as string),
    "newOutTicks": string (integer as string),
    "expectedVersion": number,
    "reason": string
}

RULES:
- Propose ONE safe trim for the selected clip only.
- clipId must match the provided clip ID exactly. Do not invent clip or asset IDs.
- Use the exact supplied tick values and asset timebase; do not mutate any state.
- expectedVersion must match the provided composition version exactly.
- newInTicks must be >= 0 and < newOutTicks.
- newOutTicks must be <= the asset's durationTicks.
- Clip in/out points live in the source asset's timebase.
- To convert seconds to ticks: seconds * timeBase.den / timeBase.num.
- clipName should be a short, human-readable label for the clip.
- reason must briefly explain what the trim does and why.
- Return only the JSON object. No explanation, no markdown fencing.`;

// ---------------------------------------------------------------------------
// Generate trim proposal
// ---------------------------------------------------------------------------

export type TrimAssistResult =
  | { ok: true; proposal: TrimProposal }
  | { ok: false; error: string; code: string };

/**
 * Generate a structured trim proposal from natural language.
 */
export async function assistTrim(
  context: TrimAiContext,
  config: LocalAiConfig = TRIM_AI_CONFIG,
): Promise<TrimAssistResult> {
  if (!context.instruction.trim()) {
    return { ok: false, error: 'Please describe how you want to trim this clip.', code: 'EMPTY_INPUT' };
  }

  const userMessage = `Clip: ${context.clip.name} (ID: ${context.clip.id})
Source asset: ${context.asset.name}
Asset timebase: ${context.asset.timeBase.num}/${context.asset.timeBase.den}
Asset duration: ${context.asset.durationTicks} ticks
Asset FPS: ${context.asset.fpsNumerator}/${context.asset.fpsDenominator}

Current source range:
  In:  ${context.clip.inTicks} ticks
  Out: ${context.clip.outTicks} ticks

Timeline position: ${context.clip.timelineStartTicks} ticks
Timeline duration: ${context.clip.timelineDurationTicks} ticks

Composition version: ${context.composition.version}

User instruction: ${context.instruction}`;

  try {
    const parsed = await generateStructured<TrimProposal>(
         [
           { role: 'system', content: TRIM_SYSTEM_PROMPT },
           { role: 'user', content: userMessage },
         ],
        (parsed) => validateModelTrimOutput(parsed, context),
       config,
       );

      // Build a fully-formed, typed proposal from authoritative context values.
      // The model output is already validated; re-deriving the apply-critical
      // fields guarantees a malformed value can never reach the apply path.
     const proposal: TrimProposal = {
       clipId: context.clip.id,
       clipName: String(parsed.clipName ?? '').trim() || context.clip.name,
       newInTicks: parsed.newInTicks,
       newOutTicks: parsed.newOutTicks,
       expectedVersion: context.composition.version,
       reason: parsed.reason,
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

function validateModelTrimOutput(parsed: unknown, context: TrimAiContext): string | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return 'Expected a JSON object';
  }

  const obj = parsed as Record<string, unknown>;

    // Schema forbids extra fields — reject unknown keys at the model boundary.
  const ALLOWED_KEYS = new Set([
      'clipId', 'clipName', 'newInTicks', 'newOutTicks', 'expectedVersion', 'reason',
     ]);
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_KEYS.has(key)) return `Unknown field: "${key}"`;
    }

    // Required fields
  if (typeof obj.clipId !== 'string') return 'clipId must be a string';
  if (typeof obj.newInTicks !== 'string') return 'newInTicks must be a string';
  if (typeof obj.newOutTicks !== 'string') return 'newOutTicks must be a string';
  if (typeof obj.expectedVersion !== 'number') return 'expectedVersion must be a number';
  if (typeof obj.reason !== 'string' || obj.reason.length === 0) return 'reason must be a non-empty string';
     // clipName is display-only and optional; if present it must be a string.
  if (obj.clipName !== undefined && typeof obj.clipName !== 'string') return 'clipName must be a string';

  // Clip ID must match context
  if (obj.clipId !== context.clip.id) {
    return `clipId "${obj.clipId}" does not match expected "${context.clip.id}"`;
  }

  // Version must match context
  if (obj.expectedVersion !== context.composition.version) {
    return `expectedVersion ${obj.expectedVersion} does not match context ${context.composition.version}`;
  }

  // Tick values must be parseable as BigInt
  try { BigInt(obj.newInTicks as string); } catch { return 'newInTicks is not a valid integer'; }
  try { BigInt(obj.newOutTicks as string); } catch { return 'newOutTicks is not a valid integer'; }

  const newIn = BigInt(obj.newInTicks as string);
  const newOut = BigInt(obj.newOutTicks as string);

  if (newIn < 0n) return 'newInTicks cannot be negative';
  if (newIn >= newOut) return 'newInTicks must be less than newOutTicks';

  try {
    const assetDur = BigInt(context.asset.durationTicks);
    if (newOut > assetDur) return `newOutTicks exceeds asset duration (${context.asset.durationTicks})`;
  } catch { /* asset duration unparseable — domain validation will catch */ }

  return null;
}
