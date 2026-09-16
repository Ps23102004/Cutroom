/**
 * ReplaceProposalPanel
 *
 * AI replace preview control for the Studio AI Assistant inspector.
 *
 * REPLACE MEANING (must not be broken):
 *   Replacing swaps a timeline clip's source asset and in/out points in place.
 *   Later clips on the same track ripple by the duration delta.
 *   It NEVER modifies, moves, or deletes the original source media file.
 *
 * Architecture constraints (identical to Trim/Reorder/Delete/Insert panels):
 *   - AI proposals are PREVIEWED and explicitly accepted before any mutation.
 *   - Raw local-model output NEVER dispatches a native operation on its own.
 *   - Apply routes through the exact existing AppContext replaceClip() path
 *     (which performs native composition.apply action="replace").
 *   - Immediately before Apply the proposal's expectedVersion must equal the
 *     CURRENT composition version AND the proposal must revalidate cleanly
 *     against the current composition. A stale or invalid proposal is rejected
 *     with zero native calls.
 *   - Dismiss clears local UI state only and makes zero native calls.
 *   - The preview ALWAYS shows current clip, replacement asset/range, duration delta, and reason.
 */

import { useCallback, useState } from 'react';
import { Button, Card, Input } from '@cutroom/ui';
import type { Asset, Clip, Composition } from '../lib/contracts';
import {
  assistReplace,
  buildReplaceContext,
  calculateReplaceDelta,
  isReplaceProposalStale,
  validateReplaceProposal,
  type ReplaceProposal,
} from '../lib/replaceAssist';
import { formatRationalTimecode } from '../lib/timecode';

export interface ReplaceProposalPanelProps {
  projectName: string;
  composition: Composition;
  /** The selected clip on the timeline to replace */
  clip: Clip;
  /** Asset of the selected clip (for current source range display) */
  selectedClipAsset?: Asset;
  /** Imported assets — the ONLY assets the AI may reference as replacement */
  assets: Asset[];
  /** Exact existing native replace operation from AppContext. */
  replaceClip: (
    clipId: string,
    assetId: string,
    sourceInTicks: string,
    sourceOutTicks: string,
  ) => Promise<void>;
  /** Exact existing native revision operation from AppContext. */
  createRevision: (commitNote: string) => Promise<unknown>;
  /** Model target label, shown so the runtime is never hidden from the editor. */
  modelLabel?: string;
}

export const ReplaceProposalPanel: React.FC<ReplaceProposalPanelProps> = ({
  projectName,
  composition,
  clip,
  selectedClipAsset,
  assets,
  replaceClip,
  createRevision,
  modelLabel = 'Gemma 4 E4B (local)',
}) => {
  const [instruction, setInstruction] = useState<string>('');
  const [proposal, setProposal] = useState<ReplaceProposal | null>(null);
  const [generating, setGenerating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  // Staleness re-derived every render against the CURRENT composition version.
  const stale = proposal !== null && isReplaceProposalStale(proposal, composition.version);

  const handleGenerate = useCallback(async () => {
    setApplied(null);
    setError(null);
    if (!instruction.trim()) {
      setError('Describe what you want to replace this clip with.');
      return;
    }
    setGenerating(true);
    const ctx = buildReplaceContext(projectName, composition, clip, assets, instruction.trim());
    const result = await assistReplace(ctx);
    setGenerating(false);
    if (!result.ok) {
      setError(result.error);
      setProposal(null);
      return;
    }
    setProposal(result.proposal);
  }, [projectName, composition, clip, assets, instruction]);

  const handleDismiss = useCallback(() => {
    // Dismiss makes ZERO native calls — local UI state only.
    setProposal(null);
    setError(null);
    setApplied(null);
  }, []);

  const handleApply = useCallback(async () => {
    const target = proposal;
    if (!target) return;

    // Immediately before Apply: expectedVersion === current composition.version
    const check = validateReplaceProposal(target, {
      composition,
      targetClip: clip,
      candidateAssets: assets,
    });
    if (!check.valid) {
      setError(check.error);
      setProposal(null);
      setApplied(null);
      return;
    }

    const replacementAsset = assets.find((a) => a.id === target.replacementAssetId);
    if (!replacementAsset) {
      setError(`Replacement asset "${target.replacementAssetId}" is no longer available.`);
      setProposal(null);
      return;
    }

    // Route the validated proposal through the exact existing native replace path.
    setError(null);
    try {
      await replaceClip(
        target.targetClipId,
        target.replacementAssetId,
        target.sourceInTicks,
        target.sourceOutTicks,
      );
      await createRevision(`AI replace: ${target.reason}`);
      setProposal(null);
      setApplied(
        `Replaced "${target.targetClipName}" with "${target.replacementAssetName}". ` +
          `Original source media will not be modified.`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      // Native failure: do not show success
      setApplied(null);
    }
  }, [proposal, composition, clip, assets, replaceClip, createRevision]);

  const replacementAsset = proposal
    ? assets.find((a) => a.id === proposal.replacementAssetId)
    : undefined;

  // Display-only preview rendering, recomputed from CURRENT composition and clip.
  const preview = (() => {
    if (!proposal || !replacementAsset) return null;
    const delta = calculateReplaceDelta(
      clip,
      replacementAsset,
      proposal.sourceInTicks,
      proposal.sourceOutTicks,
      composition.timeBase,
    );

    const currentSrcRange = selectedClipAsset
      ? `${formatRationalTimecode(clip.inTicks, selectedClipAsset.timeBase)} → ${formatRationalTimecode(clip.outTicks, selectedClipAsset.timeBase)}`
      : `${clip.inTicks} → ${clip.outTicks} ticks`;

    const replacementSrcRange =
      `${formatRationalTimecode(proposal.sourceInTicks, replacementAsset.timeBase)} → ` +
      `${formatRationalTimecode(proposal.sourceOutTicks, replacementAsset.timeBase)}`;

    const deltaSign = BigInt(delta.durationDeltaTicks) >= 0n ? '+' : '';
    const deltaSeconds =
      (Number(delta.durationDeltaTicks) * composition.timeBase.num) / composition.timeBase.den;
    const deltaFormatted = `${deltaSign}${deltaSeconds.toFixed(2)}s (${deltaSign}${delta.durationDeltaTicks} ticks)`;

    return {
      currentClip: `"${clip.name}" (${currentSrcRange})`,
      replaceWith: `"${proposal.replacementAssetName}" (${replacementSrcRange})`,
      durationChange: deltaFormatted,
      reason: proposal.reason,
    };
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text-primary, #FAF8FF)' }}>
        AI Edit Proposal &mdash; Replace
      </h4>
      <div style={{ fontSize: '11px', color: 'var(--text-secondary, #C2BCCC)' }}>
        Local model: {modelLabel}. Swaps the clip's source in place and ripples later clips. Original media is never modified.
      </div>

      <div style={{ fontSize: '12px', color: 'var(--text-primary, #FAF8FF)' }}>
        <strong>Selected clip:</strong> {clip.name}
      </div>

      <Input
        label="Replace instruction"
        placeholder="e.g. Replace with b-roll take 2 showing the product closeup."
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
          Import a replacement asset first — AI can only replace from assets already in this project.
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
        <Card raised padding="sm" data-testid="replace-proposal-preview">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--text-secondary, #C2BCCC)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              AI Edit Proposal &mdash; Replace
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-primary, #FAF8FF)' }}>
              <strong>CURRENT:</strong> {preview.currentClip}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-primary, #FAF8FF)' }}>
              <strong>REPLACE WITH:</strong> {preview.replaceWith}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary, #C2BCCC)' }}>
              <strong>DURATION CHANGE:</strong> {preview.durationChange}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary, #C2BCCC)' }}>
              <strong>REASON:</strong> {preview.reason}
            </div>

            {/* Safety note: Original source media will not be modified */}
            <div
              role="note"
              data-testid="replace-media-safe"
              style={{
                fontSize: '11px',
                color: 'var(--text-tertiary-panel, #9D95B0)',
                borderTop: '1px solid var(--border-subtle, #1E1E2A)',
                paddingTop: '6px',
              }}
            >
              Original source media will not be modified.
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void handleApply()}
                data-testid="replace-apply-button"
              >
                Apply Replace
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleDismiss}
                data-testid="replace-dismiss-button"
              >
                Dismiss
              </Button>
            </div>
          </div>
        </Card>
      )}

      {proposal && stale && (
        <div
          role="alert"
          data-testid="replace-proposal-stale"
          style={{ fontSize: '12px', color: 'var(--destructive, #E06C75)' }}
        >
          Timeline changed since this proposal was generated. Regenerate the proposal.
        </div>
      )}
    </div>
  );
};

export default ReplaceProposalPanel;
