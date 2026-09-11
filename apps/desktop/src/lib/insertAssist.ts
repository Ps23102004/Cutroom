/**
 * Cutroom AI Insert Assist
 *
 * Generates structured insert proposals from natural-language instructions.
 * Insert = add a source interval from an EXISTING asset to the timeline.
 * Source media files are never modified or moved.
 *
 * Safety chain:
 *   user instruction → local model → InsertProposal → validate → preview → Apply → addClip()
 *
 * Native semantics (verified):
 *   AppContext.addClip() dispatches composition.apply action="add" with
 *   { assetId, sourceInTicks, sourceOutTicks, trackId?, timelineStartTicks? }.
 *   timelineStartTicks defaults to the composition end (append). The native
 *   layer resolves the asset itself, converts source duration into the
 *   composition timebase, and allocates the next track-local sort_order.
 *   No new native operation is introduced here.
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

export const INSERT_AI_CONFIG: LocalAiConfig = { ...TRIM_AI_CONFIG };

// ---------------------------------------------------------------------------
// InsertProposal Schema
// ---------------------------------------------------------------------------

/** Where the clip lands on the target track. Positions are derived from REAL
 * composition clips only — the model never supplies raw timeline coordinates.
 * The native add action places a clip without rippling neighbours, so
 * "beforeClip" is intentionally unsupported (it would always overlap its
 * neighbour); inserts land at the track end or into a real gap. */
export type InsertPlacement =
  | { mode: 'atEnd' }
  | { mode: 'afterClip'; clipId: string };

export interface InsertProposal {
  /** Asset to insert — must match a candidate supplied in the AI context */
  assetId: string;
  /** Display-only asset name for human confirmation */
  assetName: string;
  /** Source in-point in asset-timebase ticks */
  sourceInTicks: string;
  /** Source out-point in asset-timebase ticks */
  sourceOutTicks: string;
  /** Destination track — must exist in the composition */
  targetTrackId: string;
  /** Placement on the target track */
  placement: InsertPlacement;
  /**
   * Composition version this proposal was generated from.
   * Apply must be rejected if current version !== expectedVersion.
   */
  expectedVersion: number;
  /** Human-readable summary of what the insert does and why */
  reason: string;
}

// ---------------------------------------------------------------------------
// Placement resolution (zero mutation — pure functions over real composition)
// ---------------------------------------------------------------------------

export interface ResolvedPlacement {
  timelineStartTicks: string;
  timelineDurationTicks: string;
}

function trackClipsSorted(composition: Composition, trackId: string): Clip[] {
  return composition.clips
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => {
      const aS = BigInt(a.timelineStartTicks), bS = BigInt(b.timelineStartTicks);
      return aS < bS ? -1 : aS > bS ? 1 : 0;
    });
}

/**
 * Convert a source-duration (asset timebase) into composition-timebase ticks.
 * Mirrors the native exact conversion; when the conversion is not exact the
 * result is rounded UP so overlap checks stay conservative.
 */
export function sourceTicksToTimelineTicks(
  sourceTicks: bigint,
  assetTimeBase: { num: number; den: number },
  compositionTimeBase: { num: number; den: number },
): bigint {
  // timeline = source * (ctb.den * stb.num) / (ctb.num * stb.den)
  const numerator = BigInt(Math.abs(compositionTimeBase.den) * Math.abs(assetTimeBase.num));
  const denominator = BigInt(Math.abs(compositionTimeBase.num) * Math.abs(assetTimeBase.den));
  const scaled = sourceTicks * numerator;
  const q = scaled / denominator;
  return scaled % denominator === 0n ? q : q + 1n;
}

/**
 * Resolve a placement against the CURRENT composition. Returns the concrete
 * timeline start for the addClip call, or an error. Zero mutation.
 */
export function resolveInsertPlacement(
  proposal: Pick<InsertProposal, 'placement' | 'targetTrackId' | 'sourceInTicks' | 'sourceOutTicks'>,
  assetTimeBase: { num: number; den: number },
  composition: Composition,
): { ok: true; resolved: ResolvedPlacement } | { ok: false; error: string } {
  const clips = trackClipsSorted(composition, proposal.targetTrackId);

  let start: bigint;
  if (proposal.placement.mode === 'atEnd') {
    // Append after the last clip on THIS track (empty track → 0).
    start = clips.reduce((end, c) => {
      const clipEnd = BigInt(c.timelineStartTicks) + BigInt(c.timelineDurationTicks);
      return clipEnd > end ? clipEnd : end;
    }, 0n);
  } else {
    if (proposal.placement.mode !== 'afterClip') {
      return { ok: false, error: `Unknown placement mode` };
    }
    const placement = proposal.placement;
    const neighbor = clips.find((c) => c.id === placement.clipId);
    if (!neighbor) {
      return { ok: false, error: `Placement clip "${placement.clipId}" was not found on the target track` };
    }
    start = BigInt(neighbor.timelineStartTicks) + BigInt(neighbor.timelineDurationTicks);
  }
  const sourceIn = BigInt(proposal.sourceInTicks);
  const sourceOut = BigInt(proposal.sourceOutTicks);
  const duration = sourceTicksToTimelineTicks(sourceOut - sourceIn, assetTimeBase, composition.timeBase);

  // Overlap guard: the native add action places the clip without shifting
  // neighbours, so an overlapping insert would corrupt the track layout.
  const end = start + duration;
  for (const c of clips) {
    const cStart = BigInt(c.timelineStartTicks);
    const cEnd = cStart + BigInt(c.timelineDurationTicks);
    if (start < cEnd && cStart < end) {
      return { ok: false, error: `Insert would overlap clip "${c.name}" on the target track` };
    }
  }

  return {
    ok: true,
    resolved: {
      timelineStartTicks: start.toString(),
      timelineDurationTicks: duration.toString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type InsertValidationResult =
  | { valid: true }
  | { valid: false; error: string };

export interface InsertValidationContext {
  composition: Composition;
  /** The exact candidate assets the AI was allowed to reference */
  candidateAssets: Asset[];
}

function looksLikeFilesystemPath(value: string): boolean {
  return /(^|[\s"'`(=])(\/|~\/|\.{1,2}\/|[A-Za-z]:\\)/.test(value);
}

export function validateInsertProposal(
  proposal: InsertProposal,
  ctx: InsertValidationContext,
): InsertValidationResult {
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

  const asset = ctx.candidateAssets.find((a) => a.id === proposal.assetId);
  if (!asset) {
    return { valid: false, error: `Asset "${proposal.assetId}" is not one of the available assets` };
  }
  if (proposal.assetName && proposal.assetName !== asset.name) {
    return { valid: false, error: `Asset name "${proposal.assetName}" does not match asset "${asset.name}"` };
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

  if (!ctx.composition.tracks.some((t) => t.id === proposal.targetTrackId)) {
    return { valid: false, error: `Target track "${proposal.targetTrackId}" does not exist in the composition` };
  }

  if (proposal.placement.mode === 'afterClip') {
    if (typeof proposal.placement.clipId !== 'string' || proposal.placement.clipId.length === 0) {
      return { valid: false, error: 'Placement must reference a real clip ID' };
    }
  } else if (proposal.placement.mode !== 'atEnd') {
    return { valid: false, error: `Unknown placement mode` };
  }

  const placementCheck = resolveInsertPlacement(proposal, asset.timeBase, ctx.composition);
  if (!placementCheck.ok) {
    return { valid: false, error: placementCheck.error };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------

export function isInsertProposalStale(proposal: InsertProposal, currentVersion: number): boolean {
  return proposal.expectedVersion !== currentVersion;
}

// ---------------------------------------------------------------------------
// AI Context Builder — narrow: project, composition, tracks, candidates, instruction
// ---------------------------------------------------------------------------

export interface InsertAiContext {
  project: { name: string };
  composition: {
    id: string;
    version: number;
    timeBase: { num: number; den: number };
  };
  tracks: Array<{
    id: string;
    label: string;
    kind: string;
  }>;
  /** Clips grouped per track for neighbourhood context (no paths) */
  trackClips: Record<string, Array<{
    id: string;
    name: string;
    timelineStartTicks: string;
    timelineDurationTicks: string;
  }>>;
  /** Candidate assets — the ONLY assets the model may reference (no paths) */
  candidateAssets: Array<{
    id: string;
    name: string;
    durationTicks: string;
    timeBase: { num: number; den: number };
  }>;
  instruction: string;
}

export function buildInsertContext(
  projectName: string,
  composition: Composition,
  candidateAssets: Asset[],
  instruction: string,
): InsertAiContext {
  const trackClips: InsertAiContext['trackClips'] = {};
  for (const track of composition.tracks) {
    trackClips[track.id] = trackClipsSorted(composition, track.id).map((c) => ({
      id: c.id, name: c.name,
      timelineStartTicks: c.timelineStartTicks,
      timelineDurationTicks: c.timelineDurationTicks,
    }));
  }

  return {
    project: { name: projectName },
    composition: { id: composition.id, version: composition.version, timeBase: composition.timeBase },
    tracks: composition.tracks.map((t) => ({ id: t.id, label: t.label, kind: t.kind })),
    trackClips,
    candidateAssets: candidateAssets.map((a) => ({
      id: a.id, name: a.name, durationTicks: a.durationTicks, timeBase: a.timeBase,
    })),
    instruction,
  };
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const INSERT_SYSTEM_PROMPT = `You are a video editing assistant for Cutroom. You generate precise clip insertion proposals.

Given the timeline state and the user's instruction, propose ONE clip to insert from the available assets.

Return ONLY valid JSON matching this exact schema:
{
    "assetId": string,
    "assetName": string,
    "sourceInTicks": string,
    "sourceOutTicks": string,
    "targetTrackId": string,
    "placement": { "mode": "atEnd" } | { "mode": "afterClip", "clipId": string },
    "reason": string
}

RULES:
- assetId must be one of the provided candidate asset IDs. Never invent asset IDs.
- sourceInTicks/sourceOutTicks are integer ticks in the ASSET timebase. 0 <= in < out <= asset duration ticks.
- targetTrackId must be one of the provided track IDs. Never invent track IDs.
- placement modes: "atEnd" appends after the last clip on the target track; "afterClip" places the clip right after an EXISTING clip ID on the target track (it must fit in the following gap). Never invent clip IDs.
- reason must briefly explain what is inserted and why.
- Do not include filesystem paths, extra fields, or markdown. Return only the JSON object.`;

// ---------------------------------------------------------------------------
// Generate insert proposal
// ---------------------------------------------------------------------------

export type InsertAssistResult =
  | { ok: true; proposal: InsertProposal }
  | { ok: false; error: string; code: string };

export async function assistInsert(
  context: InsertAiContext,
  config: LocalAiConfig = INSERT_AI_CONFIG,
): Promise<InsertAssistResult> {
  if (!context.instruction.trim()) {
    return { ok: false, error: 'Describe what you want to insert into the timeline.', code: 'EMPTY_INPUT' };
  }
  if (context.candidateAssets.length === 0) {
    return { ok: false, error: 'Import a source asset before requesting an insert.', code: 'NO_ASSETS' };
  }

  const assetList = context.candidateAssets
    .map((a, i) => `  ${i + 1}. "${a.name}" (ID: ${a.id}) — duration ${a.durationTicks} ticks @ ${a.timeBase.num}/${a.timeBase.den}`)
    .join('\n');
  const trackList = context.tracks
    .map((t) => {
      const clips = context.trackClips[t.id] ?? [];
      const clipLines = clips.length === 0
        ? '    (empty track)'
        : clips.map((c) => `    - "${c.name}" (ID: ${c.id}) start ${c.timelineStartTicks} dur ${c.timelineDurationTicks}`).join('\n');
      return `  Track "${t.label}" (${t.kind}, ID: ${t.id}):\n${clipLines}`;
    })
    .join('\n');

  const userMessage = `Available assets (the ONLY assets you may reference):
${assetList}

Timeline tracks:
${trackList}

Composition version: ${context.composition.version}

User instruction: ${context.instruction}`;

  try {
    const parsed = await generateStructured<InsertProposal>(
      [
        { role: 'system', content: INSERT_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      (p) => validateModelInsertOutput(p, context),
      config,
    );

    // Bind identity/version from the context after the model output passed
    // strict validation — the model cannot set its own expectedVersion.
    const proposal: InsertProposal = {
      ...(parsed as InsertProposal),
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

function validatePlacement(parsed: unknown): string | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return 'placement must be an object';
  }
  const p = parsed as Record<string, unknown>;
  const mode = p.mode;
  if (mode === 'atEnd') {
    if (Object.keys(p).length !== 1) return 'placement atEnd takes no extra fields';
    return null;
  }
  if (mode === 'afterClip') {
    if (Object.keys(p).length !== 2) return `placement ${mode} requires exactly mode and clipId`;
    if (typeof p.clipId !== 'string' || p.clipId.length === 0) return 'placement clipId must be a non-empty string';
    return null;
  }
  return `Unknown placement mode: ${String(mode)}`;
}

function validateModelInsertOutput(parsed: unknown, context: InsertAiContext): string | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'Expected a JSON object';
  const obj = parsed as Record<string, unknown>;

  const ALLOWED = new Set([
    'assetId', 'assetName', 'sourceInTicks', 'sourceOutTicks',
    'targetTrackId', 'placement', 'expectedVersion', 'reason',
  ]);
  for (const key of Object.keys(obj)) {
    if (!ALLOWED.has(key)) return `Unknown field: "${key}"`;
  }
  if (typeof obj.assetId !== 'string') return 'assetId must be a string';
  if (typeof obj.assetName !== 'string') return 'assetName must be a string';
  if (typeof obj.sourceInTicks !== 'string' || !/^\d+$/.test(obj.sourceInTicks)) return 'sourceInTicks must be a non-negative integer tick string';
  if (typeof obj.sourceOutTicks !== 'string' || !/^\d+$/.test(obj.sourceOutTicks)) return 'sourceOutTicks must be a non-negative integer tick string';
  if (typeof obj.targetTrackId !== 'string') return 'targetTrackId must be a string';
  if (typeof obj.reason !== 'string' || obj.reason.length === 0) return 'reason must be a non-empty string';
  if (obj.expectedVersion !== undefined && obj.expectedVersion !== context.composition.version) {
    return `expectedVersion ${obj.expectedVersion} does not match context ${context.composition.version}`;
  }

  const asset = context.candidateAssets.find((a) => a.id === obj.assetId);
  if (!asset) return `assetId "${obj.assetId}" is not one of the provided candidate assets`;
  if (obj.assetName !== asset.name) return `assetName "${obj.assetName}" does not match candidate asset "${asset.name}"`;
  if (!context.tracks.some((t) => t.id === obj.targetTrackId)) {
    return `targetTrackId "${obj.targetTrackId}" is not one of the provided tracks`;
  }
  if (BigInt(obj.sourceOutTicks) > BigInt(asset.durationTicks)) {
    return 'sourceOutTicks exceeds the asset duration';
  }
  if (BigInt(obj.sourceInTicks) >= BigInt(obj.sourceOutTicks)) {
    return 'sourceInTicks must be less than sourceOutTicks';
  }

  const placementError = validatePlacement(obj.placement);
  if (placementError) return placementError;

  // The model may only reference clips supplied in the context, and only on
  // the target track it selected.
  if (obj.placement && typeof obj.placement === 'object' && !Array.isArray(obj.placement)) {
    const placement = obj.placement as { mode?: unknown; clipId?: unknown };
    if (placement.mode === 'afterClip') {
      const neighbors = context.trackClips[obj.targetTrackId] ?? [];
      if (!neighbors.some((c) => c.id === placement.clipId)) {
        return `placement clipId "${String(placement.clipId)}" is not a provided clip on the target track`;
      }
    }
  }

  return null;
}
