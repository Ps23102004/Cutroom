/**
 * Cutroom Client Review Engine
 *
 * Pipeline:
 *   render/revision -> timecoded client comment -> structured AI proposal -> creator preview -> Apply -> new revision
 *
 * Safety & Security Invariant:
 *   Client comments NEVER directly mutate the timeline.
 *   Every comment translation produces a structured proposal requiring explicit creator preview and approval.
 */

import type { Asset, Clip, Composition, ClientReviewComment } from './contracts';
import {
  generateStructured,
  LocalAiError,
  type LocalAiConfig,
} from './localAi';
import { EDIT_PLAN_AI_CONFIG, type EditPlan } from './editPlanAssist';

export interface ClientCommentContext {
  comment: ClientReviewComment;
  composition: Composition;
  targetClip?: Clip;
  candidateAssets: Asset[];
}

export function findClipAtTimelineTicks(composition: Composition, ticks: string): Clip | undefined {
  const t = BigInt(ticks);
  return composition.clips.find((c) => {
    const start = BigInt(c.timelineStartTicks);
    const end = start + BigInt(c.timelineDurationTicks);
    return t >= start && t < end;
  });
}

const CLIENT_COMMENT_SYSTEM_PROMPT = `You are an assistant converting timecoded client review comments into structured timeline EditPlans for a human video editor to review.

The client left a comment at a specific timecode on the video. Translate their feedback into a structured 1-step or 2-step EditPlan to address their comment.

Allowed operation kinds: "trim", "reorder", "delete", "insert", "replace".

CRITICAL RULES:
- ONLY reference real clip IDs and asset IDs provided in the context. Never invent IDs.
- Do NOT directly mutate anything. Return ONLY valid JSON matching this schema:
{
    "summary": string,
    "operations": Array<EditPlanOperation>
}`;

export type ClientCommentProposalResult =
  | { ok: true; plan: EditPlan }
  | { ok: false; error: string; code: string };

export async function assistClientCommentToPlan(
  context: ClientCommentContext,
  config: LocalAiConfig = EDIT_PLAN_AI_CONFIG,
): Promise<ClientCommentProposalResult> {
  const clipList = context.composition.clips
    .map(
      (c) =>
        `  - "${c.name}" (ID: ${c.id}, asset ${c.assetId}, start ${c.timelineStartTicks}, dur ${c.timelineDurationTicks}, in ${c.inTicks}..${c.outTicks})`,
    )
    .join('\n');

  const assetList = context.candidateAssets
    .map((a) => `  - "${a.name}" (ID: ${a.id}, duration ${a.durationTicks} ticks)`)
    .join('\n');

  const targetClipInfo = context.targetClip
    ? `Target clip at comment position: "${context.targetClip.name}" (ID: ${context.targetClip.id})`
    : 'No clip found directly under the comment playhead';

  const userMessage = `TIMELINE CLIPS:
${clipList}

AVAILABLE ASSETS:
${assetList}

CLIENT REVIEW COMMENT:
- Author: ${context.comment.author}
- Timecode Ticks: ${context.comment.timelineTicks}
- Comment: "${context.comment.comment}"
- ${targetClipInfo}

Composition Version: ${context.composition.version}`;

  try {
    const parsed = await generateStructured<EditPlan>(
      [
        { role: 'system', content: CLIENT_COMMENT_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      undefined,
      config,
    );

    const plan: EditPlan = {
      summary: `Address feedback: ${context.comment.comment}`,
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
