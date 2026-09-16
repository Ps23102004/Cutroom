/**
 * TrimProposalPanel
 *
 * AI trim preview control for the Studio timeline inspector.
 *
 * Architecture constraints (must not be broken):
 *    - AI proposals are PREVIEWED and explicitly accepted before any mutation.
 *    - Raw local-model output NEVER dispatches a native operation on its own.
 *    - Apply routes through the exact existing AppContext trimClip() path
 *      (which performs native composition.apply) -- a second trim is not built.
 *    - Before Apply, the proposal's expectedVersion must equal the CURRENT
 *      composition version. A stale proposal is rejected with zero native calls.
 *    - Dismiss clears local UI state only and makes zero native calls.
 */

import { useCallback, useState } from 'react';
import { Button, Card, Input } from '@cutroom/ui';
import type { Asset, Clip, Composition } from '../lib/contracts';
import {
  assistTrim,
  buildTrimContext,
  isTrimProposalStale,
  type TrimProposal,
} from '../lib/trimAssist';
import { formatRationalTimecode } from '../lib/timecode';

export interface TrimProposalPanelProps {
  projectName: string;
  composition: Composition;
  clip: Clip;
  asset: Asset;
  /** Exact existing native trim operation from AppContext. */
  trimClip: (clipId: string, newInTicks: string, newOutTicks: string) => Promise<void>;
  /** Exact existing native revision operation from AppContext. */
  createRevision: (commitNote: string) => Promise<unknown>;
  /** Model target label, shown so the runtime is never hidden from the editor. */
  modelLabel?: string;
}

/**
 * Format a signed duration delta (in asset-timebase ticks) as a human string
 * such as "-2.0 sec". Display-only: tick arithmetic is exact BigInt; the final
 * human rendering is the only place a Number is used, and it never reaches Apply.
 */
function formatDeltaSeconds(deltaTicks: bigint, asset: Asset): string {
  const num = BigInt(asset.timeBase.num);
  const den = BigInt(asset.timeBase.den);
  if (deltaTicks === 0n) return '0.0 sec';
  const sign = deltaTicks < 0n ? '-' : '+';
  const abs = deltaTicks < 0n ? -deltaTicks : deltaTicks;
  const secondPart = abs * num;
  const whole = secondPart / den;
  const remainder = secondPart % den;
  const total = Number(whole) + (den > 0n ? Number(remainder) / Number(den) : 0);
  return `${sign}${total.toFixed(1)} sec`;
}

export const TrimProposalPanel: React.FC<TrimProposalPanelProps> = ({
  projectName,
  composition,
  clip,
  asset,
  trimClip,
  createRevision,
  modelLabel = 'Gemma 4 E4B (local)',
}) => {
  const [instruction, setInstruction] = useState<string>('');
  const [proposal, setProposal] = useState<TrimProposal | null>(null);
  const [generating, setGenerating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  // Staleness is re-derived every render against the CURRENT composition version:
  // this IS the "re-read the current version" step required immediately before Apply.
  const stale = proposal !== null && isTrimProposalStale(proposal, composition.version);

  const handleGenerate = useCallback(async () => {
    setApplied(null);
    setError(null);
    if (!instruction.trim()) {
      setError('Please describe the trim you want.');
      return;
    }
    setGenerating(true);
    const ctx = buildTrimContext(projectName, composition, clip, asset, instruction.trim());
    const result = await assistTrim(ctx);
    setGenerating(false);
    if (!result.ok) {
      setError(result.error);
      setProposal(null);
      return;
    }
    setProposal(result.proposal);
  }, [projectName, composition, clip, asset, instruction]);

  const handleDismiss = useCallback(() => {
    // Dismiss makes ZERO native calls -- it only clears local UI state and
    // preserves the composition exactly.
    setProposal(null);
    setError(null);
    setApplied(null);
  }, []);

  const handleApply = useCallback(async () => {
    const target = proposal;
    if (!target) return;

    // Staleness guard: the proposal must match the current authoritative version.
    // If the timeline changed, DO NOT call native mutation.
    if (stale) {
      setError('Timeline changed since this proposal was generated. Regenerate the proposal.');
      setProposal(null);
      setApplied(null);
      return;
    }

    // Stale check passed (expectedVersion === current version). Route the
    // validated proposal through the exact existing native trim path.
    setError(null);
    await trimClip(target.clipId, target.newInTicks, target.newOutTicks);
    await createRevision(`AI trim: ${target.reason}`);
    setProposal(null);
    setApplied(
      `Applied AI trim to "${target.clipName}" -- source ` +
        `${formatRationalTimecode(target.newInTicks, asset.timeBase)} \u2192 ` +
        `${formatRationalTimecode(target.newOutTicks, asset.timeBase)}.`,
    );
  }, [proposal, stale, trimClip, createRevision, asset.timeBase]);

  const oldIn = formatRationalTimecode(clip.inTicks, asset.timeBase);
  const oldOut = formatRationalTimecode(clip.outTicks, asset.timeBase);
  const durationDelta =
    BigInt(proposal?.newOutTicks ?? clip.outTicks) - BigInt(proposal?.newInTicks ?? clip.inTicks) -
    (BigInt(clip.outTicks) - BigInt(clip.inTicks));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text-primary, #FAF8FF)' }}>
        AI Edit Proposal &mdash; Trim
      </h4>
      <div style={{ fontSize: '11px', color: 'var(--text-secondary, #C2BCCC)' }}>
        Local model: {modelLabel}. Proposals are previewed and require explicit acceptance. No edit is written until you Apply.
      </div>

      <Input
        label="Trim instruction"
        placeholder="e.g. Shorten this clip by two seconds from the end."
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

      {proposal && !stale && (
        <Card raised padding="sm" data-testid="trim-proposal-preview">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary, #C2BCCC)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              AI Edit Proposal
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-primary, #FAF8FF)' }}>
              <strong>Clip:</strong> {proposal.clipName}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px' }}>
              <div style={{ color: 'var(--text-secondary, #C2BCCC)' }}>
                CURRENT {oldIn} &rarr; {oldOut}
              </div>
              <div style={{ color: 'var(--text-primary, #FAF8FF)' }}>
                PROPOSED {formatRationalTimecode(proposal.newInTicks, asset.timeBase)} &rarr; {formatRationalTimecode(proposal.newOutTicks, asset.timeBase)}
              </div>
              <div style={{ color: 'var(--text-secondary, #C2BCCC)' }}>
                DIFFERENCE {formatDeltaSeconds(durationDelta, asset)}
              </div>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary, #C2BCCC)' }}>
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
        <div role="alert" data-testid="trim-proposal-stale" style={{ fontSize: '12px', color: 'var(--destructive, #E06C75)' }}>
          Timeline changed since this proposal was generated. Regenerate the proposal.
        </div>
      )}
    </div>
  );
};

export default TrimProposalPanel;
