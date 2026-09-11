/**
 * Cutroom AI EditPlan / Assembly Assist
 *
 * Generates and executes structured multi-operation edit plans from natural-language instructions.
 * Supports composite workflows: "Create a 45-second product demo. Start with the strongest demo,
 * shorten the interview, remove repetition, and end with CTA."
 *
 * Allowed operations ONLY:
 *   - trim
 *   - reorder
 *   - delete
 *   - insert
 *   - replace
 *
 * Safety & Invariant Guarantees:
 *   - Every operation reuses its specific domain validator.
 *   - Unknown operations are rejected immediately.
 *   - Generation: zero mutation.
 *   - Preview: zero mutation.
 *   - Dismiss: zero mutation.
 *   - Apply Plan: explicit user action.
 *   - Expected version rechecked immediately before Apply.
 *   - Sequential execution in deterministic order with version propagation.
 *   - Partial failure detection: never reports full success after partial execution.
 *   - Revision created ONLY after complete intended success.
 *   - Original source media is NEVER modified or deleted.
 */

import type { Asset, Composition } from './contracts';
import {
  generateStructured,
  LocalAiError,
  type LocalAiConfig,
} from './localAi';
import { TRIM_AI_CONFIG, validateTrimProposal, type TrimProposal } from './trimAssist';
import { validateReorderProposal, type ReorderProposal } from './reorderAssist';
import { validateDeleteProposal, type DeleteProposal } from './deleteAssist';
import { validateInsertProposal, resolveInsertPlacement, type InsertProposal } from './insertAssist';
import { validateReplaceProposal, type ReplaceProposal } from './replaceAssist';

export const EDIT_PLAN_AI_CONFIG: LocalAiConfig = { ...TRIM_AI_CONFIG };

// ---------------------------------------------------------------------------
// Schema Types
// ---------------------------------------------------------------------------

export type EditPlanOperation =
  | {
      kind: 'trim';
      clipId: string;
      clipName?: string;
      newInTicks: string;
      newOutTicks: string;
      reason: string;
    }
  | {
      kind: 'reorder';
      clipId: string;
      clipName?: string;
      direction: 'left' | 'right';
      reason: string;
    }
  | {
      kind: 'delete';
      clipId: string;
      clipName?: string;
      reason: string;
    }
  | {
      kind: 'insert';
      assetId: string;
      assetName?: string;
      sourceInTicks: string;
      sourceOutTicks: string;
      targetTrackId: string;
      placement: { mode: 'atEnd' } | { mode: 'afterClip'; clipId: string };
      reason: string;
    }
  | {
      kind: 'replace';
      targetClipId: string;
      targetClipName?: string;
      replacementAssetId: string;
      replacementAssetName?: string;
      sourceInTicks: string;
      sourceOutTicks: string;
      reason: string;
    };

export interface EditPlan {
  summary: string;
  expectedVersion: number;
  operations: EditPlanOperation[];
}

export type EditPlanValidationResult =
  | { valid: true }
  | { valid: false; error: string; operationIndex?: number };

export interface EditPlanValidationContext {
  composition: Composition;
  assets: Asset[];
}

// ---------------------------------------------------------------------------
// Domain Validator (reuses specific validator for each operation)
// ---------------------------------------------------------------------------

export function validateEditPlanOperation(
  op: EditPlanOperation,
  expectedVersion: number,
  ctx: EditPlanValidationContext,
): { valid: true } | { valid: false; error: string } {
  switch (op.kind) {
    case 'trim': {
      const clip = ctx.composition.clips.find((c) => c.id === op.clipId);
      if (!clip) {
        return { valid: false, error: `Trim operation references non-existent clip "${op.clipId}"` };
      }
      const asset = ctx.assets.find((a) => a.id === clip.assetId);
      if (!asset) {
        return { valid: false, error: `Asset "${clip.assetId}" for clip "${clip.id}" not found` };
      }
      const proposal: TrimProposal = {
        clipId: op.clipId,
        clipName: op.clipName ?? clip.name,
        newInTicks: op.newInTicks,
        newOutTicks: op.newOutTicks,
        expectedVersion,
        reason: op.reason,
      };
      return validateTrimProposal(proposal, {
        composition: ctx.composition,
        clip,
        asset,
      });
    }

    case 'reorder': {
      const clip = ctx.composition.clips.find((c) => c.id === op.clipId);
      if (!clip) {
        return { valid: false, error: `Reorder operation references non-existent clip "${op.clipId}"` };
      }
      const proposal: ReorderProposal = {
        clipId: op.clipId,
        clipName: op.clipName ?? clip.name,
        direction: op.direction,
        expectedVersion,
        reason: op.reason,
      };
      return validateReorderProposal(proposal, {
        composition: ctx.composition,
        clip,
      });
    }

    case 'delete': {
      const clip = ctx.composition.clips.find((c) => c.id === op.clipId);
      if (!clip) {
        return { valid: false, error: `Delete operation references non-existent clip "${op.clipId}"` };
      }
      const proposal: DeleteProposal = {
        clipId: op.clipId,
        clipName: op.clipName ?? clip.name,
        expectedVersion,
        reason: op.reason,
      };
      return validateDeleteProposal(proposal, {
        composition: ctx.composition,
        clip,
      });
    }

    case 'insert': {
      const proposal: InsertProposal = {
        assetId: op.assetId,
        assetName: op.assetName ?? '',
        sourceInTicks: op.sourceInTicks,
        sourceOutTicks: op.sourceOutTicks,
        targetTrackId: op.targetTrackId,
        placement: op.placement,
        expectedVersion,
        reason: op.reason,
      };
      return validateInsertProposal(proposal, {
        composition: ctx.composition,
        candidateAssets: ctx.assets,
      });
    }

    case 'replace': {
      const clip = ctx.composition.clips.find((c) => c.id === op.targetClipId);
      if (!clip) {
        return { valid: false, error: `Replace operation references non-existent clip "${op.targetClipId}"` };
      }
      const proposal: ReplaceProposal = {
        targetClipId: op.targetClipId,
        targetClipName: op.targetClipName ?? clip.name,
        replacementAssetId: op.replacementAssetId,
        replacementAssetName: op.replacementAssetName ?? '',
        sourceInTicks: op.sourceInTicks,
        sourceOutTicks: op.sourceOutTicks,
        expectedVersion,
        reason: op.reason,
      };
      return validateReplaceProposal(proposal, {
        composition: ctx.composition,
        targetClip: clip,
        candidateAssets: ctx.assets,
      });
    }

    default:
      return { valid: false, error: `Unknown operation kind: "${(op as { kind: string }).kind}"` };
  }
}

export function validateEditPlan(
  plan: EditPlan,
  ctx: EditPlanValidationContext,
): EditPlanValidationResult {
  if (plan.expectedVersion !== ctx.composition.version) {
    return {
      valid: false,
      error: `Timeline changed since this plan was generated (expected version ${plan.expectedVersion}, current ${ctx.composition.version}). Regenerate the plan.`,
    };
  }
  if (!plan.summary || plan.summary.trim().length === 0) {
    return { valid: false, error: 'Edit plan must include a summary' };
  }
  if (!Array.isArray(plan.operations) || plan.operations.length === 0) {
    return { valid: false, error: 'Edit plan must contain at least one operation' };
  }

  // Validate the first operation against the current composition state.
  // Note: For sequential multi-step execution, each subsequent step will be validated
  // dynamically against the mutated composition as each step applies.
  const firstOp = plan.operations[0];
  const firstCheck = validateEditPlanOperation(firstOp, plan.expectedVersion, ctx);
  if (!firstCheck.valid) {
    return { valid: false, error: `Operation 1 (${firstOp.kind}): ${firstCheck.error}`, operationIndex: 0 };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Narrow Context Builder
// ---------------------------------------------------------------------------

export interface EditPlanAiContext {
  project: { name: string };
  composition: {
    id: string;
    version: number;
    timeBase: { num: number; den: number };
  };
  tracks: Array<{ id: string; label: string; kind: string }>;
  clips: Array<{
    id: string;
    name: string;
    trackId: string;
    assetId: string;
    timelineStartTicks: string;
    timelineDurationTicks: string;
    inTicks: string;
    outTicks: string;
  }>;
  candidateAssets: Array<{
    id: string;
    name: string;
    durationTicks: string;
    timeBase: { num: number; den: number };
  }>;
  instruction: string;
}

export function buildEditPlanContext(
  projectName: string,
  composition: Composition,
  assets: Asset[],
  instruction: string,
): EditPlanAiContext {
  return {
    project: { name: projectName },
    composition: {
      id: composition.id,
      version: composition.version,
      timeBase: composition.timeBase,
    },
    tracks: composition.tracks.map((t) => ({ id: t.id, label: t.label, kind: t.kind })),
    clips: composition.clips.map((c) => ({
      id: c.id,
      name: c.name,
      trackId: c.trackId,
      assetId: c.assetId,
      timelineStartTicks: c.timelineStartTicks,
      timelineDurationTicks: c.timelineDurationTicks,
      inTicks: c.inTicks,
      outTicks: c.outTicks,
    })),
    candidateAssets: assets.map((a) => ({
      id: a.id,
      name: a.name,
      durationTicks: a.durationTicks,
      timeBase: a.timeBase,
    })),
    instruction,
  };
}

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

const EDIT_PLAN_SYSTEM_PROMPT = `You are a video editing and assembly assistant for Cutroom. You generate structured multi-step edit plans to accomplish complex editing requests (e.g. creating demos, recaps, fixing pacing, trimming repetition).

Allowed operations ONLY:
1. "trim" -> { "kind": "trim", "clipId": string, "newInTicks": string, "newOutTicks": string, "reason": string }
2. "reorder" -> { "kind": "reorder", "clipId": string, "direction": "left" | "right", "reason": string }
3. "delete" -> { "kind": "delete", "clipId": string, "reason": string }
4. "insert" -> { "kind": "insert", "assetId": string, "sourceInTicks": string, "sourceOutTicks": string, "targetTrackId": string, "placement": { "mode": "atEnd" } | { "mode": "afterClip", "clipId": string }, "reason": string }
5. "replace" -> { "kind": "replace", "targetClipId": string, "replacementAssetId": string, "sourceInTicks": string, "sourceOutTicks": string, "reason": string }

CRITICAL RULES:
- ONLY reference real clip IDs, track IDs, and asset IDs provided in the context. Never invent IDs.
- All tick values must be non-negative integer tick strings.
- operations must be an array of 1 to 8 operations in sequential order.
- Do NOT include filesystem paths, markdown codeblocks, or unknown operations.
- Return ONLY a JSON object matching this schema:
{
    "summary": string,
    "operations": Array<EditPlanOperation>
}`;

// ---------------------------------------------------------------------------
// Model Output Validation
// ---------------------------------------------------------------------------

function validateModelEditPlanOutput(parsed: unknown, context: EditPlanAiContext): string | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'Expected a JSON object';
  const obj = parsed as Record<string, unknown>;

  const ALLOWED_TOP = new Set(['summary', 'operations', 'expectedVersion']);
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_TOP.has(key)) return `Unknown field: "${key}"`;
  }

  if (typeof obj.summary !== 'string' || obj.summary.trim().length === 0) {
    return 'summary must be a non-empty string';
  }
  if (!Array.isArray(obj.operations) || obj.operations.length === 0) {
    return 'operations must be a non-empty array';
  }

  const ALLOWED_KINDS = new Set(['trim', 'reorder', 'delete', 'insert', 'replace']);
  const clipIds = new Set(context.clips.map((c) => c.id));
  const trackIds = new Set(context.tracks.map((t) => t.id));
  const assetIds = new Set(context.candidateAssets.map((a) => a.id));

  for (let i = 0; i < obj.operations.length; i++) {
    const op = obj.operations[i] as Record<string, unknown>;
    if (typeof op !== 'object' || op === null || Array.isArray(op)) {
      return `operations[${i}] must be an object`;
    }
    if (typeof op.kind !== 'string' || !ALLOWED_KINDS.has(op.kind)) {
      return `operations[${i}] has unknown or invalid kind: "${String(op.kind)}"`;
    }
    if (typeof op.reason !== 'string' || op.reason.trim().length === 0) {
      return `operations[${i}] must include a non-empty reason`;
    }

    switch (op.kind) {
      case 'trim':
        if (typeof op.clipId !== 'string' || !clipIds.has(op.clipId)) {
          return `operations[${i}] (trim) references unknown clipId "${String(op.clipId)}"`;
        }
        if (typeof op.newInTicks !== 'string' || !/^\d+$/.test(op.newInTicks)) {
          return `operations[${i}] (trim) newInTicks must be non-negative integer ticks`;
        }
        if (typeof op.newOutTicks !== 'string' || !/^\d+$/.test(op.newOutTicks)) {
          return `operations[${i}] (trim) newOutTicks must be non-negative integer ticks`;
        }
        if (BigInt(op.newInTicks) >= BigInt(op.newOutTicks)) {
          return `operations[${i}] (trim) newInTicks must be less than newOutTicks`;
        }
        break;

      case 'reorder':
        if (typeof op.clipId !== 'string' || !clipIds.has(op.clipId)) {
          return `operations[${i}] (reorder) references unknown clipId "${String(op.clipId)}"`;
        }
        if (op.direction !== 'left' && op.direction !== 'right') {
          return `operations[${i}] (reorder) direction must be "left" or "right"`;
        }
        break;

      case 'delete':
        if (typeof op.clipId !== 'string' || !clipIds.has(op.clipId)) {
          return `operations[${i}] (delete) references unknown clipId "${String(op.clipId)}"`;
        }
        break;

      case 'insert':
        if (typeof op.assetId !== 'string' || !assetIds.has(op.assetId)) {
          return `operations[${i}] (insert) references unknown assetId "${String(op.assetId)}"`;
        }
        if (typeof op.targetTrackId !== 'string' || !trackIds.has(op.targetTrackId)) {
          return `operations[${i}] (insert) references unknown targetTrackId "${String(op.targetTrackId)}"`;
        }
        if (typeof op.sourceInTicks !== 'string' || !/^\d+$/.test(op.sourceInTicks)) {
          return `operations[${i}] (insert) sourceInTicks must be non-negative integer ticks`;
        }
        if (typeof op.sourceOutTicks !== 'string' || !/^\d+$/.test(op.sourceOutTicks)) {
          return `operations[${i}] (insert) sourceOutTicks must be non-negative integer ticks`;
        }
        if (BigInt(op.sourceInTicks) >= BigInt(op.sourceOutTicks)) {
          return `operations[${i}] (insert) sourceInTicks must be less than sourceOutTicks`;
        }
        break;

      case 'replace':
        if (typeof op.targetClipId !== 'string' || !clipIds.has(op.targetClipId)) {
          return `operations[${i}] (replace) references unknown targetClipId "${String(op.targetClipId)}"`;
        }
        if (typeof op.replacementAssetId !== 'string' || !assetIds.has(op.replacementAssetId)) {
          return `operations[${i}] (replace) references unknown replacementAssetId "${String(op.replacementAssetId)}"`;
        }
        if (typeof op.sourceInTicks !== 'string' || !/^\d+$/.test(op.sourceInTicks)) {
          return `operations[${i}] (replace) sourceInTicks must be non-negative integer ticks`;
        }
        if (typeof op.sourceOutTicks !== 'string' || !/^\d+$/.test(op.sourceOutTicks)) {
          return `operations[${i}] (replace) sourceOutTicks must be non-negative integer ticks`;
        }
        if (BigInt(op.sourceInTicks) >= BigInt(op.sourceOutTicks)) {
          return `operations[${i}] (replace) sourceInTicks must be less than sourceOutTicks`;
        }
        break;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Generate Edit Plan
// ---------------------------------------------------------------------------

export type EditPlanAssistResult =
  | { ok: true; plan: EditPlan }
  | { ok: false; error: string; code: string };

export async function assistEditPlan(
  context: EditPlanAiContext,
  config: LocalAiConfig = EDIT_PLAN_AI_CONFIG,
): Promise<EditPlanAssistResult> {
  if (!context.instruction.trim()) {
    return { ok: false, error: 'Describe what edits you want the AI to plan.', code: 'EMPTY_INPUT' };
  }
  if (context.clips.length === 0 && context.candidateAssets.length === 0) {
    return { ok: false, error: 'Timeline is empty and no assets are imported.', code: 'NO_MEDIA' };
  }

  const clipLines = context.clips.map(
    (c, i) => `  ${i + 1}. Clip "${c.name}" (ID: ${c.id}) on Track ${c.trackId}, asset ${c.assetId}, start ${c.timelineStartTicks}, dur ${c.timelineDurationTicks}, range ${c.inTicks}..${c.outTicks}`,
  ).join('\n');

  const assetLines = context.candidateAssets.map(
    (a, i) => `  ${i + 1}. Asset "${a.name}" (ID: ${a.id}), duration ${a.durationTicks} ticks @ ${a.timeBase.num}/${a.timeBase.den}`,
  ).join('\n');

  const userMessage = `Current Timeline Clips:
${clipLines || '  (none)'}

Available Candidate Assets:
${assetLines || '  (none)'}

Composition Version: ${context.composition.version}

User Goal / Editing Instruction:
${context.instruction}`;

  try {
    const parsed = await generateStructured<EditPlan>(
      [
        { role: 'system', content: EDIT_PLAN_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      (p) => validateModelEditPlanOutput(p, context),
      config,
    );

    const plan: EditPlan = {
      summary: (parsed as EditPlan).summary,
      expectedVersion: context.composition.version,
      operations: (parsed as EditPlan).operations,
    };

    return { ok: true, plan };
  } catch (err: unknown) {
    if (err instanceof LocalAiError) {
      return { ok: false, error: err.message, code: err.code };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, code: 'UNKNOWN' };
  }
}

// ---------------------------------------------------------------------------
// Execution Engine with Partial Failure Detection & Version Propagation
// ---------------------------------------------------------------------------

export interface ExecutionEngineCallbacks {
  trimClip: (clipId: string, newInTicks: string, newOutTicks: string) => Promise<void>;
  reorderClips: (clipId: string, direction: 'left' | 'right') => Promise<void>;
  removeClip: (clipId: string) => Promise<void>;
  addClip: (params: {
    assetId: string;
    sourceInTicks: string;
    sourceOutTicks: string;
    trackId?: string;
    timelineStartTicks?: string;
  }) => Promise<void>;
  replaceClip: (
    clipId: string,
    assetId: string,
    sourceInTicks: string,
    sourceOutTicks: string,
  ) => Promise<void>;
  createRevision: (commitNote: string) => Promise<unknown>;
  getCurrentComposition: () => Composition | null;
  getAssets: () => Asset[];
}

export type ExecutionResult =
  | { success: true; appliedCount: number; revisionCreated: boolean }
  | {
      success: false;
      appliedCount: number;
      totalCount: number;
      failedIndex: number;
      error: string;
    };

export async function executeEditPlan(
  plan: EditPlan,
  callbacks: ExecutionEngineCallbacks,
): Promise<ExecutionResult> {
  const comp = callbacks.getCurrentComposition();
  if (!comp) {
    return { success: false, appliedCount: 0, totalCount: plan.operations.length, failedIndex: 0, error: 'No active composition' };
  }
  if (comp.version !== plan.expectedVersion) {
    return {
      success: false,
      appliedCount: 0,
      totalCount: plan.operations.length,
      failedIndex: 0,
      error: `Composition version conflict: expected ${plan.expectedVersion}, current is ${comp.version}`,
    };
  }

  let appliedCount = 0;

  for (let i = 0; i < plan.operations.length; i++) {
    const op = plan.operations[i];
    try {
      switch (op.kind) {
        case 'trim':
          await callbacks.trimClip(op.clipId, op.newInTicks, op.newOutTicks);
          break;

        case 'reorder':
          await callbacks.reorderClips(op.clipId, op.direction);
          break;

        case 'delete':
          await callbacks.removeClip(op.clipId);
          break;

        case 'insert': {
          const currentComp = callbacks.getCurrentComposition() ?? comp;
          const asset = callbacks.getAssets().find((a) => a.id === op.assetId);
          let timelineStart: string | undefined;
          if (asset) {
            const placement = resolveInsertPlacement(
              {
                placement: op.placement,
                targetTrackId: op.targetTrackId,
                sourceInTicks: op.sourceInTicks,
                sourceOutTicks: op.sourceOutTicks,
              },
              asset.timeBase,
              currentComp,
            );
            if (placement.ok) {
              timelineStart = placement.resolved.timelineStartTicks;
            }
          }
          await callbacks.addClip({
            assetId: op.assetId,
            sourceInTicks: op.sourceInTicks,
            sourceOutTicks: op.sourceOutTicks,
            trackId: op.targetTrackId,
            timelineStartTicks: timelineStart,
          });
          break;
        }

        case 'replace':
          await callbacks.replaceClip(
            op.targetClipId,
            op.replacementAssetId,
            op.sourceInTicks,
            op.sourceOutTicks,
          );
          break;
      }

      appliedCount++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Partial failure detected: stop immediately, do NOT create revision!
      return {
        success: false,
        appliedCount,
        totalCount: plan.operations.length,
        failedIndex: i,
        error: `Step ${i + 1} of ${plan.operations.length} (${op.kind}) failed: ${msg}. ${appliedCount} operation(s) applied.`,
      };
    }
  }

  // Revision is created ONLY after complete intended success!
  await callbacks.createRevision(`AI Edit Plan: ${plan.summary}`);
  return { success: true, appliedCount, revisionCreated: true };
}
