/**
 * Cutroom Media Understanding Engine
 *
 * Local-first media intelligence:
 *   1. Transcripts / ASR segments & word-level timing
 *   2. Transcript <-> source range mapping
 *   3. Silence / dead-space detection
 *   4. Useful moment / hook / cta classification
 *   5. Searchable media index
 *   6. Silence cut assistance (generating EditPlans to tighten timelines)
 *
 * Safety Invariants:
 *   - All derived metadata stays strictly local.
 *   - Only references real asset IDs and bounded source ranges.
 *   - Source media files are never modified, deleted, or moved.
 */

import type {
  Composition,
  MediaMoment,
  MediaUnderstandingMetadata,
  SilenceInterval,
  TranscriptSegment,
} from './contracts';
import type { EditPlan, EditPlanOperation } from './editPlanAssist';

// ---------------------------------------------------------------------------
// Transcript <-> Source Range Mapping & Search
// ---------------------------------------------------------------------------

export interface SearchResult {
  assetId: string;
  startTicks: string;
  endTicks: string;
  text: string;
  speaker?: string;
  category?: string;
  matchType: 'transcript' | 'moment';
}

export function searchMediaIndex(
  metadata: MediaUnderstandingMetadata[],
  query: string,
): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const results: SearchResult[] = [];

  for (const item of metadata) {
    // Search transcripts
    for (const seg of item.transcripts) {
      if (seg.text.toLowerCase().includes(q)) {
        results.push({
          assetId: item.assetId,
          startTicks: seg.startTicks,
          endTicks: seg.endTicks,
          text: seg.text,
          speaker: seg.speaker,
          matchType: 'transcript',
        });
      }
    }

    // Search moments
    for (const moment of item.moments) {
      if (
        moment.label.toLowerCase().includes(q) ||
        moment.summary.toLowerCase().includes(q) ||
        moment.category.toLowerCase().includes(q)
      ) {
        results.push({
          assetId: item.assetId,
          startTicks: moment.startTicks,
          endTicks: moment.endTicks,
          text: `${moment.label}: ${moment.summary}`,
          category: moment.category,
          matchType: 'moment',
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Silence / Dead-Space Detection
// ---------------------------------------------------------------------------

/**
 * Detect dead space / silence gaps between transcript segments within an asset.
 * A silence is any interval between segments (or leading/trailing) greater than
 * minSilenceTicks in the asset timebase.
 */
export function detectSilenceIntervals(
  assetId: string,
  assetDurationTicks: string,
  transcripts: TranscriptSegment[],
  minSilenceTicks: bigint = 24000n, // ~1 second default at 24000
): SilenceInterval[] {
  const silences: SilenceInterval[] = [];
  const duration = BigInt(assetDurationTicks);

  const sorted = [...transcripts].sort((a, b) => {
    const sA = BigInt(a.startTicks), sB = BigInt(b.startTicks);
    return sA < sB ? -1 : sA > sB ? 1 : 0;
  });

  let currentCursor = 0n;

  for (const seg of sorted) {
    const segStart = BigInt(seg.startTicks);
    const segEnd = BigInt(seg.endTicks);

    if (segStart > currentCursor) {
      const gap = segStart - currentCursor;
      if (gap >= minSilenceTicks) {
        silences.push({
          assetId,
          startTicks: currentCursor.toString(),
          endTicks: segStart.toString(),
          durationTicks: gap.toString(),
        });
      }
    }
    if (segEnd > currentCursor) {
      currentCursor = segEnd;
    }
  }

  if (duration > currentCursor) {
    const trailingGap = duration - currentCursor;
    if (trailingGap >= minSilenceTicks) {
      silences.push({
        assetId,
        startTicks: currentCursor.toString(),
        endTicks: duration.toString(),
        durationTicks: trailingGap.toString(),
      });
    }
  }

  return silences;
}

// ---------------------------------------------------------------------------
// Moment Detection (Hooks, Demos, CTAs, Highlights)
// ---------------------------------------------------------------------------

export function classifyMoments(
  assetId: string,
  transcripts: TranscriptSegment[],
): MediaMoment[] {
  const moments: MediaMoment[] = [];

  const HOOK_KEYWORDS = ['welcome', 'today', 'introducing', 'first', 'start', 'look at this'];
  const CTA_KEYWORDS = ['subscribe', 'click', 'link', 'download', 'try', 'sign up', 'contact'];
  const DEMO_KEYWORDS = ['demo', 'feature', 'works', 'how to', 'watch', 'here you can', 'screen'];

  transcripts.forEach((seg, i) => {
    const lower = seg.text.toLowerCase();

    let category: MediaMoment['category'] = 'interview';
    let label = 'Discussion';

    if (CTA_KEYWORDS.some((kw) => lower.includes(kw))) {
      category = 'cta';
      label = 'Call to Action';
    } else if (DEMO_KEYWORDS.some((kw) => lower.includes(kw))) {
      category = 'demo';
      label = 'Product Demo';
    } else if (HOOK_KEYWORDS.some((kw) => lower.includes(kw)) || i === 0) {
      category = 'hook';
      label = 'Opening Hook';
    }

    moments.push({
      id: `moment-${assetId}-${i}`,
      assetId,
      category,
      label,
      startTicks: seg.startTicks,
      endTicks: seg.endTicks,
      summary: seg.text,
    });
  });

  return moments;
}

// ---------------------------------------------------------------------------
// Silence Cut Plan Builder (Deterministic EditPlan Generation)
// ---------------------------------------------------------------------------

/**
 * Builds an EditPlan that trims timeline clips to eliminate detected dead space.
 * If a clip's start has leading silence or end has trailing silence, it trims the clip.
 * Zero mutation: pure function returning structured EditPlan.
 */
export function buildRemoveSilencePlan(
  composition: Composition,
  metadataMap: Map<string, MediaUnderstandingMetadata>,
): EditPlan | null {
  const operations: EditPlanOperation[] = [];

  for (const clip of composition.clips) {
    const meta = metadataMap.get(clip.assetId);
    if (!meta) continue;

    const clipIn = BigInt(clip.inTicks);
    const clipOut = BigInt(clip.outTicks);

    let newIn = clipIn;
    let newOut = clipOut;

    // Check for leading silence
    for (const sil of meta.silences) {
      const silStart = BigInt(sil.startTicks);
      const silEnd = BigInt(sil.endTicks);

      if (silStart <= clipIn && silEnd > clipIn && silEnd < clipOut) {
        newIn = silEnd;
      }
      if (silStart > clipIn && silStart < clipOut && silEnd >= clipOut) {
        newOut = silStart;
      }
    }

    if (newIn !== clipIn || newOut !== clipOut) {
      if (newOut > newIn) {
        operations.push({
          kind: 'trim',
          clipId: clip.id,
          clipName: clip.name,
          newInTicks: newIn.toString(),
          newOutTicks: newOut.toString(),
          reason: `Trim detected silence from clip "${clip.name}"`,
        });
      }
    }
  }

  if (operations.length === 0) return null;

  return {
    summary: `Automatically remove dead space/silence from ${operations.length} clip(s)`,
    expectedVersion: composition.version,
    operations,
  };
}
