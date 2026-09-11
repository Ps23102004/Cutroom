/**
 * Cutroom Smart Assembly
 *
 * Synthesizes Project Brief + Transcripts + Media Moments + Current Timeline
 * into an authoritative, validated multi-step EditPlan.
 *
 * Strict Identity & Range Invariants:
 *   - AI may reference ONLY real asset IDs present in the candidate assets.
 *   - AI may reference ONLY real clip IDs present in the composition.
 *   - Source ranges must satisfy 0 <= in < out <= asset.durationTicks.
 *   - Hallucinated IDs or out-of-bound ranges are REJECTED immediately.
 *   - Zero mutation on generation or preview.
 *   - Revision created ONLY after 100% complete execution.
 *   - Original source media is NEVER modified.
 */

import type { Asset, Composition, ProjectBrief, MediaUnderstandingMetadata } from './contracts';
import {
  generateStructured,
  LocalAiError,
  type LocalAiConfig,
} from './localAi';
import { EDIT_PLAN_AI_CONFIG, type EditPlan } from './editPlanAssist';

export interface SmartAssemblyContext {
  brief: {
    goal: string;
    audience: string;
    targetDurationSeconds: number;
    tone: string;
    cta: string;
  };
  composition: {
    id: string;
    version: number;
    timeBase: { num: number; den: number };
  };
  clips: Array<{
    id: string;
    name: string;
    assetId: string;
    timelineStartTicks: string;
    timelineDurationTicks: string;
    inTicks: string;
    outTicks: string;
  }>;
  availableMoments: Array<{
    assetId: string;
    assetName: string;
    label: string;
    category: string;
    startTicks: string;
    endTicks: string;
    summary: string;
  }>;
  candidateAssets: Array<{
    id: string;
    name: string;
    durationTicks: string;
    timeBase: { num: number; den: number };
  }>;
  instruction: string;
}

export function buildSmartAssemblyContext(
  brief: ProjectBrief,
  composition: Composition,
  assets: Asset[],
  metadataMap: Map<string, MediaUnderstandingMetadata>,
  instruction: string,
): SmartAssemblyContext {
  const availableMoments: SmartAssemblyContext['availableMoments'] = [];

  for (const asset of assets) {
    const meta = metadataMap.get(asset.id);
    if (meta && meta.moments.length > 0) {
      for (const m of meta.moments) {
        availableMoments.push({
          assetId: asset.id,
          assetName: asset.name,
          label: m.label,
          category: m.category,
          startTicks: m.startTicks,
          endTicks: m.endTicks,
          summary: m.summary,
        });
      }
    }
  }

  return {
    brief: {
      goal: brief.goal,
      audience: brief.audience,
      targetDurationSeconds: brief.targetDurationSeconds,
      tone: brief.tone,
      cta: brief.cta,
    },
    composition: {
      id: composition.id,
      version: composition.version,
      timeBase: composition.timeBase,
    },
    clips: composition.clips.map((c) => ({
      id: c.id,
      name: c.name,
      assetId: c.assetId,
      timelineStartTicks: c.timelineStartTicks,
      timelineDurationTicks: c.timelineDurationTicks,
      inTicks: c.inTicks,
      outTicks: c.outTicks,
    })),
    availableMoments,
    candidateAssets: assets.map((a) => ({
      id: a.id,
      name: a.name,
      durationTicks: a.durationTicks,
      timeBase: a.timeBase,
    })),
    instruction,
  };
}

const SMART_ASSEMBLY_PROMPT = `You are an expert video editor performing Smart Assembly for Cutroom.
You analyze the Project Brief (goal, audience, target duration, tone, CTA), media understanding moments, and the current timeline, then generate a multi-step EditPlan.

CRITICAL RULES:
- Reference ONLY real asset IDs and clip IDs provided. Never invent IDs.
- Source ticks must be valid integer strings within the asset's duration.
- Only use allowed operation kinds: "trim", "reorder", "delete", "insert", "replace".
- Do not output filesystem paths or markdown. Return ONLY valid JSON:
{
    "summary": string,
    "operations": Array<EditPlanOperation>
}`;

export type SmartAssemblyResult =
  | { ok: true; plan: EditPlan }
  | { ok: false; error: string; code: string };

export async function assistSmartAssembly(
  context: SmartAssemblyContext,
  config: LocalAiConfig = EDIT_PLAN_AI_CONFIG,
): Promise<SmartAssemblyResult> {
  const momentsList = context.availableMoments
    .map(
      (m, i) =>
        `  ${i + 1}. [${m.category.toUpperCase()}] "${m.label}" (Asset: "${m.assetName}" ID: ${m.assetId}) ticks ${m.startTicks}..${m.endTicks}: "${m.summary}"`,
    )
    .join('\n');

  const assetList = context.candidateAssets
    .map((a) => `  - "${a.name}" (ID: ${a.id}, duration ${a.durationTicks} ticks)`)
    .join('\n');

  const clipList = context.clips
    .map((c) => `  - "${c.name}" (ID: ${c.id}, asset ${c.assetId}, start ${c.timelineStartTicks}, dur ${c.timelineDurationTicks})`)
    .join('\n');

  const userMessage = `PROJECT BRIEF:
- Goal: ${context.brief.goal}
- Audience: ${context.brief.audience}
- Target Duration: ${context.brief.targetDurationSeconds}s
- Tone: ${context.brief.tone}
- Call to Action: ${context.brief.cta}

CURRENT TIMELINE:
${clipList || '  (empty timeline)'}

AVAILABLE ASSETS:
${assetList}

UNDERSTOOD MEDIA MOMENTS & SOUNDBITES:
${momentsList || '  (no moments detected)'}

EDITOR INSTRUCTION:
${context.instruction}`;

  try {
    const parsed = await generateStructured<EditPlan>(
      [
        { role: 'system', content: SMART_ASSEMBLY_PROMPT },
        { role: 'user', content: userMessage },
      ],
      (p) => validateModelSmartAssemblyOutput(p, context),
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

function validateModelSmartAssemblyOutput(parsed: unknown, context: SmartAssemblyContext): string | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'Expected a JSON object';
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.summary !== 'string' || obj.summary.trim().length === 0) return 'summary must be non-empty string';
  if (!Array.isArray(obj.operations) || obj.operations.length === 0) return 'operations must be a non-empty array';

  const assetMap = new Map(context.candidateAssets.map((a) => [a.id, a]));
  const clipIds = new Set(context.clips.map((c) => c.id));

  for (let i = 0; i < obj.operations.length; i++) {
    const op = obj.operations[i] as Record<string, unknown>;
    if (typeof op !== 'object' || op === null) return `operations[${i}] must be an object`;

    const kind = op.kind;
    if (kind === 'insert') {
      const asset = assetMap.get(op.assetId as string);
      if (!asset) return `operations[${i}] (insert) references unknown asset ID "${String(op.assetId)}"`;
      const inTicks = BigInt(op.sourceInTicks as string);
      const outTicks = BigInt(op.sourceOutTicks as string);
      const dur = BigInt(asset.durationTicks);
      if (inTicks < 0n || inTicks >= outTicks || outTicks > dur) {
        return `operations[${i}] (insert) has invalid source bounds [${inTicks}..${outTicks}] for asset duration ${dur}`;
      }
    } else if (kind === 'replace') {
      const asset = assetMap.get(op.replacementAssetId as string);
      if (!asset) return `operations[${i}] (replace) references unknown asset ID "${String(op.replacementAssetId)}"`;
      if (!clipIds.has(op.targetClipId as string)) return `operations[${i}] (replace) references unknown clip ID "${String(op.targetClipId)}"`;
      const inTicks = BigInt(op.sourceInTicks as string);
      const outTicks = BigInt(op.sourceOutTicks as string);
      const dur = BigInt(asset.durationTicks);
      if (inTicks < 0n || inTicks >= outTicks || outTicks > dur) {
        return `operations[${i}] (replace) has invalid source bounds [${inTicks}..${outTicks}] for asset duration ${dur}`;
      }
    } else if (kind === 'trim') {
      if (!clipIds.has(op.clipId as string)) return `operations[${i}] (trim) references unknown clip ID "${String(op.clipId)}"`;
    } else if (kind === 'delete') {
      if (!clipIds.has(op.clipId as string)) return `operations[${i}] (delete) references unknown clip ID "${String(op.clipId)}"`;
    } else if (kind === 'reorder') {
      if (!clipIds.has(op.clipId as string)) return `operations[${i}] (reorder) references unknown clip ID "${String(op.clipId)}"`;
    } else {
      return `operations[${i}] unknown kind "${String(kind)}"`;
    }
  }

  return null;
}
