/**
 * InsertProposalPanel
 *
 * AI insert preview control for the Studio AI Assistant inspector.
 *
 * INSERT MEANING (must not be broken):
 *   Inserting adds a range of an EXISTING asset to the timeline.
 *   It NEVER modifies, moves, or deletes the original source media file.
 *
 * Architecture constraints (identical to Trim/Reorder/Delete panels):
 *   - AI proposals are PREVIEWED and explicitly accepted before any mutation.
 *   - Raw local-model output NEVER dispatches a native operation on its own.
 *   - Apply routes through the exact existing AppContext addClip() path
 *     (which performs native composition.apply action="add").
 *   - Before Apply the proposal's expectedVersion must equal the CURRENT
 *     composition version AND the proposal must revalidate cleanly against
 *     the current composition. A stale or invalid proposal is rejected with
 *     zero native calls.
 *   - Dismiss clears local UI state only and makes zero native calls.
 *   - The preview ALWAYS shows source range, destination, and resulting order.
 */

import { useCallback, useState } from 'react';
import { Button, Card, Input } from '@cutroom/ui';
import type { Asset, Composition } from '../lib/contracts';
import {
  assistInsert,
  buildInsertContext,
  isInsertProposalStale,
  resolveInsertPlacement,
  validateInsertProposal,
  type InsertProposal,
} from '../lib/insertAssist';
import { formatRationalTimecode } from '../lib/timecode';

export interface InsertProposalPanelProps {
  projectName: string;
  composition: Composition;
  /** Imported assets — the ONLY assets the AI may reference */
  assets: Asset[];
  /** Exact existing native add operation from AppContext. */
  addClip: (params: {
    assetId: string;
    sourceInTicks: string;
    sourceOutTicks: string;
    trackId?: string;
    timelineStartTicks?: string;
  }) => Promise<void>;
  /** Exact existing native revision operation from AppContext. */
  createRevision: (commitNote: string) => Promise<unknown>;
  /** Model target label, shown so the runtime is never hidden from the editor. */
  modelLabel?: string;
}

export const InsertProposalPanel: React.FC<InsertProposalPanelProps> = ({
  projectName,
  composition,
  assets,
  addClip,
  createRevision,
  modelLabel = 'Gemma 4 E4B (local)',
}) => {
  const [instruction, setInstruction] = useState<string>('');
  const [proposal, setProposal] = useState<InsertProposal | null>(null);
  const [generating, setGenerating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  // Staleness re-derived every render against the CURRENT composition version.
  const stale = proposal !== null && isInsertProposalStale(proposal, composition.version);

  const handleGenerate = useCallback(async () => {
    setApplied(null);
    setError(null);
    if (!instruction.trim()) {
      setError('Describe what you want to insert into the timeline.');
      return;
    }
    setGenerating(true);
    const ctx = buildInsertContext(projectName, composition, assets, instruction.trim());
    const result = await assistInsert(ctx);
    setGenerating(false);
    if (!result.ok) {
      setError(result.error);
      setProposal(null);
      return;
    }
    setProposal(result.proposal);
  }, [projectName, composition, assets, instruction]);

  const handleDismiss = useCallback(() => {
    // Dismiss makes ZERO native calls — local UI state only.
    setProposal(null);
    setError(null);
    setApplied(null);
  }, []);

  const handleApply = useCallback(async () => {
    const target = proposal;
    if (!target) return;

    // Revalidate against the CURRENT composition: staleness + full domain
    // validation. Any failure means zero native calls.
    const check = validateInsertProposal(target, { composition, candidateAssets: assets });
    if (!check.valid) {
      setError(check.error);
      setProposal(null);
      setApplied(null);
      return;
    }

    const asset = assets.find((a) => a.id === target.assetId);
    if (!asset) {
      setError(`Asset "${target.assetId}" is no longer available.`);
      setProposal(null);
      return;
    }
    const placement = resolveInsertPlacement(target, asset.timeBase, composition);
    if (!placement.ok) {
      setError(placement.error);
      setProposal(null);
      return;
    }

    // Route the validated proposal through the exact existing native add path.
    setError(null);
    await addClip({
      assetId: target.assetId,
      sourceInTicks: target.sourceInTicks,
      sourceOutTicks: target.sourceOutTicks,
      trackId: target.targetTrackId,
      timelineStartTicks: placement.resolved.timelineStartTicks,
    });
    await createRevision(`AI insert: ${target.reason}`);
    setProposal(null);
    setApplied(
      `Inserted "${target.assetName}" into the timeline. ` +
        `The original source media was not modified.`,
    );
  }, [proposal, composition, assets, addClip, createRevision]);

  const proposalAsset = proposal
    ? assets.find((a) => a.id === proposal.assetId)
    : undefined;
  const targetTrack = proposal
    ? composition.tracks.find((t) => t.id === proposal.targetTrackId)
    : undefined;

  // Display-only preview rendering, recomputed from the CURRENT composition.
  const preview = (() => {
    if (!proposal || !proposalAsset) return null;
    const placement = resolveInsertPlacement(proposal, proposalAsset.timeBase, composition);
    const srcRange =
      `${formatRationalTimecode(proposal.sourceInTicks, proposalAsset.timeBase)} \u2192 ` +
      `${formatRationalTimecode(proposal.sourceOutTicks, proposalAsset.timeBase)}`;
    if (!placement.ok) return { srcRange, error: placement.error as string };
    return {
      srcRange,
      destination: targetTrack
        ? `Track "${targetTrack.label}" at ${formatRationalTimecode(placement.resolved.timelineStartTicks, composition.timeBase)}`
        : proposal.targetTrackId,
      range: `${formatRationalTimecode(placement.resolved.timelineStartTicks, composition.timeBase)} \u2192 ${formatRationalTimecode((BigInt(placement.resolved.timelineStartTicks) + BigInt(placement.resolved.timelineDurationTicks)).toString(), composition.timeBase)}`,
      error: null as string | null,
    };
  })();

  // Resulting order on the target track with the insert in place (display only).
  const resultingOrder = (() => {
    if (!proposal || !proposalAsset || !preview || preview.error) return null;
    const placement = resolveInsertPlacement(proposal, proposalAsset.timeBase, composition);
    if (!placement.ok) return null;
    const start = BigInt(placement.resolved.timelineStartTicks);
    const end = start + BigInt(placement.resolved.timelineDurationTicks);
    const entries = composition.clips
      .filter((c) => c.trackId === proposal.targetTrackId)
      .map((c) => ({ name: c.name, s: BigInt(c.timelineStartTicks), e: BigInt(c.timelineStartTicks) + BigInt(c.timelineDurationTicks) }));
    entries.push({ name: `\u2605 ${proposal.assetName} (new)`, s: start, e: end });
    entries.sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
    return entries.map((e) => e.name).join('  \u2192  ');
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text-primary, #FAF8FF)' }}>
        AI Edit Proposal &mdash; Insert
      </h4>
      <div style={{ fontSize: '11px', color: 'var(--text-secondary, #C2BCCC)' }}>
        Local model: {modelLabel}. Proposals are previewed and require explicit acceptance. No edit is written until you Apply.
      </div>

      <Input
        label="Insert instruction"
        placeholder="e.g. Insert the product demo clip at the end of the main track."
        value={instruction}
        onChange={(e) => setInstruction(e.currentTarget.value)}
      />

      <Button
        size="sm"
        variant="secondary"
        onClick={() => void handleGenerate()}
        isLoading={generating}
        disabled={assets.length === 0}
      >
        Generate Proposal
      </Button>

      {assets.length === 0 && (
        <div style={{ fontSize: '11px', color: 'var(--text-tertiary-panel, #9D95B0)' }}>
          Import a source asset first — AI can only insert from assets already in this project.
        </div>
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

      {proposal && !stale && preview && (
        <Card raised padding="sm" data-testid="insert-proposal-preview">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary, #C2BCCC)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              AI Edit Proposal
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-primary, #FAF8FF)' }}>
              <strong>Source:</strong> {proposal.assetName} &mdash; {preview.srcRange}
            </div>
            {preview.error ? (
              <div role="alert" style={{ fontSize: '12px', color: 'var(--destructive, #E06C75)' }}>
                {preview.error}
              </div>
            ) : (
              <>
                <div style={{ fontSize: '12px', color: 'var(--text-primary, #FAF8FF)' }}>
                  <strong>Insert:</strong> {preview.destination}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary, #C2BCCC)' }}>
                  Timeline range: {preview.range}
                </div>
                {resultingOrder && (
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary, #C2BCCC)' }}>
                    <strong>Result:</strong> {resultingOrder}
                  </div>
                )}
              </>
            )}
            <div style={{ fontSize: '12px', color: 'var(--text-secondary, #C2BCCC)' }}>
              <strong>Reason:</strong> {proposal.reason}
            </div>

            {/* Safety invariant made explicit in the preview every time. */}
            <div
              role="note"
              data-testid="insert-media-safe"
              style={{
                fontSize: '11px',
                color: 'var(--text-tertiary-panel, #9D95B0)',
                borderTop: '1px solid var(--border-subtle, #1E1E2A)',
                paddingTop: '6px',
              }}
            >
              Inserting adds a timeline clip that references the source. Original media will not be modified.
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void handleApply()}
                data-testid="insert-apply-button"
              >
                Apply Insert
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
        <div role="alert" data-testid="insert-proposal-stale" style={{ fontSize: '12px', color: 'var(--destructive, #E06C75)' }}>
          Timeline changed since this proposal was generated. Regenerate the proposal.
        </div>
      )}
    </div>
  );
};

export default InsertProposalPanel;
