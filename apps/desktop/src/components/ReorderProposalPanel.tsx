/**
 * ReorderProposalPanel
 *
 * AI reorder preview control for the Studio timeline inspector.
 *
 * Architecture constraints (identical to TrimProposalPanel):
 *    - AI proposals are PREVIEWED and explicitly accepted before any mutation.
 *    - Raw local-model output NEVER dispatches a native operation on its own.
 *    - Apply routes through the exact existing AppContext reorderClips() path
 *      (which performs native composition.apply) — a second reorder is not built.
 *    - Before Apply, the proposal's expectedVersion must equal the CURRENT
 *      composition version. A stale proposal is rejected with zero native calls.
 *    - Dismiss clears local UI state only and makes zero native calls.
 */

import { useCallback, useState } from 'react';
import { Button, Card, Input } from '@cutroom/ui';
import type { Clip, Composition } from '../lib/contracts';
import {
  assistReorder,
  buildReorderContext,
  isReorderProposalStale,
  type ReorderProposal,
} from '../lib/reorderAssist';

export interface ReorderProposalPanelProps {
  projectName: string;
  composition: Composition;
  clip: Clip;
  /** Exact existing native reorder operation from AppContext. */
  reorderClips: (clipId: string, direction: 'left' | 'right') => Promise<void>;
  /** Exact existing native revision operation from AppContext. */
  createRevision: (commitNote: string) => Promise<unknown>;
  /** Model target label. */
  modelLabel?: string;
}

export const ReorderProposalPanel: React.FC<ReorderProposalPanelProps> = ({
  projectName,
  composition,
  clip,
  reorderClips,
  createRevision,
  modelLabel = 'Gemma 4 E4B (local)',
}) => {
  const [instruction, setInstruction] = useState<string>('');
  const [proposal, setProposal] = useState<ReorderProposal | null>(null);
  const [generating, setGenerating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  // Staleness re-derived every render against the CURRENT composition version.
  const stale = proposal !== null && isReorderProposalStale(proposal, composition.version);

  // Build the current track order for display
  const trackClips = composition.clips
    .filter((c) => c.trackId === clip.trackId)
    .sort((a, b) => {
      const aStart = BigInt(a.timelineStartTicks);
      const bStart = BigInt(b.timelineStartTicks);
      if (aStart < bStart) return -1;
      if (aStart > bStart) return 1;
      return 0;
    });

  const clipIndex = trackClips.findIndex((c) => c.id === clip.id);

  // Compute the proposed order for preview
  const proposedOrder = proposal && !stale ? (() => {
    const order = [...trackClips];
    const idx = order.findIndex((c) => c.id === proposal.clipId);
    if (idx === -1) return order;
    const targetIdx = proposal.direction === 'left' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= order.length) return order;
    const temp = order[idx];
    order[idx] = order[targetIdx];
    order[targetIdx] = temp;
    return order;
  })() : null;

  const handleGenerate = useCallback(async () => {
    setApplied(null);
    setError(null);
    if (!instruction.trim()) {
      setError('Please describe how you want to reorder the clips.');
      return;
    }
    setGenerating(true);
    const ctx = buildReorderContext(projectName, composition, clip, instruction.trim());
    const result = await assistReorder(ctx);
    setGenerating(false);
    if (!result.ok) {
      setError(result.error);
      setProposal(null);
      return;
    }
    setProposal(result.proposal);
  }, [projectName, composition, clip, instruction]);

  const handleDismiss = useCallback(() => {
    // Dismiss makes ZERO native calls.
    setProposal(null);
    setError(null);
    setApplied(null);
  }, []);

  const handleApply = useCallback(async () => {
    const target = proposal;
    if (!target) return;

    // Staleness guard
    if (stale) {
      setError('Timeline changed since this proposal was generated. Regenerate the proposal.');
      setProposal(null);
      setApplied(null);
      return;
    }

    setError(null);
    await reorderClips(target.clipId, target.direction);
    await createRevision(`AI reorder: ${target.reason}`);
    setProposal(null);
    setApplied(
      `Applied AI reorder: moved "${target.clipName}" ${target.direction}.`,
    );
  }, [proposal, stale, reorderClips, createRevision]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text-primary, #F3F0F6)' }}>
        AI Edit Proposal &mdash; Reorder
      </h4>
      <div style={{ fontSize: '11px', color: 'var(--text-secondary, #BAB3C5)' }}>
        Local model: {modelLabel}. Proposals are previewed and require explicit acceptance. No edit is written until you Apply.
      </div>

      {/* Current track order context */}
      <div style={{ fontSize: '11px', color: 'var(--text-tertiary-panel, #9A91A7)' }}>
        Track order ({trackClips.length} clip{trackClips.length !== 1 ? 's' : ''}):{" "}
        {trackClips.map((c, i) => (
          <span key={c.id}>
            {i > 0 && ' \u2192 '}
            <span style={{
              fontWeight: c.id === clip.id ? 700 : 400,
              color: c.id === clip.id ? 'var(--text-primary, #F3F0F6)' : undefined,
            }}>
              {c.name}
            </span>
          </span>
        ))}
      </div>

      {clipIndex !== -1 && trackClips.length < 2 && (
        <div style={{ fontSize: '11px', color: 'var(--text-tertiary-panel, #9A91A7)' }}>
          Reorder requires at least two clips on the same track.
        </div>
      )}

      {trackClips.length >= 2 && (
        <>
          <Input
            label="Reorder instruction"
            placeholder="e.g. Move this clip to the beginning of the track."
            value={instruction}
            onChange={(e) => setInstruction(e.currentTarget.value)}
          />

          <Button
            size="sm"
            variant="secondary"
            onClick={() => void handleGenerate()}
            isLoading={generating}
          >
            Generate Proposal
          </Button>
        </>
      )}

      {error && (
        <div role="alert" style={{ fontSize: '12px', color: 'var(--destructive, #E06C75)' }}>
          {error}
        </div>
      )}

      {applied && (
        <div role="status" style={{ fontSize: '12px', color: 'var(--positive, #A7D7A1)' }}>
          {applied}
        </div>
      )}

      {proposal && !stale && proposedOrder && (
        <Card raised padding="sm" data-testid="reorder-proposal-preview">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary, #BAB3C5)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              AI Edit Proposal
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-primary, #F3F0F6)' }}>
              <strong>Clip:</strong> {proposal.clipName} &mdash; move {proposal.direction}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px' }}>
              <div style={{ color: 'var(--text-secondary, #BAB3C5)' }}>
                CURRENT{" "}
                {trackClips.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && ' \u2192 '}
                    <span style={{ fontWeight: c.id === proposal.clipId ? 700 : 400 }}>
                      {c.name}
                    </span>
                  </span>
                ))}
              </div>
              <div style={{ color: 'var(--text-primary, #F3F0F6)' }}>
                PROPOSED{" "}
                {proposedOrder.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && ' \u2192 '}
                    <span style={{ fontWeight: c.id === proposal.clipId ? 700 : 400 }}>
                      {c.name}
                    </span>
                  </span>
                ))}
              </div>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)' }}>
              <strong>Reason:</strong> {proposal.reason}
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <Button
                size="sm"
                variant="primary"
                onClick={() => void handleApply()}
              >
                Apply Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleDismiss}
              >
                Dismiss
              </Button>
            </div>
          </div>
        </Card>
      )}

      {proposal && stale && (
        <div role="alert" data-testid="reorder-proposal-stale" style={{ fontSize: '12px', color: 'var(--destructive, #E06C75)' }}>
          Timeline changed since this proposal was generated. Regenerate the proposal.
        </div>
      )}
    </div>
  );
};

export default ReorderProposalPanel;
