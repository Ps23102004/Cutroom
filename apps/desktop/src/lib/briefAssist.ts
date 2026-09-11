/**
 * Cutroom Brief Assist
 *
 * Uses the local AI provider to convert natural-language requests into
 * structured ProjectBrief proposals. The user reviews the proposal before
 * it is persisted via brief.set.
 *
 * Does NOT generate updatedAt — that is owned by native brief.set.
 */

import type { ProjectBrief } from './contracts';
import {
  generateStructured,
  health,
  LocalAiError,
  type LocalAiConfig,
  DEFAULT_LOCAL_AI_CONFIG,
} from './localAi';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Fields the AI may propose. updatedAt is excluded. */
export type BriefProposal = Omit<ProjectBrief, 'updatedAt'>;

export interface BriefAssistInput {
  instruction: string;
  project: {
    name: string;
    aspectRatio: string;
    fpsNumerator?: number;
    fpsDenominator?: number;
  };
  currentBrief: ProjectBrief | null;
}

export type BriefAssistResult =
  | { ok: true; proposal: BriefProposal; rawModel?: string }
  | { ok: false; error: string; code: string };

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a video editing assistant for Cutroom. Your job is to convert a user\'s natural-language brief request into a structured ProjectBrief JSON object.

Return ONLY valid JSON matching this exact schema (no extra fields):
{
  "goal": string,
  "audience": string,
  "targetDurationSeconds": number,
  "aspectRatio": "16:9" | "9:16" | "1:1",
  "requiredSegments": string,
  "excludedSegments": string,
  "tone": string,
  "style": string,
  "cta": string
}

Rules:
- Preserve existing values when the user did not request changes.
- Do not invent fields not in the schema.
- targetDurationSeconds must be a positive integer.
- aspectRatio must be exactly "16:9", "9:16", or "1:1".
- Return only the JSON object. No explanation, no markdown fencing.`;

// ---------------------------------------------------------------------------
// Build user message
// ---------------------------------------------------------------------------

function buildUserMessage(input: BriefAssistInput): string {
  const parts: string[] = [];

  parts.push(`Project: ${input.project.name}`);
  parts.push(`Current aspect ratio: ${input.project.aspectRatio}`);

  if (input.currentBrief) {
    parts.push('');
    parts.push('Current brief:');
    const { updatedAt: _, ...briefFields } = input.currentBrief;
    parts.push(JSON.stringify(briefFields, null, 2));
  }

  parts.push('');
  parts.push(`User request: ${input.instruction}`);

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_ASPECTS = new Set(['16:9', '9:16', '1:1']);
const BRIEF_KEYS = new Set([
  'goal', 'audience', 'targetDurationSeconds', 'aspectRatio',
  'requiredSegments', 'excludedSegments', 'tone', 'style', 'cta',
]);

function validateBriefProposal(parsed: unknown): string | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return 'Expected a JSON object';
  }

  const obj = parsed as Record<string, unknown>;

  // Check for unknown keys
  for (const key of Object.keys(obj)) {
    if (!BRIEF_KEYS.has(key)) {
      return `Unknown field: "${key}"`;
    }
  }

  // Type checks
  if (typeof obj.goal !== 'undefined' && typeof obj.goal !== 'string') return 'goal must be a string';
  if (typeof obj.audience !== 'undefined' && typeof obj.audience !== 'string') return 'audience must be a string';
  if (typeof obj.tone !== 'undefined' && typeof obj.tone !== 'string') return 'tone must be a string';
  if (typeof obj.style !== 'undefined' && typeof obj.style !== 'string') return 'style must be a string';
  if (typeof obj.cta !== 'undefined' && typeof obj.cta !== 'string') return 'cta must be a string';
  if (typeof obj.requiredSegments !== 'undefined' && typeof obj.requiredSegments !== 'string') {
    return 'requiredSegments must be a string';
  }
  if (typeof obj.excludedSegments !== 'undefined' && typeof obj.excludedSegments !== 'string') {
    return 'excludedSegments must be a string';
  }

  if (typeof obj.targetDurationSeconds !== 'undefined') {
    if (typeof obj.targetDurationSeconds !== 'number' || obj.targetDurationSeconds <= 0) {
      return 'targetDurationSeconds must be a positive number';
    }
  }

  if (typeof obj.aspectRatio !== 'undefined') {
    if (!VALID_ASPECTS.has(obj.aspectRatio as string)) {
      return `aspectRatio must be one of: ${[...VALID_ASPECTS].join(', ')}`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Merge: fill in missing fields from current brief or defaults
// ---------------------------------------------------------------------------

const BRIEF_DEFAULTS: BriefProposal = {
  goal: '',
  audience: '',
  targetDurationSeconds: 60,
  aspectRatio: '16:9',
  requiredSegments: '',
  excludedSegments: '',
  tone: 'Direct, informative',
  style: 'Fast-paced, modern',
  cta: '',
};

function mergeProposal(
  partial: Partial<BriefProposal>,
  current: ProjectBrief | null,
): BriefProposal {
  const base = current
    ? { ...BRIEF_DEFAULTS, ...current }
    : BRIEF_DEFAULTS;

  return {
    goal: partial.goal ?? base.goal,
    audience: partial.audience ?? base.audience,
    targetDurationSeconds: partial.targetDurationSeconds ?? base.targetDurationSeconds,
    aspectRatio: (partial.aspectRatio ?? base.aspectRatio) as '16:9' | '9:16' | '1:1',
    requiredSegments: partial.requiredSegments ?? base.requiredSegments,
    excludedSegments: partial.excludedSegments ?? base.excludedSegments,
    tone: partial.tone ?? base.tone,
    style: partial.style ?? base.style,
    cta: partial.cta ?? base.cta,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether local AI is available for brief assist.
 */
export async function briefAssistAvailable(
  config: LocalAiConfig = DEFAULT_LOCAL_AI_CONFIG,
): Promise<{ available: boolean; error?: string }> {
  try {
    const h = await health(config);
    return { available: h.ok, error: h.error };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { available: false, error: msg };
  }
}

/**
 * Generate a structured brief proposal from natural language.
 *
 * Returns a validated BriefProposal (without updatedAt) that the UI
 * can preview before calling saveBrief().
 */
export async function assistBrief(
  input: BriefAssistInput,
  config: LocalAiConfig = DEFAULT_LOCAL_AI_CONFIG,
): Promise<BriefAssistResult> {
  if (!input.instruction.trim()) {
    return { ok: false, error: 'Please describe what you want for this brief.', code: 'EMPTY_INPUT' };
  }

  try {
    const partial = await generateStructured<Partial<BriefProposal>>(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserMessage(input) },
      ],
      validateBriefProposal,
      config,
    );

    const proposal = mergeProposal(partial, input.currentBrief);
    return { ok: true, proposal };
  } catch (err: unknown) {
    if (err instanceof LocalAiError) {
      return { ok: false, error: err.message, code: err.code };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, code: 'UNKNOWN' };
  }
}
